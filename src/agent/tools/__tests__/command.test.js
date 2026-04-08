import { describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { handler, schema } from '../command.js'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

describe('run_command tool', () => {
  it('declares background mode for long-running commands', () => {
    expect(schema.function.parameters.properties.mode.enum).toEqual(['wait', 'background'])
  })

  it('forwards the requested execution mode to tauri', async () => {
    invoke.mockResolvedValueOnce({ ok: true, started: true, background: true })

    await handler({
      command: 'pnpm dev',
      cwd: '/tmp/demo',
      mode: 'background'
    }, {
      settings: {
        workspacePath: '/tmp/demo'
      }
    })

    expect(invoke).toHaveBeenCalledWith('agent_run_command', {
      command: 'pnpm dev',
      cwd: '/tmp/demo',
      mode: 'background',
      workspacePath: '/tmp/demo'
    })
  })
})
