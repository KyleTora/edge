import { describe, it, expect } from 'vitest'
import { scan } from '../../src/engine/scanner.js'
import type { MarketSnapshot } from '../../src/sources/normalize.js'
import type { Config } from '../../src/config.js'

const baseConfig: Config = {
  books: ['BetMGM', 'DraftKings', 'bet365'],
  manual_books: [],
  sharp_anchor: 'pinnacle',
  ev_threshold: 0.02,
  max_sharp_implied_prob: 0.75,
  sports: ['nba'],
  bankroll_units: 100,
  unit_size_cad: 25,
  watch_interval_minutes: 10,
  closing_line_capture_minutes_before_game: 5,
  stale_sharp_max_age_minutes: 60,
}

const snap: MarketSnapshot = {
  market: 'moneyline',
  sport: 'nba',
  gameId: '12345',
  startTime: '2026-04-07T01:30:00Z',
  homeTeam: 'Denver Nuggets',
  awayTeam: 'Los Angeles Lakers',
  line: null,
  // Pinnacle -130 / +112 → devigged DEN ~0.5452, LAL ~0.4548
  sharp: { home: -130, away: 112 },
  bookPrices: {
    BetMGM: { home: -120, away: 110 },
    DraftKings: { home: -118, away: 108 },
    bet365: { home: -108, away: 105 }, // best home (lowest juice)
  },
}

describe('scan', () => {
  const detectedAt = '2026-04-06T18:00:00Z'

  it('produces a pick when EV exceeds threshold', () => {
    const picks = scan({ snapshots: [snap], config: baseConfig, detectedAt })
    const denPick = picks.find((p) => p.side === 'home')
    expect(denPick).toBeDefined()
    expect(denPick!.best_book).toBe('bet365')
    expect(denPick!.best_price).toBe(-108)
    expect(denPick!.ev_pct).toBeCloseTo(0.05, 2)
  })

  it('skips picks below ev_threshold', () => {
    const tighter = { ...baseConfig, ev_threshold: 0.10 }
    const picks = scan({ snapshots: [snap], config: tighter, detectedAt })
    expect(picks).toHaveLength(0)
  })

  it('skips picks where sharp implied prob exceeds chalk cap', () => {
    const heavyChalk: MarketSnapshot = {
      ...snap,
      sharp: { home: -500, away: 380 }, // home ~0.83 implied
    }
    const picks = scan({ snapshots: [heavyChalk], config: baseConfig, detectedAt })
    const homePick = picks.find((p) => p.side === 'home')
    expect(homePick).toBeUndefined()
  })

  it('only considers books in the allowlist', () => {
    const snapWithFanduel: MarketSnapshot = {
      ...snap,
      bookPrices: {
        ...(snap as Extract<MarketSnapshot, { market: 'moneyline' }>).bookPrices,
        FanDuel: { home: 500, away: -700 }, // would be best home if allowed
      },
    }
    const picks = scan({ snapshots: [snapWithFanduel], config: baseConfig, detectedAt })
    const denPick = picks.find((p) => p.side === 'home')
    expect(denPick!.best_book).not.toBe('FanDuel')
  })

  it('generates deterministic pick id', () => {
    const picks = scan({ snapshots: [snap], config: baseConfig, detectedAt })
    const denPick = picks.find((p) => p.side === 'home')!
    expect(denPick.id).toBe('2026-04-07:nba:12345:moneyline:home')
  })

  it('serializes all_prices as JSON', () => {
    const picks = scan({ snapshots: [snap], config: baseConfig, detectedAt })
    const denPick = picks.find((p) => p.side === 'home')!
    const parsed = JSON.parse(denPick.all_prices)
    expect(parsed.bet365).toBe(-108)
    expect(parsed.BetMGM).toBe(-120)
  })

  it('handles totals market correctly', () => {
    const totalSnap: MarketSnapshot = {
      market: 'total',
      sport: 'nba',
      gameId: '12345',
      startTime: '2026-04-07T01:30:00Z',
      homeTeam: 'Denver Nuggets',
      awayTeam: 'Los Angeles Lakers',
      line: 224.5,
      // Pinnacle Over -115 / Under -105 → devigged Over ~0.5108, Under ~0.4892
      sharp: { over: -115, under: -105 },
      bookPrices: {
        BetMGM: { over: -115, under: -105 },
        DraftKings: { over: -110, under: -110 },
        bet365: { over: 100, under: -120 }, // Over +100 → best Over
      },
    }
    const picks = scan({ snapshots: [totalSnap], config: baseConfig, detectedAt })
    const overPick = picks.find((p) => p.side === 'over')
    expect(overPick).toBeDefined()
    expect(overPick!.market).toBe('total')
    expect(overPick!.line).toBe(224.5)
    expect(overPick!.best_book).toBe('bet365')
    expect(overPick!.best_price).toBe(100)
    expect(overPick!.id).toBe('2026-04-07:nba:12345:total:over')
  })
})
