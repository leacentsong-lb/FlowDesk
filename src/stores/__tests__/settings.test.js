import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSettingsStore } from '../settings'

describe('settings store', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('stores a single workspace path for AI usage', () => {
    const settings = useSettingsStore()

    expect(settings.workspacePath).toBe('/Users/leacentsong/Documents/LifeByteCodes')

    settings.setWorkspacePath('/Users/demo/workspace')

    expect(settings.workspacePath).toBe('/Users/demo/workspace')
    expect(localStorage.getItem('ai_workspace_path')).toBe('/Users/demo/workspace')
  })

  it('stores AI provider config with OpenAI defaults', () => {
    const settings = useSettingsStore()

    expect(settings.aiConfig.provider).toBe('openai')
    expect(settings.aiConfig.model).toBe('gpt-5.2')
    expect(settings.aiConfig.baseURL).toBe('')

    settings.updateAiConfig({
      provider: 'openai',
      apiKey: 'sk-test',
      baseURL: 'https://api.openai.com/v1',
      model: 'gpt-5.2',
      organization: 'org_demo',
      project: 'proj_demo'
    })

    expect(settings.aiConfig.apiKey).toBe('sk-test')
    expect(localStorage.getItem('ai_provider')).toBe('openai')
    expect(localStorage.getItem('ai_api_key')).toBe('sk-test')
    expect(localStorage.getItem('ai_model')).toBe('gpt-5.2')
    expect(localStorage.getItem('ai_base_url')).toBe('https://api.openai.com/v1')
    expect(localStorage.getItem('ai_organization')).toBe('org_demo')
    expect(localStorage.getItem('ai_project')).toBe('proj_demo')
  })

  it('stores web search provider config with Tavily defaults', () => {
    const settings = useSettingsStore()

    expect(settings.searchConfig.provider).toBe('tavily')
    expect(settings.searchConfig.apiKey).toBe('')
    expect(settings.searchConfigured).toBe(false)

    settings.updateSearchConfig({
      provider: 'tavily',
      apiKey: 'tvly-test'
    })

    expect(settings.searchConfig.apiKey).toBe('tvly-test')
    expect(settings.searchConfigured).toBe(true)
    expect(localStorage.getItem('search_provider')).toBe('tavily')
    expect(localStorage.getItem('search_api_key')).toBe('tvly-test')
  })
})
