import { describe, it, expect, beforeEach, vi } from 'vitest'
import { runCard } from '../../src/commands/card.js'
import { createFakeSupabase, type FakeSupabase } from '../helpers/fake-supabase.js'
import type { Config, Env } from '../../src/config.js'
import type { MarketSnapshot } from '../../src/sources/normalize.js'
import type { Candidate } from '../../src/engine/scanner.js'

vi.mock('../../src/sources/action-network.js', () => ({
  fetchActionNetworkNba: vi.fn().mockResolvedValue([]),
  fetchActionNetworkMlb: vi.fn().mockResolvedValue([]),
  fetchActionNetworkNhl: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../src/sources/odds-api.js', () => ({
  fetchPinnacleNba: vi.fn().mockResolvedValue([]),
  fetchPinnacleMlb: vi.fn().mockResolvedValue([]),
  fetchPinnacleNhl: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../src/sources/normalize.js', () => ({
  joinSources: vi.fn().mockReturnValue([] as MarketSnapshot[]),
}))
vi.mock('../../src/engine/scanner.js', () => ({
  rankCandidates: vi.fn().mockReturnValue([] as Candidate[]),
}))

function cand(id: string, score: number): Candidate {
  return {
    id,
    detected_at: '2026-04-21T14:00:00Z',
    sport: 'mlb',
    game_id: id,
    game_date: '2026-04-21',
    game_time: '2026-04-21T23:00:00Z',
    away_team: 'A',
    home_team: 'B',
    market: 'moneyline',
    side: 'home',
    line: null,
    best_book: 'betmgm',
    best_price: 110,
    sharp_book: 'pinnacle',
    sharp_implied: 0.5,
    ev_pct: 0.03,
    all_prices: {},
    score,
    status: 'active',
  }
}

const config: Config = {
  books: ['betmgm'],
  manual_books: [],
  sharp_anchor: 'pinnacle',
  daily_picks: 5,
  sports: ['mlb'],
  bankroll_units: 100,
  unit_size_cad: 25,
  closing_line_capture_minutes_before_game: 5,
}
const env: Env = {
  ODDS_API_KEY: 'test',
  SUPABASE_URL: 'http://localhost',
  SUPABASE_SERVICE_ROLE_KEY: 'test',
}

describe('runCard', () => {
  let fake: FakeSupabase
  beforeEach(async () => {
    fake = createFakeSupabase()
    const { rankCandidates } = await import('../../src/engine/scanner.js')
    vi.mocked(rankCandidates).mockReturnValue([])
  })

  describe('morning mode', () => {
    it('returns an empty card and writes nothing when no candidates', async () => {
      const result = await runCard({
        supabase: fake as never,
        config,
        env,
        mode: 'morning',
        sports: ['mlb'],
        detectedAt: '2026-04-21T14:00:00Z',
      })
      expect(result.picks).toEqual([])
      expect(result.swapSummary).toBeUndefined()
      expect(fake._tables.edge_picks ?? []).toHaveLength(0)
    })

    it('does not re-insert when active picks already exist for today', async () => {
      await fake.from('edge_picks').insert([
        { id: 'existing', card_date: '2026-04-21', status: 'active' },
      ])
      const result = await runCard({
        supabase: fake as never,
        config,
        env,
        mode: 'morning',
        sports: ['mlb'],
        detectedAt: '2026-04-21T14:00:00Z',
      })
      expect(result.picks).toHaveLength(1)
      expect(result.picks[0]!.id).toBe('existing')
      expect(fake._tables.edge_picks).toHaveLength(1)
    })

    it('fills remaining slots when partial card exists and skips duplicates', async () => {
      const { rankCandidates } = await import('../../src/engine/scanner.js')
      vi.mocked(rankCandidates).mockReturnValue([
        cand('a', 0.10), // already in DB — should be skipped
        cand('c', 0.08),
        cand('d', 0.06),
        cand('e', 0.04),
      ])

      // Pre-seed 2 active picks (partial card; daily_picks=5 → 3 slots left)
      await fake.from('edge_picks').insert([
        {
          id: 'a',
          card_date: '2026-04-21',
          status: 'active',
          score: 0.09,
          sport: 'mlb',
          game_id: 'a',
          game_date: '2026-04-21',
          game_time: '2026-04-21T23:00:00Z',
          market: 'moneyline',
          side: 'home',
          line: null,
          away_team: 'A',
          home_team: 'B',
          best_book: 'betmgm',
          best_price: 110,
          sharp_book: 'pinnacle',
          sharp_implied: 0.5,
          ev_pct: 0.03,
          all_prices: {},
          detected_at: '2026-04-21T14:00:00Z',
        },
        {
          id: 'b',
          card_date: '2026-04-21',
          status: 'active',
          score: 0.07,
          sport: 'mlb',
          game_id: 'b',
          game_date: '2026-04-21',
          game_time: '2026-04-21T23:00:00Z',
          market: 'moneyline',
          side: 'home',
          line: null,
          away_team: 'A',
          home_team: 'B',
          best_book: 'betmgm',
          best_price: 110,
          sharp_book: 'pinnacle',
          sharp_implied: 0.5,
          ev_pct: 0.03,
          all_prices: {},
          detected_at: '2026-04-21T14:00:00Z',
        },
      ])

      const result = await runCard({
        supabase: fake as never,
        config,
        env,
        mode: 'morning',
        sports: ['mlb'],
        detectedAt: '2026-04-21T14:00:00Z',
      })

      // Final card = 2 existing (a, b) + 3 new (c, d, e) = 5; 'a' not duplicated
      expect(fake._tables.edge_picks).toHaveLength(5)
      expect(result.picks.map((p) => p.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
    })
  })

  describe('refresh mode', () => {
    it('returns an empty card when no prior and no candidates', async () => {
      const result = await runCard({
        supabase: fake as never,
        config,
        env,
        mode: 'refresh',
        sports: ['mlb'],
        detectedAt: '2026-04-21T19:00:00Z',
      })
      expect(result.picks).toEqual([])
      expect(result.swapSummary?.morningCardSize).toBe(0)
    })
  })
})
