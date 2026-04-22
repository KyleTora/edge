import { describe, it, expect } from 'vitest'
import { resolveSwaps } from '../../src/engine/resolve-swaps.js'
import type { PickRow } from '../../src/db/queries.js'
import type { Candidate } from '../../src/engine/scanner.js'

function row(id: string, gameTime: string, score = 0.05): PickRow {
  return {
    id,
    detected_at: '2026-04-21T10:00:00Z',
    sport: 'mlb',
    game_id: id,
    game_date: gameTime.slice(0, 10),
    game_time: gameTime,
    away_team: 'A',
    home_team: 'B',
    market: 'moneyline',
    side: 'home',
    line: null,
    best_book: 'betmgm',
    best_price: 110,
    sharp_book: 'pinnacle',
    sharp_implied: 0.5,
    ev_pct: 0.03,
    all_prices: {},
    score,
    card_date: '2026-04-21',
    status: 'active',
  }
}

function cand(id: string, gameTime: string, score: number): Candidate {
  return {
    id,
    detected_at: '2026-04-21T15:00:00Z',
    sport: 'mlb',
    game_id: id,
    game_date: gameTime.slice(0, 10),
    game_time: gameTime,
    away_team: 'A',
    home_team: 'B',
    market: 'moneyline',
    side: 'home',
    line: null,
    best_book: 'betmgm',
    best_price: 110,
    sharp_book: 'pinnacle',
    sharp_implied: 0.5,
    ev_pct: 0.03,
    all_prices: {},
    score,
    status: 'active',
  }
}

const NOW = new Date('2026-04-21T15:00:00Z') // 3pm ET refresh
const LATER = '2026-04-21T23:00:00Z' // evening game
const EARLIER = '2026-04-21T14:00:00Z' // already started

describe('resolveSwaps', () => {
  it('returns all new candidates as add when prior is empty', () => {
    const ranked = [cand('x', LATER, 0.10), cand('y', LATER, 0.08)]
    const r = resolveSwaps([], ranked, new Set(), NOW, 2)
    expect(r.add.map((c) => c.id)).toEqual(['x', 'y'])
    expect(r.keep).toEqual([])
    expect(r.kept_started).toEqual([])
    expect(r.drop).toEqual([])
  })

  it('locks in all prior picks whose games have started', () => {
    const prior = [row('a', EARLIER, 0.05), row('b', EARLIER, 0.04)]
    const ranked = [cand('x', LATER, 0.10)]
    const r = resolveSwaps(prior, ranked, new Set(), NOW, 2)
    expect(r.kept_started.map((p) => p.id)).toEqual(['a', 'b'])
    expect(r.keep).toEqual([])
    expect(r.drop).toEqual([])
    expect(r.add).toEqual([]) // no slots left
  })

  it('drops a prior pick that fell out of top-N, adds the displacer', () => {
    const prior = [row('a', LATER, 0.05)]
    const ranked = [cand('x', LATER, 0.10)] // x outscores a
    const r = resolveSwaps(prior, ranked, new Set(), NOW, 1)
    expect(r.drop.map((p) => p.id)).toEqual(['a'])
    expect(r.add.map((c) => c.id)).toEqual(['x'])
    expect(r.keep).toEqual([])
  })

  it('keeps a prior pick that is still in top-N', () => {
    const prior = [row('a', LATER, 0.05)]
    const ranked = [cand('a', LATER, 0.09), cand('x', LATER, 0.02)]
    const r = resolveSwaps(prior, ranked, new Set(), NOW, 1)
    expect(r.keep.map((p) => p.id)).toEqual(['a'])
    expect(r.drop).toEqual([])
    expect(r.add).toEqual([])
  })

  it('handles a mixed case: 2 kept_started, 1 keep, 1 drop, 1 add', () => {
    const prior = [
      row('started1', EARLIER, 0.09),
      row('started2', EARLIER, 0.08),
      row('keepme', LATER, 0.07),
      row('dropme', LATER, 0.02),
    ]
    const ranked = [
      cand('keepme', LATER, 0.07),
      cand('newone', LATER, 0.05),
      cand('dropme', LATER, 0.02),
    ]
    const r = resolveSwaps(prior, ranked, new Set(), NOW, 4)
    expect(r.kept_started.map((p) => p.id).sort()).toEqual(['started1', 'started2'])
    expect(r.keep.map((p) => p.id)).toEqual(['keepme'])
    expect(r.drop.map((p) => p.id)).toEqual(['dropme'])
    expect(r.add.map((c) => c.id)).toEqual(['newone'])
  })

  it('skips candidates whose id is in alreadySwappedOffIds', () => {
    const ranked = [cand('rejected', LATER, 0.10), cand('fresh', LATER, 0.05)]
    const r = resolveSwaps([], ranked, new Set(['rejected']), NOW, 2)
    expect(r.add.map((c) => c.id)).toEqual(['fresh'])
    // Slot for rejected is not backfilled — card is size 1 instead of 2. OK.
  })

  it('yields a partial card when fewer candidates than targetSize', () => {
    const ranked = [cand('only', LATER, 0.10)]
    const r = resolveSwaps([], ranked, new Set(), NOW, 3)
    expect(r.add).toHaveLength(1)
  })
})
