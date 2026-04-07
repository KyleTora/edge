import { describe, it, expect } from 'vitest'
import { gradeMoneyline, gradeTotal, gradeSpread, type Outcome } from '../../src/resolve/grading-rules.js'

describe('gradeMoneyline', () => {
  it('home wins → won when side=home', () => {
    expect(gradeMoneyline({ side: 'home', homeScore: 5, awayScore: 3 })).toBe<Outcome>('won')
  })
  it('home wins → lost when side=away', () => {
    expect(gradeMoneyline({ side: 'away', homeScore: 5, awayScore: 3 })).toBe<Outcome>('lost')
  })
  it('tie → push for either side', () => {
    expect(gradeMoneyline({ side: 'home', homeScore: 2, awayScore: 2 })).toBe<Outcome>('push')
    expect(gradeMoneyline({ side: 'away', homeScore: 2, awayScore: 2 })).toBe<Outcome>('push')
  })
})

describe('gradeTotal', () => {
  it('total > line and side=over → won', () => {
    expect(gradeTotal({ side: 'over', line: 8.5, homeScore: 5, awayScore: 4 })).toBe<Outcome>('won')
  })
  it('total < line and side=over → lost', () => {
    expect(gradeTotal({ side: 'over', line: 8.5, homeScore: 4, awayScore: 4 })).toBe<Outcome>('lost')
  })
  it('total == line → push', () => {
    expect(gradeTotal({ side: 'over', line: 9, homeScore: 5, awayScore: 4 })).toBe<Outcome>('push')
    expect(gradeTotal({ side: 'under', line: 9, homeScore: 5, awayScore: 4 })).toBe<Outcome>('push')
  })
  it('total < line and side=under → won', () => {
    expect(gradeTotal({ side: 'under', line: 8.5, homeScore: 4, awayScore: 4 })).toBe<Outcome>('won')
  })
})

describe('gradeSpread', () => {
  it('home -3.5 covers when home wins by 4', () => {
    expect(gradeSpread({ side: 'home', line: -3.5, homeScore: 7, awayScore: 3 })).toBe<Outcome>('won')
  })
  it('home -3.5 fails when home wins by 3', () => {
    expect(gradeSpread({ side: 'home', line: -3.5, homeScore: 6, awayScore: 3 })).toBe<Outcome>('lost')
  })
  it('away +7 covers when away loses by 6', () => {
    expect(gradeSpread({ side: 'away', line: 7, homeScore: 10, awayScore: 4 })).toBe<Outcome>('won')
  })
  it('exact spread → push', () => {
    expect(gradeSpread({ side: 'home', line: -3, homeScore: 6, awayScore: 3 })).toBe<Outcome>('push')
  })
})
