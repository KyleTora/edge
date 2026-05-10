import { describe, it, expect } from 'vitest'
import { signMarkToken, verifyMarkToken } from '../../src/parlay/sign.js'

describe('sign / verify mark token', () => {
  const secret = 'test-secret'

  it('verifies a token signed with the same secret', () => {
    const t = signMarkToken('parlay-123', 'skip', secret)
    expect(verifyMarkToken('parlay-123', 'skip', t, secret)).toBe(true)
  })

  it('rejects mismatched parlay id', () => {
    const t = signMarkToken('parlay-123', 'skip', secret)
    expect(verifyMarkToken('parlay-999', 'skip', t, secret)).toBe(false)
  })

  it('rejects mismatched action', () => {
    const t = signMarkToken('parlay-123', 'skip', secret)
    expect(verifyMarkToken('parlay-123', 'bet', t, secret)).toBe(false)
  })

  it('rejects different secret', () => {
    const t = signMarkToken('parlay-123', 'skip', secret)
    expect(verifyMarkToken('parlay-123', 'skip', t, 'other')).toBe(false)
  })
})
