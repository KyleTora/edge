import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseNbaBoxScore } from '../../../src/sources/box-scores/nba.js'

const fixture = JSON.parse(
  readFileSync(join(__dirname, '../../fixtures/box-score-nba.json'), 'utf-8'),
)

describe('parseNbaBoxScore', () => {
  it('extracts player stats by player_id', () => {
    const stats = parseNbaBoxScore(fixture)
    expect(stats.gameStatus).toBe('final')
    const lebron = stats.byPlayer['1628378']!
    expect(lebron.points).toBe(28)
    expect(lebron.rebounds).toBe(8)
  })

  it('returns "in_progress" or similar when not final', () => {
    const inFlight = { ...fixture, game: { ...fixture.game, status: 'InProgress' } }
    expect(parseNbaBoxScore(inFlight).gameStatus).not.toBe('final')
  })
})
