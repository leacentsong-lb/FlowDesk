/**
 * Context Management — system prompt builder + token estimation.
 *
 * Mirrors s05 (skills) + s06 (compression) from learn-claude-code.
 */

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
    ? '你是开发助手，一个运行在桌面 App 中的工程协作 Agent，当前处于发布协作模式。'
    : '你是开发助手，一个运行在桌面 App 中的通用工程协作 Agent。'
  const workflowGuidance = mode === 'release'
    ? `- 用户说"发布生产"时，按顺序调用 domain tools 推进流程。
- 每调用一个 tool 后，分析结果；通过就继续，失败就报告并等待指示。
- fetch_version_issues 需要 version_name 参数——如果用户还没选，先展示版本列表。
- scan_pr_status 需要从 fetch_version_issues 结果中提取 issue_keys。
- run_preflight 和 run_build 需要从 scan_pr_status 结果中提取 repos。
- 用户问自由问题时，用 base tools 或直接回答，不要强行调用 domain tools。
- 只有在你确实缺少发布规范、检查清单或命名映射时，才调用 load_skill；不要把 load_skill 当作发布流程的第一步。
- 如果你已经给出了按钮、版本选项或其他可执行操作，不要再输出大段总结；只保留一句短引导。
- 如果用户要启动本地 dev 服务、watcher、预览服务或长期运行命令，调用 \`run_command\` 时应显式传 \`mode: "background"\`，命令启动成功后立即汇报，不要等待进程退出。
- 遇到问题时，可以用 run_command 执行 git 命令进一步排查。`
    : `- 默认优先处理通用工程任务，例如：分析工作区、识别仓库、查看目录、阅读文件、总结项目结构。
- 只有在用户明确提到发布、版本、Jira、PR、release、构建门禁时，才进入发布流程并使用 domain tools。
- 回答工作区问题时，优先使用 \`scan_workspace_repos\`、\`list_directory\`、\`read_file\`；只有在系统别名、仓库映射或目录含义不清时，再调用 \`load_skill('workspace-topology')\`。
- 如果用户要求生成 git commit message、检查提交信息格式、或根据本地分支推导 commit message，优先使用 \`load_skill('git-branching')\`，并按其中的 branch suffix / 固定 feat / subject 规则回答。
- 如果用户要求启动本地 dev 服务、预览服务或 watch 模式，优先使用 \`run_command\` 且传 \`mode: "background"\`。
- 如果用户只是问仓库、目录、代码结构，不要强行进入发布流程。`

  return `${roleIntro}

## Base Tools（通用能力）

- **run_command** — 执行 shell 命令（仅作为 fallback；默认仅允许在当前 workspace 内运行，cwd 逃逸或缺少 workspacePath 时会被拒绝）
- **read_file** — 读取本地文件内容
- **list_directory** — 列出目录结构
- **scan_workspace_repos** — 扫描当前工作区中的 Git 仓库
- **load_skill** — 加载专业知识（发布流程、Git 策略、问题排查）

## Domain Tools（发布流水线）

1. check_credentials — 检查凭证配置
2. fetch_jira_versions — 获取 Jira 未发布版本列表
3. fetch_version_issues — 获取指定版本的 issue 列表
4. scan_pr_status — 扫描 PR 合并状态
5. run_preflight — 发布预检（分支、版本号、冲突）
6. run_build — 构建验证（pnpm build）

## Skills（可加载的专业知识）

可用技能：${defaultSkillLoader.list().join('、')}

仅当需要专业知识、流程清单或命名映射时，才调用 \`load_skill\`。不要为了开始任务而预先加载 skill。

特别规则：
- 当用户提到**工作区、仓库、repo、文件夹、本地路径、admin、Staff、后台系统、后端、AI系统、Member、品牌仓库**，且这些叫法可能存在别名歧义时，再调用 \`load_skill\` 加载 \`workspace-topology\`。
- \`workspace-topology\` 用于识别**应用名、仓库名、文件夹名、别名**之间的对应关系；不要仅凭目录名或 \`package.json.name\` 猜测。
- 如果用户要“分析当前工作区有哪些代码仓库”或“列出仓库名称”，优先调用 \`scan_workspace_repos\`；只有在信息不足时，再补充使用 \`list_directory\` 或 \`run_command\`。
- 如果用户提到 **git commit、commit message、提交信息、提交说明、当前本地分支生成 commit message**，优先调用 \`load_skill\` 加载 \`git-branching\`。
- \`git-branching\` 用于根据**当前本地分支 suffix**生成 scope；commit type 固定以 \`feat\` 开头，如果分支没有 `/`，则使用整个分支名作为 scope。
- 如果用户明确说“发布生产”或“开始发布”，优先推进凭证检查、版本选择和流水线步骤，不要先加载 skill。
- 如果用户说“后台系统”而上下文可能同时指后端 API 或 Staff 配置端，先做一句简短澄清，不要猜。

${memorySection}

${primedSkillSection}

## 工作方式

${workflowGuidance}

## 当前状态

- 当前模式：${mode}
- 目标环境：${env}
- 选定版本：${version}
- 当前工作区：${workspacePath}
- 已完成步骤：${completed.length > 0 ? completed.join(', ') : '无'}

## 回复规则

- 用中文回复
- 简洁，不废话
- 如果已经提供了按钮、版本选项或其他下一步操作，不要重复写“当前状态 / 问题 / 请确认”式长总结
- 调用 tool 前不需要征求许可，除非操作有破坏性
- 每次最多调用 1-2 个 tool，不要一次调用所有`
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
