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
    score: 0.0412,
    card_date: '2026-04-06',
    status: 'active' as const,
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

import {
  listPicksAwaitingGrade,
  upsertResult,
  insertPickGrade,
  getResultByGameId,
  type ResultRow,
  type PickGradeRow,
} from '../../src/db/queries.js'

describe('grade-related queries', () => {
  let fake: FakeSupabase

  beforeEach(() => {
    fake = createFakeSupabase()
  })

  it('upsertResult inserts a new game result', async () => {
    const r: ResultRow = {
      game_id: 'lal-den',
      sport: 'nba',
      game_date: '2026-04-07',
      home_score: 110,
      away_score: 105,
      status: 'final',
      resolved_at: '2026-04-08T05:00:00Z',
    }
    await upsertResult(fake as never, r)
    expect(fake._tables.edge_results).toHaveLength(1)
    expect(fake._tables.edge_results![0]).toMatchObject(r)
  })

  it('upsertResult overwrites a postponed-then-final progression', async () => {
    const game_id = 'nyy-bos'
    await upsertResult(fake as never, {
      game_id,
      sport: 'mlb',
      game_date: '2026-04-07',
      home_score: 0,
      away_score: 0,
      status: 'postponed',
      resolved_at: '2026-04-07T22:00:00Z',
    })
    await upsertResult(fake as never, {
      game_id,
      sport: 'mlb',
      game_date: '2026-04-08',
      home_score: 5,
      away_score: 3,
      status: 'final',
      resolved_at: '2026-04-09T05:00:00Z',
    })
    expect(fake._tables.edge_results).toHaveLength(1)
    expect(fake._tables.edge_results![0]!.status).toBe('final')
    expect(fake._tables.edge_results![0]!.home_score).toBe(5)
  })

  it('insertPickGrade writes a row', async () => {
    const g: PickGradeRow = {
      pick_id: '2026-04-07:nba:lal-den:moneyline:home',
      outcome: 'won',
      graded_at: '2026-04-08T05:00:00Z',
    }
    await insertPickGrade(fake as never, g)
    expect(fake._tables.edge_pick_grades).toEqual([g])
  })

  it('listPicksAwaitingGrade returns picks with no grade row in lookback window', async () => {
    // pick A: in window, ungraded → should be returned
    await upsertPick(fake as never, makePick({ id: 'a', game_date: '2026-04-06' }))
    // pick B: in window, already graded → should be excluded
    await upsertPick(fake as never, makePick({ id: 'b', game_date: '2026-04-06' }))
    await insertPickGrade(fake as never, { pick_id: 'b', outcome: 'won', graded_at: '2026-04-07T00:00:00Z' })
    // pick C: out of window → should be excluded
    await upsertPick(fake as never, makePick({ id: 'c', game_date: '2026-03-01' }))

    const result = await listPicksAwaitingGrade(fake as never, '2026-04-08', 3)
    const ids = result.map((p) => p.id).sort()
    expect(ids).toEqual(['a'])
  })

  it('getResultByGameId returns null when missing', async () => {
    const r = await getResultByGameId(fake as never, 'unknown')
    expect(r).toBeNull()
  })
})

import {
  listPicksAwaitingClose,
  insertClosingLine,
  type ClosingLineRow,
} from '../../src/db/queries.js'

describe('close-related queries', () => {
  let fake: FakeSupabase

  beforeEach(() => {
    fake = createFakeSupabase()
  })

  it('insertClosingLine writes a row', async () => {
    const row: ClosingLineRow = {
      pick_id: 'p1',
      closed_at: '2026-04-07T01:25:00Z',
      sharp_close: -130,
      sharp_implied: 0.555,
      best_book_close: -125,
      capture_lag_min: -5,
    }
    await insertClosingLine(fake as never, row)
    expect(fake._tables.edge_closing_lines).toEqual([row])
  })

  it('listPicksAwaitingClose returns picks whose game starts in the next windowMinutes and have no closing line', async () => {
    const now = new Date('2026-04-07T01:20:00Z')
    // pick A: starts 5 min from now → in window
    await upsertPick(fake as never, makePick({ id: 'a', game_time: '2026-04-07T01:25:00Z' }))
    // pick B: starts 30 min from now → out of 15-min window
    await upsertPick(fake as never, makePick({ id: 'b', game_time: '2026-04-07T01:50:00Z' }))
    // pick C: in window but already has closing line
    await upsertPick(fake as never, makePick({ id: 'c', game_time: '2026-04-07T01:25:00Z' }))
    await insertClosingLine(fake as never, {
      pick_id: 'c',
      closed_at: '2026-04-07T01:24:00Z',
      sharp_close: -110,
      sharp_implied: 0.5,
      best_book_close: null,
      capture_lag_min: -1,
    })

    const result = await listPicksAwaitingClose(fake as never, now, 15)
    expect(result.map((p) => p.id).sort()).toEqual(['a'])
  })
})

import {
  getPicksWithGradesInRange,
  getClosingLinesForPicks,
  type GradedPickRow,
} from '../../src/db/queries.js'

describe('record-related queries', () => {
  let fake: FakeSupabase

  beforeEach(() => {
    fake = createFakeSupabase()
  })

  it('getPicksWithGradesInRange returns picks joined to grades within window', async () => {
    await upsertPick(fake as never, makePick({ id: 'a', game_date: '2026-04-05' }))
    await upsertPick(fake as never, makePick({ id: 'b', game_date: '2026-04-07' }))
    await upsertPick(fake as never, makePick({ id: 'c', game_date: '2026-03-30' }))
    await insertPickGrade(fake as never, { pick_id: 'a', outcome: 'won', graded_at: '2026-04-06' })
    await insertPickGrade(fake as never, { pick_id: 'b', outcome: 'lost', graded_at: '2026-04-08' })

    const result = await getPicksWithGradesInRange(fake as never, '2026-04-01', '2026-04-30')
    const ids = result.map((r) => r.id).sort()
    expect(ids).toEqual(['a', 'b'])
    const a = result.find((r) => r.id === 'a')!
    expect(a.outcome).toBe('won')
  })

  it('getClosingLinesForPicks returns map keyed by pick_id', async () => {
    await insertClosingLine(fake as never, {
      pick_id: 'a',
      closed_at: '2026-04-06T01:00:00Z',
      sharp_close: -110,
      sharp_implied: 0.524,
      best_book_close: -105,
      capture_lag_min: -5,
    })
    const map = await getClosingLinesForPicks(fake as never, ['a', 'b'])
    expect(map.get('a')?.sharp_close).toBe(-110)
    expect(map.has('b')).toBe(false)
  })
})

import { getPicksGradedSince, listPicksForCardDate } from '../../src/db/queries.js'

describe('getPicksGradedSince', () => {
  let fake: FakeSupabase

  beforeEach(() => {
    fake = createFakeSupabase()
  })

  it('returns picks whose graded_at is at or after the cutoff', async () => {
    await upsertPick(fake as never, makePick({ id: 'old' }))
    await upsertPick(fake as never, makePick({ id: 'new' }))
    await insertPickGrade(fake as never, {
      pick_id: 'old',
      outcome: 'won',
      graded_at: '2026-04-07T08:00:00Z',
    })
    await insertPickGrade(fake as never, {
      pick_id: 'new',
      outcome: 'lost',
      graded_at: '2026-04-08T08:00:00Z',
    })
    const result = await getPicksGradedSince(fake as never, '2026-04-08T00:00:00Z')
    expect(result.map((p) => p.id).sort()).toEqual(['new'])
    expect(result[0]?.outcome).toBe('lost')
  })

  it('returns an empty array when nothing has been graded since cutoff', async () => {
    const result = await getPicksGradedSince(fake as never, '2026-04-08T00:00:00Z')
    expect(result).toEqual([])
  })

  it('skips orphan grade rows whose pick row no longer exists', async () => {
    await insertPickGrade(fake as never, {
      pick_id: 'orphan',
      outcome: 'won',
      graded_at: '2026-04-08T08:00:00Z',
    })
    const result = await getPicksGradedSince(fake as never, '2026-04-08T00:00:00Z')
    expect(result).toEqual([])
  })
})

describe('listPicksForCardDate', () => {
  it('excludes rows with status=swapped_off', async () => {
    const fake = createFakeSupabase()
    await fake.from('edge_picks').insert([
      { id: 'a', card_date: '2026-04-21', status: 'active', score: 0.05 },
      { id: 'b', card_date: '2026-04-21', status: 'swapped_off', score: 0.07 },
      { id: 'c', card_date: '2026-04-21', status: 'active', score: 0.03 },
    ])

    const rows = await listPicksForCardDate(fake as never, '2026-04-21')

    expect(rows.map((r) => r.id)).toEqual(['a', 'c'])
  })
})
