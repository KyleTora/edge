import { describe, it, expect, beforeEach } from 'vitest'
import { runRecord } from '../../src/commands/record.js'
import { createFakeSupabase, type FakeSupabase } from '../helpers/fake-supabase.js'
import { upsertPick, insertPickGrade, insertClosingLine } from '../../src/db/queries.js'

function makePick(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    detected_at: '2026-04-06T18:00:00Z',
    sport: 'nba',
    game_id: id,
    game_date: '2026-04-06',
    game_time: '2026-04-07T01:30:00Z',
    away_team: 'A',
    home_team: 'B',
    market: 'moneyline' as const,
    side: 'home' as const,
    line: null,
    best_book: 'betmgm',
    best_price: -110,
    sharp_book: 'pinnacle',
    sharp_implied: 0.5,
    ev_pct: 0.03,
    all_prices: { betmgm: -110 },
    score: 0.0275,
    card_date: '2026-04-06',
    ...overrides,
  }
}

describe('runRecord', () => {
  let fake: FakeSupabase

  beforeEach(() => {
    fake = createFakeSupabase()
  })

  it('returns empty metrics when no graded picks', async () => {
    const result = await runRecord({ supabase: fake as never, since: '2026-04-01', until: '2026-04-30' })
    expect(result.metrics.picks).toBe(0)
  })

  it('aggregates a single graded pick with closing line', async () => {
    await upsertPick(fake as never, makePick('a'))
    await insertPickGrade(fake as never, { pick_id: 'a', outcome: 'won', graded_at: '2026-04-08T00:00:00Z' })
    await insertClosingLine(fake as never, {
      pick_id: 'a',
      closed_at: '2026-04-07T01:25:00Z',
      sharp_close: -120,
      sharp_implied: 0.545,
      best_book_close: -115,
      capture_lag_min: -5,
    })
    const result = await runRecord({ supabase: fake as never, since: '2026-04-01', until: '2026-04-30' })
    expect(result.metrics.picks).toBe(1)
    expect(result.metrics.won).toBe(1)
    expect(result.metrics.clvAvg).toBeCloseTo(0.045, 3)
  })
})
