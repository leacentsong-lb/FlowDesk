import { describe, expect, it } from 'vitest'
import { normalizeStreamPart } from '../normalize-parts'

describe('normalizeStreamPart', () => {
  it('maps AI SDK tool-call parts to app tool-call-delta events', () => {
    const event = normalizeStreamPart({
      type: 'tool-call',
      toolCallId: 'call_123',
      toolName: 'scan_pr_status',
      input: { repo: 'member', branch: 'release/v1.0.0' }
    })

    expect(event).toEqual({
      kind: 'tool-call-delta',
      index: 0,
      id: 'call_123',
      name: 'scan_pr_status',
      argumentsFragment: '{"repo":"member","branch":"release/v1.0.0"}'
    })
  })

  it('maps AI SDK error parts to app error events', () => {
    const event = normalizeStreamPart({
      type: 'error',
      error: 'bad api key'
    })

    expect(event).toEqual({
      kind: 'error',
      message: 'bad api key'
    })
  })
})
