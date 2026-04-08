/**
 * Tool: run_preflight
 * Runs pre-flight checks on release repos: branch existence, version match, merge conflicts.
 */
import { invoke } from '@tauri-apps/api/core'

export const schema = {
  type: 'function',
  function: {
    name: 'run_preflight',
    description: '对指定仓库执行发布预检：release 分支存在性、latest 分支存在性、package.json 版本号匹配、latest→release 合并冲突检查。任一失败将阻塞发布。',
    parameters: {
      type: 'object',
      properties: {
        version: { type: 'string', description: '版本号，如 3.8.2' },
        repos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              path: { type: 'string' }
            }
          },
          description: '仓库列表，包含 key 和 path'
        }
      },
      required: ['version', 'repos']
    }
  }
}

export async function handler(args, _ctx) {
  const version = args.version
  const repos = args.repos || []
  const results = []

  for (const repo of repos) {
    const checks = {}
    const releaseBranch = `release/v${version}`

    try {
      const [releaseExists, latestExists, pkgVersion, workingTree] = await Promise.all([
        invoke('git_remote_branch_exists', { projectPath: repo.path, branchName: releaseBranch }),
        invoke('git_remote_branch_exists', { projectPath: repo.path, branchName: 'latest' }),
        invoke('read_package_version', { projectPath: repo.path }),
        invoke('git_check_working_tree', { projectPath: repo.path })
      ])

      checks.releaseBranch = releaseExists.exists
        ? { ok: true, detail: releaseBranch }
        : { ok: false, detail: `分支 ${releaseBranch} 不存在` }

      checks.latestBranch = latestExists.exists
        ? { ok: true, detail: 'latest' }
        : { ok: false, detail: '分支 latest 不存在' }

      const expected = version.replace(/^v/, '')
      const actual = pkgVersion.version || ''
      checks.packageVersion = actual === expected
        ? { ok: true, detail: actual }
        : { ok: false, detail: `期望 ${expected}，实际 ${actual || '(空)'}` }

      checks.workingTree = workingTree.clean
        ? { ok: true, detail: '干净' }
        : { ok: false, detail: workingTree.summary }

      if (releaseExists.exists && latestExists.exists) {
        const mergeCheck = await invoke('git_merge_conflict_check', {
          projectPath: repo.path,
          sourceBranch: 'latest',
          targetBranch: releaseBranch
        })
        checks.mergeConflict = mergeCheck.hasConflict
          ? { ok: false, detail: 'latest → release 存在合并冲突' }
          : { ok: true, detail: `Behind: ${mergeCheck.behind}, Ahead: ${mergeCheck.ahead}` }
      }
    } catch (e) {
      checks.error = { ok: false, detail: e?.message || String(e) }
    }

    const allOk = Object.values(checks).every(c => c.ok)
    results.push({ repoKey: repo.key, path: repo.path, checks, ok: allOk })
  }

  const hasBlocked = results.some(r => !r.ok)
  return {
    ok: !hasBlocked,
    results,
    summary: hasBlocked
      ? `预检未通过：${results.filter(r => !r.ok).map(r => r.repoKey).join(', ')}`
      : `${results.length} 个仓库预检全部通过`
  }
}
