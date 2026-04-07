import { describe, it, expect } from 'vitest'
import chalk from 'chalk'
import { renderPicksTable } from '../../src/ui/tables.js'
import type { PickRow } from '../../src/db/queries.js'

chalk.level = 0

const pick: PickRow = {
  id: '2026-04-06:nba:12345:moneyline:home',
  detected_at: '2026-04-06T18:00:00Z',
  sport: 'nba',
  game_id: '12345',
  game_date: '2026-04-06',
  game_time: '2026-04-07T01:30:00Z',
  away_team: 'Los Angeles Lakers',
  home_team: 'Denver Nuggets',
  market: 'moneyline',
  side: 'home',
  line: null,
  best_book: 'bet365',
  best_price: -108,
  sharp_book: 'pinnacle',
  sharp_implied: 0.5452,
  ev_pct: 0.05,
  all_prices: {},
}

describe('renderPicksTable', () => {
  it('renders empty table when no picks', () => {
    const out = renderPicksTable([])
    expect(out).toContain('No +EV picks')
  })

  it('renders header row', () => {
    const out = renderPicksTable([pick])
    expect(out).toContain('EV%')
    expect(out).toContain('SPORT')
    expect(out).toContain('MATCHUP')
    expect(out).toContain('PICK')
    expect(out).toContain('BOOK')
  })

  it('renders the pick data', () => {
    const out = renderPicksTable([pick])
    expect(out).toContain('NBA')
    expect(out).toContain('LAL @ DEN')
    expect(out).toContain('Nuggets')
    expect(out).toContain('bet365')
    expect(out).toContain('-108')
    expect(out).toContain('+5.0%')
  })
})
