import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { TOOLS, TOOL_HANDLERS } from '../index.js'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

describe('jira agent tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers fetch_jira_versions with a release_state parameter', () => {
    const schema = TOOLS.find(tool => tool.function.name === 'fetch_jira_versions')

    expect(schema).toBeTruthy()
    expect(schema.function.parameters.properties.release_state).toMatchObject({
      type: 'string'
    })
    expect(schema.function.parameters.properties.release_state.enum).toEqual(['unreleased', 'released', 'all'])
    expect(typeof TOOL_HANDLERS.fetch_jira_versions).toBe('function')
  })

  it('returns only unreleased versions by default', async () => {
    invoke.mockResolvedValueOnce({
      status: 200,
      body: JSON.stringify([
        { name: '3.8.5', released: false, archived: false },
        { name: '3.8.4', released: true, archived: false },
        { name: '3.8.3', released: false, archived: true }
      ])
    })

    const result = await TOOL_HANDLERS.fetch_jira_versions({}, {
      jira: {
        config: {
          domain: 'example.atlassian.net',
          email: 'demo@example.com',
          apiToken: 'token',
          project: 'CRMCN'
        }
      }
    })

    expect(result.ok).toBe(true)
    expect(result.versions.map(version => version.name)).toEqual(['3.8.5'])
    expect(result.versions[0].released).toBe(false)
  })

  it('returns only released versions when requested', async () => {
    invoke.mockResolvedValueOnce({
      status: 200,
      body: JSON.stringify([
        { name: '3.8.5', released: false, archived: false },
        { name: '3.8.4', released: true, archived: false },
        { name: '3.8.3', released: true, archived: true }
      ])
    })

    const result = await TOOL_HANDLERS.fetch_jira_versions({ release_state: 'released' }, {
      jira: {
        config: {
          domain: 'example.atlassian.net',
          email: 'demo@example.com',
          apiToken: 'token',
          project: 'CRMCN'
        }
      }
    })

    expect(result.ok).toBe(true)
    expect(result.versions.map(version => version.name)).toEqual(['3.8.4'])
    expect(result.versions[0].released).toBe(true)
  })

  it('returns both released and unreleased versions when release_state is all', async () => {
    invoke.mockResolvedValueOnce({
      status: 200,
      body: JSON.stringify([
        { name: '3.8.5', released: false, archived: false },
        { name: '3.8.4', released: true, archived: false },
        { name: '3.8.3', released: false, archived: true }
      ])
    })

    const result = await TOOL_HANDLERS.fetch_jira_versions({ release_state: 'all' }, {
      jira: {
        config: {
          domain: 'example.atlassian.net',
          email: 'demo@example.com',
          apiToken: 'token',
          project: 'CRMCN'
        }
      }
    })

    expect(result.ok).toBe(true)
    expect(result.versions.map(version => version.name)).toEqual(['3.8.5', '3.8.4'])
    expect(result.versions.map(version => version.released)).toEqual([false, true])
  })
})
