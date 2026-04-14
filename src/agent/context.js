/**
 * Context Management — system prompt builder + token estimation.
 *
 * Mirrors s05 (skills) + s06 (compression) from learn-claude-code.
 */

import { normalizePromptConfig } from './prompt-config.js'
import { defaultSkillLoader } from './skills.js'
import { getToolsByTags } from './tools/index.js'

/**
 * Build the system prompt that tells the LLM who it is and what tools it has.
 *
 * @param {object} state - Current session state.
 * @param {string} state.mode - Current agent mode.
 * @param {string} state.version - Selected version (may be empty).
 * @param {string} state.environment - Target environment.
 * @param {string} state.workspacePath - Current workspace root from settings.
 * @param {string[]} state.completedTools - Names of already-completed tools.
 * @returns {string} System prompt.
 */
export function buildSystemPrompt(state = {}) {
  const promptConfig = normalizePromptConfig(state.promptConfig)
  const mode = state.mode || 'general'
  const workflowId = state.workflowId || mode
  const version = state.version || '未选择'
  const env = state.environment || '未选择'
  const workspacePath = state.workspacePath || '未设置'
  const memorySummary = String(state.memorySummary || '').trim()
  const memorySection = memorySummary ? `## Memory\n\n${memorySummary}` : '## Memory\n\n(no memory loaded)'
  const primedSkillBundle = String(state.primedSkillBundle || '').trim()
  const primedSkillSection = primedSkillBundle ? `## Primed Skills\n\n${primedSkillBundle}` : '## Primed Skills\n\n(no primed skills)'
  const completed = state.completedTools || []
  const availableTools = resolveAvailableTools(state)
  const roleIntro = mode === 'release'
    ? promptConfig.role.releaseIntro
    : promptConfig.role.generalIntro
  const workflowGuidance = mode === 'release'
    ? promptConfig.workflow.release
    : promptConfig.workflow.general
  const workflowPrompt = String(state.workflowPrompt || '').trim()
  const policyLines = buildPolicyLines(state.policy)
  const specialRules = promptConfig.specialRules.map(rule => `- ${rule}`).join('\n')
  const responseRules = promptConfig.responseRules.map(rule => `- ${rule}`).join('\n')
  const toolSummary = formatToolSummary(availableTools)

  return [
    roleIntro,
    '',
    '## Tool Surface',
    '',
    toolSummary,
    '',
    '## Skills（可加载的专业知识）',
    '',
    `可用技能：${defaultSkillLoader.list().join('、')}`,
    '',
    promptConfig.skillPolicyIntro,
    '',
    '## Policy',
    '',
    policyLines,
    '',
    '特别规则：',
    specialRules,
    '',
    memorySection,
    '',
    primedSkillSection,
    '',
    '## 工作方式',
    '',
    workflowGuidance,
    workflowPrompt ? '' : null,
    workflowPrompt || null,
    '',
    '## 当前状态',
    '',
    `- 当前模式：${mode}`,
    `- 当前工作流：${workflowId}`,
    `- 目标环境：${env}`,
    `- 选定版本：${version}`,
    `- 当前工作区：${workspacePath}`,
    `- 已完成步骤：${completed.length > 0 ? completed.join(', ') : '无'}`,
    '',
    '## 回复规则',
    '',
    responseRules
  ].filter(Boolean).join('\n')
}

/**
 * Rough token estimation (chars / 4).
 */
export function estimateTokens(messages) {
  return Math.ceil(JSON.stringify(messages).length / 4)
}

/**
 * Compress old tool results to keep context size manageable.
 * Preserves the last N tool results in full; older ones get summarized
 * so the LLM retains awareness of what happened earlier.
 *
 * @param {Array} messages - OpenAI-format messages array (mutated in-place).
 * @param {number} keepLast - How many recent tool messages to preserve in full.
 */
export function microcompact(messages, keepLast = 6) {
  const toolMsgs = messages.filter(m => m.role === 'tool')
  if (toolMsgs.length <= keepLast) return

  const toClear = toolMsgs.slice(0, -keepLast)
  for (const msg of toClear) {
    if (typeof msg.content !== 'string' || msg.content.length <= 200) continue
    const summary = extractToolSummary(msg.content)
    msg.content = summary
  }
}

/**
 * Extract a concise summary from a tool result JSON string.
 * Keeps `ok`, `summary`, `count`, key status fields; drops large arrays.
 */
function extractToolSummary(content) {
  try {
    const parsed = JSON.parse(content)
    const compact = { ok: parsed.ok }
    if (parsed.summary) compact.summary = parsed.summary
    if (parsed.count != null) compact.count = parsed.count
    if (parsed.error) compact.error = parsed.error
    for (const [key, value] of Object.entries(parsed)) {
      if (!Array.isArray(value) || key in compact) continue
      compact[`${key}Count`] = value.length
    }
    return JSON.stringify(compact)
  } catch {
    return content.slice(0, 200) + '...[truncated]'
  }
}

/**
 * @param {object} state
 * @returns {Array<object>}
 */
function resolveAvailableTools(state) {
  if (Array.isArray(state.availableTools) && state.availableTools.length > 0) {
    return state.availableTools
  }

  return state.mode === 'release'
    ? getToolsByTags(['base', 'release'])
    : getToolsByTags(['base'])
}

/**
 * @param {Array<object>} tools
 * @returns {string}
 */
function formatToolSummary(tools) {
  if (!Array.isArray(tools) || tools.length === 0) {
    return '- (no tools available)'
  }

  return tools
    .map(tool => {
      const name = tool?.function?.name || 'unknown_tool'
      const description = tool?.function?.description || '无描述'
      return `- \`${name}\` — ${description}`
    })
    .join('\n')
}

/**
 * @param {object} policy
 * @returns {string}
 */
function buildPolicyLines(policy = {}) {
  const riskLevel = policy.riskLevel || 'low'
  const requiresApproval = policy.requiresApproval ? '是' : '否'
  const shouldVerify = policy.shouldVerify ? '是' : '否'

  return [
    `- 风险等级：${riskLevel}`,
    `- 是否需要审批：${requiresApproval}`,
    `- 是否建议在执行后做验证：${shouldVerify}`
  ].join('\n')
}
