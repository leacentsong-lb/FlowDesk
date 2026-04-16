import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import AgentChatPanel from '../AgentChatPanel.vue'
import { useReleaseStore } from '../../../stores/release'

describe('AgentChatPanel', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('renders generic assistant copy by default', () => {
    const release = useReleaseStore()
    vi.spyOn(release, 'agentStart').mockImplementation(() => {})

    const wrapper = mount(AgentChatPanel)

    expect(wrapper.text()).toContain('开发助手')
    expect(wrapper.find('[data-testid="chat-topbar"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="chat-timeline"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="chat-composer"]').exists()).toBe(true)
    expect(wrapper.find('.suggestion-row').exists()).toBe(false)
    expect(wrapper.get('.chat-input').attributes('placeholder')).toContain('开发助手')
  })

  it('renders structured code and json blocks for agent messages', async () => {
    const release = useReleaseStore()
    vi.spyOn(release, 'agentStart').mockImplementation(() => {})

    const wrapper = mount(AgentChatPanel)

    release.chatMessages = [
      {
        id: 'agent-rich',
        role: 'agent',
        ts: new Date('2026-04-07T10:00:00Z'),
        text: 'rich blocks',
        blocks: [
          {
            type: 'code',
            language: 'js',
            content: 'const release = true;'
          },
          {
            type: 'json',
            raw: '{"status":"ok","count":2}',
            content: {
              status: 'ok',
              count: 2
            }
          }
        ]
      }
    ]

    await nextTick()

    expect(wrapper.find('[data-testid="code-block"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="copy-code-btn"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="json-block"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('"status": "ok"')
  })

  it('renders docked interactions above the composer and dispatches clicks through the store', async () => {
    const release = useReleaseStore()
    vi.spyOn(release, 'agentStart').mockImplementation(() => {})
    const handleChatAction = vi.spyOn(release, 'handleChatAction').mockImplementation(() => {})

    const wrapper = mount(AgentChatPanel)

    release.pendingInteraction = {
      id: 'interaction-1',
      type: 'action-list',
      title: '选择下一步',
      actions: [
        { id: 'confirm-release', label: '确认发布', variant: 'primary' }
      ]
    }

    await nextTick()

    expect(wrapper.find('[data-testid="chat-docked-interaction"]').exists()).toBe(true)
    expect(wrapper.find('.msg-actions').exists()).toBe(false)
    await wrapper.get('[data-testid="chat-action-confirm-release"]').trigger('click')

    expect(handleChatAction).toHaveBeenCalledWith('confirm-release')
  })

  it('renders approval interactions with explicit danger copy', async () => {
    const release = useReleaseStore()
    vi.spyOn(release, 'agentStart').mockImplementation(() => {})

    const wrapper = mount(AgentChatPanel)

    release.pendingInteraction = {
      id: 'interaction-approval-1',
      type: 'approval-card',
      title: '确认执行危险操作',
      description: '这会把 release/v3.8.2 合并到 latest。',
      meta: {
        severity: 'high',
        approvalLabel: '需要人工授权'
      },
      actions: [
        { id: 'approve-mergeLatest', label: '确认合并', variant: 'danger' },
        { id: 'reject-mergeLatest', label: '取消', variant: 'secondary' }
      ]
    }

    await nextTick()

    expect(wrapper.find('[data-testid="chat-docked-interaction"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('需要人工授权')
    expect(wrapper.text()).toContain('确认执行危险操作')
  })

  it('renders compact tool status lines instead of verbose tool cards', async () => {
    const release = useReleaseStore()
    vi.spyOn(release, 'agentStart').mockImplementation(() => {})

    const wrapper = mount(AgentChatPanel)

    release.chatMessages = [
      {
        id: 'tool-running',
        role: 'agent',
        kind: 'tool',
        status: 'running',
        ts: new Date('2026-04-07T10:02:00Z'),
        meta: {
          toolLabel: '检查凭证',
          toolName: 'check_credentials',
          compactText: 'Tool(check_credentials): 正在执行 检查凭证...'
        },
        text: 'Tool(check_credentials): 正在执行 检查凭证...'
      }
    ]

    await nextTick()

    const card = wrapper.find('[data-testid="tool-status-card"]')
    expect(card.exists()).toBe(true)
    expect(card.text()).toContain('Tool(check_credentials): 正在执行 检查凭证...')
    expect(card.attributes('data-activity-kind')).toBe('tool')
  })

  it('shows tool status transitions inside the details panel instead of separate rows', async () => {
    const release = useReleaseStore()
    vi.spyOn(release, 'agentStart').mockImplementation(() => {})

    const wrapper = mount(AgentChatPanel)

    release.chatMessages = [
      {
        id: 'tool-check-credentials',
        role: 'agent',
        kind: 'tool',
        status: 'success',
        ts: new Date('2026-04-07T10:02:00Z'),
        meta: {
          toolLabel: '检查凭证',
          toolName: 'check_credentials',
          compactText: 'Tool(check_credentials): 凭证就绪：Jira ✓, GitHub ✓, AI ✓',
          displayResult: {
            ok: true,
            summary: '凭证就绪：Jira ✓, GitHub ✓, AI ✓'
          },
          statusHistory: [
            { status: 'running', text: '正在执行 检查凭证', ts: '2026-04-07T10:02:00Z' },
            { status: 'success', text: '凭证就绪：Jira ✓, GitHub ✓, AI ✓', ts: '2026-04-07T10:02:02Z' }
          ]
        },
        text: 'Tool(check_credentials): 凭证就绪：Jira ✓, GitHub ✓, AI ✓'
      }
    ]

    await nextTick()

    expect(wrapper.findAll('[data-testid="tool-status-card"]')).toHaveLength(1)
    await wrapper.get('[data-testid="tool-details-toggle"]').trigger('click')
    expect(wrapper.text()).toContain('运行中')
    expect(wrapper.text()).toContain('成功')
    expect(wrapper.text()).toContain('正在执行 检查凭证')
    expect(wrapper.text()).toContain('凭证就绪：Jira ✓, GitHub ✓, AI ✓')
  })

  it('renders skill activity with a visible skill badge and styling hook', async () => {
    const release = useReleaseStore()
    vi.spyOn(release, 'agentStart').mockImplementation(() => {})

    const wrapper = mount(AgentChatPanel)

    release.chatMessages = [
      {
        id: 'skill-primed',
        role: 'agent',
        kind: 'skill',
        status: 'success',
        ts: new Date('2026-04-08T10:03:00Z'),
        meta: {
          toolName: 'load_skill',
          skillName: 'git-branching',
          compactText: 'Skill(git-branching): 已注入到当前对话。'
        },
        text: 'Skill(git-branching): 已注入到当前对话。'
      }
    ]

    await nextTick()

    const card = wrapper.find('[data-testid="tool-status-card"]')
    expect(card.exists()).toBe(true)
    expect(card.attributes('data-activity-kind')).toBe('skill')
    expect(card.text()).toContain('SKILL')
    expect(card.text()).toContain('git-branching')
  })

  it('renders reasoning as a compact summary chip by default', async () => {
    const release = useReleaseStore()
    vi.spyOn(release, 'agentStart').mockImplementation(() => {})

    const wrapper = mount(AgentChatPanel)

    release.chatMessages = [
      {
        id: 'agent-reasoning',
        role: 'agent',
        ts: new Date('2026-04-08T10:03:00Z'),
        text: '我已经完成分析。',
        _reasoning: '先检查当前工作区配置，再确认可用工具，最后决定下一步。'
      }
    ]

    await nextTick()

    const summary = wrapper.find('[data-testid="reasoning-summary"]')
    expect(summary.exists()).toBe(true)
    expect(summary.text()).toContain('思考')
    expect(summary.text()).toContain('先检查当前工作区配置')
  })

  it('does not expose full skill body in the chat UI', async () => {
    const release = useReleaseStore()
    vi.spyOn(release, 'agentStart').mockImplementation(() => {})

    const wrapper = mount(AgentChatPanel)

    release.chatMessages = [
      {
        id: 'tool-skill',
        role: 'agent',
        kind: 'tool',
        status: 'success',
        ts: new Date('2026-04-07T10:03:00Z'),
        meta: {
          toolLabel: '加载技能',
          toolName: 'load_skill',
          displayResult: {
            ok: true,
            skillName: 'release-flow',
            summary: '已加载技能：release-flow'
          },
          rawResult: {
            ok: true,
            skillName: 'release-flow',
            summary: '已加载技能：release-flow',
            content: '<skill name="release-flow">secret body</skill>'
          }
        },
        text: '已加载技能：release-flow'
      }
    ]

    await nextTick()

    expect(wrapper.text()).toContain('已加载技能：release-flow')
    expect(wrapper.text()).not.toContain('secret body')
    expect(wrapper.text()).not.toContain('<skill name="release-flow">')
  })

  it('shows a stop button while the agent is running', async () => {
    const release = useReleaseStore()
    vi.spyOn(release, 'agentStart').mockImplementation(() => {})

    const wrapper = mount(AgentChatPanel)
    release.agentRunning = true

    await nextTick()

    expect(wrapper.find('[data-testid="chat-stop-btn"]').exists()).toBe(true)
  })

  it('opens prompt settings from the chat topbar', async () => {
    const release = useReleaseStore()
    vi.spyOn(release, 'agentStart').mockImplementation(() => {})
    const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')

    const wrapper = mount(AgentChatPanel)
    await wrapper.get('[data-testid="open-prompt-studio-btn"]').trigger('click')

    expect(dispatchEventSpy).toHaveBeenCalledWith(expect.objectContaining({
      type: 'open-settings'
    }))
  })

  it('renders a right-side trace panel with latest ai chain details', async () => {
    const release = useReleaseStore()
    vi.spyOn(release, 'agentStart').mockImplementation(() => {})

    release.activeTrace = {
      id: 'trace-1',
      runId: 'run-1',
      status: 'completed',
      startedAt: '2026-04-15T10:00:00.000Z',
      finishedAt: '2026-04-15T10:00:05.000Z',
      events: [
        {
          type: 'model.call',
          at: '2026-04-15T10:00:01.000Z',
          provider: 'openai',
          model: 'gpt-5.2',
          messageCount: 3,
          toolCount: 2,
          request: {
            messages: [{ role: 'user', content: '帮我分析链路' }]
          }
        },
        {
          type: 'network.end',
          at: '2026-04-15T10:00:02.000Z',
          requestId: 'req-1',
          ok: true,
          status: 200,
          durationMs: 88,
          response: { finishReason: 'stop' }
        },
        {
          type: 'tool.end',
          at: '2026-04-15T10:00:03.000Z',
          toolName: 'scan_workspace_repos',
          toolStatus: 'success',
          result: { ok: true, summary: '找到 1 个仓库' }
        },
        {
          type: 'run.final_answer',
          at: '2026-04-15T10:00:04.000Z',
          text: '链路检查完成。'
        }
      ]
    }

    const wrapper = mount(AgentChatPanel)
    await nextTick()

    expect(wrapper.find('[data-testid="trace-panel"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('调试链路')
    expect(wrapper.text()).toContain('AI 请求')
    expect(wrapper.text()).toContain('网络响应')
    expect(wrapper.text()).toContain('工具完成')
    expect(wrapper.text()).toContain('链路检查完成。')
    expect(wrapper.find('[data-testid="trace-detail-json"]').text()).toContain('"model": "gpt-5.2"')
  })

  it('does not send on Enter and updates the composer hint', async () => {
    const release = useReleaseStore()
    vi.spyOn(release, 'agentStart').mockImplementation(() => {})
    const agentChat = vi.spyOn(release, 'agentChat').mockImplementation(() => {})

    const wrapper = mount(AgentChatPanel)
    const input = wrapper.get('.chat-input')

    await input.setValue('继续发布')
    await input.trigger('keydown', { key: 'Enter', shiftKey: false })

    expect(agentChat).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Enter 换行，Shift + Enter 发送')
  })

  it('sends on Shift+Enter', async () => {
    const release = useReleaseStore()
    vi.spyOn(release, 'agentStart').mockImplementation(() => {})
    const agentChat = vi.spyOn(release, 'agentChat').mockImplementation(() => {})

    const wrapper = mount(AgentChatPanel)
    const input = wrapper.get('.chat-input')

    await input.setValue('继续发布')
    await input.trigger('keydown', { key: 'Enter', shiftKey: true })

    expect(agentChat).toHaveBeenCalledWith('继续发布')
  })

  it('locks the composer and shows a running state while waiting for the agent', async () => {
    const release = useReleaseStore()
    vi.spyOn(release, 'agentStart').mockImplementation(() => {})

    const wrapper = mount(AgentChatPanel)
    release.agentRunning = true

    await nextTick()

    expect(wrapper.get('.composer-shell').classes()).toContain('is-running')
    expect(wrapper.get('.chat-input').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.send-btn').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.composer-prefix').attributes('data-running')).toBe('true')
    expect(wrapper.findAll('[data-testid^="composer-ring-"]')).toHaveLength(4)
  })

  it('does not send again on Shift+Enter while the agent is still running', async () => {
    const release = useReleaseStore()
    vi.spyOn(release, 'agentStart').mockImplementation(() => {})
    const agentChat = vi.spyOn(release, 'agentChat').mockImplementation(() => {})

    const wrapper = mount(AgentChatPanel)
    const input = wrapper.get('.chat-input')

    await input.setValue('继续发布')
    release.agentRunning = true
    await nextTick()
    await input.trigger('keydown', { key: 'Enter', shiftKey: true })

    expect(agentChat).not.toHaveBeenCalled()
  })
})
