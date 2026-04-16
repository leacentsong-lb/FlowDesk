import { postJson, streamEvents } from './transport/tauri-sidecar.js'

/**
 * @returns {object}
 */
export function createAiClient() {
  return {
    /**
     * @param {object} payload
     * @returns {Promise<{ ok: boolean, message: string, status?: number }>}
     */
    async testConnection(payload, hooks) {
      const result = await postJson('/v1/test', payload, hooks)
      return {
        ok: result.ok && result.body?.ok !== false,
        status: result.status,
        message: result.body?.message || (result.ok ? '连接成功' : `连接失败: HTTP ${result.status}`)
      }
    },

    /**
     * @param {object} payload
     * @returns {Promise<any>}
     */
    async complete(payload, hooks) {
      const result = await postJson('/v1/chat/complete', payload, hooks)
      if (!result.ok) {
        throw new Error(result.body?.message || `HTTP ${result.status}`)
      }
      return result.body
    },

    /**
     * @param {object} payload
     * @param {(event: any) => void} onEvent
     * @param {AbortSignal} [signal]
     * @returns {Promise<void>}
     */
    async streamAgent(payload, onEvent, signal, hooks) {
      return streamEvents('/v1/agent/stream', payload, onEvent, signal, hooks)
    }
  }
}

export const aiClient = createAiClient()
