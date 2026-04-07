import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchPinnacleNba, type OddsApiGameData } from '../../src/sources/odds-api.js'

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
      {
        key: 'bet365',
        title: 'bet365',
        markets: [
          {
            key: 'h2h',
            outcomes: [
              { name: 'Denver Nuggets', price: -125 },
              { name: 'Los Angeles Lakers', price: 105 },
            ],
          },
          {
            key: 'totals',
            outcomes: [
              { name: 'Over', price: -110, point: 224.5 },
              { name: 'Under', price: -110, point: 224.5 },
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

  it('parses bet365 moneyline', async () => {
    const result = await fetchPinnacleNba('FAKE_KEY')
    const game = result[0]!
    expect(game.bet365MlHome).toBe(-125)
    expect(game.bet365MlAway).toBe(105)
  })

  it('parses bet365 totals when line matches Pinnacle', async () => {
    const result = await fetchPinnacleNba('FAKE_KEY')
    const game = result[0]!
    expect(game.bet365Over).toBe(-110)
    expect(game.bet365Under).toBe(-110)
  })

  it('omits bet365 totals when line does not match Pinnacle', async () => {
    const differentLineFakeResponse = [
      {
        ...FAKE_RESPONSE[0],
        bookmakers: [
          FAKE_RESPONSE[0]!.bookmakers[0]!, // pinnacle
          {
            key: 'bet365',
            title: 'bet365',
            markets: [
              {
                key: 'h2h',
                outcomes: [
                  { name: 'Denver Nuggets', price: -125 },
                  { name: 'Los Angeles Lakers', price: 105 },
                ],
              },
              {
                key: 'totals',
                outcomes: [
                  { name: 'Over', price: -110, point: 225.0 }, // different line
                  { name: 'Under', price: -110, point: 225.0 },
                ],
              },
            ],
          },
        ],
      },
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => differentLineFakeResponse,
      }))
    )
    const result = await fetchPinnacleNba('FAKE_KEY')
    const game = result[0]!
    expect(game.bet365Over).toBeNull()
    expect(game.bet365Under).toBeNull()
    // But moneyline should still be populated
    expect(game.bet365MlHome).toBe(-125)
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

  it('leaves bet365 fields null when bet365 bookmaker is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => [
          { ...FAKE_RESPONSE[0], bookmakers: [FAKE_RESPONSE[0]!.bookmakers[0]!] },
        ],
      }))
    )
    const result = await fetchPinnacleNba('FAKE_KEY')
    const game = result[0]!
    expect(game.bet365MlHome).toBeNull()
    expect(game.bet365MlAway).toBeNull()
    expect(game.bet365Over).toBeNull()
    expect(game.bet365Under).toBeNull()
  })
})
