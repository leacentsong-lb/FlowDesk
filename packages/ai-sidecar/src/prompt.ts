type OpenAIMessage = {
  role?: string
  content?: string | null
  tool_calls?: Array<{
    id?: string
    function?: {
      name?: string
      arguments?: string
    }
  }>
  tool_call_id?: string
}

/**
 * Build a stable textual transcript from OpenAI-style messages.
 *
 * @param prompt - Direct prompt, if already provided.
 * @param messages - OpenAI-style message history.
 * @returns Flattened prompt passed to the AI SDK.
 */
export function buildPrompt(prompt?: string, messages: OpenAIMessage[] = []) {
  if (prompt?.trim()) {
    return prompt.trim()
  }

  const transcript = messages
    .map(message => serializeMessage(message))
    .filter(Boolean)
    .join('\n\n')

  return [
    '继续完成下面这段对话。',
    '如果需要，请调用可用工具。',
    transcript
  ]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * @param message - OpenAI-style message.
 * @returns Serialized transcript block.
 */
function serializeMessage(message: OpenAIMessage) {
  const role = (message.role || 'user').toLowerCase()

  if (role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    const toolCalls = message.tool_calls
      .map(toolCall => {
        const name = toolCall.function?.name || 'unknown_tool'
        const args = toolCall.function?.arguments || '{}'
        return `- ${name}: ${args}`
      })
      .join('\n')

    const blocks = []
    if (message.content?.trim()) {
      blocks.push(`[assistant]\n${message.content.trim()}`)
    }
    blocks.push(`[assistant_tool_calls]\n${toolCalls}`)
    return blocks.join('\n')
  }

  if (role === 'tool') {
    return `[tool:${message.tool_call_id || 'unknown'}]\n${String(message.content || '')}`
  }

  return `[${role}]\n${String(message.content || '')}`
}
