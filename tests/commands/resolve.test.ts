import { describe, it, expect, beforeEach } from 'vitest'
import { runResolve } from '../../src/commands/resolve.js'
import { createFakeSupabase, type FakeSupabase } from '../helpers/fake-supabase.js'
import type { Config, Env } from '../../src/config.js'

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
