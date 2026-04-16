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
          workflowId: 'general',
          requiresApproval: false
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
          workflowId: 'release',
          riskLevel: 'high'
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
          workflowId: 'release',
          riskLevel: 'high'
        })
      })
    )
  })

  it('keeps neutral follow-up messages inside the active release workflow', async () => {
    const release = useReleaseStore()

    await release.agentChat('发布生产环境，请开始检查')
    mockRunAgent.mockClear()

    await release.agentChat('继续')

    expect(release.mode).toBe('release')
    expect(release.currentWorkflowId).toBe('release')
    expect(release.sessionActive).toBe(true)
    expect(mockRunAgent).toHaveBeenCalledWith(
      '继续当前发布会话。用户追加消息：继续',
      expect.objectContaining({
        displayUserText: '继续',
        route: expect.objectContaining({
          mode: 'release',
          workflowId: 'release',
          riskLevel: 'high'
        })
      })
    )
  })

  it('switches unrelated questions back to the general workflow while preserving the release session', async () => {
    const release = useReleaseStore()

    await release.agentChat('发布生产环境，请开始检查')
    mockRunAgent.mockClear()

    await release.agentChat('请读一下 src/agent/context.js')

    expect(release.mode).toBe('general')
    expect(release.currentWorkflowId).toBe('general')
    expect(release.sessionActive).toBe(true)
    expect(mockRunAgent).toHaveBeenCalledWith(
      '请读一下 src/agent/context.js',
      expect.objectContaining({
        displayUserText: '请读一下 src/agent/context.js',
        route: expect.objectContaining({
          mode: 'general',
          workflowId: 'general',
          requiresApproval: false
        })
      })
    )
  })

  it('can resume the preserved release session after a temporary switch back to general', async () => {
    const release = useReleaseStore()

    await release.agentChat('发布生产环境，请开始检查')
    await release.agentChat('你是谁？')
    mockRunAgent.mockClear()

    await release.agentChat('继续')

    expect(release.mode).toBe('release')
    expect(release.currentWorkflowId).toBe('release')
    expect(release.sessionActive).toBe(true)
    expect(mockRunAgent).toHaveBeenCalledWith(
      '继续当前发布会话。用户追加消息：继续',
      expect.objectContaining({
        displayUserText: '继续',
        route: expect.objectContaining({
          mode: 'release',
          workflowId: 'release'
        })
      })
    )
  })

  it('allows explicit exit messages to switch back to the general workflow', async () => {
    const release = useReleaseStore()

    await release.agentChat('发布生产环境，请开始检查')
    mockRunAgent.mockClear()

    await release.agentChat('退出发布流程')

    expect(release.mode).toBe('general')
    expect(release.currentWorkflowId).toBe('general')
    expect(release.sessionActive).toBe(false)
    expect(mockRunAgent).toHaveBeenCalledWith(
      '退出发布流程',
      expect.objectContaining({
        route: expect.objectContaining({
          mode: 'general',
          workflowId: 'general'
        })
      })
    )
  })
})
