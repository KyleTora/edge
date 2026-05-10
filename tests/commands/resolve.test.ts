import { describe, it, expect, beforeEach } from 'vitest'
import { runResolve } from '../../src/commands/resolve.js'
import { createFakeSupabase, type FakeSupabase } from '../helpers/fake-supabase.js'
import type { Config, Env } from '../../src/config.js'

const config: Config = {
  books: ['betmgm'],
  manual_books: [],
  sharp_anchor: 'pinnacle',
  sports: ['nba'],
  bankroll_units: 100,
  unit_size_cad: 25,
  parlay: {
    target_odds: 100,
    odds_tolerance: [-110, 130],
    min_legs: 2,
    max_legs: 3,
    min_leg_prob: 0.70,
    max_leg_prob: 0.85,
    filler_min_prob: 0.75,
    stake_base: 10,
    stake_multiplier: 2,
    prop_markets: {
      nba: ['points', 'rebounds', 'assists', 'threes_made'],
      mlb: ['hits', 'total_bases', 'rbis', 'strikeouts_pitcher'],
      nhl: ['shots_on_goal', 'points_player'],
    },
  },
}
const env: Env = {
  ODDS_API_KEY: 'test',
  SUPABASE_URL: 'http://localhost',
  SUPABASE_SERVICE_ROLE_KEY: 'test',
}

describe('runResolve', () => {
  let fake: FakeSupabase

  beforeEach(() => {
    fake = createFakeSupabase()
  })

  it('mode=close runs only the close path', async () => {
    const result = await runResolve({ supabase: fake as never, config, env, mode: 'close' })
    expect(result.capture).toBeDefined()
    expect(result.grade).toBeUndefined()
  })

  it('mode=grade runs only the grade path', async () => {
    const result = await runResolve({ supabase: fake as never, config, env, mode: 'grade' })
    expect(result.capture).toBeUndefined()
    expect(result.grade).toBeDefined()
  })

  it('mode=both runs both paths', async () => {
    const result = await runResolve({ supabase: fake as never, config, env, mode: 'both' })
    expect(result.capture).toBeDefined()
    expect(result.grade).toBeDefined()
  })
})
