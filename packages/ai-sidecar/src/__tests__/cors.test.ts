import { describe, expect, it } from 'vitest'
import { buildCorsHeaders } from '../cors'

describe('buildCorsHeaders', () => {
  it('returns CORS headers for local dev frontend requests', () => {
    expect(buildCorsHeaders()).toEqual({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    })
  })
})
