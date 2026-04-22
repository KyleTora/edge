import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runReport } from '../../src/commands/report.js'
import type { Config } from '../../src/config.js'
import { resetQuotaState, recordQuotaResponse } from '../../src/quota.js'
import { createFakeSupabase } from '../helpers/fake-supabase.js'

const config: Config = {
  books: ['BetMGM', 'DraftKings', 'Caesars', 'BetRivers'],
  manual_books: ['thescore', 'bet365'],
  sharp_anchor: 'pinnacle',
  daily_picks: 5,
  sports: ['nba', 'mlb', 'nhl'],
  bankroll_units: 100,
  unit_size_cad: 25,
  closing_line_capture_minutes_before_game: 5,
}

const ACTION_NETWORK_RESPONSE = {
  games: [
    {
      id: 12345,
      home_team_id: 1,
      away_team_id: 2,
      start_time: '2099-04-08T01:30:00Z',
      status: 'scheduled',
      teams: [
        { id: 1, full_name: 'Denver Nuggets' },
        { id: 2, full_name: 'Los Angeles Lakers' },
      ],
      odds: [
        { book_id: 68, type: 'game', ml_home: -155, ml_away: 130, total: 224.5, over: -110, under: -110 },
        { book_id: 15, type: 'game', ml_home: -170, ml_away: 145, total: 224.5, over: -112, under: -108 },
      ],
    },
  ],
}

const ODDS_API_RESPONSE = [
  {
    id: 'abc123',
    sport_key: 'basketball_nba',
    commence_time: '2099-04-08T01:30:00Z',
    home_team: 'Denver Nuggets',
    away_team: 'Los Angeles Lakers',
    bookmakers: [
      {
        key: 'pinnacle',
        title: 'Pinnacle',
        markets: [
          { key: 'h2h', outcomes: [{ name: 'Denver Nuggets', price: -200 }, { name: 'Los Angeles Lakers', price: 170 }] },
          { key: 'totals', outcomes: [{ name: 'Over', price: -108, point: 224.5 }, { name: 'Under', price: -112, point: 224.5 }] },
        ],
      },
    ],
  },
]

const env = { ODDS_API_KEY: 'FAKE', SUPABASE_URL: 'http://fake', SUPABASE_SERVICE_ROLE_KEY: 'fake' }

describe('runReport', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    resetQuotaState()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (typeof url === 'string' && url.includes('actionnetwork.com')) {
          return {
            ok: true,
            headers: new Headers(),
            json: async () => ACTION_NETWORK_RESPONSE,
          }
        }
        if (typeof url === 'string' && url.includes('the-odds-api.com')) {
          recordQuotaResponse({
            'x-requests-used': '156',
            'x-requests-remaining': '344',
            'x-requests-last': '4',
          })
          return {
            ok: true,
            headers: new Headers({
              'x-requests-used': '156',
              'x-requests-remaining': '344',
              'x-requests-last': '4',
            }),
            json: async () => ODDS_API_RESPONSE,
          }
        }
        throw new Error(`Unexpected URL: ${url}`)
      })
    )
  })

  it('returns rendered email payload in dry-run mode', async () => {
    const fake = createFakeSupabase()
    const result = await runReport({
      supabase: fake as never,
      config,
      env: { ODDS_API_KEY: 'FAKE', SUPABASE_URL: 'http://fake', SUPABASE_SERVICE_ROLE_KEY: 'fake' },
      sports: ['nba'],
      runLabel: '4pm ET',
      runDate: '2026-04-07',
      dryRun: true,
    })
    expect(result.sent).toBe(false)
    expect(result.email.subject).toContain('Apr 7')
    expect(result.email.html).toContain('NBA')
    expect(result.email.csv).toContain('nba')
    expect(result.picks.length).toBeGreaterThan(0)
  })

  it('respects the sports filter (overrides config.sports)', async () => {
    const fake = createFakeSupabase()
    const result = await runReport({
      supabase: fake as never,
      config,
      env: { ODDS_API_KEY: 'FAKE', SUPABASE_URL: 'http://fake', SUPABASE_SERVICE_ROLE_KEY: 'fake' },
      sports: ['mlb'],
      runLabel: '11am ET (MLB only)',
      runDate: '2026-04-07',
      dryRun: true,
    })
    expect(result.picks.every((p) => p.sport === 'mlb')).toBe(true)
  })

  it('produces a quiet-day email when daily_picks is 0', async () => {
    const fake = createFakeSupabase()
    const zeroPicksConfig = { ...config, daily_picks: 0 }
    const result = await runReport({
      supabase: fake as never,
      config: zeroPicksConfig,
      env: { ODDS_API_KEY: 'FAKE', SUPABASE_URL: 'http://fake', SUPABASE_SERVICE_ROLE_KEY: 'fake' },
      sports: ['nba'],
      runLabel: '4pm ET',
      runDate: '2026-04-07',
      dryRun: true,
    })
    expect(result.picks).toHaveLength(0)
    expect(result.email.subject).toContain('quiet day')
  })

  it('persists picks to edge_picks during a run', async () => {
    const fake = createFakeSupabase()
    const result = await runReport({
      supabase: fake as never,
      config,
      env: { ODDS_API_KEY: 'FAKE', SUPABASE_URL: 'http://fake', SUPABASE_SERVICE_ROLE_KEY: 'fake' },
      sports: ['nba'],
      runLabel: 'test',
      runDate: '2026-04-07',
      dryRun: true,
    })
    expect(result.picks.length).toBeGreaterThan(0)
    const persisted = fake._tables.edge_picks ?? []
    expect(persisted.length).toBe(result.picks.length)
  })

  it('passes swapSummary from runCard into renderEmail on refresh', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-21T19:00:00Z'))

    const fake = createFakeSupabase()
    // Pre-populate a prior active pick whose game has started (relative to the refresh run)
    await fake.from('edge_picks').insert([
      {
        id: '2026-04-21:mlb:g1:moneyline:home',
        card_date: '2026-04-21',
        status: 'active',
        game_time: '2026-04-21T14:00:00Z',   // before the 19:00Z runReport below
        sport: 'mlb',
        game_id: 'g1',
        market: 'moneyline',
        side: 'home',
        score: 0.05,
        sharp_implied: 0.5,
        ev_pct: 0.02,
        away_team: 'A',
        home_team: 'B',
        game_date: '2026-04-21',
        best_book: 'betmgm',
        best_price: 110,
        sharp_book: 'pinnacle',
        all_prices: {},
        detected_at: '2026-04-21T10:00:00Z',
        line: null,
      },
    ])

    const result = await runReport({
      supabase: fake as never,
      config,
      env,
      sports: ['mlb'],
      runLabel: 'refresh',
      runDate: '2026-04-21',
      dryRun: true,
      mode: 'refresh',
    })

    expect(result.email.html).toMatch(/game started before refresh/i)
  })
})
