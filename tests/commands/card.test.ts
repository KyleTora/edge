import { describe, it, expect, beforeEach, vi } from 'vitest'
import { runCard } from '../../src/commands/card.js'
import { createFakeSupabase, type FakeSupabase } from '../helpers/fake-supabase.js'
import type { Config, Env } from '../../src/config.js'
import type { MarketSnapshot } from '../../src/sources/normalize.js'

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
  beforeEach(() => {
    fake = createFakeSupabase()
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
