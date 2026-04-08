import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import DashboardView from '../DashboardView.vue'

describe('DashboardView', () => {
  it('does not render the greeting header so the dashboard can use more vertical space', () => {
    const wrapper = mount(DashboardView, {
      global: {
        stubs: {
          JiraPanel: { template: '<div data-testid="jira-panel" />' },
          TodoListPanel: { template: '<div data-testid="todo-panel" />' },
          CreateBranchModal: { template: '<div data-testid="branch-modal" />' }
        }
      }
    })

    expect(wrapper.find('.dashboard-header').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('准备开始新的一天吧')
    expect(wrapper.text()).not.toContain('Good Morning!')
    expect(wrapper.text()).not.toContain('Good Afternoon!')
    expect(wrapper.text()).not.toContain('Good Evening!')
  })
})
