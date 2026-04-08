import { describe, expect, it } from 'vitest'
import { buildTools } from '../tools'

describe('buildTools', () => {
  it('wraps OpenAI-style JSON schema into AI SDK compatible inputSchema', () => {
    const tools = buildTools([
      {
        type: 'function',
        function: {
          name: 'scan_pr_status',
          description: 'Scan PR status',
          parameters: {
            type: 'object',
            properties: {
              repo: { type: 'string' }
            },
            required: ['repo']
          }
        }
      }
    ])

    expect(tools.scan_pr_status.inputSchema).toBeTruthy()
    expect(tools.scan_pr_status.inputSchema.jsonSchema).toEqual({
      type: 'object',
      properties: {
        repo: { type: 'string' }
      },
      required: ['repo']
    })
  })
})
