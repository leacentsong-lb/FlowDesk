const DEFAULT_TRACE_LIMIT = 20
const MASKED_VALUE = '***'

const SENSITIVE_KEY_PATTERN = /(api[-_]?key|authorization|token|secret|password)/i

function nowIso() {
  return new Date().toISOString()
}

function safeClone(value) {
  return JSON.parse(JSON.stringify(value ?? null))
}

function sanitizeForTrace(value) {
  if (Array.isArray(value)) {
    return value.map(item => sanitizeForTrace(item))
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, currentValue]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key) ? MASKED_VALUE : sanitizeForTrace(currentValue)
    ])
  )
}

function notifyTrace(trace) {
  if (!trace || typeof trace.notify !== 'function') return
  trace.notify(snapshotTrace(trace))
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
      toolResults: [],
      networkCalls: [],
      networkResults: []
    }
    trace.rounds.push(roundEntry)
  }

  return roundEntry
}

export function createTraceSession({
  runId = '',
  mode = 'general',
  workspacePath = '',
  userText = '',
  workflowId = '',
  provider = '',
  model = '',
  notify = null
} = {}) {
  return {
    id: runId || `trace-${Date.now()}`,
    runId: runId || '',
    mode,
    workflowId,
    provider,
    model,
    workspacePath,
    userText,
    status: 'running',
    startedAt: nowIso(),
    finishedAt: null,
    rounds: [],
    toolCalls: [],
    toolResults: [],
    networkCalls: [],
    networkResults: [],
    finalAnswer: '',
    error: '',
    events: [],
    notify
  }
}

export function recordTraceEvent(trace, event) {
  if (!trace || !event?.type) return trace

  const stampedEvent = sanitizeForTrace({
    ...safeClone(event),
    at: nowIso()
  })
  trace.events.push(stampedEvent)

  switch (event.type) {
    case 'round.started': {
      ensureRound(trace, event.round)
      break
    }
    case 'model.call': {
      const roundEntry = ensureRound(trace, event.round)
      roundEntry?.modelCalls.push({
        provider: event.provider || '',
        model: event.model || '',
        messageCount: event.messageCount ?? 0,
        toolCount: event.toolCount ?? 0,
        request: sanitizeForTrace(event.request || null),
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
    case 'network.start': {
      const networkCall = {
        round: event.round ?? null,
        requestId: event.requestId || '',
        method: event.method || 'POST',
        path: event.path || '',
        url: event.url || '',
        payload: sanitizeForTrace(event.payload || {}),
        at: stampedEvent.at
      }
      trace.networkCalls.push(networkCall)
      ensureRound(trace, event.round)?.networkCalls.push(networkCall)
      break
    }
    case 'network.end': {
      const networkResult = {
        round: event.round ?? null,
        requestId: event.requestId || '',
        ok: event.ok !== false,
        status: event.status ?? null,
        durationMs: event.durationMs ?? null,
        response: sanitizeForTrace(event.response || null),
        error: event.error || '',
        at: stampedEvent.at
      }
      trace.networkResults.push(networkResult)
      ensureRound(trace, event.round)?.networkResults.push(networkResult)
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

  notifyTrace(trace)
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

  notifyTrace(trace)
  return trace
}

export function snapshotTrace(trace) {
  return safeClone(trace)
}

export function pushTraceEntry(entries, trace, limit = DEFAULT_TRACE_LIMIT) {
  const nextEntries = [...(entries || []), snapshotTrace(trace)].filter(Boolean)
  return nextEntries.slice(Math.max(0, nextEntries.length - limit))
}

function summarizeText(value, maxLength = 80) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  if (text.length <= maxLength) return text
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

function resolveEventStatus(event) {
  if (!event) return 'info'

  if (event.type === 'run.error') return 'error'
  if (event.type === 'tool.end') {
    if (event.toolStatus === 'error') return 'error'
    if (event.toolStatus === 'recovering') return 'warning'
    return 'success'
  }
  if (event.type === 'network.end') {
    if (event.ok === false || event.status >= 400 || event.error) return 'error'
    return 'success'
  }
  return 'info'
}

function buildSummary(event) {
  switch (event.type) {
    case 'model.call':
      return `${event.provider || 'unknown'} / ${event.model || 'unknown'} · ${event.messageCount ?? 0} 条消息 · ${event.toolCount ?? 0} 个工具`
    case 'assistant.completed':
      return summarizeText(event.text || (event.toolCalls?.length ? `返回 ${event.toolCalls.length} 个工具调用` : '模型已返回'))
    case 'tool.start':
      return event.toolName || '未知工具'
    case 'tool.end':
      return event.result?.summary || event.toolName || '工具执行完成'
    case 'network.start':
      return `${event.method || 'POST'} ${event.path || event.url || ''}`.trim()
    case 'network.end':
      return event.error
        ? summarizeText(event.error)
        : `HTTP ${event.status ?? '-'} · ${event.durationMs ?? 0}ms`
    case 'run.started':
      return 'Agent 会话已启动'
    case 'run.error':
      return summarizeText(event.message || '运行失败')
    case 'run.final_answer':
      return summarizeText(event.text || 'Agent 已完成回复')
    default:
      return summarizeText(event.text || event.toolName || event.path || event.type)
  }
}

function buildLabel(event) {
  switch (event.type) {
    case 'model.call':
      return 'AI 请求'
    case 'assistant.completed':
      return 'AI 返回'
    case 'tool.start':
      return '工具开始'
    case 'tool.end':
      return '工具完成'
    case 'network.start':
      return '网络请求'
    case 'network.end':
      return '网络响应'
    case 'run.started':
      return '开始运行'
    case 'run.error':
      return '运行报错'
    case 'run.final_answer':
      return '最终回复'
    default:
      return event.type
  }
}

function buildCategory(event) {
  switch (event.type) {
    case 'model.call':
    case 'assistant.completed':
      return 'ai'
    case 'tool.start':
    case 'tool.end':
      return 'tool'
    case 'network.start':
    case 'network.end':
      return 'network'
    default:
      return 'lifecycle'
  }
}

export function buildTraceTimeline(trace) {
  return [...(trace?.events || [])]
    .filter(event => event?.type)
    .sort((left, right) => String(left.at || '').localeCompare(String(right.at || '')))
    .map((event, index) => ({
      id: `${event.at || 'trace'}-${index}-${event.type}`,
      type: event.type,
      at: event.at || '',
      round: event.round ?? null,
      category: buildCategory(event),
      label: buildLabel(event),
      summary: buildSummary(event),
      status: resolveEventStatus(event),
      raw: event
    }))
}
