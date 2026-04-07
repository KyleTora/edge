import { describe, it, expect } from 'vitest'
import { americanToImpliedProb, devigTwoWay } from '../../src/engine/devig.js'

describe('americanToImpliedProb', () => {
  it('converts negative odds (favorite)', () => {
    // -130 → 130/(130+100) = 0.5652
    expect(americanToImpliedProb(-130)).toBeCloseTo(0.5652, 4)
  })

  it('converts positive odds (underdog)', () => {
    // +112 → 100/(100+112) = 0.4717
    expect(americanToImpliedProb(112)).toBeCloseTo(0.4717, 4)
  })

  it('handles even money (-100 / +100)', () => {
    expect(americanToImpliedProb(-100)).toBeCloseTo(0.5, 4)
    expect(americanToImpliedProb(100)).toBeCloseTo(0.5, 4)
  })
})

describe('devigTwoWay (multiplicative)', () => {
  it('strips vig from a balanced market', () => {
    // -110 / -110: each 0.5238, sum 1.0476, devigged each = 0.5
    const result = devigTwoWay(-110, -110)
    expect(result.home).toBeCloseTo(0.5, 4)
    expect(result.away).toBeCloseTo(0.5, 4)
  })

  it('strips vig from an asymmetric market', () => {
    // Pinnacle -130 / +112
    // Implied: 0.5652 + 0.4717 = 1.0369
    // Devigged: 0.5452 / 0.4548
    const result = devigTwoWay(-130, 112)
    expect(result.home).toBeCloseTo(0.5452, 3)
    expect(result.away).toBeCloseTo(0.4548, 3)
    expect(result.home + result.away).toBeCloseTo(1.0, 6)
  })

  it('returns probabilities that sum to exactly 1', () => {
    const result = devigTwoWay(-150, 130)
    expect(result.home + result.away).toBeCloseTo(1.0, 10)
  })
})
