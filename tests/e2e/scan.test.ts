import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runCard } from '../../src/commands/card.js'
import { createFakeSupabase, type FakeSupabase } from '../helpers/fake-supabase.js'
import type { Config } from '../../src/config.js'

const config: Config = {
  books: ['BetMGM', 'DraftKings'],
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

// Pinnacle: home=-200, away=+170 → homeTrue≈0.643
// BetMGM (68): home=-155 → EV≈+3.5% (above threshold)
// DraftKings (15): home=-170 → EV≈+1.3%
const ACTION_NETWORK_RESPONSE = {
  games: [
    {
      id: 12345,
      home_team_id: 1,
      away_team_id: 2,
      start_time: '2026-04-07T01:30:00Z',
      status: 'scheduled',
      teams: [
        { id: 1, full_name: 'Denver Nuggets' },
        { id: 2, full_name: 'Los Angeles Lakers' },
      ],
      odds: [
        {
          book_id: 68,
          type: 'game',
          ml_home: -155,
          ml_away: 130,
          total: 224.5,
          over: -110,
          under: -110,
        },
        {
          book_id: 15,
          type: 'game',
          ml_home: -170,
          ml_away: 145,
          total: 224.5,
          over: -112,
          under: -108,
        },
      ],
    },
  ],
}

const ODDS_API_RESPONSE = [
  {
    id: 'abc123',
    sport_key: 'basketball_nba',
    commence_time: '2026-04-07T01:30:00Z',
    home_team: 'Denver Nuggets',
    away_team: 'Los Angeles Lakers',
    bookmakers: [
      {
        key: 'pinnacle',
        title: 'Pinnacle',
        markets: [
          {
            key: 'h2h',
            outcomes: [
              { name: 'Denver Nuggets', price: -200 },
              { name: 'Los Angeles Lakers', price: 170 },
            ],
          },
          {
            key: 'totals',
            outcomes: [
              { name: 'Over', price: -108, point: 224.5 },
              { name: 'Under', price: -112, point: 224.5 },
            ],
          },
        ],
      },
    ],
  },
]

const env = {
  ODDS_API_KEY: 'FAKE',
  SUPABASE_URL: 'http://fake',
  SUPABASE_SERVICE_ROLE_KEY: 'fake',
}

describe('e2e: card', () => {
  let fake: FakeSupabase

  beforeEach(() => {
    fake = createFakeSupabase()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (typeof url === 'string' && url.includes('actionnetwork.com')) {
          return { ok: true, json: async () => ACTION_NETWORK_RESPONSE }
        }
        if (typeof url === 'string' && url.includes('the-odds-api.com')) {
          return { ok: true, json: async () => ODDS_API_RESPONSE }
        }
        throw new Error(`Unexpected URL: ${url}`)
      })
    )
  })

  it('inserts a pick into the database', async () => {
    await runCard({
      supabase: fake as never,
      config,
      env,
      mode: 'morning',
      sports: config.sports,
      detectedAt: '2026-04-06T18:00:00Z',
    })
    const rows = fake._tables.edge_picks ?? []
    const denPick = rows.find((r) => r.side === 'home' && r.market === 'moneyline')
    expect(denPick).toBeDefined()
    expect(denPick!.best_book).toBe('BetMGM')
  })

  it('is idempotent: running twice does not duplicate', async () => {
    await runCard({
      supabase: fake as never,
      config,
      env,
      mode: 'morning',
      sports: config.sports,
      detectedAt: '2026-04-06T18:00:00Z',
    })
    // Second run — picks already exist (card_date idempotency kicks in if daily_picks reached,
    // otherwise upsertPick deduplicates by id)
    await runCard({
      supabase: fake as never,
      config,
      env,
      mode: 'morning',
      sports: config.sports,
      detectedAt: '2026-04-06T19:00:00Z',
    })
    const rows = fake._tables.edge_picks ?? []
    const denPicks = rows.filter((r) => r.side === 'home' && r.market === 'moneyline')
    expect(denPicks).toHaveLength(1)
    expect(denPicks[0]!.detected_at).toBe('2026-04-06T18:00:00Z')
  })
})
