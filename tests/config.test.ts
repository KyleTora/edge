import { describe, it, expect } from 'vitest'
import { parseConfig } from '../src/config.js'

describe('parseConfig', () => {
  it('parses a valid config', () => {
    const raw = {
      books: ['betmgm', 'draftkings'],
      manual_books: ['thescore'],
      sharp_anchor: 'pinnacle',
      ev_threshold: 0.02,
      max_sharp_implied_prob: 0.75,
      sports: ['nba'],
      bankroll_units: 100,
      unit_size_cad: 25,
      watch_interval_minutes: 10,
      closing_line_capture_minutes_before_game: 5,
      stale_sharp_max_age_minutes: 60,
    }
    const cfg = parseConfig(raw)
    expect(cfg.books).toEqual(['betmgm', 'draftkings'])
    expect(cfg.ev_threshold).toBe(0.02)
  })

  it('rejects ev_threshold outside [0, 1]', () => {
    expect(() =>
      parseConfig({
        books: ['betmgm'],
        manual_books: [],
        sharp_anchor: 'pinnacle',
        ev_threshold: 1.5,
        max_sharp_implied_prob: 0.75,
        sports: ['nba'],
        bankroll_units: 100,
        unit_size_cad: 25,
        watch_interval_minutes: 10,
        closing_line_capture_minutes_before_game: 5,
        stale_sharp_max_age_minutes: 60,
      })
    ).toThrow()
  })

  it('requires at least one book', () => {
    expect(() =>
      parseConfig({
        books: [],
        manual_books: [],
        sharp_anchor: 'pinnacle',
        ev_threshold: 0.02,
        max_sharp_implied_prob: 0.75,
        sports: ['nba'],
        bankroll_units: 100,
        unit_size_cad: 25,
        watch_interval_minutes: 10,
        closing_line_capture_minutes_before_game: 5,
        stale_sharp_max_age_minutes: 60,
      })
    ).toThrow()
  })
})
