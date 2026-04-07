import { describe, it, expect, beforeEach } from 'vitest'
import { recordQuotaResponse, getLastQuotaSnapshot, resetQuotaState } from '../src/quota.js'

describe('quota', () => {
  beforeEach(() => {
    resetQuotaState()
  })

  it('returns null before any response is recorded', () => {
    expect(getLastQuotaSnapshot()).toBeNull()
  })

  it('captures the latest snapshot after one response', () => {
    recordQuotaResponse({
      'x-requests-used': '156',
      'x-requests-remaining': '344',
      'x-requests-last': '4',
    })
    const snap = getLastQuotaSnapshot()
    expect(snap).toEqual({ used: 156, remaining: 344, lastCallCost: 4 })
  })

  it('overwrites with the most recent values', () => {
    recordQuotaResponse({ 'x-requests-used': '156', 'x-requests-remaining': '344', 'x-requests-last': '4' })
    recordQuotaResponse({ 'x-requests-used': '160', 'x-requests-remaining': '340', 'x-requests-last': '4' })
    const snap = getLastQuotaSnapshot()
    expect(snap).toEqual({ used: 160, remaining: 340, lastCallCost: 4 })
  })

  it('ignores responses missing the headers', () => {
    recordQuotaResponse({ 'x-requests-used': '160', 'x-requests-remaining': '340', 'x-requests-last': '4' })
    recordQuotaResponse({}) // empty headers (e.g. error response)
    const snap = getLastQuotaSnapshot()
    expect(snap).toEqual({ used: 160, remaining: 340, lastCallCost: 4 })
  })
})
