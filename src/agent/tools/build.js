/**
 * Tool: run_build
 * Runs `pnpm run build` in each repo to verify build passes.
 */
import { invoke } from '@tauri-apps/api/core'

export const schema = {
  type: 'function',
  function: {
    name: 'run_build',
    description: '对指定仓库执行 pnpm run build 构建验证。任一仓库构建失败将阻塞发布。这是发布前的最后一道门禁。',
    parameters: {
      type: 'object',
      properties: {
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
      required: ['repos']
    }
  }
}

export async function handler(args, _ctx) {
  const repos = args.repos || []
  const results = []

  for (const repo of repos) {
    try {
      const result = await invoke('run_pnpm_build', { projectPath: repo.path })
      results.push({
        repoKey: repo.key,
        ok: result.success,
        elapsedMs: result.elapsedMs,
        stderr: result.stderr,
        stdout: result.stdout
      })
    } catch (e) {
      results.push({
        repoKey: repo.key,
        ok: false,
        stderr: e?.message || String(e),
        stdout: '',
        elapsedMs: 0
      })
    }
  }

  const failed = results.filter(r => !r.ok)
  return {
    ok: failed.length === 0,
    results,
    summary: failed.length > 0
      ? `构建失败：${failed.map(r => r.repoKey).join('、')}`
      : `${results.length} 个仓库构建全部通过（${results.map(r => `${r.repoKey} ${(r.elapsedMs / 1000).toFixed(1)}s`).join(', ')}）`
  }
}
