import { describe, expect, it } from 'vitest'
import { defaultSkillLoader } from '../skills.js'

describe('built-in skills', () => {
  it('documents branch-aware commit writing rules in git-branching', () => {
    const content = defaultSkillLoader.load('git-branching')

    expect(content).toContain('Read current branch name')
    expect(content).toContain('Extract branch suffix as scope')
    expect(content).toContain('feat(<scope>): <subject>')
    expect(content).toContain('type must start with `feat`')
    expect(content).toContain('If branch has no `/`, use entire branch name as scope')
    expect(content).toContain('If branch suffix is not ticket-like, still use exact suffix and warn user')
  })
})
