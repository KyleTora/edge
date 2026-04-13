import { describe, it, expect } from 'vitest'
import { rankCandidates } from '../../src/engine/scanner.js'
import type { MarketSnapshot } from '../../src/sources/normalize.js'
import type { Config } from '../../src/config.js'

const baseConfig: Config = {
  books: ['BetMGM', 'DraftKings', 'bet365'],
  manual_books: [],
  sharp_anchor: 'pinnacle',
  daily_picks: 5,
  sports: ['nba'],
  bankroll_units: 100,
  unit_size_cad: 25,
  closing_line_capture_minutes_before_game: 5,
}

const detectedAt = '2026-04-06T18:00:00Z'

const snap: MarketSnapshot = {
  market: 'moneyline',
  sport: 'nba',
  gameId: '12345',
  startTime: '2026-04-07T01:30:00Z',
  homeTeam: 'Denver Nuggets',
  awayTeam: 'Los Angeles Lakers',
  line: null,
  sharp: { home: -130, away: 112 },
  bookPrices: {
    BetMGM: { home: -120, away: 110 },
    DraftKings: { home: -118, away: 108 },
    bet365: { home: -108, away: 105 },
  },
}

describe('rankCandidates', () => {
  it('returns candidates sorted by score descending', () => {
    const candidates = rankCandidates({ snapshots: [snap], config: baseConfig, detectedAt })
    expect(candidates.length).toBeGreaterThan(0)
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i - 1]!.score).toBeGreaterThanOrEqual(candidates[i]!.score)
    }
  })

  it('computes score as ev_pct * sqrt(trueProb * payout)', () => {
    const candidates = rankCandidates({ snapshots: [snap], config: baseConfig, detectedAt })
    const home = candidates.find((c) => c.side === 'home')!
    expect(home.score).toBeGreaterThan(0)
    expect(home.score).toBeCloseTo(home.ev_pct * Math.sqrt(home.sharp_implied * (home.best_price > 0 ? home.best_price / 100 : 100 / -home.best_price)), 4)
  })

  it('includes all sides even with negative EV', () => {
    const candidates = rankCandidates({ snapshots: [snap], config: baseConfig, detectedAt })
    expect(candidates.find((c) => c.side === 'home')).toBeDefined()
    expect(candidates.find((c) => c.side === 'away')).toBeDefined()
  })

  it('skips games that have already started', () => {
    const liveSnap: MarketSnapshot = {
      ...snap,
      startTime: '2026-04-06T17:00:00Z',
    }
    const candidates = rankCandidates({ snapshots: [liveSnap], config: baseConfig, detectedAt })
    expect(candidates).toHaveLength(0)
  })

  it('only considers books in the allowlist for best price', () => {
    const snapWithFanduel: MarketSnapshot = {
      ...snap,
      bookPrices: {
        ...(snap as Extract<MarketSnapshot, { market: 'moneyline' }>).bookPrices,
        FanDuel: { home: 500, away: -700 },
      },
    }
    const candidates = rankCandidates({ snapshots: [snapWithFanduel], config: baseConfig, detectedAt })
    const home = candidates.find((c) => c.side === 'home')!
    expect(home.best_book).not.toBe('FanDuel')
  })

  it('handles totals market', () => {
    const totalSnap: MarketSnapshot = {
      market: 'total',
      sport: 'nba',
      gameId: '12345',
      startTime: '2026-04-07T01:30:00Z',
      homeTeam: 'Denver Nuggets',
      awayTeam: 'Los Angeles Lakers',
      line: 224.5,
      sharp: { over: -115, under: -105 },
      bookPrices: {
        BetMGM: { over: -115, under: -105 },
        DraftKings: { over: -110, under: -110 },
        bet365: { over: 100, under: -120 },
      },
    }
    const candidates = rankCandidates({ snapshots: [totalSnap], config: baseConfig, detectedAt })
    const over = candidates.find((c) => c.side === 'over')!
    expect(over).toBeDefined()
    expect(over.market).toBe('total')
    expect(over.line).toBe(224.5)
    expect(over.best_book).toBe('bet365')
  })

  it('generates deterministic pick id', () => {
    const candidates = rankCandidates({ snapshots: [snap], config: baseConfig, detectedAt })
    const home = candidates.find((c) => c.side === 'home')!
    expect(home.id).toBe('2026-04-07:nba:12345:moneyline:home')
  })

  it('ranks across multiple sports when given multiple snapshots', () => {
    const mlbSnap: MarketSnapshot = {
      ...snap,
      sport: 'mlb',
      gameId: '99999',
    }
    const candidates = rankCandidates({ snapshots: [snap, mlbSnap], config: baseConfig, detectedAt })
    const sports = new Set(candidates.map((c) => c.sport))
    expect(sports.has('nba')).toBe(true)
    expect(sports.has('mlb')).toBe(true)
  })
})
