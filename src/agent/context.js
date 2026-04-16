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
  return buildPromptMessages(state)
    .map(message => String(message.content || '').trim())
    .filter(Boolean)
    .join('\n\n')
}

/**
 * Build prompt messages with a stable prefix and a volatile runtime tail.
 *
 * @param {object} state
 * @returns {Array<{ role: 'system', content: string }>}
 */
export function buildPromptMessages(state = {}) {
  const promptConfig = normalizePromptConfig(state.promptConfig)
  const mode = state.mode || 'general'
  const roleIntro = mode === 'release'
    ? promptConfig.role.releaseIntro
    : promptConfig.role.generalIntro
  const workflowGuidance = mode === 'release'
    ? promptConfig.workflow.release
    : promptConfig.workflow.general
  const specialRules = promptConfig.specialRules.map(rule => `- ${rule}`).join('\n')
  const responseRules = promptConfig.responseRules.map(rule => `- ${rule}`).join('\n')

  const stablePrompt = [
    roleIntro,
    '',
    '## 工作方式',
    '',
    workflowGuidance,
    '',
    '## Skills 使用策略',
    '',
    promptConfig.skillPolicyIntro,
    '',
    '## 特别规则',
    '',
    specialRules,
    '',
    '## 回复规则',
    '',
    responseRules
  ].filter(Boolean).join('\n')

  const dynamicPrompt = buildDynamicRuntimePrompt(state)

  return [
    { role: 'system', content: stablePrompt },
    { role: 'system', content: dynamicPrompt }
  ]
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

function buildDynamicRuntimePrompt(state = {}) {
  const mode = state.mode || 'general'
  const workflowId = state.workflowId || mode
  const version = state.version || '未选择'
  const env = state.environment || '未选择'
  const workspacePath = state.workspacePath || '未设置'
  const completed = state.completedTools || []
  const availableTools = resolveAvailableTools(state)
  const workflowPrompt = String(state.workflowPrompt || '').trim()
  const policyLines = buildPolicyLines(state.policy)
  const releaseSessionLines = buildReleaseSessionLines(state.releaseSession, state.currentGate)
  const toolSummary = formatToolSummary(availableTools)
  const memorySummary = String(state.memorySummary || '').trim()
  const memorySection = memorySummary ? `## Memory\n\n${memorySummary}` : '## Memory\n\n(no memory loaded)'
  const primedSkillBundle = String(state.primedSkillBundle || '').trim()
  const primedSkillSection = primedSkillBundle ? `## Primed Skills\n\n${primedSkillBundle}` : '## Primed Skills\n\n(no primed skills)'
  const skillDirectory = defaultSkillLoader.promptIndex()

  return [
    '## Tool Surface',
    '',
    toolSummary,
    '',
    '## Skills（可按需加载）',
    '',
    skillDirectory,
    '',
    '## Policy',
    '',
    policyLines,
    '',
    workflowPrompt ? '## Workflow Context' : null,
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
    ...releaseSessionLines,
    '',
    memorySection,
    '',
    primedSkillSection
  ].filter(Boolean).join('\n')
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
    `- 是否建议在执行后做验证：${shouldVerify}`,
    '- 对于 release workflow 中的危险步骤，若未看到已授权状态，禁止继续执行。'
  ].join('\n')
}

/**
 * @param {object} session
 * @param {object} gate
 * @returns {string[]}
 */
function buildReleaseSessionLines(session, gate) {
  if (!session?.steps) {
    return []
  }

  const blockedSteps = (session.blockedSteps || []).join(', ') || '无'
  const pendingApprovals = (session.approvals || [])
    .filter(approval => approval.decision === 'pending')
    .map(approval => approval.stepId)
    .join(', ') || '无'

  return [
    `- Release Session：${session.sessionId || '未创建'}`,
    `- Release 状态：${session.status || 'draft'}`,
    `- 当前步骤：${session.currentStepId || '无'}`,
    `- 阻塞步骤：${blockedSteps}`,
    `- 待审批步骤：${pendingApprovals}`,
    gate?.stepId ? `- 当前审批闸门：${gate.stepId}` : '- 当前审批闸门：无'
  ]
}
