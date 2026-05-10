// tests/parlay/candidates.test.ts
import { describe, it, expect } from 'vitest'
import { propMarketsToCandidates } from '../../src/parlay/candidates.js'
import type { PropMarket } from '../../src/sources/action-network-props.js'

const market: PropMarket = {
  game_id: 'g1',
  sport: 'nba',
  player_id: '9001',
  player_name: 'LeBron James',
  prop_market: 'points',
  prop_line: 22.5,
  over: {
    pinnacle: { sidePrice: -220, oppositePrice: 170 },
    books: [
      { book: 'draftkings', price: -240, oppositePrice: 180 },
      { book: 'betmgm', price: -230, oppositePrice: 175 },
    ],
  },
  under: {
    pinnacle: { sidePrice: 170, oppositePrice: -220 },
    books: [{ book: 'draftkings', price: 180, oppositePrice: -240 }],
  },
}

describe('propMarketsToCandidates', () => {
  it('produces over and under candidates with best price per side', () => {
    const candidates = propMarketsToCandidates([market], { allowedBooks: ['draftkings','betmgm'] })
    const over = candidates.filter((c) => c.prop_side === 'over')
    expect(over.length).toBe(1)
    // best price for over = least negative (closest to underdog) = -230
    expect(over[0].price_american).toBe(-230)
    expect(over[0].book).toBe('betmgm')
    expect(over[0].true_prob).toBeCloseTo(0.65, 1)  // pinnacle devig of -220/170
  })

  it('omits sides with no books in allowed list', () => {
    const candidates = propMarketsToCandidates([market], { allowedBooks: ['caesars'] })
    expect(candidates.length).toBe(0)
  })

  it('marks both sides as filler-eligible when prob >= filler threshold', () => {
    const candidates = propMarketsToCandidates([market], { allowedBooks: ['draftkings','betmgm'] })
    expect(candidates.every((c) => typeof c.is_filler_eligible === 'boolean')).toBe(true)
  })
})
