import type { BoxScoreStats } from './nba.js'  // reuse type
export type { BoxScoreStats } from './nba.js'

export function parseMlbBoxScore(raw: any): BoxScoreStats {
  const status = String(raw?.game_status ?? '').toLowerCase()
  const gameStatus: BoxScoreStats['gameStatus'] =
    status === 'final' ? 'final' :
    status === 'in progress' || status.includes('inning') ? 'in_progress' :
    status === 'postponed' ? 'postponed' :
    status === 'scheduled' || status === 'pre-game' ? 'not_started' :
    'unknown'
  const byPlayer: BoxScoreStats['byPlayer'] = {}
  for (const team of ['home','away'] as const) {
    const players = raw?.teams?.[team]?.players ?? {}
    for (const k of Object.keys(players)) {
      const p = players[k]
      const id = String(p?.person?.id)
      if (!id) continue
      const batting = p?.stats?.batting ?? {}
      const pitching = p?.stats?.pitching ?? {}
      byPlayer[id] = {
        hits: batting.hits ?? 0,
        total_bases: batting.totalBases ?? 0,
        rbis: batting.rbi ?? 0,
        strikeouts_pitcher: pitching.strikeOuts ?? 0,
      }
    }
  }
  return { gameStatus, byPlayer }
}

export async function fetchMlbBoxScore(gamePk: string): Promise<BoxScoreStats> {
  const res = await fetch(`https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`)
  if (!res.ok) throw new Error(`MLB box-score fetch failed: ${res.status}`)
  const raw = await res.json()
  // statsapi puts game status under a different endpoint; merge in here:
  const live = await fetch(`https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`)
  if (live.ok) {
    const liveJson: any = await live.json()
    raw.game_status = liveJson?.gameData?.status?.detailedState
  }
  return parseMlbBoxScore(raw)
}
