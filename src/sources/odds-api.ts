const ODDS_API_BASE = 'https://api.the-odds-api.com/v4'

export interface OddsApiGameData {
  oddsApiId: string
  startTime: string
  homeTeam: string
  awayTeam: string
  mlHome: number | null
  mlAway: number | null
  totalLine: number | null
  over: number | null
  under: number | null
  bet365MlHome: number | null
  bet365MlAway: number | null
  bet365Over: number | null
  bet365Under: number | null
}

// Keep PinnacleGame as an alias so existing imports don't break
export type PinnacleGame = OddsApiGameData

interface OddsApiOutcome {
  name: string
  price: number
  point?: number
}

interface OddsApiMarket {
  key: string
  outcomes: OddsApiOutcome[]
}

interface OddsApiBookmaker {
  key: string
  title: string
  markets: OddsApiMarket[]
}

interface OddsApiGame {
  id: string
  commence_time: string
  home_team: string
  away_team: string
  bookmakers: OddsApiBookmaker[]
}

async function fetchSport(
  sportKey: string,
  apiKey: string
): Promise<OddsApiGameData[]> {
  const params = new URLSearchParams({
    apiKey,
    regions: 'eu,uk',
    markets: 'h2h,totals',
    oddsFormat: 'american',
    bookmakers: 'pinnacle,bet365',
  })
  const res = await fetch(`${ODDS_API_BASE}/sports/${sportKey}/odds?${params}`)
  if (!res.ok) throw new Error(`Odds API ${sportKey} error: ${res.status}`)
  const data = (await res.json()) as OddsApiGame[]

  const results: OddsApiGameData[] = []
  for (const g of data) {
    const pinnacle = g.bookmakers.find((b) => b.key === 'pinnacle')
    if (!pinnacle) continue

    const bet365 = g.bookmakers.find((b) => b.key === 'bet365')

    const h2h = pinnacle.markets.find((m) => m.key === 'h2h')
    const totals = pinnacle.markets.find((m) => m.key === 'totals')

    const mlHome = h2h?.outcomes.find((o) => o.name === g.home_team)?.price ?? null
    const mlAway = h2h?.outcomes.find((o) => o.name === g.away_team)?.price ?? null

    const overOutcome = totals?.outcomes.find((o) => o.name === 'Over')
    const underOutcome = totals?.outcomes.find((o) => o.name === 'Under')
    const pinnacleTotalLine = overOutcome?.point ?? null

    // bet365 moneyline — include unconditionally if present
    const bet365H2h = bet365?.markets.find((m) => m.key === 'h2h')
    const bet365MlHome = bet365H2h?.outcomes.find((o) => o.name === g.home_team)?.price ?? null
    const bet365MlAway = bet365H2h?.outcomes.find((o) => o.name === g.away_team)?.price ?? null

    // bet365 totals — only include if the line matches Pinnacle's
    const bet365Totals = bet365?.markets.find((m) => m.key === 'totals')
    const bet365OverOutcome = bet365Totals?.outcomes.find((o) => o.name === 'Over')
    const bet365UnderOutcome = bet365Totals?.outcomes.find((o) => o.name === 'Under')
    const bet365LineMatches =
      pinnacleTotalLine !== null &&
      bet365OverOutcome?.point === pinnacleTotalLine
    const bet365Over = bet365LineMatches ? (bet365OverOutcome?.price ?? null) : null
    const bet365Under = bet365LineMatches ? (bet365UnderOutcome?.price ?? null) : null

    results.push({
      oddsApiId: g.id,
      startTime: g.commence_time,
      homeTeam: g.home_team,
      awayTeam: g.away_team,
      mlHome,
      mlAway,
      totalLine: pinnacleTotalLine,
      over: overOutcome?.price ?? null,
      under: underOutcome?.price ?? null,
      bet365MlHome,
      bet365MlAway,
      bet365Over,
      bet365Under,
    })
  }
  return results
}

export function fetchPinnacleNba(apiKey: string): Promise<OddsApiGameData[]> {
  return fetchSport('basketball_nba', apiKey)
}

export function fetchPinnacleMlb(apiKey: string): Promise<OddsApiGameData[]> {
  return fetchSport('baseball_mlb', apiKey)
}

export function fetchPinnacleNhl(apiKey: string): Promise<OddsApiGameData[]> {
  return fetchSport('icehockey_nhl', apiKey)
}
