type AppStreamEvent = {
  kind: string
  index?: number
  id?: string
  name?: string
  argumentsFragment?: string
  text?: string
  finishReason?: string
  message?: string
}

/**
 * Normalize sidecar stream parts to the app's existing event contract.
 *
 * @param part - Raw AI SDK stream part.
 * @returns Normalized event or null when the part is not relevant to the app.
 */
export function normalizeStreamPart(part: Record<string, unknown>): AppStreamEvent | null {
  if (part.type === 'text' || part.type === 'text-delta') {
    return {
      kind: 'text-delta',
      text: String(part.text || part.textDelta || '')
    }
  }

  if (part.type === 'reasoning' || part.type === 'reasoning-delta') {
    return {
      kind: 'reasoning-delta',
      text: String(part.text || part.textDelta || '')
    }
  }

  if (part.type === 'tool-call-streaming-start') {
    return {
      kind: 'tool-call-delta',
      index: 0,
      id: String(part.toolCallId || ''),
      name: String(part.toolName || ''),
      argumentsFragment: ''
    }
  }

  if (part.type === 'tool-call-delta') {
    return {
      kind: 'tool-call-delta',
      index: 0,
      id: String(part.toolCallId || ''),
      name: String(part.toolName || ''),
      argumentsFragment: String(part.argsTextDelta || '')
    }
  }

  if (part.type === 'tool-call') {
    return {
      kind: 'tool-call-delta',
      index: 0,
      id: String(part.toolCallId || ''),
      name: String(part.toolName || ''),
      argumentsFragment: JSON.stringify(part.input || {})
    }
  }

  if (part.type === 'finish') {
    return {
      kind: 'done',
      finishReason: String(part.finishReason || 'stop')
    }
  }

  if (part.type === 'error') {
    return {
      kind: 'error',
      message: String(part.error || 'AI stream failed')
    }
  }

  return null
}
