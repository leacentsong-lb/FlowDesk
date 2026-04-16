import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import SettingsDrawer from '../SettingsDrawer.vue'

const { openMock } = vi.hoisted(() => ({
  openMock: vi.fn()
}))
const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn()
}))
const { aiClientMock } = vi.hoisted(() => ({
  aiClientMock: {
    testConnection: vi.fn()
  }
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: openMock
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock
}))

vi.mock('../../../ai/client.js', () => ({
  aiClient: aiClientMock
}))

describe('SettingsDrawer', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    openMock.mockReset()
    invokeMock.mockReset()
    aiClientMock.testConnection.mockReset()
  })

  it('shows a workspace selector instead of per-broker path configuration', () => {
    const wrapper = mount(SettingsDrawer, {
      props: {
        open: true,
        tab: 'projects'
      }
    })

    expect(wrapper.text()).toContain('工作区')
    expect(wrapper.text()).not.toContain('Broker 项目路径配置')
    expect(wrapper.text()).not.toContain('添加新 Broker')
    expect(wrapper.find('[data-testid=\"select-workspace-btn\"]').exists()).toBe(true)
  })

  it('does not render when open prop is false', () => {
    const wrapper = mount(SettingsDrawer, {
      props: {
        open: false,
        tab: 'projects'
      }
    })

    expect(wrapper.find('.settings-overlay').exists()).toBe(false)
  })

  it('updates the workspace path after selecting a directory', async () => {
    openMock.mockResolvedValue('/Users/demo/AI')

    const wrapper = mount(SettingsDrawer, {
      props: {
        open: true,
        tab: 'projects'
      }
    })

    await wrapper.get('[data-testid=\"select-workspace-btn\"]').trigger('click')
    await nextTick()

    expect(openMock).toHaveBeenCalled()
    expect(wrapper.get('[data-testid=\"workspace-path-input\"]').element.value).toBe('/Users/demo/AI')
  })

  it('renders Jira project keys as multiple inputs and supports add/remove actions', async () => {
    const wrapper = mount(SettingsDrawer, {
      props: {
        open: true,
        tab: 'jira'
      }
    })

    const projectInputs = wrapper.findAll('[data-testid="jira-project-input"]')

    expect(projectInputs).toHaveLength(1)
    expect(projectInputs[0].element.value).toBe('CRMCN')

    await wrapper.get('[data-testid="jira-project-add-btn"]').trigger('click')

    const addedInputs = wrapper.findAll('[data-testid="jira-project-input"]')
    expect(addedInputs).toHaveLength(2)

    await addedInputs[1].setValue('CRMHK')
    await wrapper.get('[data-testid="jira-project-remove-btn-1"]').trigger('click')

    const remainingInputs = wrapper.findAll('[data-testid="jira-project-input"]')
    expect(remainingInputs).toHaveLength(1)
    expect(remainingInputs[0].element.value).toBe('CRMCN')
  })

  it('renders an AI provider tab with OpenAI-oriented config fields', () => {
    const wrapper = mount(SettingsDrawer, {
      props: {
        open: true,
        tab: 'ai'
      }
    })

    expect(wrapper.text()).toContain('AI')
    expect(wrapper.get('[data-testid="ai-provider-select"]').element.value).toBe('openai')
    expect(wrapper.get('[data-testid="ai-model-input"]').element.value).toBe('gpt-5.2')
    expect(wrapper.get('[data-testid="ai-api-key-input"]').element.getAttribute('type')).toBe('password')
    expect(wrapper.get('[data-testid="ai-base-url-input"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="ai-organization-input"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="ai-project-input"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="search-provider-select"]').element.value).toBe('tavily')
    expect(wrapper.get('[data-testid="search-api-key-input"]').exists()).toBe(true)
  })

  it('renders a prompt tab with editor and preview panels', () => {
    const wrapper = mount(SettingsDrawer, {
      props: {
        open: true,
        tab: 'prompt'
      }
    })

    expect(wrapper.text()).toContain('提示词')
    expect(wrapper.find('[data-testid="prompt-general-role-input"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="prompt-preview"]').exists()).toBe(true)
  })

  it('tests the AI connection with the current provider config', async () => {
    aiClientMock.testConnection.mockResolvedValue({
      ok: true,
      message: '连接成功'
    })

    const wrapper = mount(SettingsDrawer, {
      props: {
        open: true,
        tab: 'ai'
      }
    })

    await wrapper.get('[data-testid="ai-api-key-input"]').setValue('sk-test')
    await wrapper.get('[data-testid="ai-test-btn"]').trigger('click')
    await nextTick()

    expect(aiClientMock.testConnection).toHaveBeenCalledWith(expect.objectContaining({
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-5.2'
      }))
  })

  it('shows the AI error response body when the connection test returns HTTP 400', async () => {
    aiClientMock.testConnection.mockResolvedValue({
      ok: false,
      message: '连接失败: HTTP 400 - Unsupported parameter: max_output_tokens'
    })

    const wrapper = mount(SettingsDrawer, {
      props: {
        open: true,
        tab: 'ai'
      }
    })

    await wrapper.get('[data-testid="ai-api-key-input"]').setValue('sk-test')
    await wrapper.get('[data-testid="ai-test-btn"]').trigger('click')
    await nextTick()

    expect(wrapper.text()).toContain('连接失败: HTTP 400')
    expect(wrapper.text()).toContain('Unsupported parameter: max_output_tokens')
  })
})
