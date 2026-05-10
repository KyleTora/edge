export interface BoxScoreStats {
  gameStatus: 'final' | 'in_progress' | 'not_started' | 'postponed' | 'unknown'
  byPlayer: Record<string, Record<string, number>>
}

export function parseNbaBoxScore(raw: any): BoxScoreStats {
  const status = String(raw?.game?.status ?? '').toLowerCase()
  const gameStatus: BoxScoreStats['gameStatus'] =
    status === 'final' ? 'final' :
    status.includes('progress') || status.includes('quarter') ? 'in_progress' :
    status.includes('postpon') ? 'postponed' :
    status === 'scheduled' || status === 'pregame' ? 'not_started' :
    'unknown'
  const byPlayer: BoxScoreStats['byPlayer'] = {}
  for (const p of raw?.players ?? []) {
    byPlayer[String(p.id)] = p.stats ?? {}
  }
  return { gameStatus, byPlayer }
}

// Live source: stats.nba.com or ESPN unofficial. The exact endpoint requires
// reverse-engineering; the executor can switch the fetch URL once tested.
const NBA_BOX_URL = (gameId: string) =>
  `https://stats.nba.com/stats/boxscoretraditionalv2?GameID=${gameId}&StartPeriod=1&EndPeriod=10&StartRange=0&EndRange=28800&RangeType=0`

export async function fetchNbaBoxScore(gameId: string): Promise<BoxScoreStats> {
  const res = await fetch(NBA_BOX_URL(gameId), {
    headers: {
      'User-Agent': 'edge-cli/0.2',
      'Referer': 'https://www.nba.com/',
      'Accept': 'application/json',
    },
  })
  if (!res.ok) throw new Error(`NBA box-score fetch failed: ${res.status}`)
  const raw = await res.json()
  // stats.nba.com uses a row-based "resultSet" shape — normalize before parsing:
  return parseNbaBoxScore(normalizeNbaResultSet(raw, gameId))
}

function normalizeNbaResultSet(raw: any, gameId: string): any {
  // Minimal: locate the "PlayerStats" resultSet, project to {id, full_name, stats}.
  const sets = raw?.resultSets ?? []
  const ps = sets.find((s: any) => s.name === 'PlayerStats')
  if (!ps) return { game: { id: gameId, status: 'unknown' }, players: [] }
  const headers: string[] = ps.headers
  const idx = (k: string) => headers.indexOf(k)
  const players = (ps.rowSet ?? []).map((row: any[]) => ({
    id: String(row[idx('PLAYER_ID')]),
    full_name: row[idx('PLAYER_NAME')],
    stats: {
      points: row[idx('PTS')] ?? 0,
      rebounds: row[idx('REB')] ?? 0,
      assists: row[idx('AST')] ?? 0,
      threes_made: row[idx('FG3M')] ?? 0,
    },
  }))
  return { game: { id: gameId, status: 'Final' }, players }
}
