import type { BoxScoreStats } from './nba.js'

export function parseNhlBoxScore(raw: any): BoxScoreStats {
  const status = String(raw?.gameState ?? '').toLowerCase()
  const gameStatus: BoxScoreStats['gameStatus'] =
    status === 'final' || status === 'off' ? 'final' :
    status === 'live' || status === 'crit' ? 'in_progress' :
    status === 'postponed' || status === 'pp' ? 'postponed' :
    status === 'fut' || status === 'pre' ? 'not_started' :
    'unknown'
  const byPlayer: BoxScoreStats['byPlayer'] = {}
  for (const teamSide of ['homeTeam','awayTeam'] as const) {
    const team = raw?.playerByGameStats?.[teamSide]
    for (const skater of team?.skaters ?? []) {
      byPlayer[String(skater.playerId)] = {
        shots_on_goal: skater.shots ?? 0,
        points_player: skater.points ?? 0,
      }
    }
  }
  return { gameStatus, byPlayer }
}

export async function fetchNhlBoxScore(gameId: string): Promise<BoxScoreStats> {
  const res = await fetch(`https://api-web.nhle.com/v1/gamecenter/${gameId}/boxscore`)
  if (!res.ok) throw new Error(`NHL box-score fetch failed: ${res.status}`)
  return parseNhlBoxScore(await res.json())
}
