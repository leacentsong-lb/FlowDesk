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

describe('release skill priming', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    mockRunAgent.mockReset()
    localStorage.setItem('ai_api_key', 'test-key')
  })

  it('primes workspace-topology for admin mapping questions before running the agent', async () => {
    const release = useReleaseStore()

    await release.agentChat('admin 对应哪个仓库')

    expect(mockRunAgent).toHaveBeenCalledWith(
      'admin 对应哪个仓库',
      expect.objectContaining({
        route: expect.objectContaining({
          mode: 'general',
          intent: 'workspace_mapping',
          shouldPrimeWorkspaceSkill: true
        })
      })
    )
  })

  it('primes workspace-topology for backend mapping questions before running the agent', async () => {
    const release = useReleaseStore()

    await release.agentChat('后台系统是哪一个 repo')

    expect(mockRunAgent).toHaveBeenCalledWith(
      '后台系统是哪一个 repo',
      expect.objectContaining({
        route: expect.objectContaining({
          mode: 'general',
          intent: 'workspace_mapping',
          shouldPrimeWorkspaceSkill: true
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
          intent: 'release_flow',
          shouldPrimeWorkspaceSkill: false
        })
      })
    )
  })

  it('primes git-branching for commit message questions before running the agent', async () => {
    const release = useReleaseStore()

    await release.agentChat('请根据当前本地分支帮我生成 commit message')

    expect(mockRunAgent).toHaveBeenCalledWith(
      '请根据当前本地分支帮我生成 commit message',
      expect.objectContaining({
        route: expect.objectContaining({
          mode: 'general',
          intent: 'git_commit_message',
          primeSkillNames: ['git-branching']
        })
      })
    )
  })
})
