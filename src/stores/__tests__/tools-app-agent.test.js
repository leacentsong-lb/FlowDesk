import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useToolsStore } from '../tools'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue({
    ok: true,
    skills: []
  })
}))

describe('tools store app agent editors', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('loads, saves and resets app built-in skill customizations', async () => {
    const tools = useToolsStore()

    tools.refreshAppSkillRegistry()
    const original = tools.appSkills.find(skill => skill.name === 'git-branching')
    expect(original.summary).toContain('git相关操作都使用此skills')
    expect(original.synopsis).toContain('Generate and execute a compliant commit message')

    await tools.selectAppSkill('git-branching')
    tools.selectedAppSkillContent = `${original.defaultContent}\n\n## Custom Section`
    tools.selectedAppSkillEnabled = false
    tools.saveSelectedAppSkill()

    tools.refreshAppSkillRegistry()
    const customized = tools.appSkills.find(skill => skill.name === 'git-branching')
    expect(customized.customized).toBe(true)
    expect(customized.enabled).toBe(false)
    expect(customized.content).toContain('Custom Section')

    tools.resetSelectedAppSkill()
    const reset = tools.appSkills.find(skill => skill.name === 'git-branching')
    expect(reset.customized).toBe(false)
    expect(reset.enabled).toBe(true)
  })

  it('creates and removes custom app skills', async () => {
    const tools = useToolsStore()

    tools.refreshAppSkillRegistry()
    expect(tools.appSkills.find(skill => skill.name === 'custom-debug-skill')).toBeUndefined()

    await tools.createAppSkill()
    expect(tools.selectedAppSkill?.name).toBe('custom-debug-skill')
    expect(tools.selectedAppSkillContent).toContain('name: custom-debug-skill')
    expect(tools.selectedAppSkillContent).toContain('# 自定义技能')
    expect(tools.selectedAppSkillContent).toContain('## 适用场景')

    tools.selectedAppSkillContent = [
      '---',
      'name: custom-debug-skill',
      'description: 自定义调试技能',
      '---',
      '',
      '# Custom Debug Skill',
      '',
      'Use this skill for custom debugging.'
    ].join('\n')
    tools.saveSelectedAppSkill()

    tools.refreshAppSkillRegistry()
    const created = tools.appSkills.find(skill => skill.name === 'custom-debug-skill')
    expect(created).toBeTruthy()
    expect(created.builtIn).toBe(false)
    expect(created.content).toContain('Custom Debug Skill')

    tools.resetSelectedAppSkill()
    expect(tools.appSkills.find(skill => skill.name === 'custom-debug-skill')).toBeUndefined()
  })

  it('loads, saves and resets app built-in tool customizations', async () => {
    const tools = useToolsStore()

    tools.refreshAppToolRegistry()
    await tools.selectAppTool('web_search')
    tools.selectedAppToolLabel = '联网搜索（App）'
    tools.selectedAppToolDescription = '仅影响 App 内置 AI chat 的联网搜索描述'
    tools.selectedAppToolEnabled = false
    tools.saveSelectedAppTool()

    tools.refreshAppToolRegistry()
    const customized = tools.appTools.find(tool => tool.name === 'web_search')
    expect(customized).toMatchObject({
      label: '联网搜索（App）',
      enabled: false,
      customized: true
    })

    tools.resetSelectedAppTool()
    const reset = tools.appTools.find(tool => tool.name === 'web_search')
    expect(reset.customized).toBe(false)
    expect(reset.enabled).toBe(true)
  })
})
