// tests/parlay/builder.test.ts
import { describe, it, expect } from 'vitest'
import { buildParlay, type LegCandidate } from '../../src/parlay/builder.js'

const cfg = {
  target_odds: 100,
  odds_tolerance: [-110, 130] as [number, number],
  min_legs: 2,
  max_legs: 3,
  min_leg_prob: 0.70,
  max_leg_prob: 0.85,
  filler_min_prob: 0.75,
}

function leg(over: Partial<LegCandidate>): LegCandidate {
  return {
    id: 'x',
    game_id: 'g1',
    sport: 'nba',
    player_id: 'p',
    player_name: 'P',
    prop_market: 'points',
    prop_line: 10.5,
    prop_side: 'over',
    book: 'draftkings',
    price_american: -240,
    true_prob: 0.72,
    is_filler_eligible: false,
    ...over,
  }
}

describe('buildParlay', () => {
  it('returns null when fewer than 2 candidates qualify', () => {
    const result = buildParlay([leg({ id: 'a', game_id: 'g1' })], cfg)
    expect(result).toBeNull()
  })

  it('builds a 2-leg parlay near +100 from two -240 legs', () => {
    const result = buildParlay(
      [
        leg({ id: 'a', game_id: 'g1', price_american: -240, true_prob: 0.72 }),
        leg({ id: 'b', game_id: 'g2', price_american: -240, true_prob: 0.72 }),
      ],
      cfg,
    )
    expect(result).not.toBeNull()
    expect(result!.legs.length).toBe(2)
    // -240 × -240 → 1.4167 × 1.4167 = 2.007 → ~ +100
    expect(result!.combined_odds).toBeGreaterThanOrEqual(95)
    expect(result!.combined_odds).toBeLessThanOrEqual(105)
  })

  it('rejects same-game combos (max 1 leg per game)', () => {
    const result = buildParlay(
      [
        leg({ id: 'a', game_id: 'g1', price_american: -240, true_prob: 0.72 }),
        leg({ id: 'b', game_id: 'g1', price_american: -240, true_prob: 0.72 }),
      ],
      cfg,
    )
    expect(result).toBeNull()
  })

  it('prefers combos with more +EV legs over filler', () => {
    // two +EV legs and one filler: builder should pick the +EV pair
    const evA = leg({ id: 'a', game_id: 'g1', price_american: -200, true_prob: 0.72, is_filler_eligible: false })
    const evB = leg({ id: 'b', game_id: 'g2', price_american: -200, true_prob: 0.72, is_filler_eligible: false })
    const fill = leg({ id: 'f', game_id: 'g3', price_american: -240, true_prob: 0.78, is_filler_eligible: true })
    const result = buildParlay([evA, evB, fill], cfg)
    expect(result).not.toBeNull()
    const ids = result!.legs.map((l) => l.id).sort()
    expect(ids).toEqual(['a', 'b'])
  })

  it('falls back to filler when not enough +EV legs', () => {
    const fill1 = leg({ id: 'f1', game_id: 'g1', price_american: -240, true_prob: 0.78, is_filler_eligible: true })
    const fill2 = leg({ id: 'f2', game_id: 'g2', price_american: -240, true_prob: 0.78, is_filler_eligible: true })
    const result = buildParlay([fill1, fill2], cfg)
    expect(result).not.toBeNull()
    expect(result!.legs.length).toBe(2)
  })

  it('drops candidates outside the prob band', () => {
    const tooLow = leg({ id: 'a', game_id: 'g1', true_prob: 0.5 })
    const tooHigh = leg({ id: 'b', game_id: 'g2', true_prob: 0.95 })
    const ok1 = leg({ id: 'c', game_id: 'g3', price_american: -240, true_prob: 0.72 })
    const ok2 = leg({ id: 'd', game_id: 'g4', price_american: -240, true_prob: 0.72 })
    const result = buildParlay([tooLow, tooHigh, ok1, ok2], cfg)
    expect(result).not.toBeNull()
    const ids = result!.legs.map((l) => l.id).sort()
    expect(ids).toEqual(['c', 'd'])
  })
})
