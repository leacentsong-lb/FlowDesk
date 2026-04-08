import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import DevView from '../DevView.vue'
import { useReleaseStore } from '../../stores/release'

describe('DevView', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('shows the pipeline only in release mode', async () => {
    const release = useReleaseStore()
    release.mode = 'general'
    release.sessionActive = true

    const wrapper = mount(DevView, {
      global: {
        stubs: {
          PipelinePanel: { template: '<div data-testid="pipeline-panel" />' },
          AgentChatPanel: { template: '<div data-testid="agent-chat-panel" />' }
        }
      }
    })

    expect(wrapper.find('[data-testid="pipeline-panel"]').exists()).toBe(false)

    release.mode = 'release'
    await nextTick()

    expect(wrapper.find('[data-testid="pipeline-panel"]').exists()).toBe(true)
  })
})
