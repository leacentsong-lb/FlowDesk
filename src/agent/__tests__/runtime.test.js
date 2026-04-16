import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveAgentWorkflow } from '../workflows/index.js'

const { mockAgentLoop } = vi.hoisted(() => ({
  mockAgentLoop: vi.fn()
}))

const { mockLoadAgentMemories } = vi.hoisted(() => ({
  mockLoadAgentMemories: vi.fn()
}))

vi.mock('../index.js', () => ({
  agentLoop: mockAgentLoop,
  getAllTools: () => [
    {
      function: {
        name: 'fetch_jira_versions',
        description: '获取 Jira 版本'
      }
    },
    {
      function: {
        name: 'run_preflight',
        description: '执行预检'
      }
    },
    {
      function: {
        name: 'check_credentials',
        description: '检查凭证'
      }
    }
  ]
}))

vi.mock('../memory.js', () => ({
  loadAgentMemories: mockLoadAgentMemories
}))

import { createAgentRuntime } from '../runtime.js'

describe('agent runtime', () => {
  beforeEach(() => {
    mockAgentLoop.mockReset()
    mockLoadAgentMemories.mockReset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('suppresses all follow-up assistant text after version interaction is shown', async () => {
    mockLoadAgentMemories.mockResolvedValueOnce({
      projectMemory: 'project memory',
      userMemory: 'user memory',
      summary: 'Project memory: project memory\nUser memory: user memory',
      sources: {
        project: '/tmp/workspace/.flow-desk/AGENT.md',
        user: '/Users/demo/.flow-desk/AGENT.md'
      }
    })

    mockAgentLoop.mockImplementationOnce(async (_messages, options) => {
      expect(options.state.memorySummary).toContain('Project memory')
      expect(options.state.memorySummary).toContain('User memory')
      options.onToolEnd?.('fetch_jira_versions', {
        ok: true,
        summary: '已获取可发布版本。',
        versions: [{ name: '3.8.4' }]
      })

      options.onEvent?.({ type: 'assistant.completed', text: '请选择要继续处理的版本。' })
      options.onText?.('根据当前分析，请确认您要发布哪个版本到生产环境。')
    })

    const runtime = createAgentRuntime({
      ctx: {
        settings: { aiConfig: { apiKey: 'test-key' }, workspacePath: '/tmp/workspace' },
        jira: {}
      },
      getState: () => ({
        mode: 'release',
        version: '',
        environment: 'production',
        completedTools: []
      })
    })

    await runtime.runAgent('发布生产环境，请开始检查凭证并获取版本列表。', {
      workflow: resolveAgentWorkflow('release')
    })

    const texts = runtime.chatMessages.value.map(message => message.text)
    expect(texts).not.toContain('请选择要继续处理的版本。')
    expect(texts.join('\n')).not.toContain('根据当前分析')
    expect(runtime.pendingInteraction.value).toMatchObject({
      type: 'selection-card',
      title: '选择发布版本'
    })
    expect(runtime.pendingInteraction.value.actions.map(action => action.id)).toContain('version-3.8.4')
  })

  it('streams assistant text from incremental agent events', async () => {
    mockLoadAgentMemories.mockResolvedValueOnce({
      projectMemory: '',
      userMemory: '',
      summary: '',
      sources: {
        project: '/tmp/workspace/.flow-desk/AGENT.md',
        user: '/Users/demo/.flow-desk/AGENT.md'
      }
    })

    mockAgentLoop.mockImplementationOnce(async (_messages, options) => {
      options.onEvent?.({ type: 'assistant.delta', text: '这是' })
      options.onEvent?.({ type: 'assistant.delta', text: '真实' })
      options.onEvent?.({ type: 'assistant.delta', text: '流式输出' })
      options.onEvent?.({ type: 'assistant.completed', text: '这是真实流式输出' })
    })

    const runtime = createAgentRuntime({
      ctx: {
        settings: { aiConfig: { apiKey: 'test-key' }, workspacePath: '/tmp/workspace' },
        jira: {}
      },
      getState: () => ({
        mode: 'general',
        version: '',
        environment: 'production',
        completedTools: []
      })
    })

    await runtime.runAgent('请开始流式回复。')

    const streamedMessage = runtime.chatMessages.value.at(-1)
    expect(streamedMessage.role).toBe('agent')
    expect(streamedMessage.text).toBe('这是真实流式输出')
    expect(streamedMessage._streaming).toBe(false)
  })

  it('renders the original user text when an internal sticky workflow prefix is used', async () => {
    mockLoadAgentMemories.mockResolvedValueOnce({
      projectMemory: '',
      userMemory: '',
      summary: '',
      sources: {
        project: '/tmp/workspace/.flow-desk/AGENT.md',
        user: '/Users/demo/.flow-desk/AGENT.md'
      }
    })

    mockAgentLoop.mockImplementationOnce(async (_messages, options) => {
      options.onText?.('我是发布助手。')
    })

    const runtime = createAgentRuntime({
      ctx: {
        settings: { aiConfig: { apiKey: 'test-key' }, workspacePath: '/tmp/workspace' },
        jira: {}
      },
      getState: () => ({
        mode: 'release',
        version: '3.8.2',
        environment: 'production',
        completedTools: []
      })
    })

    await runtime.runAgent('继续当前发布会话。用户追加消息：你是谁？', {
      displayUserText: '你是谁？'
    })

    expect(runtime.chatMessages.value[0].role).toBe('user')
    expect(runtime.chatMessages.value[0].text).toBe('你是谁？')
    expect(runtime.agentMessages.value[0].content).toBe('继续当前发布会话。用户追加消息：你是谁？')
  })

  it('does not append a duplicate final answer when assistant completion already rendered it', async () => {
    mockLoadAgentMemories.mockResolvedValueOnce({
      projectMemory: '',
      userMemory: '',
      summary: '',
      sources: {
        project: '/tmp/workspace/.flow-desk/AGENT.md',
        user: '/Users/demo/.flow-desk/AGENT.md'
      }
    })

    mockAgentLoop.mockImplementationOnce(async (_messages, options) => {
      options.onEvent?.({ type: 'assistant.delta', text: 'admin 默认对应 ' })
      options.onEvent?.({ type: 'assistant.delta', text: 'Staff 系统。' })
      options.onEvent?.({ type: 'assistant.completed', text: 'admin 默认对应 Staff 系统。' })
      options.onText?.('admin 默认对应 Staff 系统。')
    })

    const runtime = createAgentRuntime({
      ctx: {
        settings: { aiConfig: { apiKey: 'test-key' }, workspacePath: '/tmp/workspace' },
        jira: {}
      },
      getState: () => ({
        mode: 'general',
        version: '',
        environment: 'production',
        completedTools: []
      })
    })

    await runtime.runAgent('admin 对应哪个仓库')

    const agentReplies = runtime.chatMessages.value.filter(message => message.role === 'agent')
    expect(agentReplies).toHaveLength(1)
    expect(agentReplies[0].text).toBe('admin 默认对应 Staff 系统。')
  })

  it('renders recoverable tool validation issues as self-healing instead of hard failure', async () => {
    mockLoadAgentMemories.mockResolvedValueOnce({
      projectMemory: '',
      userMemory: '',
      summary: '',
      sources: {
        project: '/tmp/workspace/.flow-desk/AGENT.md',
        user: '/Users/demo/.flow-desk/AGENT.md'
      }
    })

    mockAgentLoop.mockImplementationOnce(async (_messages, options) => {
      options.onToolEnd?.('read_file', {
        ok: false,
        error: '工具参数无效：read_file 缺少必填参数 path',
        summary: '参数不完整，Agent 正在自动补齐后重试。',
        recoverable: true,
        recoveryKind: 'missing_required_params',
        missingFields: ['path']
      })

      options.onText?.('已自动补齐参数并继续处理。')
    })

    const runtime = createAgentRuntime({
      ctx: {
        settings: { aiConfig: { apiKey: 'test-key' }, workspacePath: '/tmp/workspace' },
        jira: {}
      },
      getState: () => ({
        mode: 'general',
        version: '',
        environment: 'production',
        completedTools: []
      })
    })

    await runtime.runAgent('读一下 package.json')

    const toolMessage = runtime.chatMessages.value.find(message => message.kind === 'tool')
    expect(toolMessage.text).toContain('Agent 正在自动补齐后重试')
    expect(toolMessage.status).toBe('recovering')
    expect(toolMessage.actions || []).toHaveLength(0)
  })

  it('merges repeated updates of the same tool into a single chat entry', async () => {
    mockLoadAgentMemories.mockResolvedValueOnce({
      projectMemory: '',
      userMemory: '',
      summary: '',
      sources: {
        project: '/tmp/workspace/.flow-desk/AGENT.md',
        user: '/Users/demo/.flow-desk/AGENT.md'
      }
    })

    mockAgentLoop.mockImplementationOnce(async (_messages, options) => {
      options.onToolStart?.('check_credentials', {})
      options.onToolEnd?.('check_credentials', {
        ok: true,
        summary: '凭证就绪：Jira ✓, GitHub ✓, AI ✓'
      })
    })

    const runtime = createAgentRuntime({
      ctx: {
        settings: { aiConfig: { apiKey: 'test-key' }, workspacePath: '/tmp/workspace' },
        jira: {}
      },
      getState: () => ({
        mode: 'release',
        version: '',
        environment: 'production',
        completedTools: []
      })
    })

    await runtime.runAgent('检查发布凭证。')

    const toolMessages = runtime.chatMessages.value.filter(message => message.kind === 'tool')
    expect(toolMessages).toHaveLength(1)
    expect(toolMessages[0].meta?.toolName).toBe('check_credentials')
    expect(toolMessages[0].meta?.statusHistory?.map(item => item.status)).toEqual(['running', 'success'])
    expect(toolMessages[0].text).toContain('凭证就绪')
  })

  it('blocks guarded dangerous release tools until the approval gate is opened', async () => {
    mockLoadAgentMemories.mockResolvedValueOnce({
      projectMemory: '',
      userMemory: '',
      summary: '',
      sources: {
        project: '/tmp/workspace/.flow-desk/AGENT.md',
        user: '/Users/demo/.flow-desk/AGENT.md'
      }
    })

    mockAgentLoop.mockImplementationOnce(async (_messages, options) => {
      const guardResult = await options.beforeToolCall?.({
        toolName: 'execute_release_merge',
        args: { session_id: 'session-1' },
        state: options.state
      })

      options.onToolEnd?.('execute_release_merge', guardResult?.result || {
        ok: false,
        blocked: true,
        summary: '等待人工授权后再执行。'
      })
      options.onText?.('已暂停，等待审批。')
    })

    const runtime = createAgentRuntime({
      ctx: {
        settings: { aiConfig: { apiKey: 'test-key' }, workspacePath: '/tmp/workspace' },
        jira: {}
      },
      getState: () => ({
        mode: 'release',
        version: '3.8.2',
        environment: 'production',
        completedTools: []
      }),
      beforeToolCall({ toolName }) {
        if (toolName === 'execute_release_merge') {
          return {
            result: {
              ok: false,
              blocked: true,
              requiresApproval: true,
              summary: 'mergeLatest 仍在等待人工授权。'
            }
          }
        }
        return null
      }
    })

    await runtime.runAgent('继续执行发布。', {
      workflow: resolveAgentWorkflow('release')
    })

    const toolMessage = runtime.chatMessages.value.find(message => message.kind === 'tool')
    expect(toolMessage.text).toContain('等待人工授权')
  })

  it('ignores stale async text after stopping the current run', async () => {
    mockLoadAgentMemories.mockResolvedValueOnce({
      projectMemory: '',
      userMemory: '',
      summary: '',
      sources: {
        project: '/tmp/workspace/.flow-desk/AGENT.md',
        user: '/Users/demo/.flow-desk/AGENT.md'
      }
    })

    mockAgentLoop.mockImplementationOnce(async (_messages, options) => {
      await new Promise(resolve => {
        setTimeout(() => {
          options.onText?.('这条旧消息不应该继续显示。')
          resolve()
        }, 1000)
      })
    })

    const runtime = createAgentRuntime({
      ctx: {
        settings: { aiConfig: { apiKey: 'test-key' }, workspacePath: '/tmp/workspace' },
        jira: {}
      },
      getState: () => ({
        mode: 'general',
        version: '',
        environment: 'production',
        completedTools: []
      })
    })

    const runPromise = runtime.runAgent('请先分析当前工作区。')
    expect(runtime.agentRunning.value).toBe(true)

    runtime.stopAgentChat()
    expect(runtime.agentRunning.value).toBe(false)

    await vi.advanceTimersByTimeAsync(1000)
    await runPromise

    expect(runtime.chatMessages.value.map(message => message.text).join('\n')).not.toContain('旧消息不应该继续显示')
  })

  it('passes workflow tool subsets down to the agent loop', async () => {
    mockLoadAgentMemories.mockResolvedValue({
      projectMemory: '',
      userMemory: '',
      summary: '',
      sources: {
        project: '/tmp/workspace/.flow-desk/AGENT.md',
        user: '/Users/demo/.flow-desk/AGENT.md'
      }
    })

    const releaseTools = [
      {
        type: 'function',
        function: {
          name: 'fetch_jira_versions',
          description: '获取 Jira 版本'
        }
      }
    ]

    mockAgentLoop.mockImplementationOnce(async (_messages, options) => {
      expect(options.tools).toEqual(releaseTools)
    })

    const runtime = createAgentRuntime({
      ctx: {
        settings: { aiConfig: { apiKey: 'test-key' }, workspacePath: '/tmp/workspace' },
        jira: {}
      },
      getState: () => ({
        mode: 'general',
        version: '',
        environment: 'production',
        completedTools: []
      })
    })

    await runtime.runAgent('发布生产环境，请开始检查', {
      tools: releaseTools
    })
  })

  it('caches loaded skills after the model explicitly loads them', async () => {
    mockLoadAgentMemories.mockResolvedValue({
      projectMemory: '',
      userMemory: '',
      summary: '',
      sources: {
        project: '/tmp/workspace/.flow-desk/AGENT.md',
        user: '/Users/demo/.flow-desk/AGENT.md'
      }
    })

    mockAgentLoop
      .mockImplementationOnce(async (_messages, options) => {
        expect(options.state.primedSkillNames || []).toEqual([])
        expect(options.state.primedSkillBundle).toBe('')
        options.onToolEnd?.('load_skill', {
          ok: true,
          skillName: 'git-branching',
          summary: '已加载技能：git-branching',
          content: '<skill name="git-branching">branch rules</skill>'
        })
      })
      .mockImplementationOnce(async (_messages, options) => {
        expect(options.state.primedSkillNames).toContain('git-branching')
        expect(options.state.primedSkillBundle).toContain('branch rules')
      })

    const runtime = createAgentRuntime({
      ctx: {
        settings: { aiConfig: { apiKey: 'test-key' }, workspacePath: '/tmp/workspace' },
        jira: {}
      },
      getState: () => ({
        mode: 'release',
        version: '',
        environment: 'production',
        completedTools: []
      })
    })

    await runtime.runAgent('先加载 git branching skill')
    await runtime.runAgent('请根据当前分支生成 commit message')

    expect(runtime.chatMessages.value.some(message =>
      message.kind === 'skill' &&
      String(message.text || '').includes('git-branching')
    )).toBe(true)
  })
})
