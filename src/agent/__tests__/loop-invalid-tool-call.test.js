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

import { agentLoop } from '../loop.js'

describe('agent loop invalid tool calls', () => {
  beforeEach(() => {
    streamAgentMock.mockReset()
    runCommandMock.mockReset()
  })

  it('does not execute run_command when tool arguments are invalid', async () => {
    const messages = [{ role: 'user', content: '帮我执行 pwd' }]

    let modelCallCount = 0
    streamAgentMock.mockImplementation(async (payload, onEvent) => {
      modelCallCount += 1

      if (modelCallCount === 1) {
        onEvent({
          kind: 'tool-call-delta',
          index: 0,
          id: 'call_run_command',
          name: 'run_command',
          argumentsFragment: '{}'
        })
        onEvent({ kind: 'done', finishReason: 'tool_calls' })
        return
      }

      const toolResultMessage = payload.messages.find(message => message.role === 'tool')
      expect(toolResultMessage?.content).toContain('工具参数无效')
      onEvent({ kind: 'text-delta', text: '请补充 command 参数后再试。' })
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
      onText() {}
    })

    expect(runCommandMock).not.toHaveBeenCalled()
  })

  it('stops auto-retrying after the same tool fails twice consecutively', async () => {
    const messages = [{ role: 'user', content: '帮我执行 pwd' }]
    const onText = vi.fn()

    let modelCallCount = 0
    streamAgentMock.mockImplementation(async (_payload, onEvent) => {
      modelCallCount += 1

      onEvent({
        kind: 'tool-call-delta',
        index: 0,
        id: `call_run_command_${modelCallCount}`,
        name: 'run_command',
        argumentsFragment: '{}'
      })
      onEvent({ kind: 'done', finishReason: 'tool_calls' })
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
      onText
    })

    expect(modelCallCount).toBe(2)
    expect(onText).toHaveBeenCalledWith('工具 run_command 连续失败 2 次，已停止自动重试。请调整参数后再试，或使用手动重试。')
    expect(runCommandMock).not.toHaveBeenCalled()
  })
})
