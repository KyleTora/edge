import { describe, it, expect } from 'vitest'
import { gradeLeg, gradeParlay, type LegToGrade } from '../../src/parlay/grade.js'
import { americanToDecimal } from '../../src/parlay/odds.js'

const baseLeg: LegToGrade = {
  player_id: 'p1', prop_market: 'points', prop_line: 22.5,
  prop_side: 'over', price_american: -240,
}

describe('gradeLeg', () => {
  it('hit when over and value > line', () => {
    expect(gradeLeg(baseLeg, { points: 28 }).result).toBe('hit')
  })
  it('miss when over and value <= line (whole-number lines need special handling, but .5 is unambiguous)', () => {
    expect(gradeLeg(baseLeg, { points: 22 }).result).toBe('miss')
  })
  it('void when stat missing (player did not play)', () => {
    expect(gradeLeg(baseLeg, {}).result).toBe('void')
  })
  it('miss for under when value > line', () => {
    expect(gradeLeg({ ...baseLeg, prop_side: 'under' }, { points: 28 }).result).toBe('miss')
  })
})

describe('gradeParlay', () => {
  it('won when all legs hit', () => {
    const result = gradeParlay([
      { ...baseLeg, result: 'hit', actual_value: 28 },
      { ...baseLeg, result: 'hit', actual_value: 30, price_american: -200 },
    ], { stake: 10 })
    expect(result.parlayResult).toBe('won')
    // combined decimal: 1.4167 × 1.5 = 2.125 → payout: 10 * 1.125 = 11.25
    expect(result.pnl).toBeCloseTo(11.25, 2)
  })

  it('lost when any leg misses', () => {
    const result = gradeParlay([
      { ...baseLeg, result: 'hit', actual_value: 28 },
      { ...baseLeg, result: 'miss', actual_value: 5 },
    ], { stake: 10 })
    expect(result.parlayResult).toBe('lost')
    expect(result.pnl).toBe(-10)
  })

  it('reduces parlay when some legs void', () => {
    const result = gradeParlay([
      { ...baseLeg, result: 'hit', actual_value: 28 },
      { ...baseLeg, result: 'void', actual_value: null },
    ], { stake: 10 })
    expect(result.parlayResult).toBe('won')   // single-leg "hit" remains
    expect(result.pnl).toBeCloseTo(americanToDecimal(-240) * 10 - 10, 2)
  })

  it('void when all legs void', () => {
    const result = gradeParlay([
      { ...baseLeg, result: 'void', actual_value: null },
      { ...baseLeg, result: 'void', actual_value: null },
    ], { stake: 10 })
    expect(result.parlayResult).toBe('void')
    expect(result.pnl).toBe(0)
  })
})
