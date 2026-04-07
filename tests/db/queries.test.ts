import { describe, it, expect, beforeEach } from 'vitest'
import { upsertPick, listPicksForDate, type PickRow } from '../../src/db/queries.js'
import { createFakeSupabase, type FakeSupabase } from '../helpers/fake-supabase.js'

function makePick(overrides: Partial<PickRow> = {}): PickRow {
  return {
    id: '2026-04-06:nba:lal-den:moneyline:home',
    detected_at: '2026-04-06T18:00:00Z',
    sport: 'nba',
    game_id: 'lal-den',
    game_date: '2026-04-06',
    game_time: '2026-04-07T01:30:00Z',
    away_team: 'Los Angeles Lakers',
    home_team: 'Denver Nuggets',
    market: 'moneyline',
    side: 'home',
    line: null,
    best_book: 'bet365',
    best_price: -108,
    sharp_book: 'pinnacle',
    sharp_implied: 0.5557,
    ev_pct: 0.05,
    all_prices: { bet365: -108, betmgm: -120 },
    ...overrides,
  }
}

describe('queries (Supabase)', () => {
  let fake: FakeSupabase

  beforeEach(() => {
    fake = createFakeSupabase()
  })

  it('upserts a pick and returns true on first insert', async () => {
    const ins = await upsertPick(fake as never, makePick())
    expect(ins).toBe(true)
    expect(fake._tables.edge_picks).toHaveLength(1)
  })

  it('returns false on duplicate id (idempotent re-detection)', async () => {
    const pick = makePick()
    await upsertPick(fake as never, pick)
    const second = await upsertPick(fake as never, { ...pick, ev_pct: 0.99 })
    expect(second).toBe(false)
    expect(fake._tables.edge_picks).toHaveLength(1)
    expect(fake._tables.edge_picks![0]!.ev_pct).toBe(0.05)
  })

  it('listPicksForDate orders by ev_pct desc', async () => {
    await upsertPick(fake as never, makePick({ id: 'a', ev_pct: 0.02 }))
    await upsertPick(fake as never, makePick({ id: 'b', ev_pct: 0.05 }))
    await upsertPick(fake as never, makePick({ id: 'c', ev_pct: 0.03 }))
    const rows = await listPicksForDate(fake as never, '2026-04-06')
    expect(rows.map((r) => r.id)).toEqual(['b', 'c', 'a'])
  })
})
