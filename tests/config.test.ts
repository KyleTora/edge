import { describe, it, expect } from 'vitest'
import { parseConfig } from '../src/config.js'

describe('parseConfig', () => {
  it('parses a valid config', () => {
    const raw = {
      books: ['betmgm', 'draftkings'],
      manual_books: ['thescore'],
      sharp_anchor: 'pinnacle',
      daily_picks: 5,
      sports: ['nba'],
      bankroll_units: 100,
      unit_size_cad: 25,
      closing_line_capture_minutes_before_game: 5,
    }
    const cfg = parseConfig(raw)
    expect(cfg.books).toEqual(['betmgm', 'draftkings'])
    expect(cfg.daily_picks).toBe(5)
  })

  it('defaults daily_picks to 5 when not provided', () => {
    const raw = {
      books: ['betmgm'],
      manual_books: [],
      sharp_anchor: 'pinnacle',
      sports: ['nba'],
      bankroll_units: 100,
      unit_size_cad: 25,
      closing_line_capture_minutes_before_game: 5,
    }
    const cfg = parseConfig(raw)
    expect(cfg.daily_picks).toBe(5)
  })

  it('requires at least one book', () => {
    expect(() =>
      parseConfig({
        books: [],
        manual_books: [],
        sharp_anchor: 'pinnacle',
        daily_picks: 5,
        sports: ['nba'],
        bankroll_units: 100,
        unit_size_cad: 25,
        closing_line_capture_minutes_before_game: 5,
      })
    ).toThrow()
  })
})
