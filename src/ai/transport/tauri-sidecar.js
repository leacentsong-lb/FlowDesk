import { invoke } from '@tauri-apps/api/core'

let cachedBaseUrl = ''

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
 * @returns {Promise<any>}
 */
export async function postJson(path, payload) {
  try {
    const baseUrl = await ensureSidecarBaseUrl()
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    const body = await response.json().catch(() => ({}))
    return {
      ok: response.ok,
      status: response.status,
      body
    }
  } catch (error) {
    throw wrapTransportError(error)
  }
}

/**
 * @param {string} path
 * @param {object} payload
 * @param {(event: any) => void} onEvent
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
export async function streamEvents(path, payload, onEvent, signal) {
  try {
    const baseUrl = await ensureSidecarBaseUrl()
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
          onEvent?.(JSON.parse(data))
        }
      }
    }
  } catch (error) {
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
