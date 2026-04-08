import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const { mockAgentLoop } = vi.hoisted(() => ({
  mockAgentLoop: vi.fn()
}))

const { mockLoadAgentMemories } = vi.hoisted(() => ({
  mockLoadAgentMemories: vi.fn()
}))

vi.mock('../../agent/index.js', () => ({
  agentLoop: mockAgentLoop,
  TOOLS: []
}))

vi.mock('../../agent/memory.js', () => ({
  loadAgentMemories: mockLoadAgentMemories
}))

import { useReleaseStore } from '../release'

describe('release store typing effect', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    mockAgentLoop.mockReset()
    mockLoadAgentMemories.mockReset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('streams agent text progressively before completing', async () => {
    mockLoadAgentMemories.mockResolvedValue({
      projectMemory: '',
      userMemory: '',
      summary: '',
      sources: { project: '', user: '' }
    })

    mockAgentLoop.mockImplementationOnce(async (_messages, options) => {
      options.onText?.('这是一个带打字机效果的回答。')
    })

    const release = useReleaseStore()

    await release.handleChatAction('mode-general-workspace')

    const agentMessage = release.chatMessages.at(-1)
    expect(agentMessage.role).toBe('agent')
    expect(agentMessage._streaming).toBe(true)
    expect(agentMessage.text.length).toBeGreaterThan(0)
    expect(agentMessage.text.length).toBeLessThan('这是一个带打字机效果的回答。'.length)

    vi.advanceTimersByTime(500)

    const completedMessage = release.chatMessages.at(-1)
    expect(completedMessage.text).toBe('这是一个带打字机效果的回答。')
    expect(completedMessage._streaming).toBe(false)
  })

  it('can stop the current chat run immediately', async () => {
    mockLoadAgentMemories.mockResolvedValue({
      projectMemory: '',
      userMemory: '',
      summary: '',
      sources: { project: '', user: '' }
    })

    mockAgentLoop.mockImplementationOnce(async (_messages, options) => {
      await new Promise(resolve => {
        setTimeout(() => {
          options.onText?.('这条消息不应在终止后出现。')
          resolve()
        }, 1000)
      })
    })

    const release = useReleaseStore()
    const runPromise = release.handleChatAction('mode-general-workspace')

    expect(release.agentRunning).toBe(true)
    release.stopAgentChat()
    expect(release.agentRunning).toBe(false)

    await vi.advanceTimersByTimeAsync(1000)
    await runPromise

    expect(release.chatMessages.map(message => message.text).join('\n')).not.toContain('不应在终止后出现')
  })
})
