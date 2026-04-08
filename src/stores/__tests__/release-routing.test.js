import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'

const { mockRunAgent } = vi.hoisted(() => ({
  mockRunAgent: vi.fn()
}))

vi.mock('../../agent/runtime.js', () => ({
  createAgentRuntime: vi.fn(() => ({
    agentRunning: ref(false),
    chatMessages: ref([]),
    pushMessage: vi.fn(),
    runAgent: mockRunAgent,
    stopAgentChat: vi.fn(),
    resetRuntime: vi.fn()
  }))
}))

import { useReleaseStore } from '../release'

describe('release store intent routing', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    mockRunAgent.mockReset()
    localStorage.setItem('ai_api_key', 'test-key')
  })

  it('keeps workspace inventory questions in general mode before running the agent', async () => {
    const release = useReleaseStore()

    await release.agentChat('分析当前工作区有哪些仓库，列出名称')

    expect(release.mode).toBe('general')
    expect(release.sessionActive).toBe(false)
    expect(mockRunAgent).toHaveBeenCalledWith(
      '分析当前工作区有哪些仓库，列出名称',
      expect.objectContaining({
        route: expect.objectContaining({
          mode: 'general',
          intent: 'workspace_inventory',
          shouldPrimeWorkspaceSkill: true
        })
      })
    )
  })

  it('switches release questions into release mode before running the agent', async () => {
    const release = useReleaseStore()

    await release.agentChat('发布生产环境，请开始检查')

    expect(release.mode).toBe('release')
    expect(release.sessionActive).toBe(true)
    expect(mockRunAgent).toHaveBeenCalledWith(
      '发布生产环境，请开始检查',
      expect.objectContaining({
        route: expect.objectContaining({
          mode: 'release',
          intent: 'release_flow',
          shouldPrimeWorkspaceSkill: false
        })
      })
    )
  })

  it('keeps retry actions in release mode instead of rerouting them to general', async () => {
    const release = useReleaseStore()

    await release.agentChat('发布生产环境，请开始检查')
    mockRunAgent.mockClear()

    await release.handleChatAction('retry-run_preflight')

    expect(release.mode).toBe('release')
    expect(release.sessionActive).toBe(true)
    expect(mockRunAgent).toHaveBeenCalledWith(
      '请重新执行 run_preflight。',
      expect.objectContaining({
        route: expect.objectContaining({
          mode: 'release',
          intent: 'release_flow',
          shouldPrimeWorkspaceSkill: false
        })
      })
    )
  })
})
