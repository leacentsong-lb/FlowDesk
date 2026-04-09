import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSkillLoader } from '../skills.js'

const { mockAgentLoop } = vi.hoisted(() => ({
  mockAgentLoop: vi.fn()
}))

const { mockLoadAgentMemories } = vi.hoisted(() => ({
  mockLoadAgentMemories: vi.fn()
}))

vi.mock('../index.js', () => ({
  agentLoop: mockAgentLoop,
  TOOLS: [
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

  it('suppresses verbose follow-up text after version actions are shown', async () => {
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

    await runtime.runAgent('发布生产环境，请开始检查凭证并获取版本列表。')

    const texts = runtime.chatMessages.value.map(message => message.text)
    expect(texts).toContain('请选择要继续处理的版本。')
    expect(texts.join('\n')).not.toContain('根据当前分析')
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

  it('primes workspace-topology once for workspace mapping routes', async () => {
    mockLoadAgentMemories.mockResolvedValue({
      projectMemory: '',
      userMemory: '',
      summary: '',
      sources: {
        project: '/tmp/workspace/.flow-desk/AGENT.md',
        user: '/Users/demo/.flow-desk/AGENT.md'
      }
    })

    mockAgentLoop.mockImplementation(async (_messages, options) => {
      expect(options.state.primedSkillNames).toContain('workspace-topology')
      expect(options.state.primedSkillBundle).toContain('<skill name="workspace-topology">')
    })

    const loadSpy = vi.spyOn(defaultSkillLoader, 'load')

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

    await runtime.runAgent('admin 对应哪个仓库', {
      route: {
        mode: 'general',
        intent: 'workspace_mapping',
        shouldPrimeWorkspaceSkill: true,
        shouldScanWorkspaceFirst: false
      }
    })

    expect(loadSpy).toHaveBeenCalledTimes(1)
    expect(loadSpy).toHaveBeenCalledWith('workspace-topology')
  })

  it('does not reload workspace-topology in the same runtime session', async () => {
    mockLoadAgentMemories.mockResolvedValue({
      projectMemory: '',
      userMemory: '',
      summary: '',
      sources: {
        project: '/tmp/workspace/.flow-desk/AGENT.md',
        user: '/Users/demo/.flow-desk/AGENT.md'
      }
    })

    mockAgentLoop.mockResolvedValue(undefined)

    const loadSpy = vi.spyOn(defaultSkillLoader, 'load')

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

    await runtime.runAgent('admin 对应哪个仓库', {
      route: {
        mode: 'general',
        intent: 'workspace_mapping',
        shouldPrimeWorkspaceSkill: true,
        shouldScanWorkspaceFirst: false
      }
    })
    await runtime.runAgent('后台系统是哪一个 repo', {
      route: {
        mode: 'general',
        intent: 'workspace_mapping',
        shouldPrimeWorkspaceSkill: true,
        shouldScanWorkspaceFirst: false
      }
    })

    expect(loadSpy).toHaveBeenCalledTimes(1)
    expect(loadSpy).toHaveBeenCalledWith('workspace-topology')
  })

  it('does not prime workspace-topology for release routes', async () => {
    mockLoadAgentMemories.mockResolvedValue({
      projectMemory: '',
      userMemory: '',
      summary: '',
      sources: {
        project: '/tmp/workspace/.flow-desk/AGENT.md',
        user: '/Users/demo/.flow-desk/AGENT.md'
      }
    })

    mockAgentLoop.mockImplementationOnce(async (_messages, options) => {
      expect(options.state.primedSkillNames || []).not.toContain('workspace-topology')
      expect(options.state.primedSkillBundle).toBe('')
    })

    const loadSpy = vi.spyOn(defaultSkillLoader, 'load')

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

    await runtime.runAgent('发布生产环境，请开始检查', {
      route: {
        mode: 'release',
        intent: 'release_flow',
        shouldPrimeWorkspaceSkill: false,
        shouldScanWorkspaceFirst: false
      }
    })

    expect(loadSpy).not.toHaveBeenCalled()
  })

  it('primes git-branching for commit message routes', async () => {
    mockLoadAgentMemories.mockResolvedValue({
      projectMemory: '',
      userMemory: '',
      summary: '',
      sources: {
        project: '/tmp/workspace/.flow-desk/AGENT.md',
        user: '/Users/demo/.flow-desk/AGENT.md'
      }
    })

    mockAgentLoop.mockImplementationOnce(async (_messages, options) => {
      expect(options.state.primedSkillNames).toContain('git-branching')
      expect(options.state.primedSkillBundle).toContain('<skill name="git-branching">')
    })

    const loadSpy = vi.spyOn(defaultSkillLoader, 'load')

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

    await runtime.runAgent('请根据当前本地分支帮我生成 commit message', {
      route: {
        mode: 'general',
        intent: 'git_commit_message',
        shouldPrimeWorkspaceSkill: false,
        shouldScanWorkspaceFirst: false,
        primeSkillNames: ['git-branching']
      }
    })

    expect(loadSpy).toHaveBeenCalledWith('git-branching')
    expect(runtime.chatMessages.value.some(message =>
      message.kind === 'skill' &&
      String(message.text || '').includes('git-branching')
    )).toBe(true)
  })
})
