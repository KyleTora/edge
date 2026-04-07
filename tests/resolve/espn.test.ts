import { describe, it, expect } from 'vitest'
import { parseEspnScoreboard, espnUrl } from '../../src/resolve/espn.js'

describe('espnUrl', () => {
  it('produces the correct URL for MLB', () => {
    expect(espnUrl('mlb', '2026-04-07')).toBe(
      'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=20260407'
    )
  })
  it('produces the correct URL for NBA', () => {
    expect(espnUrl('nba', '2026-04-07')).toBe(
      'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20260407'
    )
  })
  it('produces the correct URL for NHL', () => {
    expect(espnUrl('nhl', '2026-04-07')).toBe(
      'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=20260407'
    )
  })
  it('throws on unknown sport', () => {
    expect(() => espnUrl('cricket' as never, '2026-04-07')).toThrow()
  })
})

describe('parseEspnScoreboard', () => {
  it('extracts final games with home/away scores', () => {
    const fixture = {
      events: [
        {
          date: '2026-04-07T23:00Z',
          status: { type: { name: 'STATUS_FINAL' } },
          competitions: [
            {
              competitors: [
                { homeAway: 'home', team: { displayName: 'Denver Nuggets' }, score: '110' },
                { homeAway: 'away', team: { displayName: 'Los Angeles Lakers' }, score: '105' },
              ],
            },
          ],
        },
      ],
    }
    const games = parseEspnScoreboard('nba', fixture)
    expect(games).toEqual([
      {
        sport: 'nba',
        gameDate: '2026-04-07',
        homeTeam: 'Denver Nuggets',
        awayTeam: 'Los Angeles Lakers',
        homeTeamCanonical: 'nuggets',
        awayTeamCanonical: 'lakers',
        homeScore: 110,
        awayScore: 105,
        status: 'final',
      },
    ])
  })

  it('marks postponed games', () => {
    const fixture = {
      events: [
        {
          date: '2026-04-07T20:00Z',
          status: { type: { name: 'STATUS_POSTPONED' } },
          competitions: [
            {
              competitors: [
                { homeAway: 'home', team: { displayName: 'NY Yankees' }, score: '0' },
                { homeAway: 'away', team: { displayName: 'Boston Red Sox' }, score: '0' },
              ],
            },
          ],
        },
      ],
    }
    const games = parseEspnScoreboard('mlb', fixture)
    expect(games[0]!.status).toBe('postponed')
  })

  it('skips games still in progress', () => {
    const fixture = {
      events: [
        {
          date: '2026-04-07T20:00Z',
          status: { type: { name: 'STATUS_IN_PROGRESS' } },
          competitions: [
            {
              competitors: [
                { homeAway: 'home', team: { displayName: 'X' }, score: '3' },
                { homeAway: 'away', team: { displayName: 'Y' }, score: '2' },
              ],
            },
          ],
        },
      ],
    }
    expect(parseEspnScoreboard('mlb', fixture)).toEqual([])
  })
})
