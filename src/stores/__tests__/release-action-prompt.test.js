import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const { mockAgentLoop } = vi.hoisted(() => ({
  mockAgentLoop: vi.fn()
}))

vi.mock('../../agent/index.js', () => ({
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

import { useReleaseStore } from '../release'

describe('release store action-first replies', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    mockAgentLoop.mockReset()
  })

  it('suppresses verbose follow-up text after version actions are already shown', async () => {
    mockAgentLoop.mockImplementationOnce(async (_messages, options) => {
      options.onToolEnd?.('fetch_jira_versions', {
        ok: true,
        summary: '已获取可发布版本。',
        versions: [
          { name: '3.8.4' },
          { name: '3.8.3' }
        ]
      })

      options.onText?.(`根据当前分析，发布流程已准备就绪：

当前状态
- 凭证检查通过
- 版本列表已获取

请确认您要发布哪个版本到生产环境。`)
    })

    const release = useReleaseStore()

    await release.handleChatAction('mode-release-production')

    const texts = release.chatMessages.map(message => message.text)

    expect(texts).toContain('请选择要继续处理的版本。')
    expect(texts.join('\n')).not.toContain('根据当前分析')
    expect(release.chatMessages.some(message =>
      message.actions?.some(action => action.id === 'version-3.8.4')
    )).toBe(true)
  })

  it('keeps a short follow-up message when the release flow is blocked', async () => {
    mockAgentLoop.mockImplementationOnce(async (_messages, options) => {
      options.onToolEnd?.('run_preflight', {
        ok: false,
        summary: '预检失败，请选择下一步操作。'
      })

      options.onText?.('检测到阻塞，请先修复预检问题后再继续。')
    })

    const release = useReleaseStore()

    await release.handleChatAction('mode-release-production')

    const texts = release.chatMessages.map(message => message.text)
    const compactTexts = release.chatMessages.map(message => message.meta?.compactText).filter(Boolean)

    expect(compactTexts).toContain('Tool(run_preflight): 预检失败，请选择下一步操作。')
    expect(release.chatMessages.some(message =>
      message.role === 'agent' && message.kind !== 'tool' && message.text.startsWith('检测到')
    )).toBe(true)
    expect(release.chatMessages.some(message =>
      message.actions?.some(action => action.id === 'retry-run_preflight')
    )).toBe(true)
  })
})
