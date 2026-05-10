import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseNhlBoxScore } from '../../../src/sources/box-scores/nhl.js'

const fixture = JSON.parse(readFileSync(join(__dirname, '../../fixtures/box-score-nhl.json'), 'utf-8'))

describe('parseNhlBoxScore', () => {
  it('extracts skater stats keyed by player id', () => {
    const stats = parseNhlBoxScore(fixture)
    expect(stats.gameStatus).toBe('final')
    const mcdavid = stats.byPlayer['8478402']
    expect(mcdavid.shots_on_goal).toBe(5)
    expect(mcdavid.points_player).toBe(2)
  })
})
