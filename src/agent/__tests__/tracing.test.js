import { beforeEach, describe, expect, it, vi } from 'vitest'

const { streamAgentMock, scanWorkspaceReposMock } = vi.hoisted(() => ({
  streamAgentMock: vi.fn(),
  scanWorkspaceReposMock: vi.fn()
}))

vi.mock('../../ai/client.js', () => ({
  aiClient: {
    streamAgent: streamAgentMock
  }
}))

vi.mock('../tools/index.js', () => ({
  TOOL_HANDLERS: {
    scan_workspace_repos: scanWorkspaceReposMock
  },
  TOOLS: [
    {
      function: {
        name: 'scan_workspace_repos',
        description: '扫描当前工作区内的 git 仓库'
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
import { createTraceSession, pushTraceEntry } from '../tracing.js'

describe('agent tracing', () => {
  beforeEach(() => {
    streamAgentMock.mockReset()
    scanWorkspaceReposMock.mockReset()
  })

  it('records rounds, tool calls, tool results and final answer for each run', async () => {
    const messages = [{ role: 'user', content: '分析当前工作区的代码仓库都有哪些' }]
    const traceSession = createTraceSession({
      runId: 'run-trace-1',
      mode: 'general',
      workspacePath: '/tmp/workspace',
      userText: '分析当前工作区的代码仓库都有哪些'
    })

    scanWorkspaceReposMock.mockResolvedValueOnce({
      ok: true,
      repos: [{ name: 'repo-a', path: '/tmp/workspace/repo-a' }],
      summary: '找到 1 个仓库'
    })

    let modelCallCount = 0
    streamAgentMock.mockImplementation(async (_payload, onEvent) => {
      modelCallCount += 1

      if (modelCallCount === 1) {
        onEvent({
          kind: 'tool-call-delta',
          index: 0,
          id: 'call_scan_workspace',
          name: 'scan_workspace_repos',
          argumentsFragment: '{"path":"/tmp/workspace"}'
        })
        onEvent({ kind: 'done', finishReason: 'tool_calls' })
        return
      }

      onEvent({ kind: 'text-delta', text: '当前工作区共有 1 个仓库：repo-a。' })
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
        workspacePath: '/tmp/workspace',
        traceSession
      },
      onText() {}
    })

    expect(traceSession.mode).toBe('general')
    expect(traceSession.workspacePath).toBe('/tmp/workspace')
    expect(traceSession.userText).toBe('分析当前工作区的代码仓库都有哪些')
    expect(traceSession.rounds).toHaveLength(2)
    expect(traceSession.rounds[0].assistantMessages[0].toolCalls[0]).toMatchObject({
      id: 'call_scan_workspace',
      name: 'scan_workspace_repos'
    })
    expect(traceSession.toolCalls[0]).toMatchObject({
      round: 0,
      toolName: 'scan_workspace_repos',
      args: { path: '/tmp/workspace' }
    })
    expect(traceSession.toolResults[0]).toMatchObject({
      round: 0,
      toolName: 'scan_workspace_repos',
      toolStatus: 'success'
    })
    expect(traceSession.toolResults[0].result).toMatchObject({
      ok: true,
      summary: '找到 1 个仓库'
    })
    expect(traceSession.finalAnswer).toBe('当前工作区共有 1 个仓库：repo-a。')
    expect(traceSession.status).toBe('completed')
    expect(traceSession.finishedAt).toBeTruthy()
  })

  it('truncates old trace entries safely', () => {
    let traces = []

    for (let index = 0; index < 25; index += 1) {
      traces = pushTraceEntry(traces, createTraceSession({
        runId: `run-${index}`,
        userText: `message-${index}`
      }), 20)
    }

    expect(traces).toHaveLength(20)
    expect(traces[0].runId).toBe('run-5')
    expect(traces.at(-1).runId).toBe('run-24')
  })
})
