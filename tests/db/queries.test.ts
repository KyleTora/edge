import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { applySchema } from '../../src/db/schema.js'
import { insertPick, listPicksForDate, type PickRow } from '../../src/db/queries.js'

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
    all_prices: JSON.stringify({ bet365: -108, betmgm: -120 }),
    ...overrides,
  }
}

describe('queries', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    applySchema(db)
  })

  it('inserts a pick', () => {
    const inserted = insertPick(db, makePick())
    expect(inserted).toBe(true)
  })

  it('returns false when pick id already exists (ON CONFLICT DO NOTHING)', () => {
    const pick = makePick()
    insertPick(db, pick)
    const second = insertPick(db, { ...pick, ev_pct: 0.99 })
    expect(second).toBe(false)
    const rows = listPicksForDate(db, '2026-04-06')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.ev_pct).toBe(0.05) // original value preserved
  })

  it('lists picks for a date ordered by ev_pct desc', () => {
    insertPick(db, makePick({ id: 'a', ev_pct: 0.02 }))
    insertPick(db, makePick({ id: 'b', ev_pct: 0.05 }))
    insertPick(db, makePick({ id: 'c', ev_pct: 0.03 }))
    const rows = listPicksForDate(db, '2026-04-06')
    expect(rows.map((r) => r.id)).toEqual(['b', 'c', 'a'])
  })
})
