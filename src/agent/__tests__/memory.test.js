import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { homeDir } from '@tauri-apps/api/path'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

vi.mock('@tauri-apps/api/path', () => ({
  homeDir: vi.fn()
}))

import {
  getProjectMemoryPath,
  getUserMemoryPath,
  loadAgentMemories
} from '../memory.js'

describe('agent memory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('builds the project memory path from the workspace root', () => {
    expect(getProjectMemoryPath('/Users/demo/workspace')).toBe('/Users/demo/workspace/.flow-desk/AGENT.md')
  })

  it('builds the user memory path from the home directory', async () => {
    homeDir.mockResolvedValueOnce('/Users/demo')

    await expect(getUserMemoryPath()).resolves.toBe('/Users/demo/.flow-desk/AGENT.md')
  })

  it('loads both project and user memories and returns a concise summary', async () => {
    homeDir.mockResolvedValueOnce('/Users/demo')
    invoke
      .mockResolvedValueOnce({
        ok: true,
        content: 'Project rule A\nProject rule B'
      })
      .mockResolvedValueOnce({
        ok: true,
        content: 'User preference X'
      })

    const result = await loadAgentMemories({
      workspacePath: '/Users/demo/workspace'
    })

    expect(result.projectMemory).toContain('Project rule A')
    expect(result.userMemory).toContain('User preference X')
    expect(result.summary).toContain('Project memory')
    expect(result.summary).toContain('User memory')
    expect(result.sources).toEqual({
      project: '/Users/demo/workspace/.flow-desk/AGENT.md',
      user: '/Users/demo/.flow-desk/AGENT.md'
    })
  })

  it('tolerates missing memory files without throwing', async () => {
    homeDir.mockResolvedValueOnce('/Users/demo')
    invoke
      .mockRejectedValueOnce(new Error('project memory missing'))
      .mockRejectedValueOnce(new Error('user memory missing'))

    const result = await loadAgentMemories({
      workspacePath: '/Users/demo/workspace'
    })

    expect(result.projectMemory).toBe('')
    expect(result.userMemory).toBe('')
    expect(result.summary).toBe('')
  })
})
