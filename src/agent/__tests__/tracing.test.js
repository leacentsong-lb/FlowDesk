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
  getAllTools: () => [
    {
      function: {
        name: 'scan_workspace_repos',
        description: '扫描当前工作区内的 git 仓库'
      }
    }
  ],
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
  buildPromptMessages: vi.fn(() => [{ role: 'system', content: 'system prompt' }]),
  microcompact: vi.fn(),
  estimateTokens: vi.fn(() => 0)
}))

import { agentLoop } from '../loop.js'
import { buildTraceTimeline, createTraceSession, pushTraceEntry, recordTraceEvent } from '../tracing.js'

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

  it('builds a readable timeline for network, ai, tool and lifecycle events', () => {
    const traceSession = createTraceSession({
      runId: 'run-trace-2',
      mode: 'general',
      workspacePath: '/tmp/workspace',
      userText: '检查链路'
    })

    recordTraceEvent(traceSession, {
      type: 'model.call',
      round: 0,
      provider: 'openai',
      model: 'gpt-5.2',
      messageCount: 3,
      toolCount: 2,
      request: {
        messages: [{ role: 'user', content: '检查链路' }],
        tools: [{ function: { name: 'scan_workspace_repos' } }]
      }
    })
    recordTraceEvent(traceSession, {
      type: 'network.start',
      round: 0,
      requestId: 'req-1',
      method: 'POST',
      path: '/v1/agent/stream',
      url: 'http://127.0.0.1:4317/v1/agent/stream',
      payload: {
        apiKey: 'sk-test',
        provider: 'openai'
      }
    })
    recordTraceEvent(traceSession, {
      type: 'tool.start',
      round: 0,
      toolName: 'scan_workspace_repos',
      args: { path: '/tmp/workspace' }
    })
    recordTraceEvent(traceSession, {
      type: 'tool.end',
      round: 0,
      toolName: 'scan_workspace_repos',
      toolStatus: 'success',
      result: { ok: true, summary: '找到 1 个仓库' }
    })
    recordTraceEvent(traceSession, {
      type: 'network.end',
      round: 0,
      requestId: 'req-1',
      ok: true,
      status: 200,
      durationMs: 120,
      response: { finishReason: 'stop' }
    })
    recordTraceEvent(traceSession, {
      type: 'run.final_answer',
      text: '链路检查完成。'
    })

    const timeline = buildTraceTimeline(traceSession)

    expect(timeline.map(item => item.category)).toEqual([
      'ai',
      'network',
      'tool',
      'tool',
      'network',
      'lifecycle'
    ])
    expect(timeline[0]).toMatchObject({
      label: 'AI 请求',
      summary: 'openai / gpt-5.2 · 3 条消息 · 2 个工具'
    })
    expect(timeline[1].raw.payload.apiKey).toBe('***')
    expect(timeline[2]).toMatchObject({
      label: '工具开始',
      summary: 'scan_workspace_repos'
    })
    expect(timeline[4]).toMatchObject({
      label: '网络响应',
      status: 'success'
    })
    expect(timeline[5]).toMatchObject({
      label: '最终回复',
      summary: '链路检查完成。'
    })
  })
})
