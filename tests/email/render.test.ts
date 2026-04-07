import { describe, it, expect } from 'vitest'
import { renderEmail, type EmailRenderInput } from '../../src/email/render.js'
import type { PickRow } from '../../src/db/queries.js'

const samplePick: PickRow = {
  id: '2026-04-07:nba:an:12345:moneyline:home',
  detected_at: '2026-04-07T20:00:00Z',
  sport: 'nba',
  game_id: 'an:12345',
  game_date: '2026-04-07',
  game_time: '2026-04-08T01:30:00Z',
  away_team: 'Los Angeles Lakers',
  home_team: 'Denver Nuggets',
  market: 'moneyline',
  side: 'home',
  line: null,
  best_book: 'BetMGM',
  best_price: -108,
  sharp_book: 'pinnacle',
  sharp_implied: 0.5452,
  ev_pct: 0.05,
  all_prices: {},
}

const baseInput: EmailRenderInput = {
  picks: [samplePick],
  quota: { used: 156, remaining: 344, lastCallCost: 4 },
  runLabel: '4pm ET',
  runDate: '2026-04-07',
  sportsScanned: ['mlb', 'nba', 'nhl'],
}

describe('renderEmail', () => {
  it('builds a subject with pick count and top EV when picks exist', () => {
    const out = renderEmail(baseInput)
    expect(out.subject).toContain('1 pick')
    expect(out.subject).toContain('Apr 7')
    expect(out.subject).toContain('+5.0%')
    expect(out.subject).toContain('NBA')
  })

  it('builds a quiet-day subject when no picks', () => {
    const out = renderEmail({ ...baseInput, picks: [] })
    expect(out.subject).toContain('quiet day')
    expect(out.subject).toContain('Apr 7')
  })

  it('renders an HTML body containing the pick row', () => {
    const out = renderEmail(baseInput)
    expect(out.html).toContain('<table')
    expect(out.html).toContain('NBA')
    expect(out.html).toContain('Nuggets')
    expect(out.html).toContain('BetMGM')
    expect(out.html).toContain('-108')
    expect(out.html).toContain('+5.0%')
  })

  it('renders a quiet-day HTML body when no picks', () => {
    const out = renderEmail({ ...baseInput, picks: [] })
    expect(out.html).toContain('No markets crossed')
    expect(out.html).not.toContain('<table')
  })

  it('renders CSV with header row', () => {
    const out = renderEmail({ ...baseInput, picks: [] })
    expect(out.csv.split('\n')[0]).toBe(
      'ev_pct,sport,matchup,pick,best_book,best_price,sharp_implied_pct,start_time,sharp_book'
    )
  })

  it('renders CSV with one row per pick', () => {
    const out = renderEmail(baseInput)
    const lines = out.csv.trim().split('\n')
    expect(lines).toHaveLength(2) // header + 1 pick
    expect(lines[1]).toContain('nba')
    expect(lines[1]).toContain('LAK @ NUG')
    expect(lines[1]).toContain('Nuggets ML')
    expect(lines[1]).toContain('BetMGM')
    expect(lines[1]).toContain('-108')
  })

  it('includes quota stats in HTML', () => {
    const out = renderEmail(baseInput)
    expect(out.html).toContain('156')
    expect(out.html).toContain('500')
  })

  it('includes the run label and sports list in HTML', () => {
    const out = renderEmail(baseInput)
    expect(out.html).toContain('4pm ET')
    expect(out.html).toContain('Apr 7')
  })
})
