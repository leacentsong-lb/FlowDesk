import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { invoke } from '@tauri-apps/api/core'
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
    setActivePinia(createPinia())
    invoke.mockResolvedValue({
      ok: true,
      skills: []
    })
  })

  it('shows a tools menu first and enters skills management only after clicking the menu card', async () => {
    const wrapper = mount(ToolsView)

    expect(wrapper.find('[data-testid="tools-menu-grid"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('本机 Skills 管理')
    expect(wrapper.text()).toContain('App 内置 Skills')
    expect(wrapper.text()).toContain('App 内置 Tools')
    expect(wrapper.text()).not.toContain('已收集本机 Skills')

    await wrapper.get('[data-testid="tools-menu-local-skills"]').trigger('click')

    expect(wrapper.text()).toContain('已收集本机 Skills')
    expect(wrapper.text()).toContain('返回 Tools')
  })

  it('shows app skill summaries after entering app skills management', async () => {
    const wrapper = mount(ToolsView)

    await wrapper.get('[data-testid="tools-menu-app-skills"]').trigger('click')

    expect(wrapper.text()).toContain('App 内置 Skills')
    expect(wrapper.text()).toContain('Generate and execute a compliant commit message')
    expect(wrapper.text()).toContain('git相关操作都使用此skills')
  })

  it('can create a new app skill from the app skills page', async () => {
    const wrapper = mount(ToolsView)

    await wrapper.get('[data-testid="tools-menu-app-skills"]').trigger('click')
    expect(wrapper.get('[data-testid="app-skill-create-btn"]').classes()).toContain('app-skill-create-btn')
    await wrapper.get('[data-testid="app-skill-create-btn"]').trigger('click')

    expect(wrapper.text()).toContain('custom-debug-skill')
    const editor = wrapper.get('[data-testid="app-skill-editor"]')
    expect(editor.element.value).toContain('name: custom-debug-skill')
    expect(editor.element.value).toContain('# 自定义技能')
    expect(editor.element.value).toContain('## 适用场景')
  })
})
