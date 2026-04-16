import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn()
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock
}))

import { postJson } from '../transport/tauri-sidecar.js'

describe('tauri sidecar transport tracing', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    global.fetch = vi.fn()
  })

  it('emits sanitized network trace events for json requests', async () => {
    invokeMock.mockResolvedValueOnce({
      baseUrl: 'http://127.0.0.1:4317'
    })

    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, message: '连接成功' })
    })

    const onNetworkEvent = vi.fn()

    await postJson('/v1/test', {
      apiKey: 'sk-test',
      provider: 'openai'
    }, {
      onNetworkEvent
    })

    expect(onNetworkEvent).toHaveBeenCalledTimes(2)
    expect(onNetworkEvent.mock.calls[0][0]).toMatchObject({
      type: 'network.start',
      method: 'POST',
      path: '/v1/test'
    })
    expect(onNetworkEvent.mock.calls[0][0].payload.apiKey).toBe('***')
    expect(onNetworkEvent.mock.calls[1][0]).toMatchObject({
      type: 'network.end',
      ok: true,
      status: 200
    })
  })
})
