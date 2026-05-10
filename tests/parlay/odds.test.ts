// tests/parlay/odds.test.ts
import { describe, it, expect } from 'vitest'
import {
  americanToDecimal,
  decimalToAmerican,
  americanToImplied,
  impliedToAmerican,
  combineDecimals,
  evPercent,
} from '../../src/parlay/odds.js'

describe('americanToDecimal', () => {
  it('converts +100 to 2.0', () => expect(americanToDecimal(100)).toBeCloseTo(2.0, 5))
  it('converts -200 to 1.5', () => expect(americanToDecimal(-200)).toBeCloseTo(1.5, 5))
  it('converts +250 to 3.5', () => expect(americanToDecimal(250)).toBeCloseTo(3.5, 5))
})

describe('decimalToAmerican', () => {
  it('converts 2.0 to +100', () => expect(decimalToAmerican(2.0)).toBe(100))
  it('converts 1.5 to -200', () => expect(decimalToAmerican(1.5)).toBe(-200))
  it('rounds to integer americans', () => expect(decimalToAmerican(2.05)).toBe(105))
})

describe('americanToImplied', () => {
  it('converts +100 to 0.5', () => expect(americanToImplied(100)).toBeCloseTo(0.5, 5))
  it('converts -200 to 0.6667', () => expect(americanToImplied(-200)).toBeCloseTo(2/3, 5))
})

describe('impliedToAmerican', () => {
  it('round-trips +150', () =>
    expect(impliedToAmerican(americanToImplied(150))).toBe(150))
  it('round-trips -240', () =>
    expect(impliedToAmerican(americanToImplied(-240))).toBe(-240))
})

describe('combineDecimals', () => {
  it('multiplies decimal odds', () => {
    expect(combineDecimals([1.91, 1.91])).toBeCloseTo(3.6481, 4)
  })
  it('handles 3 legs', () => {
    expect(combineDecimals([1.5, 1.5, 1.5])).toBeCloseTo(3.375, 4)
  })
})

describe('evPercent', () => {
  it('positive when true prob > implied', () => {
    expect(evPercent(0.55, 100)).toBeCloseTo(0.10, 5)  // 0.55*2 - 1 = 0.10
  })
  it('zero at exactly fair', () => {
    expect(evPercent(0.5, 100)).toBeCloseTo(0, 5)
  })
  it('negative when overpriced', () => {
    expect(evPercent(0.5, -200)).toBeCloseTo(-0.25, 5)  // 0.5*1.5 - 1 = -0.25
  })
})
