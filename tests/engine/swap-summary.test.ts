import { describe, it, expect } from 'vitest'
import { buildSwapSummary } from '../../src/engine/swap-summary.js'
import type { PickRow } from '../../src/db/queries.js'
import type { Candidate } from '../../src/engine/scanner.js'
import type { SwapResolution } from '../../src/engine/resolve-swaps.js'

function row(id: string, overrides: Partial<PickRow> = {}): PickRow {
  return {
    id,
    detected_at: '2026-04-21T10:00:00Z',
    sport: 'mlb',
    game_id: id,
    game_date: '2026-04-21',
    game_time: '2026-04-21T23:00:00Z',
    away_team: 'Yankees',
    home_team: 'Red Sox',
    market: 'moneyline',
    side: 'home',
    line: null,
    best_book: 'betmgm',
    best_price: -135,
    sharp_book: 'pinnacle',
    sharp_implied: 0.585,
    ev_pct: 0.031,
    all_prices: {},
    score: 0.03,
    card_date: '2026-04-21',
    status: 'active',
    ...overrides,
  }
}

function cand(id: string, overrides: Partial<Candidate> = {}): Candidate {
  const base = row(id)
  // strip card_date to match Candidate = Omit<PickRow, 'card_date'>
  const { card_date: _, ...rest } = base
  return { ...rest, ...overrides } as Candidate
}

describe('buildSwapSummary', () => {
  it('reports morningCardSize as the size of prior active set', () => {
    const resolution: SwapResolution = {
      keep: [row('a')],
      kept_started: [row('b', { game_time: '2026-04-21T14:00:00Z' })],
      drop: [],
      add: [],
    }
    const s = buildSwapSummary(resolution, [])
    expect(s.morningCardSize).toBe(2)
  })

  it('explains a dropped pick by comparing stored vs. fresh sharp', () => {
    const dropped = row('y', {
      sport: 'mlb',
      game_id: 'g1',
      market: 'moneyline',
      side: 'home',
      sharp_implied: 0.585,
      ev_pct: 0.031,
    })
    const fresh: Candidate = cand('y', {
      sport: 'mlb',
      game_id: 'g1',
      market: 'moneyline',
      side: 'home',
      sharp_implied: 0.612,
      ev_pct: -0.008,
    })
    const resolution: SwapResolution = {
      keep: [],
      kept_started: [],
      drop: [dropped],
      add: [],
    }

    const s = buildSwapSummary(resolution, [fresh])

    expect(s.dropped).toHaveLength(1)
    const reason = s.dropped[0]!.reason
    expect(reason).toContain('58.5%')
    expect(reason).toContain('61.2%')
    expect(reason).toContain('+3.1%')
    expect(reason).toContain('-0.8%')
  })

  it('reports "no longer offered" when a dropped pick is missing from fresh ranked', () => {
    const dropped = row('y', { game_id: 'gone' })
    const resolution: SwapResolution = {
      keep: [],
      kept_started: [],
      drop: [dropped],
      add: [],
    }
    const s = buildSwapSummary(resolution, [])
    expect(s.dropped[0]!.reason).toMatch(/no longer offered/i)
  })

  it('explains an added pick by citing its current EV and implied prob', () => {
    const added: Candidate = cand('new', { sharp_implied: 0.401, ev_pct: 0.042 })
    const resolution: SwapResolution = {
      keep: [],
      kept_started: [],
      drop: [],
      add: [added],
    }
    const s = buildSwapSummary(resolution, [added])
    expect(s.added[0]!.reason).toContain('40.1%')
    expect(s.added[0]!.reason).toContain('+4.2%')
  })

  it('includes startedBeforeRefresh for kept_started picks', () => {
    const started = row('s', { game_time: '2026-04-21T14:00:00Z' })
    const resolution: SwapResolution = {
      keep: [],
      kept_started: [started],
      drop: [],
      add: [],
    }
    const s = buildSwapSummary(resolution, [])
    expect(s.startedBeforeRefresh).toHaveLength(1)
    expect(s.startedBeforeRefresh[0]!.pick.id).toBe('s')
  })
})
