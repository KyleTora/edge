const AN_BASE = 'https://api.actionnetwork.com/web/v1'

const BOOK_NAMES: Record<number, string> = {
  15: 'DraftKings',
  30: 'FanDuel',
  68: 'BetMGM',
  69: 'Caesars',
  71: 'Fanatics',
  75: 'BetRivers',
}

export interface ActionNetworkOdds {
  gameId: string
  startTime: string
  homeTeam: string
  awayTeam: string
  books: BookOdds[]
}

export interface BookOdds {
  bookId: number
  bookName: string
  mlHome: number | null
  mlAway: number | null
  total: number | null
  over: number | null
  under: number | null
}

interface ANGame {
  id: number
  home_team_id: number
  away_team_id: number
  start_time: string
  status: string
  teams: Array<{ id: number; full_name: string }>
  odds: Array<{
    book_id: number
    type: string
    ml_home: number | null
    ml_away: number | null
    total: number | null
    over: number | null
    under: number | null
  }>
}

async function fetchScoreboard(sportPath: string): Promise<ActionNetworkOdds[]> {
  const res = await fetch(`${AN_BASE}/scoreboard/${sportPath}`, {
    headers: { 'User-Agent': 'edge-cli/0.1.0' },
  })
  if (!res.ok) throw new Error(`Action Network ${sportPath} error: ${res.status}`)
  const data = (await res.json()) as { games: ANGame[] }

  const results: ActionNetworkOdds[] = []
  for (const game of data.games ?? []) {
    if (game.status === 'complete' || game.status === 'canceled') continue
    const home = game.teams.find((t) => t.id === game.home_team_id)
    const away = game.teams.find((t) => t.id === game.away_team_id)
    if (!home || !away) continue

    const books: BookOdds[] = []
    for (const o of game.odds) {
      if (o.type !== 'game') continue
      const bookName = BOOK_NAMES[o.book_id]
      if (!bookName) continue
      books.push({
        bookId: o.book_id,
        bookName,
        mlHome: o.ml_home,
        mlAway: o.ml_away,
        total: o.total,
        over: o.over,
        under: o.under,
      })
    }

    if (books.length === 0) continue
    results.push({
      gameId: String(game.id),
      startTime: game.start_time,
      homeTeam: home.full_name,
      awayTeam: away.full_name,
      books,
    })
  }
  return results
}

export function fetchActionNetworkNba(): Promise<ActionNetworkOdds[]> {
  return fetchScoreboard('nba')
}

export function fetchActionNetworkMlb(): Promise<ActionNetworkOdds[]> {
  return fetchScoreboard('mlb')
}

export function fetchActionNetworkNhl(): Promise<ActionNetworkOdds[]> {
  return fetchScoreboard('nhl')
}
