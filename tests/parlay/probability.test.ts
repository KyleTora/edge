// tests/parlay/probability.test.ts
import { describe, it, expect } from 'vitest'
import { devigTwoWay, consensusProb, computeTrueProb } from '../../src/parlay/probability.js'

describe('devigTwoWay', () => {
  it('removes vig proportionally from a balanced market', () => {
    // both sides at -110 → implied 0.5238 each, sum 1.0476
    // devigged: 0.5
    expect(devigTwoWay(-110, -110)).toBeCloseTo(0.5, 4)
  })

  it('skews probability toward favorite', () => {
    // -240 vs +180 → implied 0.7059 / 0.3571, sum 1.063
    // favorite devigged: 0.7059 / 1.063 ≈ 0.6641
    expect(devigTwoWay(-240, 180)).toBeCloseTo(0.6641, 3)
  })
})

describe('consensusProb', () => {
  it('averages devigged probabilities across multiple books', () => {
    const result = consensusProb([
      { sidePrice: -200, oppositePrice: 170 },
      { sidePrice: -220, oppositePrice: 180 },
    ])
    expect(result).toBeGreaterThan(0.6)
    expect(result).toBeLessThan(0.75)
  })

  it('returns null for empty input', () => {
    expect(consensusProb([])).toBeNull()
  })
})

describe('computeTrueProb', () => {
  it('prefers Pinnacle when available', () => {
    const result = computeTrueProb({
      pinnacle: { sidePrice: -110, oppositePrice: -110 },
      otherBooks: [{ sidePrice: -200, oppositePrice: 170 }],
    })
    expect(result.source).toBe('pinnacle')
    expect(result.prob).toBeCloseTo(0.5, 4)
  })

  it('falls back to consensus when Pinnacle absent', () => {
    const result = computeTrueProb({
      pinnacle: null,
      otherBooks: [{ sidePrice: -200, oppositePrice: 170 }],
    })
    expect(result.source).toBe('consensus')
    expect(result.prob).toBeGreaterThan(0)
  })

  it('returns null source if no data', () => {
    const result = computeTrueProb({ pinnacle: null, otherBooks: [] })
    expect(result.source).toBe('none')
    expect(result.prob).toBeNull()
  })
})
