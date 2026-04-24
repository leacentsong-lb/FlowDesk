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
    localStorage.clear()
  })

  it('loads scan roots from backend manifest and persists changes back through backend', async () => {
    invoke
      .mockResolvedValueOnce({
        ok: true,
        roots: [
          { path: '/tmp/skills-a', enabled: true },
          { path: '/tmp/skills-b', enabled: false },
          { path: '/tmp/skills-c', enabled: true }
        ]
      })
      .mockResolvedValueOnce({
        ok: true,
        roots: [
          { path: '/tmp/skills-a', enabled: true },
          { path: '/tmp/skills-c', enabled: true },
          { path: '/tmp/skills-d', enabled: true }
        ]
      })
      .mockResolvedValueOnce({
        ok: true,
        roots: [
          { path: '/tmp/skills-c', enabled: true },
          { path: '/tmp/skills-d', enabled: true }
        ]
      })

    const tools = useToolsStore()
    await tools.loadScanRoots()
    await tools.addScanRoot('/tmp/skills-d')
    await tools.removeScanRoot('/tmp/skills-a')

    expect(invoke).toHaveBeenNthCalledWith(1, 'agent_get_skill_scan_roots')
    expect(invoke).toHaveBeenNthCalledWith(2, 'agent_set_skill_scan_roots', {
      roots: [
        { path: '/tmp/skills-a', enabled: true },
        { path: '/tmp/skills-c', enabled: true },
        { path: '/tmp/skills-d', enabled: true }
      ]
    })
    expect(invoke).toHaveBeenNthCalledWith(3, 'agent_set_skill_scan_roots', {
      roots: [
        { path: '/tmp/skills-c', enabled: true },
        { path: '/tmp/skills-d', enabled: true }
      ]
    })
    expect(tools.scanRoots).toEqual(['/tmp/skills-c', '/tmp/skills-d'])
  })


  it('prevents adding duplicated or excessive scan roots', async () => {
    invoke.mockImplementation((command) => {
      if (command === 'agent_set_skill_scan_roots') {
        return Promise.resolve({
          ok: true,
          roots: [
            { path: '/tmp/a', enabled: true },
            { path: '/tmp/b', enabled: true },
            { path: '/tmp/c', enabled: true },
            { path: '/tmp/d', enabled: true },
            { path: '/tmp/e', enabled: true },
            { path: '/tmp/f', enabled: true },
            { path: '/tmp/g', enabled: true },
            { path: '/tmp/h', enabled: true }
          ]
        })
      }
      return Promise.resolve({ ok: true, skills: [] })
    })

    const tools = useToolsStore()
    await tools.setScanRoots(['/tmp/a', '/tmp/b', '/tmp/c', '/tmp/d', '/tmp/e', '/tmp/f', '/tmp/g', '/tmp/h'])
    const duplicateAdded = await tools.addScanRoot('/tmp/a')
    const exceededAdded = await tools.addScanRoot('/tmp/i')

    expect(duplicateAdded).toBe(false)
    expect(exceededAdded).toBe(false)
    expect(tools.scanRoots).toHaveLength(8)
    expect(tools.appStatusMessage).toContain('最多只允许配置 8 个扫描目录')
  })

  it('discovers local skills and keeps the discovered registry in memory', async () => {
    invoke.mockImplementation((command) => {
      if (command === 'agent_set_skill_scan_roots') {
        return Promise.resolve({ ok: true, roots: [{ path: '/tmp/skills', enabled: true }] })
      }
      if (command === 'agent_discover_skills') {
        return Promise.resolve({
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
      }
      return Promise.resolve({ ok: true, skills: [] })
    })

    const tools = useToolsStore()
    await tools.discoverSkills(['/tmp/skills'])

    expect(invoke).toHaveBeenCalledWith('agent_discover_skills', {
      roots: ['/tmp/skills']
    })
    expect(tools.discoveredSkills).toHaveLength(1)
    expect(tools.discoveredSkills[0].name).toBe('agent-design-guide')
    expect(tools.scanRoots).toEqual(['/tmp/skills'])
  })


  it('supports selecting discovered skills and bulk importing them into the central library', async () => {
    invoke.mockImplementation((command, payload) => {
      if (command === 'agent_set_skill_scan_roots') {
        return Promise.resolve({ ok: true, roots: [{ path: '/tmp/skills', enabled: true }] })
      }
      if (command === 'agent_discover_skills') {
        return Promise.resolve({
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
            },
            {
              id: 'skill-2',
              name: 'release-checklist',
              title: 'Release Checklist',
              description: 'Release checklist skill',
              skillPath: '/tmp/skills/release-checklist/SKILL.md',
              rootPath: '/tmp/skills',
              files: ['SKILL.md']
            }
          ]
        })
      }
      if (command === 'agent_import_skill_to_library') {
        return Promise.resolve({
          ok: true,
          skill: {
            name: payload.skillPath.includes('agent-design-guide') ? 'agent-design-guide' : 'release-checklist'
          }
        })
      }
      if (command === 'agent_list_library_skills') {
        return Promise.resolve({
          ok: true,
          skills: [
            { name: 'agent-design-guide' },
            { name: 'release-checklist' }
          ]
        })
      }
      return Promise.resolve({ ok: true, skills: [] })
    })

    const tools = useToolsStore()
    await tools.discoverSkills(['/tmp/skills'])
    tools.toggleDiscoveredSkillSelection(tools.discoveredSkills[0])
    tools.toggleAllDiscoveredSkills(tools.discoveredSkills)
    await tools.importSelectedDiscoveredSkillsToLibrary()

    expect(tools.selectedDiscoveredSkillIds).toEqual([])
    expect(invoke).toHaveBeenCalledWith('agent_import_skill_to_library', {
      skillPath: '/tmp/skills/agent-design-guide/SKILL.md'
    })
    expect(invoke).toHaveBeenCalledWith('agent_import_skill_to_library', {
      skillPath: '/tmp/skills/release-checklist/SKILL.md'
    })
    expect(tools.appStatusMessage).toContain('已导入 2 个 Skills')
  })

  it('loads, saves and deletes the selected skill through tauri commands', async () => {
    invoke.mockImplementation((command) => {
      if (command === 'agent_set_skill_scan_roots') {
        return Promise.resolve({ ok: true, roots: [{ path: '/tmp/skills', enabled: true }] })
      }
      if (command === 'agent_discover_skills') {
        return Promise.resolve({
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
      }
      if (command === 'agent_read_skill') {
        return Promise.resolve({
          ok: true,
          skillPath: '/tmp/skills/agent-design-guide/SKILL.md',
          content: '# Skill Body'
        })
      }
      if (command === 'agent_write_skill') {
        return Promise.resolve({
          ok: true,
          skillPath: '/tmp/skills/agent-design-guide/SKILL.md',
          bytes: 20
        })
      }
      if (command === 'agent_delete_skill') {
        return Promise.resolve({
          ok: true,
          deletedPath: '/tmp/skills/agent-design-guide'
        })
      }
      return Promise.resolve({ ok: true, skills: [] })
    })

    const tools = useToolsStore()
    await tools.discoverSkills(['/tmp/skills'])
    await tools.selectSkill(tools.discoveredSkills[0])
    await tools.saveSelectedSkill('# Updated Skill Body')
    await tools.deleteSkill(tools.discoveredSkills[0])

    expect(invoke).toHaveBeenCalledWith('agent_read_skill', {
      skillPath: '/tmp/skills/agent-design-guide/SKILL.md'
    })
    expect(invoke).toHaveBeenCalledWith('agent_write_skill', {
      skillPath: '/tmp/skills/agent-design-guide/SKILL.md',
      content: '# Updated Skill Body'
    })
    expect(invoke).toHaveBeenCalledWith('agent_delete_skill', {
      skillPath: '/tmp/skills/agent-design-guide/SKILL.md'
    })
    expect(tools.discoveredSkills).toHaveLength(0)
    expect(tools.selectedSkill).toBe(null)
  })

  it('loads app skills from the unified backend catalog', async () => {
    invoke.mockImplementation((command) => {
      if (command === 'agent_list_app_skills') {
        return Promise.resolve({
          ok: true,
          skills: [
            {
              name: 'release-flow',
              title: 'Release Flow',
              description: '发布流程技能',
              sourceType: 'workspace',
              sourcePath: '/tmp/workspace/.flow-desk/app-skills/release-flow/SKILL.md',
              effectivePath: '/tmp/workspace/.flow-desk/app-skills/release-flow/SKILL.md',
              writable: true,
              enabled: true,
              content: '---\nname: release-flow\n---\n# Release Flow'
            }
          ]
        })
      }
      return Promise.resolve({ ok: true, skills: [] })
    })

    const tools = useToolsStore()
    await tools.refreshAppSkillRegistry()

    expect(invoke).toHaveBeenCalledWith('agent_list_app_skills', {
      workspacePath: '/Users/leacentsong/Documents/LifeByteCodes'
    })
    expect(tools.appSkills).toHaveLength(1)
    expect(tools.appSkills[0].sourceType).toBe('workspace')
    expect(tools.appSkills[0].writable).toBe(true)
  })

  it('migrates legacy app skill overrides into global app skills once', async () => {
    localStorage.setItem('app_agent_skill_overrides_v1', JSON.stringify({
      'legacy-debug-skill': {
        content: ['---', 'name: legacy-debug-skill', 'description: 旧技能', '---', '# Legacy Debug Skill'].join('\n'),
        enabled: true
      }
    }))

    let refreshCount = 0
    invoke.mockImplementation((command) => {
      if (command === 'agent_list_app_skills') {
        refreshCount += 1
        if (refreshCount === 1) {
          return Promise.resolve({ ok: true, skills: [] })
        }
        return Promise.resolve({
          ok: true,
          skills: [
            {
              name: 'legacy-debug-skill',
              title: 'Legacy Debug Skill',
              description: '旧技能',
              sourceType: 'global',
              sourcePath: '/Users/demo/.flow-desk/app-skills/legacy-debug-skill/SKILL.md',
              effectivePath: '/Users/demo/.flow-desk/app-skills/legacy-debug-skill/SKILL.md',
              writable: true,
              enabled: true,
              content: ['---', 'name: legacy-debug-skill', 'description: 旧技能', '---', '# Legacy Debug Skill'].join('\n')
            }
          ]
        })
      }
      if (command === 'agent_migrate_app_skill_overrides') {
        return Promise.resolve({
          ok: true,
          migrated: ['legacy-debug-skill'],
          skipped: []
        })
      }
      return Promise.resolve({ ok: true, skills: [] })
    })

    const tools = useToolsStore()
    await tools.migrateLegacyAppSkillOverrides()

    expect(invoke).toHaveBeenCalledWith('agent_migrate_app_skill_overrides', {
      overrides: {
        'legacy-debug-skill': {
          content: ['---', 'name: legacy-debug-skill', 'description: 旧技能', '---', '# Legacy Debug Skill'].join('\n'),
          enabled: true
        }
      }
    })
    expect(localStorage.getItem('app_agent_skill_overrides_v1')).toBeNull()
    expect(tools.appSkills.some(skill => skill.name === 'legacy-debug-skill')).toBe(true)
    expect(tools.appStatusMessage).toContain('已迁移')
  })



  it('loads library skills with install targets from manifest-backed backend payload', async () => {
    invoke.mockImplementation((command) => {
      if (command === 'agent_list_library_skills') {
        return Promise.resolve({
          ok: true,
          skills: [
            {
              name: 'release-flow',
              title: 'Release Flow',
              description: '发布流程技能',
              canonicalPath: '/Users/demo/.flow-desk/skills/release-flow/SKILL.md',
              sourcePath: '/tmp/legacy/release-flow/SKILL.md',
              installedScopes: ['global', 'workspace'],
              installTargets: [
                {
                  scope: 'global',
                  installedPath: '/Users/demo/.flow-desk/app-skills/release-flow',
                  linkType: 'symlink'
                },
                {
                  scope: 'workspace',
                  installedPath: '/tmp/workspace/.flow-desk/app-skills/release-flow',
                  linkType: 'copy'
                }
              ]
            }
          ]
        })
      }
      return Promise.resolve({ ok: true, skills: [] })
    })

    const tools = useToolsStore()
    await tools.loadLibrarySkills()

    expect(tools.librarySkills[0].installedScopes).toEqual(['global', 'workspace'])
    expect(tools.librarySkills[0].installTargets).toHaveLength(2)
  })

  it('can install a library skill into a specified workspace directory', async () => {
    invoke.mockImplementation((command) => {
      if (command === 'agent_install_library_skill_to_app') {
        return Promise.resolve({
          ok: true,
          installedPath: '/tmp/another-workspace/.flow-desk/app-skills/imported-debug-skill',
          linkType: 'symlink'
        })
      }
      return Promise.resolve({ ok: true, skills: [] })
    })

    const tools = useToolsStore()
    await tools.installLibrarySkillToApp('imported-debug-skill', 'workspace', '/tmp/another-workspace')

    expect(invoke).toHaveBeenCalledWith('agent_install_library_skill_to_app', {
      skillName: 'imported-debug-skill',
      scope: 'workspace',
      workspacePath: '/tmp/another-workspace'
    })
    expect(tools.appStatusMessage).toContain('/tmp/another-workspace/.flow-desk/app-skills/imported-debug-skill')
  })

  it('can uninstall a library skill from workspace app skills', async () => {
    invoke
      .mockResolvedValueOnce({
        ok: true,
        skills: [
          {
            name: 'imported-debug-skill',
            title: 'Imported Debug Skill',
            description: '导入的调试技能',
            canonicalPath: '/Users/demo/.flow-desk/skills/imported-debug-skill/SKILL.md',
            sourcePath: '/tmp/skills/agent-design-guide/SKILL.md'
          }
        ]
      })
      .mockResolvedValueOnce({
        ok: true,
        removed: true,
        scope: 'workspace',
        skillName: 'imported-debug-skill'
      })
      .mockResolvedValueOnce({
        ok: true,
        skills: []
      })

    const tools = useToolsStore()
    await tools.loadLibrarySkills()
    await tools.uninstallLibrarySkillFromApp('imported-debug-skill', 'workspace')

    expect(invoke).toHaveBeenCalledWith('agent_uninstall_library_skill_from_app', {
      skillName: 'imported-debug-skill',
      scope: 'workspace',
      workspacePath: '/Users/leacentsong/Documents/LifeByteCodes'
    })
    expect(tools.appStatusMessage).toContain('已从 workspace App Skills 卸载')
  })

  it('can import a discovered skill into the central library and install it to app skills', async () => {
    invoke
      .mockResolvedValueOnce({
        ok: true,
        skill: {
          name: 'imported-debug-skill',
          title: 'Imported Debug Skill',
          description: '导入的调试技能',
          canonicalPath: '/Users/demo/.flow-desk/skills/imported-debug-skill/SKILL.md',
          sourcePath: '/tmp/skills/agent-design-guide/SKILL.md'
        }
      })
      .mockResolvedValueOnce({
        ok: true,
        installedPath: '/tmp/workspace/.flow-desk/app-skills/imported-debug-skill',
        linkType: 'symlink'
      })
      .mockResolvedValueOnce({
        ok: true,
        skills: [
          {
            name: 'imported-debug-skill',
            title: 'Imported Debug Skill',
            description: '导入的调试技能',
            canonicalPath: '/Users/demo/.flow-desk/skills/imported-debug-skill/SKILL.md',
            sourcePath: '/tmp/skills/agent-design-guide/SKILL.md'
          }
        ]
      })
      .mockResolvedValueOnce({
        ok: true,
        skills: [
          {
            name: 'imported-debug-skill',
            title: 'Imported Debug Skill',
            description: '导入的调试技能',
            sourceType: 'workspace',
            sourcePath: '/tmp/workspace/.flow-desk/app-skills/imported-debug-skill/SKILL.md',
            effectivePath: '/tmp/workspace/.flow-desk/app-skills/imported-debug-skill/SKILL.md',
            writable: true,
            enabled: true,
            content: [
              '---',
              'name: imported-debug-skill',
              'description: 导入的调试技能',
              '---',
              '',
              '# Imported Debug Skill'
            ].join('\n')
          }
        ]
      })

    const tools = useToolsStore()
    await tools.importDiscoveredSkillToLibrary({
      name: 'agent-design-guide',
      title: 'Agent Design Guide',
      ok: true,
      skillPath: '/tmp/skills/agent-design-guide/SKILL.md'
    })
    await tools.installLibrarySkillToApp('imported-debug-skill', 'workspace')

    expect(invoke).toHaveBeenCalledWith('agent_import_skill_to_library', {
      skillPath: '/tmp/skills/agent-design-guide/SKILL.md'
    })
    expect(invoke).toHaveBeenCalledWith('agent_install_library_skill_to_app', {
      skillName: 'imported-debug-skill',
      scope: 'workspace',
      workspacePath: '/Users/leacentsong/Documents/LifeByteCodes'
    })
    expect(invoke).toHaveBeenCalledWith('agent_list_app_skills', {
      workspacePath: '/Users/leacentsong/Documents/LifeByteCodes'
    })
    expect(tools.appSkills.some(skill => skill.name === 'imported-debug-skill')).toBe(true)
    expect(tools.appStatusMessage).toContain('已安装到 workspace App Skills')
  })

  it('can create a workspace app skill and select it immediately', async () => {
    invoke
      .mockResolvedValueOnce({
        ok: true,
        skill: {
          name: 'custom-debug-skill',
          title: 'Custom Debug Skill',
          description: '请填写这个自定义技能的用途',
          sourceType: 'workspace',
          sourcePath: '/tmp/workspace/.flow-desk/app-skills/custom-debug-skill/SKILL.md',
          effectivePath: '/tmp/workspace/.flow-desk/app-skills/custom-debug-skill/SKILL.md',
          writable: true,
          enabled: true,
          content: '---\nname: custom-debug-skill\n---\n# 自定义技能'
        }
      })
      .mockResolvedValueOnce({
        ok: true,
        skills: [
          {
            name: 'custom-debug-skill',
            title: 'Custom Debug Skill',
            description: '请填写这个自定义技能的用途',
            sourceType: 'workspace',
            sourcePath: '/tmp/workspace/.flow-desk/app-skills/custom-debug-skill/SKILL.md',
            effectivePath: '/tmp/workspace/.flow-desk/app-skills/custom-debug-skill/SKILL.md',
            writable: true,
            enabled: true,
            content: '---\nname: custom-debug-skill\n---\n# 自定义技能'
          }
        ]
      })

    const tools = useToolsStore()
    await tools.createAppSkill()

    expect(invoke).toHaveBeenCalledWith('agent_create_app_skill', {
      workspacePath: '/Users/leacentsong/Documents/LifeByteCodes',
      baseName: 'custom-debug-skill'
    })
    expect(tools.selectedAppSkill?.name).toBe('custom-debug-skill')
    expect(tools.appStatusMessage).toContain('已新增')
  })

  it('can save and delete a writable workspace app skill', async () => {
    invoke
      .mockResolvedValueOnce({
        ok: true,
        skills: [
          {
            name: 'custom-debug-skill',
            title: 'Custom Debug Skill',
            description: '自定义调试技能',
            sourceType: 'workspace',
            sourcePath: '/tmp/workspace/.flow-desk/app-skills/custom-debug-skill/SKILL.md',
            effectivePath: '/tmp/workspace/.flow-desk/app-skills/custom-debug-skill/SKILL.md',
            writable: true,
            enabled: true,
            content: '---\nname: custom-debug-skill\n---\n# Custom Debug Skill'
          }
        ]
      })
      .mockResolvedValueOnce({ ok: true, skillPath: '/tmp/workspace/.flow-desk/app-skills/custom-debug-skill/SKILL.md' })
      .mockResolvedValueOnce({
        ok: true,
        skills: [
          {
            name: 'custom-debug-skill',
            title: 'Custom Debug Skill',
            description: '自定义调试技能',
            sourceType: 'workspace',
            sourcePath: '/tmp/workspace/.flow-desk/app-skills/custom-debug-skill/SKILL.md',
            effectivePath: '/tmp/workspace/.flow-desk/app-skills/custom-debug-skill/SKILL.md',
            writable: true,
            enabled: true,
            content: '---\nname: custom-debug-skill\n---\n# Updated Skill'
          }
        ]
      })
      .mockResolvedValueOnce({ ok: true, deletedPath: '/tmp/workspace/.flow-desk/app-skills/custom-debug-skill' })
      .mockResolvedValueOnce({ ok: true, skills: [] })

    const tools = useToolsStore()
    await tools.refreshAppSkillRegistry()
    await tools.selectAppSkill('custom-debug-skill')
    tools.selectedAppSkillContent = '---\nname: custom-debug-skill\n---\n# Updated Skill'
    await tools.saveSelectedAppSkill()
    await tools.deleteSelectedAppSkill()

    expect(invoke).toHaveBeenCalledWith('agent_save_app_skill', {
      skillPath: '/tmp/workspace/.flow-desk/app-skills/custom-debug-skill/SKILL.md',
      content: '---\nname: custom-debug-skill\n---\n# Updated Skill',
      workspacePath: '/Users/leacentsong/Documents/LifeByteCodes'
    })
    expect(invoke).toHaveBeenCalledWith('agent_delete_app_skill', {
      skillPath: '/tmp/workspace/.flow-desk/app-skills/custom-debug-skill/SKILL.md',
      workspacePath: '/Users/leacentsong/Documents/LifeByteCodes'
    })
    expect(tools.appSkills).toHaveLength(0)
  })

  it('can copy a read-only repo app skill into workspace for editing', async () => {
    invoke
      .mockResolvedValueOnce({
        ok: true,
        skills: [
          {
            name: 'release-flow',
            title: 'Release Flow',
            description: '发布流程技能',
            sourceType: 'repo',
            sourcePath: '/tmp/repo/app-skills/release-flow/SKILL.md',
            effectivePath: '/tmp/repo/app-skills/release-flow/SKILL.md',
            writable: false,
            enabled: true,
            content: '---\nname: release-flow\n---\n# Release Flow'
          }
        ]
      })
      .mockResolvedValueOnce({
        ok: true,
        skillPath: '/tmp/workspace/.flow-desk/app-skills/release-flow/SKILL.md'
      })
      .mockResolvedValueOnce({
        ok: true,
        skills: [
          {
            name: 'release-flow',
            title: 'Release Flow',
            description: '发布流程技能',
            sourceType: 'workspace',
            sourcePath: '/tmp/workspace/.flow-desk/app-skills/release-flow/SKILL.md',
            effectivePath: '/tmp/workspace/.flow-desk/app-skills/release-flow/SKILL.md',
            writable: true,
            enabled: true,
            content: '---\nname: release-flow\n---\n# Release Flow'
          }
        ]
      })

    const tools = useToolsStore()
    await tools.refreshAppSkillRegistry()
    await tools.selectAppSkill('release-flow')
    await tools.copyAppSkillToWorkspace()

    expect(invoke).toHaveBeenCalledWith('agent_copy_app_skill_to_workspace', {
      skillPath: '/tmp/repo/app-skills/release-flow/SKILL.md',
      workspacePath: '/Users/leacentsong/Documents/LifeByteCodes'
    })
    expect(tools.selectedAppSkill?.writable).toBe(true)
    expect(tools.selectedAppSkill?.sourceType).toBe('workspace')
  })
})
