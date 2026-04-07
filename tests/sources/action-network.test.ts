import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchActionNetworkNba, type ActionNetworkOdds } from '../../src/sources/action-network.js'

const FAKE_RESPONSE = {
  games: [
    {
      id: 12345,
      home_team_id: 1,
      away_team_id: 2,
      start_time: '2026-04-07T01:30:00Z',
      status: 'scheduled',
      teams: [
        { id: 1, full_name: 'Denver Nuggets' },
        { id: 2, full_name: 'Los Angeles Lakers' },
      ],
      odds: [
        {
          book_id: 68,
          type: 'game',
          ml_home: -120,
          ml_away: 110,
          total: 224.5,
          over: -110,
          under: -110,
        },
        {
          book_id: 15,
          type: 'game',
          ml_home: -118,
          ml_away: 108,
          total: 224.5,
          over: -108,
          under: -112,
        },
      ],
    },
    {
      id: 99999,
      home_team_id: 3,
      away_team_id: 4,
      start_time: '2026-04-07T02:00:00Z',
      status: 'complete',
      teams: [
        { id: 3, full_name: 'X' },
        { id: 4, full_name: 'Y' },
      ],
      odds: [],
    },
  ],
}

describe('fetchActionNetworkNba', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => FAKE_RESPONSE,
      }))
    )
  })

  it('returns parsed odds for scheduled games', async () => {
    const result = await fetchActionNetworkNba()
    expect(result).toHaveLength(1)
    const game = result[0]!
    expect(game.homeTeam).toBe('Denver Nuggets')
    expect(game.awayTeam).toBe('Los Angeles Lakers')
    expect(game.books).toHaveLength(2)
  })

  it('omits completed games', async () => {
    const result = await fetchActionNetworkNba()
    expect(result.find((g) => g.gameId === '99999')).toBeUndefined()
  })

  it('maps book ids to names', async () => {
    const result = await fetchActionNetworkNba()
    const books = result[0]!.books.map((b) => b.bookName).sort()
    expect(books).toEqual(['BetMGM', 'DraftKings'])
  })
})
