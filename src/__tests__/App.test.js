import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import App from '../App.vue'

vi.mock('../config', () => ({
  initTheme: vi.fn()
}))

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not render screenshot entry points', () => {
    const wrapper = mount(App, {
      global: {
        plugins: [createPinia()],
        stubs: {
          DashboardView: { template: '<div data-testid="dashboard-view" />' },
          DevView: { template: '<div data-testid="dev-view" />' },
          FloatingDock: { template: '<div data-testid="floating-dock" />' },
          SettingsDrawer: { template: '<div data-testid="settings-drawer" />' }
        }
      }
    })

    expect(wrapper.find('.screenshot-fab').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('截图（⌘5）')
    expect(wrapper.find('[data-testid="theme-switcher"]').exists()).toBe(false)
  })
})
