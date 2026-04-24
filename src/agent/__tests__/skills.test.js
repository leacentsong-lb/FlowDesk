import { beforeEach, describe, expect, it } from 'vitest'
import { defaultSkillLoader, getEditableAppSkills } from '../skills.js'

describe('built-in skills', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('documents branch-aware commit writing rules in git-branching', () => {
    const content = defaultSkillLoader.load('git-branching')

    expect(content).toContain('Read current branch name')
    expect(content).toContain('Extract branch suffix as scope')
    expect(content).toContain('feat(<scope>): <subject>')
    expect(content).toContain('type must start with `feat`')
    expect(content).toContain('If branch has no `/`, use entire branch name as scope')
    expect(content).toContain('If branch suffix is not ticket-like, still use exact suffix and warn user')
  })

  it('prefers customized app skill content and hides disabled app skills', () => {
    localStorage.setItem('app_agent_skill_overrides_v1', JSON.stringify({
      'git-branching': {
        content: [
          '---',
          'name: git-branching',
          'description: customized',
          '---',
          '',
          '# Custom Git Skill',
          '',
          'Use custom flow'
        ].join('\n')
      },
      troubleshooting: {
        enabled: false
      }
    }))

    expect(defaultSkillLoader.load('git-branching')).toContain('Custom Git Skill')
    expect(defaultSkillLoader.list()).not.toContain('troubleshooting')
  })

  it('builds a concise skill summary index for prompt routing', () => {
    const summaryIndex = defaultSkillLoader.promptIndex()

    expect(summaryIndex).toContain('git-branching')
    expect(summaryIndex).toContain('git相关操作都使用此skills')
    expect(summaryIndex).toContain('Generate and execute a compliant commit message')
    expect(summaryIndex).toContain('workspace-topology')
    expect(summaryIndex).not.toContain('<skill name=')
    expect(summaryIndex).not.toContain('## Branch-Aware Commit Writer')
  })

  it('loads custom app-created skills and exposes them in the registry', () => {
    localStorage.setItem('app_agent_skill_overrides_v1', JSON.stringify({
      'custom-debug-skill': {
        content: [
          '---',
          'name: custom-debug-skill',
          'description: 自定义调试技能',
          '---',
          '',
          '# Custom Debug Skill',
          '',
          'Use this skill for custom debugging.'
        ].join('\n'),
        enabled: true
      }
    }))

    expect(defaultSkillLoader.list()).toContain('custom-debug-skill')
    expect(defaultSkillLoader.load('custom-debug-skill')).toContain('Custom Debug Skill')
    expect(defaultSkillLoader.promptIndex()).toContain('custom-debug-skill')
  })

  it('sources release-flow from the app-skills catalog', () => {
    const releaseFlow = getEditableAppSkills().find(skill => skill.name === 'release-flow')

    expect(releaseFlow?.path).toContain('app-skills/release-flow/SKILL.md')
    expect(defaultSkillLoader.load('release-flow')).toContain('发布流程规范')
  })
})
