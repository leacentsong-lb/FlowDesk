import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { createSkillSchema, handler, schema } from '../skill.js'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

describe('load_skill tool', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('uses a concise tool description instead of listing every skill inline', () => {
    expect(schema.function.description).toContain('按需加载专业技能')
    expect(schema.function.description).not.toContain('可用的 skills')
  })

  it('accepts a free-form skill name instead of a static enum', () => {
    const dynamicSchema = createSkillSchema()

    expect(dynamicSchema.function.parameters.properties.name.type).toBe('string')
    expect(dynamicSchema.function.parameters.properties.name.enum).toBeUndefined()
  })

  it('returns a short user-facing summary while keeping injected content', async () => {
    const result = await handler({ name: 'release-flow' }, {})

    expect(result.ok).toBe(true)
    expect(result.skillName).toBe('release-flow')
    expect(result.summary).toContain('已加载技能')
    expect(result.content).toContain('<skill name="release-flow">')
  })

  it('returns a clear error when the requested skill is absent from runtime catalog and built-ins', async () => {
    const result = await handler({ name: 'missing-skill' }, {
      state: {
        runtimeSkillCatalog: []
      }
    })

    expect(result.ok).toBe(false)
    expect(result.summary).toContain('Unknown skill')
  })

  it('prefers runtime app skill files when the current run has scanned app skills', async () => {
    invoke.mockResolvedValueOnce({
      ok: true,
      content: [
        '---',
        'name: release-flow',
        'description: runtime release flow',
        '---',
        '',
        '# Runtime Release Flow',
        '',
        'Use the newest runtime skill content.'
      ].join('\n')
    })

    const result = await handler({ name: 'release-flow' }, {
      state: {
        runtimeSkillCatalog: [
          {
            name: 'release-flow',
            skillPath: '/tmp/app-skills/release-flow/SKILL.md'
          }
        ]
      }
    })

    expect(invoke).toHaveBeenCalledWith('agent_read_skill', {
      skillPath: '/tmp/app-skills/release-flow/SKILL.md'
    })
    expect(result.content).toContain('Runtime Release Flow')
    expect(result.content).not.toContain('发布流程规范')
  })
})
