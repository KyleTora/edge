import { describe, it, expect } from 'vitest'
import { renderEmail, type EmailRenderInput } from '../../src/email/render.js'
import type { PickRow } from '../../src/db/queries.js'
import type { SwapSummary } from '../../src/engine/swap-summary.js'

function makePick(overrides: Partial<PickRow> = {}): PickRow {
  return {
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
    score: 0.0412,
    card_date: '2026-04-07',
    status: 'active' as const,
    ...overrides,
  }
}

const samplePick: PickRow = makePick()

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

describe('renderEmail with swapSummary', () => {
  it('renders a "What changed" section with drop + add + started reasons', () => {
    const picks: PickRow[] = [] // not the focus of this test
    const swapSummary: SwapSummary = {
      morningCardSize: 3,
      dropped: [
        { pick: makePick({ id: 'd1', away_team: 'Yankees', home_team: 'Red Sox' }), reason: 'sharp moved from 58.5% to 61.2%; EV +3.1% → -0.8%.' },
      ],
      added: [
        // Candidate = Omit<PickRow, 'card_date'>. makePick returns PickRow; strip card_date.
        { pick: (() => { const { card_date: _, ...rest } = makePick({ id: 'a1', away_team: 'Red Sox', home_team: 'Yankees' }); return rest })() as any, reason: 'EV +4.2% at current sharp (40.1% implied); top-N score.' },
      ],
      startedBeforeRefresh: [
        { pick: makePick({ id: 's1', game_time: '2026-04-21T14:00:00Z' }) },
      ],
    }

    const out = renderEmail({
      picks,
      quota: null,
      runLabel: '3pm ET',
      runDate: '2026-04-21',
      sportsScanned: ['mlb', 'nba', 'nhl'],
      swapSummary,
    })

    expect(out.html).toMatch(/What changed since morning/i)
    expect(out.html).toContain('DROPPED')
    expect(out.html).toContain('ADDED')
    expect(out.html).toMatch(/game started before refresh/i)
    expect(out.html).toContain('EV +4.2%')
  })

  it('omits the section when swapSummary has no changes', () => {
    const out = renderEmail({
      picks: [],
      quota: null,
      runLabel: '3pm ET',
      runDate: '2026-04-21',
      sportsScanned: ['mlb'],
      swapSummary: {
        morningCardSize: 0,
        dropped: [],
        added: [],
        startedBeforeRefresh: [],
      },
    })
    expect(out.html).not.toMatch(/What changed/)
  })
})
