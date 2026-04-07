import { describe, it, expect } from 'vitest'
import {
  joinSources,
  type MarketSnapshot,
} from '../../src/sources/normalize.js'
import type { ActionNetworkOdds } from '../../src/sources/action-network.js'
import type { OddsApiGameData } from '../../src/sources/odds-api.js'

const an: ActionNetworkOdds[] = [
  {
    gameId: '12345',
    startTime: '2026-04-07T01:30:00Z',
    homeTeam: 'Denver Nuggets',
    awayTeam: 'Los Angeles Lakers',
    books: [
      {
        bookId: 68,
        bookName: 'BetMGM',
        mlHome: -120,
        mlAway: 110,
        total: 224.5,
        over: -110,
        under: -110,
      },
      {
        bookId: 15,
        bookName: 'DraftKings',
        mlHome: -118,
        mlAway: 108,
        total: 224.5,
        over: -108,
        under: -112,
      },
    ],
  },
]

const pinnacle: OddsApiGameData[] = [
  {
    oddsApiId: 'abc123',
    startTime: '2026-04-07T01:30:00Z',
    homeTeam: 'Denver Nuggets',
    awayTeam: 'Los Angeles Lakers',
    mlHome: -130,
    mlAway: 112,
    totalLine: 224.5,
    over: -108,
    under: -112,
  },
]

describe('joinSources', () => {
  it('produces moneyline snapshots with sharp + book prices', () => {
    const snapshots = joinSources({ sport: 'nba', actionNetwork: an, pinnacle })
    const ml = snapshots.filter((s) => s.market === 'moneyline')
    expect(ml).toHaveLength(1)
    const game = ml[0]!
    if (game.market !== 'moneyline') throw new Error('expected moneyline')
    expect(game.sharp.home).toBe(-130)
    expect(game.sharp.away).toBe(112)
    expect(game.bookPrices.BetMGM).toEqual({ home: -120, away: 110 })
    expect(game.bookPrices.DraftKings).toEqual({ home: -118, away: 108 })
  })

  it('produces total snapshots with line + over/under', () => {
    const snapshots = joinSources({ sport: 'nba', actionNetwork: an, pinnacle })
    const tot = snapshots.filter((s) => s.market === 'total')
    expect(tot).toHaveLength(1)
    const game = tot[0]!
    if (game.market !== 'total') throw new Error('expected total')
    expect(game.line).toBe(224.5)
    expect(game.sharp.over).toBe(-108)
    expect(game.sharp.under).toBe(-112)
  })

  it('skips games with no matching Pinnacle entry', () => {
    const snapshots = joinSources({ sport: 'nba', actionNetwork: an, pinnacle: [] })
    expect(snapshots).toEqual([])
  })

  it('matches by team names case-insensitively', () => {
    const altPinnacle: OddsApiGameData[] = [
      { ...pinnacle[0]!, homeTeam: 'denver nuggets', awayTeam: 'LOS ANGELES LAKERS' },
    ]
    const snapshots = joinSources({ sport: 'nba', actionNetwork: an, pinnacle: altPinnacle })
    expect(snapshots.length).toBeGreaterThan(0)
  })
})
