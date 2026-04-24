import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { invoke } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import ToolsView from '../ToolsView.vue'

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn()
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

describe('ToolsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    openDialog.mockResolvedValue(null)
    setActivePinia(createPinia())
    invoke.mockImplementation((command) => {
      if (command === 'agent_list_app_skills') {
        return Promise.resolve({ ok: true, skills: [] })
      }
      if (command === 'agent_list_library_skills') {
        return Promise.resolve({ ok: true, skills: [] })
      }
      return Promise.resolve({
        ok: true,
        skills: []
      })
    })
  })

  it('shows a tools menu first and enters skills management only after clicking the menu card', async () => {
    const wrapper = mount(ToolsView)

    expect(wrapper.find('[data-testid="tools-menu-grid"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Discover')
    expect(wrapper.text()).toContain('Central Library')
    expect(wrapper.text()).toContain('App Skills')
    expect(wrapper.text()).toContain('App 内置 Tools')
    expect(wrapper.text()).not.toContain('已发现 Skills')

    await wrapper.get('[data-testid="tools-menu-discover"]').trigger('click')

    expect(wrapper.text()).toContain('已发现 Skills')
    expect(wrapper.text()).toContain('返回 Tools')
  })


  it('supports select-all and bulk import from Discover to Central Library', async () => {
    invoke.mockImplementation((command, payload) => {
      if (command === 'agent_get_skill_scan_roots') {
        return Promise.resolve({ ok: true, roots: [{ path: '/tmp/skills', enabled: true }] })
      }
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
        return Promise.resolve({ ok: true, skill: { name: 'imported' } })
      }
      if (command === 'agent_list_library_skills') {
        return Promise.resolve({ ok: true, skills: [] })
      }
      if (command === 'agent_list_app_skills') {
        return Promise.resolve({ ok: true, skills: [] })
      }
      return Promise.resolve({ ok: true, skills: [] })
    })

    const wrapper = mount(ToolsView)
    await flushPromises()
    await wrapper.get('[data-testid="tools-menu-discover"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="discover-select-all-btn"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('已选择 2 项')

    await wrapper.get('[data-testid="discover-bulk-import-btn"]').trigger('click')
    await flushPromises()

    expect(invoke).toHaveBeenCalledWith('agent_import_skill_to_library', {
      skillPath: '/tmp/skills/agent-design-guide/SKILL.md'
    })
    expect(invoke).toHaveBeenCalledWith('agent_import_skill_to_library', {
      skillPath: '/tmp/skills/release-checklist/SKILL.md'
    })
  })

  it('shows app skill summaries after entering app skills management', async () => {
    invoke.mockImplementation((command) => {
      if (command === 'agent_list_app_skills') {
        return Promise.resolve({
          ok: true,
          skills: [
            {
              name: 'git-branching',
              title: 'Git Branching',
              description: 'git相关操作都使用此skills',
              sourceType: 'system',
              sourcePath: '/tmp/system/git-branching.md',
              effectivePath: '/tmp/system/git-branching.md',
              writable: false,
              enabled: true,
              content: '# Git Branching'
            },
            {
              name: 'release-flow',
              title: 'Release Flow',
              description: 'Generate and execute a compliant commit message',
              sourceType: 'repo',
              sourcePath: '/tmp/repo/release-flow/SKILL.md',
              effectivePath: '/tmp/repo/release-flow/SKILL.md',
              writable: false,
              enabled: true,
              content: '# Release Flow'
            }
          ]
        })
      }
      if (command === 'agent_list_library_skills') {
        return Promise.resolve({ ok: true, skills: [] })
      }
      return Promise.resolve({ ok: true, skills: [] })
    })

    const wrapper = mount(ToolsView)
    await flushPromises()

    await wrapper.get('[data-testid="tools-menu-app-skills"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('App Skills')
    expect(wrapper.text()).toContain('git相关操作都使用此skills')
    expect(wrapper.text()).toContain('Release Flow')
  })


  it('loads scan roots from backend manifest on mount', async () => {
    invoke.mockImplementation((command) => {
      if (command === 'agent_get_skill_scan_roots') {
        return Promise.resolve({
          ok: true,
          roots: [
            { path: '/tmp/skills-a', enabled: true },
            { path: '/tmp/skills-b', enabled: false }
          ]
        })
      }
      if (command === 'agent_list_app_skills') {
        return Promise.resolve({ ok: true, skills: [] })
      }
      if (command === 'agent_list_library_skills') {
        return Promise.resolve({ ok: true, skills: [] })
      }
      return Promise.resolve({ ok: true, skills: [] })
    })

    const wrapper = mount(ToolsView)
    await flushPromises()
    await wrapper.get('[data-testid="tools-menu-discover"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('/tmp/skills-a')
    expect(wrapper.text()).not.toContain('/tmp/skills-b')
  })

  it('shows central library actions after entering the library page', async () => {
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

    const wrapper = mount(ToolsView)
    await flushPromises()
    await wrapper.get('[data-testid="tools-menu-library"]').trigger('click')
    await flushPromises()
    await wrapper.findAll('.skill-row').at(0)?.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Central Library')
    expect(wrapper.text()).toContain('Release Flow')
    expect(wrapper.text()).toContain('安装到当前工作区')
    expect(wrapper.text()).toContain('从当前工作区卸载')
    expect(wrapper.text()).toContain('已安装 2 处')
    expect(wrapper.text()).toContain('/Users/demo/.flow-desk/app-skills/release-flow')
    expect(wrapper.text()).toContain('/tmp/workspace/.flow-desk/app-skills/release-flow')
  })


  it('can install a library skill to a selected directory', async () => {
    openDialog.mockResolvedValue('/tmp/custom-workspace')
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
              sourcePath: '/tmp/legacy/release-flow/SKILL.md'
            }
          ]
        })
      }
      if (command === 'agent_install_library_skill_to_app') {
        return Promise.resolve({ ok: true, installedPath: '/tmp/custom-workspace/.flow-desk/app-skills/release-flow', linkType: 'symlink' })
      }
      if (command === 'agent_list_app_skills') {
        return Promise.resolve({ ok: true, skills: [] })
      }
      return Promise.resolve({ ok: true, skills: [] })
    })

    const wrapper = mount(ToolsView)
    await flushPromises()
    await wrapper.get('[data-testid="tools-menu-library"]').trigger('click')
    await flushPromises()
    await wrapper.findAll('.skill-row').at(0)?.trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="library-install-custom-dir-btn"]').trigger('click')
    await flushPromises()

    expect(openDialog).toHaveBeenCalled()
    expect(invoke).toHaveBeenCalledWith('agent_install_library_skill_to_app', {
      skillName: 'release-flow',
      scope: 'workspace',
      workspacePath: '/tmp/custom-workspace'
    })
  })

  it('shows source metadata for unified app skill entries', async () => {
    invoke.mockImplementation((command) => {
      if (command === 'agent_list_app_skills') {
        return Promise.resolve({
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
              content: [
                '---',
                'name: custom-debug-skill',
                'description: 自定义调试技能',
                '---',
                '',
                '# Custom Debug Skill'
              ].join('\n')
            }
          ]
        })
      }
      return Promise.resolve({ ok: true, skills: [] })
    })

    const wrapper = mount(ToolsView)
    await flushPromises()
    await wrapper.get('[data-testid="tools-menu-app-skills"]').trigger('click')
    await flushPromises()
    await wrapper.findAll('.skill-row').at(0)?.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('workspace')
    expect(wrapper.text()).toContain('可编辑')
    expect(wrapper.text()).toContain('Custom Debug Skill')
  })

  it('can create a workspace app skill from the app skills page', async () => {
    invoke.mockImplementation((command) => {
      if (command === 'agent_create_app_skill') {
        return Promise.resolve({
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
      }
      if (command === 'agent_list_app_skills') {
        return Promise.resolve({
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
      }
      return Promise.resolve({ ok: true, skills: [] })
    })

    const wrapper = mount(ToolsView)
    await flushPromises()
    await wrapper.get('[data-testid="tools-menu-app-skills"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="app-skill-create-btn"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('custom-debug-skill')
    expect(wrapper.get('[data-testid="app-skill-editor"]').element.value).toContain('# 自定义技能')
  })

  it('shows copy-to-workspace action for read-only repo skills', async () => {
    invoke.mockImplementation((command) => {
      if (command === 'agent_list_app_skills') {
        return Promise.resolve({
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
      }
      return Promise.resolve({ ok: true, skills: [] })
    })

    const wrapper = mount(ToolsView)
    await flushPromises()
    await wrapper.get('[data-testid="tools-menu-app-skills"]').trigger('click')
    await flushPromises()
    await wrapper.findAll('.skill-row').at(0)?.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('复制到工作区后编辑')
  })
})
