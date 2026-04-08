import { describe, expect, it } from 'vitest'
import { formatCompactToolText, normalizeChatMessage } from '../chat-format.js'

describe('chat format action compression', () => {
  it('compresses long version-selection text when actions are present', () => {
    const message = normalizeChatMessage({
      role: 'agent',
      text: `根据当前分析，发布流程已准备就绪：

当前状态
- 凭证检查通过
- Jira 版本列表已获取

请确认
您要发布哪个版本到生产环境？`,
      actions: [
        { id: 'version-3.8.4', label: '3.8.4' },
        { id: 'version-3.8.3', label: '3.8.3' }
      ]
    })

    expect(message.text).toBe('请选择要继续处理的版本。')
    expect(message.blocks[0].type).toBe('markdown')
    expect(message.blocks[0].content).toBe('请选择要继续处理的版本。')
    expect(message.blocks[1].type).toBe('actions')
  })

  it('formats compact tool text for running and error states', () => {
    expect(formatCompactToolText({
      toolName: 'scan_pr_status',
      status: 'running',
      toolLabel: '扫描 PR 状态'
    })).toBe('Tool(scan_pr_status): 正在执行 扫描 PR 状态...')

    expect(formatCompactToolText({
      toolName: 'scan_pr_status',
      status: 'error',
      summary: '执行失败，请选择下一步操作。'
    })).toBe('Tool(scan_pr_status): 执行失败，请选择下一步操作。')
  })

  it('formats compact skill text like cursor activity output', () => {
    expect(formatCompactToolText({
      toolName: 'load_skill',
      status: 'success',
      summary: '已加载技能：workspace-topology',
      meta: {
        skillName: 'workspace-topology'
      }
    })).toBe('Skill(workspace-topology): 已加载技能。')
  })
})
