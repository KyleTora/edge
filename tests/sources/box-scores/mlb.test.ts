import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseMlbBoxScore } from '../../../src/sources/box-scores/mlb.js'

const fixture = JSON.parse(readFileSync(join(__dirname, '../../fixtures/box-score-mlb.json'), 'utf-8'))

describe('parseMlbBoxScore', () => {
  it('extracts batting stats keyed by player id', () => {
    const stats = parseMlbBoxScore(fixture)
    const vlad = stats.byPlayer['660271']
    expect(vlad.hits).toBe(2)
    expect(vlad.total_bases).toBe(4)
    expect(vlad.rbis).toBe(1)
  })
})
