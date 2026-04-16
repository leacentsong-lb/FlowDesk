import { invoke } from '@tauri-apps/api/core'

let cachedBaseUrl = ''
const MASKED_VALUE = '***'
const SENSITIVE_KEY_PATTERN = /(api[-_]?key|authorization|token|secret|password)/i

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

function createRequestId() {
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function emitNetworkEvent(hooks, event) {
  hooks?.onNetworkEvent?.(event)
}

/**
 * @returns {Promise<string>}
 */
export async function ensureSidecarBaseUrl() {
  if (cachedBaseUrl) return cachedBaseUrl

  const result = await invoke('ai_sidecar_ensure_running')
  cachedBaseUrl = result?.baseUrl || ''

  if (!cachedBaseUrl) {
    throw new Error('AI sidecar 未返回可用地址')
  }

  return cachedBaseUrl
}

/**
 * @param {string} path
 * @param {object} payload
 * @param {{ onNetworkEvent?: (event: object) => void }} [hooks]
 * @returns {Promise<any>}
 */
export async function postJson(path, payload, hooks = {}) {
  const requestId = createRequestId()
  const startedAt = Date.now()
  try {
    const baseUrl = await ensureSidecarBaseUrl()
    emitNetworkEvent(hooks, {
      type: 'network.start',
      requestId,
      method: 'POST',
      path,
      url: `${baseUrl}${path}`,
      payload: sanitizeForTrace(payload)
    })
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    const body = await response.json().catch(() => ({}))
    emitNetworkEvent(hooks, {
      type: 'network.end',
      requestId,
      ok: response.ok,
      status: response.status,
      durationMs: Date.now() - startedAt,
      response: sanitizeForTrace(body)
    })
    return {
      ok: response.ok,
      status: response.status,
      body
    }
  } catch (error) {
    emitNetworkEvent(hooks, {
      type: 'network.end',
      requestId,
      ok: false,
      status: null,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error)
    })
    throw wrapTransportError(error)
  }
}

/**
 * @param {string} path
 * @param {object} payload
 * @param {(event: any) => void} onEvent
 * @param {AbortSignal} [signal]
 * @param {{ onNetworkEvent?: (event: object) => void }} [hooks]
 * @returns {Promise<void>}
 */
export async function streamEvents(path, payload, onEvent, signal, hooks = {}) {
  const requestId = createRequestId()
  const startedAt = Date.now()
  let eventCount = 0
  try {
    const baseUrl = await ensureSidecarBaseUrl()
    emitNetworkEvent(hooks, {
      type: 'network.start',
      requestId,
      method: 'POST',
      path,
      url: `${baseUrl}${path}`,
      payload: sanitizeForTrace(payload)
    })
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal
    })

    if (!response.ok || !response.body) {
      const errorBody = await response.text().catch(() => '')
      throw new Error(errorBody || `HTTP ${response.status}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      while (buffer.includes('\n\n')) {
        const separatorIndex = buffer.indexOf('\n\n')
        const chunk = buffer.slice(0, separatorIndex)
        buffer = buffer.slice(separatorIndex + 2)

        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)
          if (!data) continue
          eventCount += 1
          onEvent?.(JSON.parse(data))
        }
      }
    }
    emitNetworkEvent(hooks, {
      type: 'network.end',
      requestId,
      ok: true,
      status: response.status,
      durationMs: Date.now() - startedAt,
      response: {
        streamed: true,
        eventCount
      }
    })
  } catch (error) {
    emitNetworkEvent(hooks, {
      type: 'network.end',
      requestId,
      ok: false,
      status: null,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error)
    })
    throw wrapTransportError(error)
  }
}

/**
 * @param {unknown} error
 * @returns {Error}
 */
function wrapTransportError(error) {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return error
  }

  const message = error instanceof Error ? error.message : String(error)
  if (/load failed|failed to fetch/i.test(message)) {
    return new Error(`AI sidecar 网络请求失败: ${message}`)
  }

  return error instanceof Error ? error : new Error(message)
}
