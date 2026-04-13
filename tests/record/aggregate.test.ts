import { describe, it, expect } from 'vitest'
import { aggregateMetrics, type RecordMetrics } from '../../src/record/aggregate.js'
import type { GradedPickRow, ClosingLineRow } from '../../src/db/queries.js'

function pick(overrides: Partial<GradedPickRow> = {}): GradedPickRow {
  return {
    id: 'p',
    detected_at: '2026-04-06T18:00:00Z',
    sport: 'nba',
    game_id: 'g',
    game_date: '2026-04-06',
    game_time: '2026-04-07T01:30:00Z',
    away_team: 'A',
    home_team: 'B',
    market: 'moneyline',
    side: 'home',
    line: null,
    best_book: 'betmgm',
    best_price: -110,
    sharp_book: 'pinnacle',
    sharp_implied: 0.5,
    ev_pct: 0.03,
    all_prices: { betmgm: -110 },
    score: 0.0275,
    card_date: '2026-04-06',
    outcome: 'won',
    graded_at: '2026-04-08T00:00:00Z',
    ...overrides,
  }
}

function close(pickId: string, sharpImplied: number, lag = -5, sharpClose = -110): ClosingLineRow {
  return {
    pick_id: pickId,
    closed_at: '2026-04-07T01:25:00Z',
    sharp_close: sharpClose,
    sharp_implied: sharpImplied,
    best_book_close: null,
    capture_lag_min: lag,
  }
}

describe('aggregateMetrics', () => {
  it('returns empty metrics when no picks', () => {
    const m = aggregateMetrics({ picks: [], closingLines: new Map() })
    expect(m.picks).toBe(0)
    expect(m.hitRate).toBeNull()
    expect(m.clvAvg).toBeNull()
  })

  it('counts W/L/Push/Void and excludes voids from W/L denominators', () => {
    const picks = [
      pick({ id: 'a', outcome: 'won', best_price: -110 }),
      pick({ id: 'b', outcome: 'lost', best_price: -110 }),
      pick({ id: 'c', outcome: 'push', best_price: -110 }),
      pick({ id: 'd', outcome: 'void', best_price: -110 }),
    ]
    const m = aggregateMetrics({ picks, closingLines: new Map() })
    // void is excluded from picks count
    expect(m.picks).toBe(3)
    expect(m.won).toBe(1)
    expect(m.lost).toBe(1)
    expect(m.push).toBe(1)
    expect(m.void).toBe(1)
    expect(m.hitRate).toBeCloseTo(0.5, 4) // 1/(1+1)
  })

  it('computes ROI and units +/-', () => {
    const picks = [
      pick({ id: 'a', outcome: 'won', best_price: -110 }), // +0.909u
      pick({ id: 'b', outcome: 'lost', best_price: -110 }), // -1u
      pick({ id: 'c', outcome: 'won', best_price: 120 }), // +1.2u
    ]
    const m = aggregateMetrics({ picks, closingLines: new Map() })
    expect(m.units).toBeCloseTo(0.909 + -1 + 1.2, 3)
    // ROI = units / staked. Staked = 3 (1u flat each).
    expect(m.roi).toBeCloseTo((0.909 + -1 + 1.2) / 3, 3)
  })

  it('computes CLV avg and beat rate; excludes picks with no closing line', () => {
    const picks = [
      pick({ id: 'a', sharp_implied: 0.5 }),
      pick({ id: 'b', sharp_implied: 0.5 }),
      pick({ id: 'c', sharp_implied: 0.5 }),
    ]
    const closes = new Map<string, ClosingLineRow>([
      ['a', close('a', 0.55)], // CLV = +0.05
      ['b', close('b', 0.45)], // CLV = -0.05
      // c has no closing line
    ])
    const m = aggregateMetrics({ picks, closingLines: closes })
    expect(m.clvAvg).toBeCloseTo(0, 4) // (0.05 + -0.05) / 2
    expect(m.clvBeatRate).toBeCloseTo(0.5, 4) // 1 of 2 beat
    expect(m.picksWithCLV).toBe(2)
    expect(m.capturedClosesPct).toBeCloseTo(2 / 3, 4)
  })

  it('flags approximate-CLV picks (capture_lag_min > 5)', () => {
    const picks = [pick({ id: 'a' })]
    const closes = new Map<string, ClosingLineRow>([['a', close('a', 0.55, 12)]])
    const m = aggregateMetrics({ picks, closingLines: closes })
    expect(m.approximateCLV).toBe(1)
  })

  it('breaks down by sport', () => {
    const picks = [
      pick({ id: 'a', sport: 'nba', outcome: 'won', best_price: -110 }),
      pick({ id: 'b', sport: 'mlb', outcome: 'lost' }),
    ]
    const m = aggregateMetrics({ picks, closingLines: new Map() })
    const nba = m.bySport.find((s) => s.sport === 'nba')!
    const mlb = m.bySport.find((s) => s.sport === 'mlb')!
    expect(nba.picks).toBe(1)
    expect(nba.won).toBe(1)
    expect(mlb.picks).toBe(1)
    expect(mlb.lost).toBe(1)
    // ROI = units / picks (1 pick each, flat stake)
    expect(nba.roi).toBeCloseTo(100 / 110, 5) // won at -110
    expect(mlb.roi).toBeCloseTo(-1, 5) // lost
  })
})
