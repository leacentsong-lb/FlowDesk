import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { handler } from '../command.js'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

describe('run_command policy propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('forwards the current workspace path to tauri for scoped execution', async () => {
    invoke.mockResolvedValueOnce({
      ok: true,
      stdout: 'ready',
      stderr: '',
      exitCode: 0
    })

    await handler({
      command: 'pwd',
      cwd: '.',
      mode: 'wait'
    }, {
      settings: {
        workspacePath: '/Users/demo/workspace'
      }
    })

    expect(invoke).toHaveBeenCalledWith('agent_run_command', {
      command: 'pwd',
      cwd: '.',
      mode: 'wait',
      workspacePath: '/Users/demo/workspace'
    })
  })

  it('passes null workspace path when settings are unavailable so backend can fail closed', async () => {
    invoke.mockResolvedValueOnce({
      ok: false,
      blocked: true,
      stderr: 'Blocked: workspacePath is required for shell execution',
      exitCode: -1
    })

    await handler({
      command: 'pwd',
      cwd: '.',
      mode: 'wait'
    }, {
      settings: {}
    })

    expect(invoke).toHaveBeenCalledWith('agent_run_command', {
      command: 'pwd',
      cwd: '.',
      mode: 'wait',
      workspacePath: null
    })
  })
})
