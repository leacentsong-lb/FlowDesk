import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import CreateBranchModal from '../CreateBranchModal.vue'

describe('CreateBranchModal', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('uses workspace handoff instead of broker and base branch selection', () => {
    const wrapper = mount(CreateBranchModal, {
      props: {
        visible: true,
        issue: {
          key: 'CRMCN-123',
          summary: 'Test issue',
          type: 'Bug'
        }
      },
      global: {
        stubs: {
          Teleport: true
        }
      }
    })

    expect(wrapper.text()).toContain('工作区')
    expect(wrapper.text()).not.toContain('选择 Broker')
    expect(wrapper.text()).not.toContain('Base 分支')
    expect(wrapper.text()).toContain('feat/CRMCN-123')
  })
})
