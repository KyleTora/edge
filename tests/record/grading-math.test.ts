import { describe, it, expect } from 'vitest'
import {
  americanToPayout,
  unitProfit,
  americanToImplied,
  clv,
} from '../../src/record/grading-math.js'

describe('americanToPayout', () => {
  it('-110 → 0.9090...', () => {
    expect(americanToPayout(-110)).toBeCloseTo(100 / 110, 5)
  })
  it('+150 → 1.5', () => {
    expect(americanToPayout(150)).toBeCloseTo(1.5, 5)
  })
})

describe('unitProfit', () => {
  it('won at -110 → +0.9091', () => {
    expect(unitProfit('won', -110)).toBeCloseTo(0.909, 3)
  })
  it('won at +120 → +1.20', () => {
    expect(unitProfit('won', 120)).toBeCloseTo(1.2, 3)
  })
  it('lost → -1', () => {
    expect(unitProfit('lost', -110)).toBe(-1)
  })
  it('push → 0', () => {
    expect(unitProfit('push', -110)).toBe(0)
  })
  it('void → 0', () => {
    expect(unitProfit('void', -110)).toBe(0)
  })
})

describe('americanToImplied', () => {
  it('-110 → 0.5238', () => {
    expect(americanToImplied(-110)).toBeCloseTo(110 / 210, 4)
  })
  it('+100 → 0.5', () => {
    expect(americanToImplied(100)).toBeCloseTo(0.5, 4)
  })
})

describe('clv', () => {
  it('positive when detected price beats close', () => {
    // detected at +120 → 0.4545 implied; close at -110 → 0.5238 implied
    // CLV = closing - detected = +0.0693 (line moved against the close, in our favor)
    expect(clv(0.4545, 0.5238)).toBeCloseTo(0.0693, 4)
  })
  it('negative when close beat us', () => {
    expect(clv(0.55, 0.50)).toBeCloseTo(-0.05, 4)
  })
})
