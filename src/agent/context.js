/**
 * Context Management — system prompt builder + token estimation.
 *
 * Mirrors s05 (skills) + s06 (compression) from learn-claude-code.
 */

import { normalizePromptConfig } from './prompt-config.js'
import { defaultSkillLoader } from './skills.js'

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
  const version = state.version || '未选择'
  const env = state.environment || '未选择'
  const workspacePath = state.workspacePath || '未设置'
  const memorySummary = String(state.memorySummary || '').trim()
  const memorySection = memorySummary ? `## Memory\n\n${memorySummary}` : '## Memory\n\n(no memory loaded)'
  const primedSkillBundle = String(state.primedSkillBundle || '').trim()
  const primedSkillSection = primedSkillBundle ? `## Primed Skills\n\n${primedSkillBundle}` : '## Primed Skills\n\n(no primed skills)'
  const completed = state.completedTools || []
  const roleIntro = mode === 'release'
    ? promptConfig.role.releaseIntro
    : promptConfig.role.generalIntro
  const workflowGuidance = mode === 'release'
    ? promptConfig.workflow.release
    : promptConfig.workflow.general
  const specialRules = promptConfig.specialRules.map(rule => `- ${rule}`).join('\n')
  const responseRules = promptConfig.responseRules.map(rule => `- ${rule}`).join('\n')

  return [
    roleIntro,
    '',
    '## Base Tools（通用能力）',
    '',
    '- **run_command** — 执行 shell 命令（仅作为 fallback；默认仅允许在当前 workspace 内运行，cwd 逃逸或缺少 workspacePath 时会被拒绝）',
    '- **read_file** — 读取本地文件内容',
    '- **list_directory** — 列出目录结构',
    '- **scan_workspace_repos** — 扫描当前工作区中的 Git 仓库',
    '- **load_skill** — 加载专业知识（发布流程、Git 策略、问题排查）',
    '',
    '## Domain Tools（发布流水线）',
    '',
    '1. check_credentials — 检查凭证配置',
    '2. fetch_jira_versions — 获取 Jira 未发布版本列表',
    '3. fetch_version_issues — 获取指定版本的 issue 列表',
    '4. scan_pr_status — 扫描 PR 合并状态',
    '5. run_preflight — 发布预检（分支、版本号、冲突）',
    '6. run_build — 构建验证（pnpm build）',
    '',
    '## Skills（可加载的专业知识）',
    '',
    `可用技能：${defaultSkillLoader.list().join('、')}`,
    '',
    promptConfig.skillPolicyIntro,
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
    '',
    '## 当前状态',
    '',
    `- 当前模式：${mode}`,
    `- 目标环境：${env}`,
    `- 选定版本：${version}`,
    `- 当前工作区：${workspacePath}`,
    `- 已完成步骤：${completed.length > 0 ? completed.join(', ') : '无'}`,
    '',
    '## 回复规则',
    '',
    responseRules
  ].join('\n')
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
    if (Array.isArray(parsed.versions)) compact.versionCount = parsed.versions.length
    if (Array.isArray(parsed.issues)) compact.issueCount = parsed.issues.length
    if (Array.isArray(parsed.prs)) {
      compact.prCount = parsed.prs.length
      compact.unmerged = parsed.prs.filter(p => !p.merged).length
    }
    if (Array.isArray(parsed.results)) {
      compact.resultCount = parsed.results.length
      compact.failedCount = parsed.results.filter(r => !r.ok).length
    }
    return JSON.stringify(compact)
  } catch {
    return content.slice(0, 200) + '...[truncated]'
  }
}
