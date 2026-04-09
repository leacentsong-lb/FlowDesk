import { beforeEach, describe, expect, it, vi } from 'vitest'

const { streamAgentMock, runCommandMock } = vi.hoisted(() => ({
  streamAgentMock: vi.fn(),
  runCommandMock: vi.fn()
}))

vi.mock('../../ai/client.js', () => ({
  aiClient: {
    streamAgent: streamAgentMock
  }
}))

vi.mock('../tools/index.js', () => ({
  TOOL_HANDLERS: {
    run_command: runCommandMock
  },
  TOOLS: [
    {
      type: 'function',
      function: {
        name: 'run_command',
        description: '执行 shell 命令',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string' }
          },
          required: ['command']
        }
      }
    }
  ]
}))

vi.mock('../context.js', () => ({
  buildSystemPrompt: vi.fn(() => 'system prompt'),
  microcompact: vi.fn(),
  estimateTokens: vi.fn(() => 0)
}))

import { runAgentGraph } from '../graph.js'

describe('agent graph', () => {
  beforeEach(() => {
    streamAgentMock.mockReset()
    runCommandMock.mockReset()
  })

  it('routes model -> tools -> model and preserves the existing message contract', async () => {
    const events = []
    const messages = [{ role: 'user', content: '帮我执行 pwd' }]

    runCommandMock.mockResolvedValueOnce({
      ok: true,
      summary: 'pwd 执行成功'
    })

    let modelCallCount = 0
    streamAgentMock.mockImplementation(async (payload, onEvent) => {
      modelCallCount += 1

      if (modelCallCount === 1) {
        onEvent({
          kind: 'tool-call-delta',
          index: 0,
          id: 'call_run_command',
          name: 'run_command',
          argumentsFragment: '{"command":"pwd"}'
        })
        onEvent({ kind: 'done', finishReason: 'tool_calls' })
        return
      }

      const toolResultMessage = payload.messages.find(message => message.role === 'tool')
      expect(toolResultMessage).toBeTruthy()
      expect(JSON.parse(toolResultMessage.content)).toMatchObject({
        ok: true,
        summary: 'pwd 执行成功'
      })

      onEvent({ kind: 'text-delta', text: '命令已执行完成。' })
      onEvent({ kind: 'done', finishReason: 'stop' })
    })

    const result = await runAgentGraph(messages, {
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
      onGraphEvent(event) {
        events.push(event)
      }
    })

    expect(modelCallCount).toBe(2)
    expect(runCommandMock).toHaveBeenCalledWith({ command: 'pwd' }, expect.anything())
    expect(events.some(event => event.type === 'tool.start' && event.toolName === 'run_command')).toBe(true)
    expect(events.some(event => event.type === 'tool.end' && event.toolName === 'run_command')).toBe(true)
    expect(result.finalText).toBe('命令已执行完成。')
    expect(result.messages).toEqual([
      { role: 'user', content: '帮我执行 pwd' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_run_command',
            type: 'function',
            function: {
              name: 'run_command',
              arguments: '{"command":"pwd"}'
            }
          }
        ]
      },
      {
        role: 'tool',
        tool_call_id: 'call_run_command',
        content: JSON.stringify({ ok: true, summary: 'pwd 执行成功' })
      },
      {
        role: 'assistant',
        content: '命令已执行完成。',
        tool_calls: undefined
      }
    ])
  })
})
