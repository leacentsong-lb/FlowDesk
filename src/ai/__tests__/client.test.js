import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn()
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock
}))

import { createAiClient } from '../client.js'

describe('ai client', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    global.fetch = vi.fn()
  })

  it('tests AI connectivity through the sidecar bridge instead of legacy ai_test_connection', async () => {
    invokeMock.mockResolvedValueOnce({
      baseUrl: 'http://127.0.0.1:4317'
    })

    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, message: '连接成功' })
    })

    const client = createAiClient()
    const result = await client.testConnection({
      provider: 'openai',
      apiKey: 'sk-test',
      baseURL: '',
      model: 'gpt-5.2'
    })

    expect(invokeMock).toHaveBeenCalledWith('ai_sidecar_ensure_running')
    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4317/v1/test',
      expect.objectContaining({
        method: 'POST'
      })
    )
    expect(result.ok).toBe(true)
  })
})
