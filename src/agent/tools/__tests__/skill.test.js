import { beforeEach, describe, expect, it } from 'vitest'
import { createSkillSchema, handler, schema } from '../skill.js'

describe('load_skill tool', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('uses a concise tool description instead of listing every skill inline', () => {
    expect(schema.function.description).toContain('按需加载专业技能')
    expect(schema.function.description).not.toContain('可用的 skills')
  })

  it('returns a short user-facing summary while keeping injected content', async () => {
    const result = await handler({ name: 'release-flow' }, {})

    expect(result.ok).toBe(true)
    expect(result.skillName).toBe('release-flow')
    expect(result.summary).toContain('已加载技能')
    expect(result.content).toContain('<skill name="release-flow">')
  })

  it('builds the skill enum from the current app-visible skill list', () => {
    localStorage.setItem('app_agent_skill_overrides_v1', JSON.stringify({
      troubleshooting: {
        enabled: false
      },
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
        ].join('\n')
      }
    }))

    const dynamicSchema = createSkillSchema()
    const names = dynamicSchema.function.parameters.properties.name.enum

    expect(names).toContain('git-branching')
    expect(names).toContain('custom-debug-skill')
    expect(names).not.toContain('troubleshooting')
  })
})
