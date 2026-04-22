import { describe, it, expect, beforeEach } from 'vitest'
import { gradePicks } from '../../src/resolve/grade.js'
import { createFakeSupabase, type FakeSupabase } from '../helpers/fake-supabase.js'
import { upsertPick } from '../../src/db/queries.js'
import type { EspnGame } from '../../src/resolve/espn.js'

function makePick(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    detected_at: '2026-04-06T18:00:00Z',
    sport: 'nba',
    game_id: 'g1',
    game_date: '2026-04-06',
    game_time: '2026-04-07T01:30:00Z',
    away_team: 'Los Angeles Lakers',
    home_team: 'Denver Nuggets',
    market: 'moneyline' as const,
    side: 'home' as const,
    line: null,
    best_book: 'bet365',
    best_price: -108,
    sharp_book: 'pinnacle',
    sharp_implied: 0.5,
    ev_pct: 0.05,
    all_prices: { bet365: -108 },
    score: 0.0412,
    card_date: '2026-04-06',
    status: 'active' as const,
    ...overrides,
  }
}

describe('gradePicks', () => {
  let fake: FakeSupabase
  let espnFixture: Record<string, EspnGame[]>

  beforeEach(() => {
    fake = createFakeSupabase()
    espnFixture = {}
  })

  const stubFetcher = async (sport: 'mlb' | 'nba' | 'nhl', gameDate: string) =>
    espnFixture[`${sport}:${gameDate}`] ?? []

  it('grades a finished moneyline pick as won', async () => {
    await upsertPick(fake as never, makePick())
    espnFixture['nba:2026-04-06'] = [
      {
        sport: 'nba',
        gameDate: '2026-04-06',
        homeTeam: 'Denver Nuggets',
        awayTeam: 'Los Angeles Lakers',
        homeTeamCanonical: 'nuggets',
        awayTeamCanonical: 'lakers',
        homeScore: 110,
        awayScore: 100,
        status: 'final',
      },
    ]
    const summary = await gradePicks({
      supabase: fake as never,
      referenceDate: '2026-04-08',
      lookbackDays: 3,
      fetchScoreboard: stubFetcher,
    })
    expect(summary.graded).toBe(1)
    expect(summary.won).toBe(1)
    expect(summary.unmatched).toBe(0)
    expect(fake._tables.edge_pick_grades).toEqual([
      { pick_id: 'p1', outcome: 'won', graded_at: expect.any(String) },
    ])
    expect(fake._tables.edge_results).toHaveLength(1)
    expect(fake._tables.edge_results![0]!.status).toBe('final')
  })

  it('does not grade postponed games and writes only a result row', async () => {
    await upsertPick(fake as never, makePick({ sport: 'mlb', game_id: 'g2', id: 'p2', away_team: 'NY Yankees', home_team: 'Boston Red Sox' }))
    espnFixture['mlb:2026-04-06'] = [
      {
        sport: 'mlb' as never,
        gameDate: '2026-04-06',
        homeTeam: 'Boston Red Sox',
        awayTeam: 'NY Yankees',
        homeTeamCanonical: 'red-sox',
        awayTeamCanonical: 'yankees',
        homeScore: 0,
        awayScore: 0,
        status: 'postponed',
      },
    ]
    const summary = await gradePicks({
      supabase: fake as never,
      referenceDate: '2026-04-08',
      lookbackDays: 3,
      fetchScoreboard: stubFetcher,
    })
    expect(summary.postponed).toBe(1)
    expect(summary.graded).toBe(0)
    expect(fake._tables.edge_pick_grades ?? []).toHaveLength(0)
    expect(fake._tables.edge_results![0]!.status).toBe('postponed')
  })

  it('reports unmatched picks without failing', async () => {
    await upsertPick(fake as never, makePick({ id: 'orphan' }))
    // ESPN returns nothing
    const summary = await gradePicks({
      supabase: fake as never,
      referenceDate: '2026-04-08',
      lookbackDays: 3,
      fetchScoreboard: stubFetcher,
    })
    expect(summary.unmatched).toBe(1)
    expect(summary.graded).toBe(0)
  })

  it('voids canceled games', async () => {
    await upsertPick(fake as never, makePick())
    espnFixture['nba:2026-04-06'] = [
      {
        sport: 'nba',
        gameDate: '2026-04-06',
        homeTeam: 'Denver Nuggets',
        awayTeam: 'Los Angeles Lakers',
        homeTeamCanonical: 'nuggets',
        awayTeamCanonical: 'lakers',
        homeScore: 0,
        awayScore: 0,
        status: 'canceled',
      },
    ]
    const summary = await gradePicks({
      supabase: fake as never,
      referenceDate: '2026-04-08',
      lookbackDays: 3,
      fetchScoreboard: stubFetcher,
    })
    expect(summary.graded).toBe(1)
    expect(summary.void).toBe(1)
    expect(fake._tables.edge_pick_grades![0]!.outcome).toBe('void')
  })
})
