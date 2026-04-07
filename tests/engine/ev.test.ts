import { describe, it, expect } from 'vitest'
import { americanToPayout, computeEv } from '../../src/engine/ev.js'

describe('americanToPayout', () => {
  it('converts negative odds to fractional payout', () => {
    // -108 → 100/108 = 0.9259
    expect(americanToPayout(-108)).toBeCloseTo(0.9259, 4)
  })

  it('converts positive odds to fractional payout', () => {
    // +115 → 115/100 = 1.15
    expect(americanToPayout(115)).toBeCloseTo(1.15, 4)
  })

  it('handles even money', () => {
    expect(americanToPayout(-100)).toBeCloseTo(1.0, 4)
    expect(americanToPayout(100)).toBeCloseTo(1.0, 4)
  })
})

describe('computeEv', () => {
  it('computes positive EV when offered price beats sharp', () => {
    // sharp Pinnacle -130 → devigged 0.5452
    // bet365 offers -108 → payout 0.9259
    // EV = 0.5452 * 0.9259 - 0.4548 = 0.0500
    const ev = computeEv({ trueProb: 0.5452, offeredOdds: -108 })
    expect(ev).toBeCloseTo(0.05, 3)
  })

  it('computes negative EV when offered price is worse than sharp', () => {
    // sharp says 0.5452, but offered -200 (payout 0.5):
    // EV = 0.5452 * 0.5 - 0.4548 = -0.1822
    const ev = computeEv({ trueProb: 0.5452, offeredOdds: -200 })
    expect(ev).toBeCloseTo(-0.1822, 3)
  })

  it('computes zero EV at fair price', () => {
    // If true prob is 0.5 and offered is +100 (payout 1.0):
    // EV = 0.5 * 1.0 - 0.5 = 0
    const ev = computeEv({ trueProb: 0.5, offeredOdds: 100 })
    expect(ev).toBeCloseTo(0, 6)
  })
})
