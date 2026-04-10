import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import PromptStudioPanel from '../PromptStudioPanel.vue'
import { useReleaseStore } from '../../../stores/release'

describe('PromptStudioPanel', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('renders editable prompt sections and final preview', async () => {
    const release = useReleaseStore()
    release.mode = 'general'
    release.environment = 'production'

    const wrapper = mount(PromptStudioPanel)

    expect(wrapper.get('[data-testid="prompt-general-role-input"]').element.value).toContain('你是开发助手')
    expect(wrapper.get('[data-testid="prompt-preview"]').text()).toContain('你是开发助手')

    await wrapper.get('[data-testid="prompt-general-role-input"]').setValue('你是一个可配置 Prompt Agent。')
    await nextTick()

    expect(wrapper.get('[data-testid="prompt-preview"]').text()).toContain('你是一个可配置 Prompt Agent。')
  })

  it('resets prompt config when reset button is clicked', async () => {
    const wrapper = mount(PromptStudioPanel)

    await wrapper.get('[data-testid="prompt-general-role-input"]').setValue('自定义角色')
    await wrapper.get('[data-testid="prompt-reset-btn"]').trigger('click')
    await nextTick()

    expect(wrapper.get('[data-testid="prompt-general-role-input"]').element.value).toContain('你是开发助手')
  })
})
