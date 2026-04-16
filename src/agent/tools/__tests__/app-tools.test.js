import { beforeEach, describe, expect, it } from 'vitest'
import { getEditableAppTools, getToolsByTags } from '../index.js'

describe('app tool overlays', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('applies customized descriptions and hides disabled tools from the AI tool surface', () => {
    localStorage.setItem('app_agent_tool_overrides_v1', JSON.stringify({
      load_skill: {
        description: '自定义技能加载描述'
      },
      web_search: {
        enabled: false
      }
    }))

    const baseTools = getToolsByTags(['base'])

    expect(baseTools.find(tool => tool.function.name === 'load_skill')?.function.description)
      .toBe('自定义技能加载描述')
    expect(baseTools.find(tool => tool.function.name === 'web_search')).toBeUndefined()
  })

  it('includes disabled tools in the editable app tool registry', () => {
    localStorage.setItem('app_agent_tool_overrides_v1', JSON.stringify({
      web_search: {
        enabled: false,
        label: '联网搜索（已隐藏）'
      }
    }))

    const tools = getEditableAppTools()
    const webSearch = tools.find(tool => tool.name === 'web_search')

    expect(webSearch).toMatchObject({
      name: 'web_search',
      enabled: false,
      label: '联网搜索（已隐藏）',
      customized: true
    })
  })
})
