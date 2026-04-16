import { beforeEach, describe, expect, it, vi } from 'vitest'

const { streamAgentMock } = vi.hoisted(() => ({
  streamAgentMock: vi.fn()
}))

vi.mock('../../ai/client.js', () => ({
  aiClient: {
    streamAgent: streamAgentMock
  }
}))

vi.mock('../tools/index.js', () => ({
  TOOL_HANDLERS: {},
  getAllTools: () => [],
  TOOLS: []
}))

vi.mock('../context.js', () => ({
  buildSystemPrompt: vi.fn(() => 'system prompt'),
  buildPromptMessages: vi.fn(() => [{ role: 'system', content: 'system prompt' }]),
  microcompact: vi.fn(),
  estimateTokens: vi.fn(() => 0)
}))

import { agentLoop } from '../loop.js'

describe('agent loop streaming', () => {
  beforeEach(() => {
    streamAgentMock.mockReset()
  })

  it('reconstructs streamed assistant text and emits incremental events', async () => {
    const messages = [{ role: 'user', content: '你好' }]
    const events = []

    streamAgentMock.mockImplementation(async (_payload, onEvent) => {
      onEvent({ kind: 'text-delta', text: '你好' })
      onEvent({ kind: 'text-delta', text: '，世界' })
      onEvent({ kind: 'done', finishReason: 'stop' })
    })

    await agentLoop(messages, {
      ctx: {
        settings: {
          aiConfig: {
            apiKey: 'test-key',
            provider: 'openai',
            model: 'gpt-test'
          }
        },
        jira: {}
      },
      state: {
        mode: 'general',
        version: '',
        environment: 'production',
        completedTools: []
      },
      onEvent(event) {
        events.push(event)
      },
      onText() {}
    })

    expect(events.some(event => event.type === 'assistant.delta' && event.text === '你好')).toBe(true)
    expect(events.some(event => event.type === 'assistant.completed' && event.text === '你好，世界')).toBe(true)
    expect(messages.at(-1)).toEqual({
      role: 'assistant',
      content: '你好，世界',
      tool_calls: undefined
    })
  })
})
