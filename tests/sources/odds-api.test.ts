import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchPinnacleNba, type PinnacleGame } from '../../src/sources/odds-api.js'

const FAKE_RESPONSE = [
  {
    id: 'abc123',
    sport_key: 'basketball_nba',
    commence_time: '2026-04-07T01:30:00Z',
    home_team: 'Denver Nuggets',
    away_team: 'Los Angeles Lakers',
    bookmakers: [
      {
        key: 'pinnacle',
        title: 'Pinnacle',
        markets: [
          {
            key: 'h2h',
            outcomes: [
              { name: 'Denver Nuggets', price: -130 },
              { name: 'Los Angeles Lakers', price: 112 },
            ],
          },
          {
            key: 'totals',
            outcomes: [
              { name: 'Over', price: -108, point: 224.5 },
              { name: 'Under', price: -112, point: 224.5 },
            ],
          },
        ],
      },
    ],
  },
]

describe('fetchPinnacleNba', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => FAKE_RESPONSE,
      }))
    )
  })

  it('parses Pinnacle moneyline', async () => {
    const result = await fetchPinnacleNba('FAKE_KEY')
    expect(result).toHaveLength(1)
    const game = result[0]!
    expect(game.homeTeam).toBe('Denver Nuggets')
    expect(game.mlHome).toBe(-130)
    expect(game.mlAway).toBe(112)
  })

  it('parses Pinnacle total', async () => {
    const result = await fetchPinnacleNba('FAKE_KEY')
    const game = result[0]!
    expect(game.totalLine).toBe(224.5)
    expect(game.over).toBe(-108)
    expect(game.under).toBe(-112)
  })

  it('omits games with no Pinnacle bookmaker', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => [{ ...FAKE_RESPONSE[0], bookmakers: [] }],
      }))
    )
    const result = await fetchPinnacleNba('FAKE_KEY')
    expect(result).toEqual([])
  })
})
