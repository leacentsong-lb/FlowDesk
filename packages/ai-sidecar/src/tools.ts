import { jsonSchema, tool } from 'ai'

/**
 * @param tools - OpenAI-style function tool array.
 * @returns AI SDK tool record.
 */
export function buildTools(tools: Array<any> = []) {
  if (!Array.isArray(tools) || tools.length === 0) {
    return undefined
  }

  return Object.fromEntries(
    tools
      .map(entry => entry?.function)
      .filter(Boolean)
      .map(definition => [
        definition.name,
        tool({
          description: definition.description || '',
          inputSchema: jsonSchema(
            definition.parameters || {
              type: 'object',
              properties: {},
              required: []
            }
          )
        })
      ])
  )
}
