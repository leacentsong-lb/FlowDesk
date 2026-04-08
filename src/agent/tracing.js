const DEFAULT_TRACE_LIMIT = 20

function nowIso() {
  return new Date().toISOString()
}

function safeClone(value) {
  return JSON.parse(JSON.stringify(value ?? null))
}

function ensureRound(trace, round) {
  if (!trace || !Number.isInteger(round)) return null

  let roundEntry = trace.rounds.find(entry => entry.round === round)
  if (!roundEntry) {
    roundEntry = {
      round,
      startedAt: nowIso(),
      modelCalls: [],
      assistantMessages: [],
      toolCalls: [],
      toolResults: []
    }
    trace.rounds.push(roundEntry)
  }

  return roundEntry
}

export function createTraceSession({ runId = '', mode = 'general', workspacePath = '', userText = '' } = {}) {
  return {
    id: runId || `trace-${Date.now()}`,
    runId: runId || '',
    mode,
    workspacePath,
    userText,
    status: 'running',
    startedAt: nowIso(),
    finishedAt: null,
    rounds: [],
    toolCalls: [],
    toolResults: [],
    finalAnswer: '',
    error: '',
    events: []
  }
}

export function recordTraceEvent(trace, event) {
  if (!trace || !event?.type) return trace

  const stampedEvent = {
    ...safeClone(event),
    at: nowIso()
  }
  trace.events.push(stampedEvent)

  switch (event.type) {
    case 'round.started': {
      ensureRound(trace, event.round)
      break
    }
    case 'model.call': {
      const roundEntry = ensureRound(trace, event.round)
      roundEntry?.modelCalls.push({
        messageCount: event.messageCount ?? 0,
        toolCount: event.toolCount ?? 0,
        at: stampedEvent.at
      })
      break
    }
    case 'assistant.completed': {
      const roundEntry = ensureRound(trace, event.round)
      roundEntry?.assistantMessages.push({
        text: event.text || '',
        finishReason: event.finishReason || 'stop',
        toolCalls: safeClone(event.toolCalls || []),
        at: stampedEvent.at
      })
      break
    }
    case 'tool.start': {
      const toolCall = {
        round: event.round ?? null,
        toolName: event.toolName || '',
        args: safeClone(event.args || {}),
        at: stampedEvent.at
      }
      trace.toolCalls.push(toolCall)
      ensureRound(trace, event.round)?.toolCalls.push(toolCall)
      break
    }
    case 'tool.end': {
      const toolResult = {
        round: event.round ?? null,
        toolName: event.toolName || '',
        toolStatus: event.toolStatus || 'success',
        result: safeClone(event.result),
        at: stampedEvent.at
      }
      trace.toolResults.push(toolResult)
      ensureRound(trace, event.round)?.toolResults.push(toolResult)
      break
    }
    case 'run.final_answer': {
      trace.finalAnswer = event.text || ''
      break
    }
    case 'run.error': {
      trace.error = event.message || ''
      trace.status = 'error'
      break
    }
    default:
      break
  }

  return trace
}

export function finalizeTrace(trace, patch = {}) {
  if (!trace) return null

  if (patch.finalAnswer) {
    trace.finalAnswer = patch.finalAnswer
  }

  if (patch.error) {
    trace.error = patch.error
  }

  if (trace.status === 'running' || patch.status) {
    trace.status = patch.status || (trace.error ? 'error' : 'completed')
  }

  if (!trace.finishedAt) {
    trace.finishedAt = nowIso()
  }

  return trace
}

export function snapshotTrace(trace) {
  return safeClone(trace)
}

export function pushTraceEntry(entries, trace, limit = DEFAULT_TRACE_LIMIT) {
  const nextEntries = [...(entries || []), snapshotTrace(trace)].filter(Boolean)
  return nextEntries.slice(Math.max(0, nextEntries.length - limit))
}
