import { canonicalTeam } from './team-aliases.js'

export type EspnSport = 'mlb' | 'nba' | 'nhl'

const SPORT_PATHS: Record<EspnSport, string> = {
  mlb: 'baseball/mlb',
  nba: 'basketball/nba',
  nhl: 'hockey/nhl',
}

export function espnUrl(sport: EspnSport, gameDate: string): string {
  const path = SPORT_PATHS[sport]
  if (!path) throw new Error(`espnUrl: unsupported sport ${sport}`)
  const yyyymmdd = gameDate.replaceAll('-', '')
  return `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${yyyymmdd}`
}

export type EspnGameStatus = 'final' | 'postponed' | 'canceled'

export interface EspnGame {
  sport: EspnSport
  gameDate: string // YYYY-MM-DD
  homeTeam: string // raw display name
  awayTeam: string // raw display name
  homeTeamCanonical: string
  awayTeamCanonical: string
  homeScore: number
  awayScore: number
  status: EspnGameStatus
}

interface RawEvent {
  date?: string
  status?: { type?: { name?: string } }
  competitions?: Array<{
    competitors?: Array<{
      homeAway?: string
      team?: { displayName?: string }
      score?: string
    }>
  }>
}

export function parseEspnScoreboard(sport: EspnSport, payload: unknown): EspnGame[] {
  const events = (payload as { events?: RawEvent[] } | null | undefined)?.events ?? []
  const games: EspnGame[] = []
  for (const ev of events) {
    const statusName = ev.status?.type?.name ?? ''
    let status: EspnGameStatus | null = null
    if (statusName === 'STATUS_FINAL' || statusName === 'STATUS_FINAL_PEN') status = 'final'
    else if (statusName === 'STATUS_POSTPONED') status = 'postponed'
    else if (statusName === 'STATUS_CANCELED') status = 'canceled'
    if (!status) continue

    const comp = ev.competitions?.[0]
    if (!comp || !comp.competitors) continue
    const home = comp.competitors.find((c) => c.homeAway === 'home')
    const away = comp.competitors.find((c) => c.homeAway === 'away')
    if (!home?.team?.displayName || !away?.team?.displayName) continue

    const dateIso = ev.date ?? ''
    const gameDate = dateIso.slice(0, 10)

    games.push({
      sport,
      gameDate,
      homeTeam: home.team.displayName,
      awayTeam: away.team.displayName,
      homeTeamCanonical: canonicalTeam(sport, home.team.displayName),
      awayTeamCanonical: canonicalTeam(sport, away.team.displayName),
      homeScore: parseInt(home.score ?? '0', 10),
      awayScore: parseInt(away.score ?? '0', 10),
      status,
    })
  }
  return games
}

/**
 * Network fetcher used by `resolve/grade.ts`. Pure-fn wrapper around fetch
 * + parser so the orchestrator can be tested with a stub fetcher.
 */
export async function fetchEspnScoreboard(
  sport: EspnSport,
  gameDate: string,
  fetcher: typeof fetch = fetch
): Promise<EspnGame[]> {
  const url = espnUrl(sport, gameDate)
  const res = await fetcher(url)
  if (!res.ok) throw new Error(`ESPN ${sport} ${gameDate} error: ${res.status}`)
  const payload = await res.json()
  return parseEspnScoreboard(sport, payload)
}
