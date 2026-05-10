import { fetchNbaBoxScore } from './nba.js'
import { fetchMlbBoxScore } from './mlb.js'
import { fetchNhlBoxScore } from './nhl.js'
import type { BoxScoreStats } from './nba.js'
export type { BoxScoreStats } from './nba.js'

export async function fetchBoxScore(sport: 'nba'|'mlb'|'nhl', gameId: string): Promise<BoxScoreStats> {
  switch (sport) {
    case 'nba': return fetchNbaBoxScore(gameId)
    case 'mlb': return fetchMlbBoxScore(gameId)
    case 'nhl': return fetchNhlBoxScore(gameId)
  }
}
