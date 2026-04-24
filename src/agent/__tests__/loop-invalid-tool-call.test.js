import { beforeEach, describe, expect, it, vi } from 'vitest'

const { streamAgentMock, runCommandMock, readFileMock } = vi.hoisted(() => ({
  streamAgentMock: vi.fn(),
  runCommandMock: vi.fn(),
  readFileMock: vi.fn()
}))

vi.mock('../../ai/client.js', () => ({
  aiClient: {
    streamAgent: streamAgentMock
  }
}))

vi.mock('../tools/index.js', () => ({
  TOOL_HANDLERS: {
    run_command: runCommandMock,
    read_file: readFileMock
  },
  getAllTools: () => [
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
    },
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: '读取本地文件内容',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' }
          },
          required: ['path']
        }
      }
    }
  ],
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
    },
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: '读取本地文件内容',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' }
          },
          required: ['path']
        }
      }
    }
  ]
}))

vi.mock('../context.js', () => ({
  buildSystemPrompt: vi.fn(() => 'system prompt'),
  buildPromptMessages: vi.fn(() => [{ role: 'system', content: 'system prompt' }]),
  microcompact: vi.fn(),
  estimateTokens: vi.fn(() => 0)
}))

import { agentLoop } from '../loop.js'

describe('agent loop invalid tool calls', () => {
  beforeEach(() => {
    streamAgentMock.mockReset()
    runCommandMock.mockReset()
    readFileMock.mockReset()
  })

  it('treats missing required tool params as recoverable and lets the model self-correct', async () => {
    const messages = [{ role: 'user', content: '读一下 package.json' }]

    readFileMock.mockResolvedValueOnce({
      ok: true,
      summary: '已读取 package.json',
      content: '{"name":"dev-helper"}'
    })

    let modelCallCount = 0
    streamAgentMock.mockImplementation(async (payload, onEvent) => {
      modelCallCount += 1

      if (modelCallCount === 1) {
        onEvent({
          kind: 'tool-call-delta',
          index: 0,
          id: 'call_read_file_1',
          name: 'read_file',
          argumentsFragment: '{}'
        })
        onEvent({ kind: 'done', finishReason: 'tool_calls' })
        return
      }

      if (modelCallCount === 2) {
        const toolResultMessage = payload.messages.findLast(message => message.role === 'tool')
        const toolResult = JSON.parse(toolResultMessage.content)
        expect(toolResult).toMatchObject({
          ok: false,
          recoverable: true,
          recoveryKind: 'missing_required_params',
          missingFields: ['path']
        })

        onEvent({
          kind: 'tool-call-delta',
          index: 0,
          id: 'call_read_file_2',
          name: 'read_file',
          argumentsFragment: '{"path":"package.json"}'
        })
        onEvent({ kind: 'done', finishReason: 'tool_calls' })
        return
      }

      const toolResultMessage = payload.messages.findLast(message => message.role === 'tool')
      expect(JSON.parse(toolResultMessage.content)).toMatchObject({
        ok: true,
        summary: '已读取 package.json'
      })
      onEvent({ kind: 'text-delta', text: '我已经读取 package.json。' })
      onEvent({ kind: 'done', finishReason: 'stop' })
    })

    const onText = vi.fn()
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

    expect(modelCallCount).toBe(3)
    expect(readFileMock).toHaveBeenCalledTimes(1)
    expect(readFileMock).toHaveBeenCalledWith({ path: 'package.json' }, expect.anything())
    expect(onText).toHaveBeenCalledWith('我已经读取 package.json。')
  })

  it('limits self-healing retries for missing params and lets the model choose the next step', async () => {
    const messages = [{ role: 'user', content: '读一下 package.json' }]

    let modelCallCount = 0
    streamAgentMock.mockImplementation(async (payload, onEvent) => {
      modelCallCount += 1

      if (modelCallCount === 1) {
        onEvent({
          kind: 'tool-call-delta',
          index: 0,
          id: 'call_read_file_1',
          name: 'read_file',
          argumentsFragment: '{}'
        })
        onEvent({ kind: 'done', finishReason: 'tool_calls' })
        return
      }

      if (modelCallCount === 2) {
        const firstToolResult = JSON.parse(payload.messages.findLast(message => message.role === 'tool').content)
        expect(firstToolResult).toMatchObject({
          ok: false,
          recoverable: true,
          recoveryKind: 'missing_required_params',
          missingFields: ['path']
        })

        onEvent({
          kind: 'tool-call-delta',
          index: 0,
          id: 'call_read_file_2',
          name: 'read_file',
          argumentsFragment: '{}'
        })
        onEvent({ kind: 'done', finishReason: 'tool_calls' })
        return
      }

      const exhaustedResult = JSON.parse(payload.messages.findLast(message => message.role === 'tool').content)
      expect(exhaustedResult).toMatchObject({
        ok: false,
        recoverable: false,
        recoveryKind: 'missing_required_params',
        handoffToModel: true,
        missingFields: ['path']
      })

      onEvent({ kind: 'text-delta', text: '我还缺少明确文件路径，先改为定位目录或请你确认具体文件。' })
      onEvent({ kind: 'done', finishReason: 'stop' })
    })

    const onText = vi.fn()
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

    expect(modelCallCount).toBe(3)
    expect(readFileMock).not.toHaveBeenCalled()
    expect(onText).toHaveBeenCalledWith('我还缺少明确文件路径，先改为定位目录或请你确认具体文件。')
  })

  it('stops auto-retrying after the same non-recoverable tool fails twice consecutively', async () => {
    const messages = [{ role: 'user', content: '帮我执行 pwd' }]
    const onText = vi.fn()

    runCommandMock.mockResolvedValue({
      ok: false,
      summary: '命令执行失败'
    })

    let modelCallCount = 0
    streamAgentMock.mockImplementation(async (_payload, onEvent) => {
      modelCallCount += 1

      onEvent({
        kind: 'tool-call-delta',
        index: 0,
        id: `call_run_command_${modelCallCount}`,
        name: 'run_command',
        argumentsFragment: '{"command":"pwd"}'
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
    expect(runCommandMock).toHaveBeenCalledTimes(2)
  })
})
