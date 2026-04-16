import { invoke } from '@tauri-apps/api/core'

export const schema = {
  type: 'function',
  function: {
    name: 'web_search',
    description: '执行基础联网搜索，返回标题、链接和摘要片段。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词或问题' },
        limit: { type: 'integer', description: '返回结果数量上限，默认 5' }
      },
      required: ['query']
    }
  }
}

export async function handler(args, ctx) {
  return invoke('agent_web_search', {
    query: args.query,
    limit: args.limit || 5,
    provider: ctx?.settings?.searchConfig?.provider || 'tavily',
    apiKey: ctx?.settings?.searchConfig?.apiKey || ''
  })
}
