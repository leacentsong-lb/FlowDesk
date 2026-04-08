import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { TOOLS, TOOL_HANDLERS } from '../index.js'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

describe('workspace agent tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers scan_workspace_repos in the available tool list', () => {
    expect(TOOLS.map(tool => tool.function.name)).toContain('scan_workspace_repos')
    expect(typeof TOOL_HANDLERS.scan_workspace_repos).toBe('function')
  })

  it('uses the current app workspace path by default', async () => {
    invoke.mockResolvedValueOnce({
      ok: true,
      path: '/Users/demo/workspace',
      repos: []
    })

    const result = await TOOL_HANDLERS.scan_workspace_repos({}, {
      settings: {
        workspacePath: '/Users/demo/workspace'
      }
    })

    expect(invoke).toHaveBeenCalledWith('agent_scan_workspace_repos', {
      path: '/Users/demo/workspace'
    })
    expect(result.path).toBe('/Users/demo/workspace')
  })

  it('allows overriding the workspace path explicitly', async () => {
    invoke.mockResolvedValueOnce({
      ok: true,
      path: '/tmp/custom',
      repos: []
    })

    await TOOL_HANDLERS.scan_workspace_repos({ path: '/tmp/custom' }, {
      settings: {
        workspacePath: '/Users/demo/workspace'
      }
    })

    expect(invoke).toHaveBeenCalledWith('agent_scan_workspace_repos', {
      path: '/tmp/custom'
    })
  })
})
