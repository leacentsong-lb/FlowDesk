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
    pendingInteraction: ref(null),
    presentInteraction: vi.fn(),
    clearPendingInteraction: vi.fn(),
    pushMessage: vi.fn(),
    runAgent: mockRunAgent,
    stopAgentChat: vi.fn(),
    resetRuntime: vi.fn()
  }))
}))

import { useReleaseStore } from '../release'

describe('release store policy routing', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    mockRunAgent.mockReset()
    localStorage.setItem('ai_api_key', 'test-key')
  })

  it('keeps repo mapping questions in the general harness', async () => {
    const release = useReleaseStore()

    await release.agentChat('admin 对应哪个仓库')

    expect(mockRunAgent).toHaveBeenCalledWith(
      'admin 对应哪个仓库',
      expect.objectContaining({
        route: expect.objectContaining({
          mode: 'general',
          workflowId: 'general',
          requiresApproval: false
        })
      })
    )
  })

  it('keeps commit message questions in the general harness', async () => {
    const release = useReleaseStore()

    await release.agentChat('请根据当前本地分支帮我生成 commit message')

    expect(mockRunAgent).toHaveBeenCalledWith(
      '请根据当前本地分支帮我生成 commit message',
      expect.objectContaining({
        route: expect.objectContaining({
          mode: 'general',
          workflowId: 'general',
          requiresApproval: false
        })
      })
    )
  })

  it('does not prime workspace-topology for release questions', async () => {
    const release = useReleaseStore()

    await release.agentChat('发布生产环境，请开始检查')

    expect(mockRunAgent).toHaveBeenCalledWith(
      '发布生产环境，请开始检查',
      expect.objectContaining({
        route: expect.objectContaining({
          mode: 'release',
          workflowId: 'release',
          riskLevel: 'high'
        })
      })
    )
  })

  it('marks destructive requests as approval-required before running the agent', async () => {
    const release = useReleaseStore()

    await release.agentChat('请执行 rm -rf node_modules 然后重装依赖')

    expect(mockRunAgent).toHaveBeenCalledWith(
      '请执行 rm -rf node_modules 然后重装依赖',
      expect.objectContaining({
        route: expect.objectContaining({
          mode: 'general',
          workflowId: 'general',
          riskLevel: 'high',
          requiresApproval: true
        })
      })
    )
  })
})
