import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import JiraPanel from '../JiraPanel.vue'
import { useJiraStore } from '../../../stores/jira'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

describe('JiraPanel', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('defaults to the Task tab and renders hierarchy ids above the summary', async () => {
    const jira = useJiraStore()
    jira.updateConfig({
      domain: 'example.atlassian.net',
      email: 'demo@example.com',
      apiToken: 'token',
      project: 'CRMCN'
    })
    jira.issues = [
      {
        id: 'story-1',
        key: 'CRMCN-200',
        summary: 'Checkout story',
        status: 'In Progress',
        type: 'Story',
        project: 'CRMCN',
        updated: '2026-04-07T09:00:00.000Z',
        hierarchyText: 'CRMCN-100 / CRMCN-200',
        hierarchyTrail: [
          { key: 'CRMCN-100', type: 'Epic' },
          { key: 'CRMCN-200', type: 'Story' }
        ],
        parent: { key: 'CRMCN-100', summary: 'Checkout epic', type: 'Epic' },
        url: 'https://example.atlassian.net/browse/CRMCN-200'
      },
      {
        id: 'bug-1',
        key: 'CRMCN-300',
        summary: 'Fix payment bug',
        status: 'To Do',
        type: 'Bug',
        project: 'CRMCN',
        updated: '2026-04-07T10:00:00.000Z',
        hierarchyText: 'CRMCN-300',
        hierarchyTrail: [{ key: 'CRMCN-300', type: 'Bug' }],
        parent: null,
        url: 'https://example.atlassian.net/browse/CRMCN-300'
      }
    ]

    const wrapper = mount(JiraPanel)

    expect(wrapper.text()).toContain('Bug')
    expect(wrapper.text()).toContain('Task')
    expect(wrapper.text()).not.toContain('进行中')
    expect(wrapper.text()).not.toContain('待办')
    expect(wrapper.find('.task-hierarchy').text()).toBe('CRMCN-100 / CRMCN-200')
    expect(wrapper.text()).toContain('Checkout story')
    expect(wrapper.text()).not.toContain('Fix payment bug')
    expect(wrapper.text()).toContain('提测')
  })

  it('switches to the Bug tab without showing Task items', async () => {
    const jira = useJiraStore()
    jira.updateConfig({
      domain: 'example.atlassian.net',
      email: 'demo@example.com',
      apiToken: 'token',
      project: 'CRMCN'
    })
    jira.issues = [
      {
        id: 'task-1',
        key: 'CRMCN-200',
        summary: 'Checkout story',
        status: 'In Progress',
        type: 'Story',
        project: 'CRMCN',
        updated: '2026-04-07T09:00:00.000Z',
        hierarchyText: 'CRMCN-100 / CRMCN-200',
        hierarchyTrail: [
          { key: 'CRMCN-100', type: 'Epic' },
          { key: 'CRMCN-200', type: 'Story' }
        ],
        parent: { key: 'CRMCN-100', summary: 'Checkout epic', type: 'Epic' },
        url: 'https://example.atlassian.net/browse/CRMCN-200'
      },
      {
        id: 'bug-1',
        key: 'CRMCN-300',
        summary: 'Fix payment bug',
        status: 'To Do',
        type: 'Bug',
        project: 'CRMCN',
        updated: '2026-04-07T10:00:00.000Z',
        hierarchyText: 'CRMCN-300',
        hierarchyTrail: [{ key: 'CRMCN-300', type: 'Bug' }],
        parent: null,
        url: 'https://example.atlassian.net/browse/CRMCN-300'
      }
    ]

    const wrapper = mount(JiraPanel)
    const buttons = wrapper.findAll('.filter-btn')

    await buttons[0].trigger('click')

    expect(wrapper.text()).toContain('Fix payment bug')
    expect(wrapper.text()).not.toContain('Checkout story')
    expect(wrapper.text()).toContain('创建分支')
    expect(wrapper.text()).not.toContain('提测')
  })
})
