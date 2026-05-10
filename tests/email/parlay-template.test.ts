import { describe, it, expect } from 'vitest'
import { renderParlayEmail } from '../../src/email/parlay-template.js'

describe('renderParlayEmail', () => {
  it('renders subject + html with leg cards and buttons', () => {
    const result = renderParlayEmail({
      cardDate: '2026-05-10',
      parlayId: 'p-1',
      combinedOdds: 105,
      combinedProb: 0.49,
      recommendedStake: 40,
      streakAtCreation: 2,
      lifetime: { wins: 5, losses: 4, pnl: 35 },
      legs: [
        { player_name: 'LeBron James', prop_market: 'points', prop_line: 22.5, prop_side: 'over',
          price_american: -240, true_prob: 0.72, is_filler: false, book: 'draftkings',
          sport: 'nba', game_label: 'LAL @ BOS' },
        { player_name: 'Vlad Guerrero Jr.', prop_market: 'hits', prop_line: 0.5, prop_side: 'over',
          price_american: -260, true_prob: 0.74, is_filler: true, book: 'betmgm',
          sport: 'mlb', game_label: 'TOR @ NYY' },
      ],
      betUrl: 'https://w.example/mark?p=p-1&a=bet&t=abc',
      skipUrl: 'https://w.example/mark?p=p-1&a=skip&t=def',
    })
    expect(result.subject).toContain('Edge Parlay')
    expect(result.subject).toContain('May 10')
    expect(result.html).toContain('LeBron James')
    expect(result.html).toContain('Vlad Guerrero')
    expect(result.html).toContain('+105')
    expect(result.html).toContain('$40')
    expect(result.html).toContain('Skip this one')
    expect(result.html).toContain('Confirm bet')
    expect(result.html).toContain('https://w.example/mark?p=p-1&a=bet&t=abc')
    expect(result.html).toContain('https://w.example/mark?p=p-1&a=skip&t=def')
    expect(result.html).toContain('filler')
  })

  it('renders skip-day message when no legs', () => {
    const result = renderParlayEmail({
      cardDate: '2026-05-10', parlayId: 'p-1',
      combinedOdds: 0, combinedProb: 0, recommendedStake: 0, streakAtCreation: 0,
      lifetime: { wins: 0, losses: 0, pnl: 0 }, legs: [],
      betUrl: '', skipUrl: '',
      noParlayReason: 'no candidates met thresholds',
    })
    expect(result.subject).toContain('Skip Day')
    expect(result.html).toContain('No parlay today')
  })
})
