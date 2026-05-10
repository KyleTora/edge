// tests/integration/scan-dry-run.test.ts
// This is an integration smoke test for the scan command's pure-logic path:
// inputs are stubbed at the source layer; no DB or email side-effects.
import { describe, it, expect } from 'vitest'
import { propMarketsToCandidates } from '../../src/parlay/candidates.js'
import { buildParlay } from '../../src/parlay/builder.js'
import type { PropMarket } from '../../src/sources/action-network-props.js'

// Fixture: Pinnacle lines give ~0.75 true probability for each "over".
// Book prices (+40) are more generous than Pinnacle implies → positive EV legs.
// Combined decimal: 1.4 × 1.4 = 1.96 → american ≈ -104, within odds_tolerance [-110, 130].
const sample: PropMarket[] = [
  {
    game_id: 'g1', sport: 'nba', player_id: '1', player_name: 'A',
    prop_market: 'points', prop_line: 22.5,
    over: {
      pinnacle: { sidePrice: -380, oppositePrice: 290 },
      books: [{ book: 'draftkings', price: 40, oppositePrice: -60 }],
    },
    under: {
      pinnacle: { sidePrice: 290, oppositePrice: -380 },
      books: [{ book: 'draftkings', price: -60, oppositePrice: 40 }],
    },
  },
  {
    game_id: 'g2', sport: 'mlb', player_id: '2', player_name: 'B',
    prop_market: 'hits', prop_line: 0.5,
    over: {
      pinnacle: { sidePrice: -380, oppositePrice: 290 },
      books: [{ book: 'betmgm', price: 40, oppositePrice: -60 }],
    },
    under: {
      pinnacle: { sidePrice: 290, oppositePrice: -380 },
      books: [{ book: 'betmgm', price: -60, oppositePrice: 40 }],
    },
  },
]

describe('scan dry-run pipeline (smoke)', () => {
  it('builds a 2-leg parlay end-to-end through builder', () => {
    const candidates = propMarketsToCandidates(sample, { allowedBooks: ['draftkings', 'betmgm'] })
    const built = buildParlay(candidates, {
      target_odds: 100, odds_tolerance: [-110, 130],
      min_legs: 2, max_legs: 3,
      min_leg_prob: 0.65, max_leg_prob: 0.85, filler_min_prob: 0.75,
    })
    expect(built).not.toBeNull()
    expect(built!.legs.length).toBeGreaterThanOrEqual(2)
    expect(built!.combined_odds).toBeGreaterThanOrEqual(-110)
    expect(built!.combined_odds).toBeLessThanOrEqual(130)
  })
})
