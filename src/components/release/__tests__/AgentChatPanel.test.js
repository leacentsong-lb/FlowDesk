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

  it('dispatches rich action button clicks through the store', async () => {
    const release = useReleaseStore()
    vi.spyOn(release, 'agentStart').mockImplementation(() => {})
    const handleChatAction = vi.spyOn(release, 'handleChatAction').mockImplementation(() => {})

    const wrapper = mount(AgentChatPanel)

    release.chatMessages = [
      {
        id: 'agent-actions',
        role: 'agent',
        ts: new Date('2026-04-07T10:01:00Z'),
        blocks: [
          {
            type: 'actions',
            items: [
              { id: 'confirm-release', label: '确认发布', variant: 'primary' }
            ]
          }
        ]
      }
    ]

    await nextTick()
    await wrapper.get('[data-testid="chat-action-confirm-release"]').trigger('click')

    expect(handleChatAction).toHaveBeenCalledWith('confirm-release')
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
})
