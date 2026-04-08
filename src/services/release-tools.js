/**
 * Release Pipeline Tool Registry.
 *
 * Each Tool follows the contract:
 *   { name, description, permission, requires, execute(ctx) -> { status, data, summary } }
 *
 * - `description` is what the AI model reads to decide whether to call this Tool.
 * - `permission`: 'auto' | 'confirm' | 'dangerous'
 * - `requires`: array of tool names that must pass before this tool can run.
 * - `execute(ctx)`: receives { invoke, settings, jira, session } and returns result.
 * - Result `summary` is a human-readable one-liner for the chat.
 */

import { invoke } from '@tauri-apps/api/core'
import { aiClient } from '../ai/client.js'

const STEP = Object.freeze({
  IDLE: 'idle',
  RUNNING: 'running',
  PASS: 'pass',
  BLOCKED: 'blocked',
  WARN: 'warn'
})

function extractIssueKeys(text) {
  return (text || '').match(/[A-Z][A-Z0-9]+-\d+/g) || []
}

// ============================================
// Tool definitions
// ============================================

const checkCredentials = {
  name: 'check_credentials',
  description: '检查 Jira、GitHub、AI 三类凭证是否已配置。这是所有发布操作的前提。',
  permission: 'auto',
  requires: [],
  async execute({ settings, jira }) {
    const creds = {
      jira: !!jira.isConfigured,
      github: !!settings.githubToken?.trim(),
      ai: !!settings.aiConfigured
    }
    const ok = creds.jira && creds.github
    return {
      status: ok ? STEP.PASS : STEP.BLOCKED,
      data: creds,
      summary: ok
        ? `凭证就绪：Jira ✓, GitHub ✓${creds.ai ? ', AI ✓' : ', AI 未配置（可选）'}`
        : `凭证缺失：${!creds.jira ? 'Jira ✗ ' : ''}${!creds.github ? 'GitHub ✗' : ''}`
    }
  }
}

const fetchJiraVersions = {
  name: 'fetch_jira_versions',
  description: '从 Jira 获取当前项目的所有未发布版本列表，供用户选择本次要发布的版本。',
  permission: 'auto',
  requires: ['check_credentials'],
  async execute({ jira }) {
    const projects = (jira.config.project || 'CRMCN').split('\n').map(p => p.trim()).filter(Boolean)
    const project = projects[0] || 'CRMCN'

    const result = await invoke('jira_get_versions', {
      domain: jira.config.domain,
      email: jira.config.email,
      apiToken: jira.config.apiToken,
      project
    })

    if (result.status !== 200) {
      return { status: STEP.BLOCKED, data: [], summary: `获取版本失败: HTTP ${result.status}` }
    }

    const data = JSON.parse(result.body)
    const versions = (Array.isArray(data) ? data : [])
      .filter(v => !v.archived && !v.released)
      .sort((a, b) => (b.name || '').localeCompare(a.name || ''))

    return {
      status: versions.length > 0 ? STEP.PASS : STEP.BLOCKED,
      data: versions,
      summary: versions.length > 0
        ? `找到 ${versions.length} 个待发布版本：${versions.slice(0, 5).map(v => v.name).join(', ')}`
        : '未找到待发布版本'
    }
  }
}

const fetchVersionIssues = {
  name: 'fetch_version_issues',
  description: '读取指定 Jira Version 下的所有 issue，了解本次发布的范围和内容。返回 issue 列表和统计。',
  permission: 'auto',
  requires: ['fetch_jira_versions'],
  async execute({ jira, session }) {
    const projects = (jira.config.project || 'CRMCN').split('\n').map(p => p.trim()).filter(Boolean)
    const project = projects[0] || 'CRMCN'

    const result = await invoke('jira_get_version_issues', {
      domain: jira.config.domain,
      email: jira.config.email,
      apiToken: jira.config.apiToken,
      project,
      versionName: session.version
    })

    if (result.status !== 200) {
      return { status: STEP.BLOCKED, data: [], summary: `读取 issue 失败: HTTP ${result.status}` }
    }

    const data = JSON.parse(result.body)
    const issues = (data.issues || []).map(issue => {
      const f = issue.fields || {}
      return {
        key: issue.key,
        summary: f.summary || '',
        status: f.status?.name || 'Unknown',
        statusCategory: f.status?.statusCategory?.key || '',
        type: f.issuetype?.name || 'Task',
        priority: f.priority?.name || 'Medium',
        assignee: f.assignee?.displayName || '',
        parent: f.parent ? { key: f.parent.key, summary: f.parent.fields?.summary || '', type: f.parent.fields?.issuetype?.name || '' } : null,
        url: `https://${jira.config.domain}/browse/${issue.key}`
      }
    })

    const done = issues.filter(i => i.statusCategory === 'done').length
    const inProgress = issues.filter(i => i.statusCategory === 'indeterminate').length

    return {
      status: STEP.PASS,
      data: issues,
      summary: `版本 v${session.version} 共 ${issues.length} 个 issue：${done} 已完成，${inProgress} 进行中，${issues.length - done - inProgress} 待处理`
    }
  }
}

const generateReleaseSummary = {
  name: 'generate_release_summary',
  description: '使用 AI 对本次发布的所有 issue 生成中文摘要，包括主要内容、涉及模块和风险点。需要 AI 凭证。',
  permission: 'auto',
  requires: ['fetch_version_issues'],
  async execute({ settings, session }) {
    if (!settings.aiConfigured) {
      return { status: STEP.WARN, data: null, summary: 'AI 未配置，跳过摘要生成' }
    }

    const issues = session.toolResults.fetch_version_issues?.data || []
    const issueLines = issues.map(i => `- [${i.type}] ${i.key}: ${i.summary} (${i.status})`).join('\n')
    const prompt = `以下是 Jira 版本 ${session.version} 的所有 issue 列表：\n\n${issueLines}\n\n请用中文简洁总结本次发布的主要内容、涉及的模块、潜在风险点，以及是否存在未完成的 issue 需要关注。控制在 200 字以内。`

    try {
      const result = await aiClient.complete({
        provider: settings.aiConfig.provider,
        apiKey: settings.aiConfig.apiKey,
        baseURL: settings.aiConfig.baseURL || '',
        model: settings.aiConfig.model,
        organization: settings.aiConfig.organization,
        project: settings.aiConfig.project,
        prompt
      })

      return { status: STEP.PASS, data: result.text, summary: result.text || '摘要生成完成' }
    } catch (e) {
      return { status: STEP.WARN, data: null, summary: `AI 摘要出错: ${e?.message || e}` }
    }
  }
}

const scanPrStatus = {
  name: 'scan_pr_status',
  description: '扫描所有配置仓库，检查与当前版本 Jira issue 关联的 PR 是否已全部合并。如果存在未合并的 PR，发布将被阻塞。这是发布的硬门禁。',
  permission: 'auto',
  requires: ['fetch_version_issues'],
  async execute({ settings, session }) {
    const issues = session.toolResults.fetch_version_issues?.data || []
    const issueKeys = new Set(issues.map(i => i.key))
    const brokerEntries = Object.entries(settings.brokerPaths || {})
    const allMatches = []

    for (const [brokerKey, repoPath] of brokerEntries) {
      try {
        const remoteInfo = await invoke('git_get_remote_info', { projectPath: repoPath }).catch(() => '')
        if (!remoteInfo) continue
        const parts = remoteInfo.replace(/\.git$/i, '').split('/').filter(Boolean)
        if (parts.length < 2) continue
        const owner = parts[0]
        const repo = parts[1]

        const [openRes, mergedRes] = await Promise.all([
          invoke('github_list_all_open_prs', { owner, repo, token: settings.githubToken }),
          invoke('github_list_merged_prs', { owner, repo, baseBranch: `release/v${session.version}`, token: settings.githubToken })
        ])

        const openPrs = openRes.status === 200 ? JSON.parse(openRes.body) : []
        const mergedPrs = (mergedRes.status === 200 ? JSON.parse(mergedRes.body) : []).filter(pr => pr.merged_at)

        for (const pr of [...openPrs.map(p => ({ ...p, _state: 'open' })), ...mergedPrs.map(p => ({ ...p, _state: 'merged' }))]) {
          const matchedKeys = [...new Set([...extractIssueKeys(pr.title || ''), ...extractIssueKeys(pr.head?.ref || '')])].filter(k => issueKeys.has(k))
          if (matchedKeys.length > 0) {
            allMatches.push({
              repo: `${owner}/${repo}`, repoKey: brokerKey, repoPath,
              prNumber: pr.number, prTitle: pr.title, prUrl: pr.html_url || '',
              headBranch: pr.head?.ref || '', baseBranch: pr.base?.ref || '',
              merged: pr._state === 'merged', issueKeys: matchedKeys
            })
          }
        }
      } catch { /* skip single repo */ }
    }

    const unmerged = allMatches.filter(r => !r.merged)
    const repos = [...new Map(allMatches.map(r => [r.repoKey, r])).values()]

    return {
      status: unmerged.length > 0 ? STEP.BLOCKED : (allMatches.length > 0 ? STEP.PASS : STEP.WARN),
      data: { prs: allMatches, repos: repos.map(r => ({ key: r.repoKey, repo: r.repo, path: r.repoPath })) },
      summary: unmerged.length > 0
        ? `发现 ${unmerged.length} 个未合并的 PR，发布已阻塞：\n${unmerged.map(p => `  - ${p.repoKey} #${p.prNumber}: ${p.prTitle}`).join('\n')}`
        : allMatches.length > 0
          ? `${allMatches.length} 个 PR 全部已合并，识别到 ${repos.length} 个发布仓库：${repos.map(r => r.repoKey).join('、')}`
          : '未找到与版本 issue 匹配的 PR'
    }
  }
}

const confirmRepos = {
  name: 'confirm_repos',
  description: '确认本次参与发布的仓库列表。这一步需要人工确认，因为自动识别的仓库列表可能需要调整。',
  permission: 'confirm',
  requires: ['scan_pr_status'],
  async execute({ session }) {
    const repos = session.toolResults.scan_pr_status?.data?.repos || []
    const keys = repos.map(r => r.key)
    return {
      status: keys.length > 0 ? STEP.PASS : STEP.BLOCKED,
      data: keys,
      summary: `已确认 ${keys.length} 个发布仓库：${keys.join('、')}`
    }
  }
}

const runPreflight = {
  name: 'run_preflight',
  description: '对确认的仓库执行发布预检：检查 release 分支是否存在、latest 分支是否存在、package.json 版本号是否一致、latest 到 release 是否有合并冲突。任一检查失败将阻塞发布。',
  permission: 'auto',
  requires: ['confirm_repos'],
  async execute({ session }) {
    const repos = session.toolResults.scan_pr_status?.data?.repos || []
    const confirmedKeys = session.toolResults.confirm_repos?.data || []
    const targetRepos = repos.filter(r => confirmedKeys.includes(r.key))
    const results = []

    for (const repo of targetRepos) {
      const checks = {}
      const releaseBranch = `release/v${session.version}`

      try {
        const [releaseExists, latestExists, pkgVersion, workingTree] = await Promise.all([
          invoke('git_remote_branch_exists', { projectPath: repo.path, branchName: releaseBranch }),
          invoke('git_remote_branch_exists', { projectPath: repo.path, branchName: 'latest' }),
          invoke('read_package_version', { projectPath: repo.path }),
          invoke('git_check_working_tree', { projectPath: repo.path })
        ])

        checks.releaseBranch = { status: releaseExists.exists ? STEP.PASS : STEP.BLOCKED, detail: releaseExists.exists ? releaseBranch : `分支 ${releaseBranch} 不存在` }
        checks.latestBranch = { status: latestExists.exists ? STEP.PASS : STEP.BLOCKED, detail: latestExists.exists ? 'latest' : '分支 latest 不存在' }

        const expected = session.version.replace(/^v/, '')
        const actual = pkgVersion.version || ''
        checks.packageVersion = { status: actual === expected ? STEP.PASS : STEP.BLOCKED, detail: actual === expected ? actual : `期望 ${expected}，实际 ${actual || '(空)'}` }
        checks.workingTree = { status: workingTree.clean ? STEP.PASS : STEP.WARN, detail: workingTree.clean ? '干净' : workingTree.summary }

        if (releaseExists.exists && latestExists.exists) {
          const mergeCheck = await invoke('git_merge_conflict_check', { projectPath: repo.path, sourceBranch: 'latest', targetBranch: releaseBranch })
          checks.mergeConflict = { status: mergeCheck.hasConflict ? STEP.BLOCKED : STEP.PASS, detail: mergeCheck.hasConflict ? 'latest -> release 存在合并冲突' : `Behind: ${mergeCheck.behind}, Ahead: ${mergeCheck.ahead}` }
        }
      } catch (e) {
        checks.error = { status: STEP.BLOCKED, detail: e?.message || String(e) }
      }

      results.push({ repoKey: repo.key, repo: repo.repo, path: repo.path, checks })
    }

    const hasBlocked = results.some(r => Object.values(r.checks).some(c => c.status === STEP.BLOCKED))
    const blockedDetail = hasBlocked
      ? results.filter(r => Object.values(r.checks).some(c => c.status === STEP.BLOCKED))
          .map(r => {
            const fails = Object.entries(r.checks).filter(([, c]) => c.status === STEP.BLOCKED).map(([n, c]) => `${n}: ${c.detail}`)
            return `  ${r.repoKey}: ${fails.join('; ')}`
          }).join('\n')
      : ''

    return {
      status: hasBlocked ? STEP.BLOCKED : STEP.PASS,
      data: results,
      summary: hasBlocked
        ? `预检未通过：\n${blockedDetail}`
        : `${results.length} 个仓库预检全部通过`
    }
  }
}

const runBuild = {
  name: 'run_build',
  description: '对所有确认的发布仓库执行 pnpm run build 构建验证。任一仓库构建失败将阻塞发布。这是发布前的最后一道硬门禁。',
  permission: 'auto',
  requires: ['run_preflight'],
  async execute({ session }) {
    const repos = session.toolResults.scan_pr_status?.data?.repos || []
    const confirmedKeys = session.toolResults.confirm_repos?.data || []
    const targetRepos = repos.filter(r => confirmedKeys.includes(r.key))
    const results = []

    for (const repo of targetRepos) {
      try {
        const result = await invoke('run_pnpm_build', { projectPath: repo.path })
        results.push({
          repoKey: repo.key, repo: repo.repo,
          status: result.success ? STEP.PASS : STEP.BLOCKED,
          elapsedMs: result.elapsedMs,
          stderr: result.stderr, stdout: result.stdout
        })
      } catch (e) {
        results.push({ repoKey: repo.key, repo: repo.repo, status: STEP.BLOCKED, stderr: e?.message || String(e), stdout: '', elapsedMs: 0 })
      }
    }

    const failed = results.filter(r => r.status === STEP.BLOCKED)
    return {
      status: failed.length > 0 ? STEP.BLOCKED : STEP.PASS,
      data: results,
      summary: failed.length > 0
        ? `构建失败：${failed.map(r => r.repoKey).join('、')}`
        : `${results.length} 个仓库构建全部通过（${results.map(r => `${r.repoKey} ${(r.elapsedMs / 1000).toFixed(1)}s`).join(', ')}）`
    }
  }
}

// ============================================
// Registry
// ============================================

export const RELEASE_TOOLS = [
  checkCredentials,
  fetchJiraVersions,
  fetchVersionIssues,
  generateReleaseSummary,
  scanPrStatus,
  confirmRepos,
  runPreflight,
  runBuild
]

export const TOOL_MAP = Object.fromEntries(RELEASE_TOOLS.map(t => [t.name, t]))

/**
 * Build the tools schema array for AI model's `tools` parameter.
 */
export function buildToolSchemas() {
  return RELEASE_TOOLS.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: { type: 'object', properties: {}, required: [] }
    }
  }))
}

export { STEP }
