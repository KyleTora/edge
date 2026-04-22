import { describe, it, expect, beforeEach, vi } from 'vitest'
import { captureClosingLines } from '../../src/resolve/close.js'
import { createFakeSupabase, type FakeSupabase } from '../helpers/fake-supabase.js'
import { upsertPick, type PickRow } from '../../src/db/queries.js'
import type { Config, Env } from '../../src/config.js'
import type { PinnacleGame } from '../../src/sources/odds-api.js'
import type { ActionNetworkOdds } from '../../src/sources/action-network.js'

const config: Config = {
  books: ['betmgm', 'draftkings'],
  manual_books: [],
  sharp_anchor: 'pinnacle',
  daily_picks: 5,
  sports: ['nba'],
  bankroll_units: 100,
  unit_size_cad: 25,
  closing_line_capture_minutes_before_game: 5,
}

const env: Env = {
  ODDS_API_KEY: 'test',
  SUPABASE_URL: 'http://localhost',
  SUPABASE_SERVICE_ROLE_KEY: 'test',
}

function makePick(overrides: Partial<PickRow> = {}): PickRow {
  return {
    id: 'p1',
    detected_at: '2026-04-07T00:00:00Z',
    sport: 'nba',
    game_id: 'g1',
    game_date: '2026-04-07',
    game_time: '2026-04-07T01:30:00Z',
    away_team: 'Los Angeles Lakers',
    home_team: 'Denver Nuggets',
    market: 'moneyline',
    side: 'home',
    line: null,
    best_book: 'betmgm',
    best_price: -108,
    sharp_book: 'pinnacle',
    sharp_implied: 0.5,
    ev_pct: 0.05,
    all_prices: { betmgm: -108 },
    score: 0.0412,
    card_date: '2026-04-07',
    status: 'active' as const,
    ...overrides,
  }
}

function makePinnacleGame(overrides: Partial<PinnacleGame> = {}): PinnacleGame {
  return {
    oddsApiId: 'pin-1',
    startTime: '2026-04-07T01:30:00Z',
    homeTeam: 'Denver Nuggets',
    awayTeam: 'Los Angeles Lakers',
    mlHome: -130,
    mlAway: +110,
    totalLine: 225.5,
    over: -108,
    under: -112,
    ...overrides,
  }
}

function makeAnGame(overrides: Partial<ActionNetworkOdds> = {}): ActionNetworkOdds {
  return {
    gameId: 'an:1',
    startTime: '2026-04-07T01:30:00Z',
    homeTeam: 'Denver Nuggets',
    awayTeam: 'Los Angeles Lakers',
    books: [
      {
        bookId: 68,
        bookName: 'BetMGM',
        mlHome: -125,
        mlAway: +105,
        total: 225.5,
        over: -110,
        under: -110,
      },
      {
        bookId: 15,
        bookName: 'DraftKings',
        mlHome: -128,
        mlAway: +108,
        total: 225.5,
        over: -110,
        under: -110,
      },
    ],
    ...overrides,
  }
}

describe('captureClosingLines', () => {
  let fake: FakeSupabase

  beforeEach(() => {
    fake = createFakeSupabase()
  })

  it('returns 0 captures when no picks are in the window', async () => {
    const summary = await captureClosingLines({
      supabase: fake as never,
      config,
      env,
      now: new Date('2026-04-07T01:30:00Z'),
      windowMinutes: 15,
      fetchPinnacle: vi.fn(),
      fetchActionNetwork: vi.fn(),
    })
    expect(summary.captured).toBe(0)
    expect(summary.gamesProcessed).toBe(0)
  })

  it('captures a closing line for a moneyline pick whose game starts in 5 min', async () => {
    await upsertPick(fake as never, makePick())
    const fetchPinnacle = vi.fn().mockResolvedValue([makePinnacleGame()])
    const fetchActionNetwork = vi.fn().mockResolvedValue([makeAnGame()])

    const summary = await captureClosingLines({
      supabase: fake as never,
      config,
      env,
      now: new Date('2026-04-07T01:25:00Z'),
      windowMinutes: 15,
      fetchPinnacle,
      fetchActionNetwork,
    })

    expect(summary.captured).toBe(1)
    expect(summary.gamesProcessed).toBe(1)
    expect(fake._tables.edge_closing_lines).toHaveLength(1)
    const row = fake._tables.edge_closing_lines![0]!
    expect(row.pick_id).toBe('p1')
    // sharp_close = pinnacle home ML
    expect(row.sharp_close).toBe(-130)
    // best book = highest American odds among allowed books for home: -125 (BetMGM) vs -128 (DraftKings) → -125
    expect(row.best_book_close).toBe(-125)
    // capture_lag = (01:25 - 01:30) / 60s = -5 (pre-game)
    expect(row.capture_lag_min).toBe(-5)
    // sharp_implied: devig(-130, +110). homeImp=130/230=0.5652, awayImp=100/210=0.4762, sum=1.0414, home/sum≈0.5428
    expect(row.sharp_implied as number).toBeCloseTo(0.5428, 3)
  })

  it('writes best_book_close=null when no allowed book has a quote', async () => {
    await upsertPick(fake as never, makePick())
    const fetchPinnacle = vi.fn().mockResolvedValue([makePinnacleGame()])
    // Only an unallowed book present
    const fetchActionNetwork = vi.fn().mockResolvedValue([
      makeAnGame({
        books: [
          {
            bookId: 69,
            bookName: 'Caesars',
            mlHome: -125,
            mlAway: +105,
            total: 225.5,
            over: -110,
            under: -110,
          },
        ],
      }),
    ])

    const summary = await captureClosingLines({
      supabase: fake as never,
      config,
      env,
      now: new Date('2026-04-07T01:25:00Z'),
      windowMinutes: 15,
      fetchPinnacle,
      fetchActionNetwork,
    })

    expect(summary.captured).toBe(1)
    const row = fake._tables.edge_closing_lines![0]!
    expect(row.best_book_close).toBeNull()
    expect(row.sharp_close).toBe(-130)
  })

  it('captures a totals pick using over/under prices', async () => {
    await upsertPick(
      fake as never,
      makePick({ id: 'p2', market: 'total', side: 'over', line: 225.5 })
    )
    const fetchPinnacle = vi.fn().mockResolvedValue([makePinnacleGame()])
    const fetchActionNetwork = vi.fn().mockResolvedValue([makeAnGame()])

    const summary = await captureClosingLines({
      supabase: fake as never,
      config,
      env,
      now: new Date('2026-04-07T01:25:00Z'),
      windowMinutes: 15,
      fetchPinnacle,
      fetchActionNetwork,
    })

    expect(summary.captured).toBe(1)
    const row = fake._tables.edge_closing_lines![0]!
    expect(row.sharp_close).toBe(-108) // pinnacle over
    expect(row.best_book_close).toBe(-110) // both books -110
  })

  it('skips picks with no matching pinnacle game', async () => {
    await upsertPick(fake as never, makePick())
    const fetchPinnacle = vi.fn().mockResolvedValue([
      makePinnacleGame({ homeTeam: 'Boston Celtics', awayTeam: 'New York Knicks' }),
    ])
    const fetchActionNetwork = vi.fn().mockResolvedValue([makeAnGame()])

    const summary = await captureClosingLines({
      supabase: fake as never,
      config,
      env,
      now: new Date('2026-04-07T01:25:00Z'),
      windowMinutes: 15,
      fetchPinnacle,
      fetchActionNetwork,
    })

    expect(summary.captured).toBe(0)
    expect(fake._tables.edge_closing_lines ?? []).toHaveLength(0)
  })
})
