import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useJiraStore } from '../jira'
import { invoke } from '@tauri-apps/api/core'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

describe('jira store', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('fetches missing parents to build a full hierarchy trail', async () => {
    invoke
      .mockResolvedValueOnce({
        status: 200,
        body: JSON.stringify({
          issues: [
            {
              id: '300',
              key: 'CRMCN-300',
              fields: {
                summary: 'Implement task detail',
                status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
                issuetype: { name: 'Task' },
                priority: { name: 'Medium' },
                project: { key: 'CRMCN', name: 'CRM CN' },
                created: '2026-04-07T08:00:00.000+0800',
                updated: '2026-04-07T09:00:00.000+0800',
                parent: {
                  key: 'CRMCN-200',
                  fields: {
                    summary: 'Checkout story',
                    issuetype: { name: 'Story' }
                  }
                }
              }
            },
            {
              id: '400',
              key: 'CRMCN-400',
              fields: {
                summary: 'Fix production bug',
                status: { name: 'To Do', statusCategory: { key: 'new' } },
                issuetype: { name: 'Bug' },
                priority: { name: 'High' },
                project: { key: 'CRMCN', name: 'CRM CN' },
                created: '2026-04-07T08:00:00.000+0800',
                updated: '2026-04-07T09:00:00.000+0800'
              }
            }
          ]
        })
      })
      .mockResolvedValueOnce({
        status: 200,
        body: JSON.stringify({
          key: 'CRMCN-200',
          fields: {
            summary: 'Checkout story',
            issuetype: { name: 'Story' },
            parent: {
              key: 'CRMCN-100',
              fields: {
                summary: 'Checkout epic',
                issuetype: { name: 'Epic' }
              }
            }
          }
        })
      })
      .mockResolvedValueOnce({
        status: 200,
        body: JSON.stringify({
          key: 'CRMCN-100',
          fields: {
            summary: 'Checkout epic',
            issuetype: { name: 'Epic' }
          }
        })
      })

    const jira = useJiraStore()
    jira.updateConfig({
      domain: 'example.atlassian.net',
      email: 'demo@example.com',
      apiToken: 'token',
      project: 'CRMCN'
    })

    await jira.fetchIssues()

    const taskIssue = jira.issues.find(issue => issue.key === 'CRMCN-300')
    expect(taskIssue.hierarchyText).toBe('CRMCN-100 / CRMCN-200 / CRMCN-300')
    expect(taskIssue.hierarchyTrail.map(node => node.type)).toEqual(['Epic', 'Story', 'Task'])

    expect(invoke).toHaveBeenNthCalledWith(2, 'jira_get_issue', expect.objectContaining({
      issueKey: 'CRMCN-200'
    }))
    expect(invoke).toHaveBeenNthCalledWith(3, 'jira_get_issue', expect.objectContaining({
      issueKey: 'CRMCN-100'
    }))
  })

  it('separates bug issues from all other issue types', async () => {
    invoke.mockResolvedValueOnce({
      status: 200,
      body: JSON.stringify({
        issues: [
          {
            id: '1',
            key: 'CRMCN-1',
            fields: {
              summary: 'Fix payment bug',
              status: { name: 'To Do', statusCategory: { key: 'new' } },
              issuetype: { name: 'Bug' },
              priority: { name: 'High' },
              project: { key: 'CRMCN', name: 'CRM CN' },
              created: '2026-04-07T08:00:00.000+0800',
              updated: '2026-04-07T09:00:00.000+0800'
            }
          },
          {
            id: '2',
            key: 'CRMCN-2',
            fields: {
              summary: 'Checkout story',
              status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
              issuetype: { name: 'Story' },
              priority: { name: 'Medium' },
              project: { key: 'CRMCN', name: 'CRM CN' },
              created: '2026-04-07T08:00:00.000+0800',
              updated: '2026-04-07T09:00:00.000+0800'
            }
          },
          {
            id: '3',
            key: 'CRMCN-3',
            fields: {
              summary: 'Checkout epic',
              status: { name: 'Done', statusCategory: { key: 'done' } },
              issuetype: { name: 'Epic' },
              priority: { name: 'Low' },
              project: { key: 'CRMCN', name: 'CRM CN' },
              created: '2026-04-07T08:00:00.000+0800',
              updated: '2026-04-07T09:00:00.000+0800'
            }
          }
        ]
      })
    })

    const jira = useJiraStore()
    jira.updateConfig({
      domain: 'example.atlassian.net',
      email: 'demo@example.com',
      apiToken: 'token',
      project: 'CRMCN'
    })

    await jira.fetchIssues()

    expect(jira.groupedByType.bug.map(issue => issue.key)).toEqual(['CRMCN-1'])
    expect(jira.groupedByType.task.map(issue => issue.key)).toEqual(['CRMCN-2', 'CRMCN-3'])
    expect(jira.typeStats).toEqual({ bug: 1, task: 2 })
  })

  it('normalizes multiline Jira project keys and queries multiple projects', async () => {
    invoke.mockResolvedValueOnce({
      status: 200,
      body: JSON.stringify({ issues: [] })
    })

    const jira = useJiraStore()
    jira.updateConfig({
      domain: 'example.atlassian.net',
      email: 'demo@example.com',
      apiToken: 'token',
      project: 'CRMCN\n\n ABC \nCRMHK  '
    })

    expect(jira.config.project).toBe('CRMCN\nABC\nCRMHK')
    expect(localStorage.getItem('jira_project')).toBe('CRMCN\nABC\nCRMHK')

    await jira.fetchIssues()

    expect(invoke).toHaveBeenCalledWith('jira_get_my_issues', expect.objectContaining({
      project: 'CRMCN\nABC\nCRMHK'
    }))
  })
})
