import { describe, it, expect } from 'vitest'
import { parseConfig } from '../src/config.js'

describe('parseConfig', () => {
  it('parses a valid config', () => {
    const raw = {
      books: ['betmgm', 'draftkings'],
      manual_books: ['thescore'],
      sharp_anchor: 'pinnacle',
      sports: ['nba'],
      bankroll_units: 100,
      unit_size_cad: 25,
    }
    const cfg = parseConfig(raw)
    expect(cfg.books).toEqual(['betmgm', 'draftkings'])
    expect(cfg.parlay.target_odds).toBe(100)
  })

  it('defaults parlay block when not provided', () => {
    const raw = {
      books: ['betmgm'],
      manual_books: [],
      sharp_anchor: 'pinnacle',
      sports: ['nba'],
      bankroll_units: 100,
      unit_size_cad: 25,
    }
    const cfg = parseConfig(raw)
    expect(cfg.parlay.target_odds).toBe(100)
    expect(cfg.parlay.min_legs).toBe(2)
    expect(cfg.parlay.stake_base).toBe(10)
  })

  it('requires at least one book', () => {
    expect(() =>
      parseConfig({
        books: [],
        manual_books: [],
        sharp_anchor: 'pinnacle',
        sports: ['nba'],
        bankroll_units: 100,
        unit_size_cad: 25,
      })
    ).toThrow()
  })
})
