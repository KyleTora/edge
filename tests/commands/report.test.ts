import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runReport } from '../../src/commands/report.js'
import type { Config } from '../../src/config.js'
import { resetQuotaState, recordQuotaResponse } from '../../src/quota.js'

const config: Config = {
  books: ['BetMGM', 'DraftKings', 'Caesars', 'BetRivers'],
  manual_books: ['thescore', 'bet365'],
  sharp_anchor: 'pinnacle',
  ev_threshold: 0.02,
  max_sharp_implied_prob: 0.75,
  sports: ['nba', 'mlb', 'nhl'],
  bankroll_units: 100,
  unit_size_cad: 25,
  watch_interval_minutes: 10,
  closing_line_capture_minutes_before_game: 5,
  stale_sharp_max_age_minutes: 60,
}

const ACTION_NETWORK_RESPONSE = {
  games: [
    {
      id: 12345,
      home_team_id: 1,
      away_team_id: 2,
      start_time: '2026-04-08T01:30:00Z',
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
    commence_time: '2026-04-08T01:30:00Z',
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

describe('runReport', () => {
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
    const result = await runReport({
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
    const result = await runReport({
      config,
      env: { ODDS_API_KEY: 'FAKE', SUPABASE_URL: 'http://fake', SUPABASE_SERVICE_ROLE_KEY: 'fake' },
      sports: ['mlb'],
      runLabel: '11am ET (MLB only)',
      runDate: '2026-04-07',
      dryRun: true,
    })
    expect(result.picks.every((p) => p.sport === 'mlb')).toBe(true)
  })

  it('produces a quiet-day email when no picks found', async () => {
    const tightConfig = { ...config, ev_threshold: 0.99 }
    const result = await runReport({
      config: tightConfig,
      env: { ODDS_API_KEY: 'FAKE', SUPABASE_URL: 'http://fake', SUPABASE_SERVICE_ROLE_KEY: 'fake' },
      sports: ['nba'],
      runLabel: '4pm ET',
      runDate: '2026-04-07',
      dryRun: true,
    })
    expect(result.picks).toHaveLength(0)
    expect(result.email.subject).toContain('quiet day')
  })
})
