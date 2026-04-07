import { describe, it, expect, beforeEach, vi } from 'vitest'
import { runScan } from '../../src/commands/scan.js'
import { createFakeSupabase, type FakeSupabase } from '../helpers/fake-supabase.js'
import type { Config, Env } from '../../src/config.js'

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

const config: Config = {
  books: ['betmgm'],
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
const env: Env = {
  ODDS_API_KEY: 'test',
  SUPABASE_URL: 'http://localhost',
  SUPABASE_SERVICE_ROLE_KEY: 'test',
}

describe('runScan', () => {
  let fake: FakeSupabase

  beforeEach(() => {
    fake = createFakeSupabase()
  })

  it('runs end-to-end with no picks and writes nothing to edge_picks', async () => {
    const result = await runScan({
      supabase: fake as never,
      config,
      env,
      detectedAt: '2026-04-07T18:00:00Z',
    })
    expect(result).toEqual([])
    expect(fake._tables.edge_picks ?? []).toHaveLength(0)
  })
})
