/**
 * Tool: scan_pr_status
 * Scans all configured repos for PRs related to the version's Jira issues.
 */
import { invoke } from '@tauri-apps/api/core'

function extractIssueKeys(text) {
  return (text || '').match(/[A-Z][A-Z0-9]+-\d+/g) || []
}

export const schema = {
  type: 'function',
  function: {
    name: 'scan_pr_status',
    description: '扫描所有配置仓库，检查与当前版本 issue 关联的 PR 是否全部已合并。如果存在未合并 PR，发布将被阻塞。',
    parameters: {
      type: 'object',
      properties: {
        version: { type: 'string', description: '版本号，如 3.8.2' },
        issue_keys: {
          type: 'array',
          items: { type: 'string' },
          description: 'Jira issue key 列表，如 ["CRMCN-1234", "CRMCN-5678"]'
        }
      },
      required: ['version', 'issue_keys']
    }
  }
}

export async function handler(args, ctx) {
  const issueKeys = new Set(args.issue_keys || [])
  const version = args.version
  const brokerEntries = Object.entries(ctx.settings.brokerPaths || {})
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
        invoke('github_list_all_open_prs', { owner, repo, token: ctx.settings.githubToken }),
        invoke('github_list_merged_prs', { owner, repo, baseBranch: `release/v${version}`, token: ctx.settings.githubToken })
      ])

      const openPrs = openRes.status === 200 ? JSON.parse(openRes.body) : []
      const mergedPrs = (mergedRes.status === 200 ? JSON.parse(mergedRes.body) : []).filter(pr => pr.merged_at)

      for (const pr of [...openPrs.map(p => ({ ...p, _state: 'open' })), ...mergedPrs.map(p => ({ ...p, _state: 'merged' }))]) {
        const matchedKeys = [...new Set([
          ...extractIssueKeys(pr.title || ''),
          ...extractIssueKeys(pr.head?.ref || '')
        ])].filter(k => issueKeys.has(k))

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
    .map(r => ({ key: r.repoKey, repo: r.repo, path: r.repoPath }))

  return {
    ok: unmerged.length === 0,
    prs: allMatches,
    repos,
    unmergedCount: unmerged.length,
    summary: unmerged.length > 0
      ? `发现 ${unmerged.length} 个未合并的 PR：${unmerged.map(p => `${p.repoKey} #${p.prNumber}`).join(', ')}`
      : allMatches.length > 0
        ? `${allMatches.length} 个 PR 全部已合并，识别到 ${repos.length} 个发布仓库：${repos.map(r => r.key).join('、')}`
        : '未找到与版本 issue 匹配的 PR'
  }
}
