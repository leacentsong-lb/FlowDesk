import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { invoke } from '@tauri-apps/api/core'
import { useToolsStore } from '../tools'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

describe('tools store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('scans skill roots and keeps the discovered registry in memory', async () => {
    invoke.mockResolvedValueOnce({
      ok: true,
      skills: [
        {
          id: 'skill-1',
          name: 'agent-design-guide',
          title: 'Agent Design Guide',
          description: 'Design agent systems',
          skillPath: '/tmp/skills/agent-design-guide/SKILL.md',
          rootPath: '/tmp/skills',
          files: ['SKILL.md', 'references/pattern-catalog.md']
        }
      ]
    })

    const tools = useToolsStore()
    await tools.refreshSkills(['/tmp/skills'])

    expect(invoke).toHaveBeenCalledWith('agent_scan_skills', {
      roots: ['/tmp/skills']
    })
    expect(tools.skills).toHaveLength(1)
    expect(tools.skills[0].name).toBe('agent-design-guide')
    expect(tools.scanRoots).toEqual(['/tmp/skills'])
  })

  it('loads, saves and deletes the selected skill through tauri commands', async () => {
    invoke
      .mockResolvedValueOnce({
        ok: true,
        skills: [
          {
            id: 'skill-1',
            name: 'agent-design-guide',
            title: 'Agent Design Guide',
            description: 'Design agent systems',
            skillPath: '/tmp/skills/agent-design-guide/SKILL.md',
            rootPath: '/tmp/skills',
            files: ['SKILL.md']
          }
        ]
      })
      .mockResolvedValueOnce({
        ok: true,
        skillPath: '/tmp/skills/agent-design-guide/SKILL.md',
        content: '# Skill Body'
      })
      .mockResolvedValueOnce({
        ok: true,
        skillPath: '/tmp/skills/agent-design-guide/SKILL.md',
        bytes: 20
      })
      .mockResolvedValueOnce({
        ok: true,
        deletedPath: '/tmp/skills/agent-design-guide'
      })

    const tools = useToolsStore()
    await tools.refreshSkills(['/tmp/skills'])
    await tools.selectSkill(tools.skills[0])
    await tools.saveSelectedSkill('# Updated Skill Body')
    await tools.deleteSkill(tools.skills[0])

    expect(invoke).toHaveBeenNthCalledWith(2, 'agent_read_skill', {
      skillPath: '/tmp/skills/agent-design-guide/SKILL.md'
    })
    expect(invoke).toHaveBeenNthCalledWith(3, 'agent_write_skill', {
      skillPath: '/tmp/skills/agent-design-guide/SKILL.md',
      content: '# Updated Skill Body'
    })
    expect(invoke).toHaveBeenNthCalledWith(4, 'agent_delete_skill', {
      skillPath: '/tmp/skills/agent-design-guide/SKILL.md'
    })
    expect(tools.skills).toHaveLength(0)
    expect(tools.selectedSkill).toBe(null)
  })
})
