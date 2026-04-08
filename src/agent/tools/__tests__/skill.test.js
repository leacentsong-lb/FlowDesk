import { describe, expect, it } from 'vitest'
import { handler, schema } from '../skill.js'

describe('load_skill tool', () => {
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
})
