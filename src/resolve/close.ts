import type { EdgeSupabase } from '../db/client.js'
import type { Config, Env } from '../config.js'
import {
  listPicksAwaitingClose,
  insertClosingLine,
  type PickRow,
} from '../db/queries.js'
import { devigTwoWay } from '../engine/devig.js'
import {
  fetchPinnacleNba,
  fetchPinnacleMlb,
  fetchPinnacleNhl,
  type PinnacleGame,
} from '../sources/odds-api.js'
import {
  fetchActionNetworkNba,
  fetchActionNetworkMlb,
  fetchActionNetworkNhl,
  type ActionNetworkOdds,
} from '../sources/action-network.js'

export interface CaptureSummary {
  captured: number
  gamesProcessed: number
}

export interface CaptureClosingLinesInput {
  supabase: EdgeSupabase
  config: Config
  env: Env
  now?: Date
  windowMinutes?: number
  fetchPinnacle?: (sport: string, env: Env) => Promise<PinnacleGame[]>
  fetchActionNetwork?: (sport: string) => Promise<ActionNetworkOdds[]>
}

const DEFAULT_WINDOW = 15

export async function captureClosingLines(
  input: CaptureClosingLinesInput
): Promise<CaptureSummary> {
  const now = input.now ?? new Date()
  const windowMinutes = input.windowMinutes ?? DEFAULT_WINDOW
  const fetchPinnacle = input.fetchPinnacle ?? defaultFetchPinnacle
  const fetchActionNetwork = input.fetchActionNetwork ?? defaultFetchActionNetwork

  const picks = await listPicksAwaitingClose(input.supabase, now, windowMinutes)
  if (picks.length === 0) return { captured: 0, gamesProcessed: 0 }

  const bySport = new Map<string, PickRow[]>()
  for (const p of picks) {
    const list = bySport.get(p.sport) ?? []
    list.push(p)
    bySport.set(p.sport, list)
  }

  let captured = 0
  let gamesProcessed = 0
  const seenGames = new Set<string>()

  for (const [sport, sportPicks] of bySport) {
    let pinnacleGames: PinnacleGame[] = []
    let actionNetworkGames: ActionNetworkOdds[] = []
    try {
      ;[pinnacleGames, actionNetworkGames] = await Promise.all([
        fetchPinnacle(sport, input.env),
        fetchActionNetwork(sport),
      ])
    } catch (err) {
      console.error(
        `captureClosingLines: source fetch failed for ${sport}: ${(err as Error).message}`
      )
      continue
    }

    for (const pick of sportPicks) {
      const sharp = pinnacleGames.find(
        (p) =>
          normalizeName(p.homeTeam) === normalizeName(pick.home_team) &&
          normalizeName(p.awayTeam) === normalizeName(pick.away_team)
      )
      if (!sharp) continue

      const sharpClose = pickSharpPrice(sharp, pick)
      if (sharpClose === null) continue

      const sharpImplied = computeSharpImplied(sharp, pick)
      if (sharpImplied === null) continue

      const an = actionNetworkGames.find(
        (g) =>
          normalizeName(g.homeTeam) === normalizeName(pick.home_team) &&
          normalizeName(g.awayTeam) === normalizeName(pick.away_team)
      )
      const bestBookClose = an ? pickBestBookPrice(an, pick, input.config.books) : null

      const lagMin = Math.round(
        (now.getTime() - new Date(pick.game_time).getTime()) / 60000
      )

      await insertClosingLine(input.supabase, {
        pick_id: pick.id,
        closed_at: now.toISOString(),
        sharp_close: sharpClose,
        sharp_implied: sharpImplied,
        best_book_close: bestBookClose,
        capture_lag_min: lagMin,
      })
      captured++
      if (!seenGames.has(pick.game_id)) {
        seenGames.add(pick.game_id)
        gamesProcessed++
      }
    }
  }

  return { captured, gamesProcessed }
}

function defaultFetchPinnacle(sport: string, env: Env): Promise<PinnacleGame[]> {
  if (sport === 'nba') return fetchPinnacleNba(env.ODDS_API_KEY)
  if (sport === 'mlb') return fetchPinnacleMlb(env.ODDS_API_KEY)
  if (sport === 'nhl') return fetchPinnacleNhl(env.ODDS_API_KEY)
  throw new Error(`captureClosingLines: unsupported sport ${sport}`)
}

function defaultFetchActionNetwork(sport: string): Promise<ActionNetworkOdds[]> {
  if (sport === 'nba') return fetchActionNetworkNba()
  if (sport === 'mlb') return fetchActionNetworkMlb()
  if (sport === 'nhl') return fetchActionNetworkNhl()
  throw new Error(`captureClosingLines: unsupported sport ${sport}`)
}

function normalizeName(s: string): string {
  return s.toLowerCase().trim()
}

/**
 * The Pinnacle American odds for the side this pick is on. Returns null if
 * the sharp book has no price for that side (e.g. h2h missing, or total
 * line not posted).
 */
function pickSharpPrice(sharp: PinnacleGame, pick: PickRow): number | null {
  if (pick.market === 'moneyline') {
    if (pick.side === 'home') return sharp.mlHome
    if (pick.side === 'away') return sharp.mlAway
    return null
  }
  if (pick.market === 'total') {
    if (sharp.totalLine === null) return null
    if (pick.side === 'over') return sharp.over
    if (pick.side === 'under') return sharp.under
    return null
  }
  // spread is not offered by the Pinnacle h2h+totals fetch — skip.
  return null
}

/**
 * Devig the two-sided market and return the no-vig probability for the side
 * this pick is on.
 */
function computeSharpImplied(sharp: PinnacleGame, pick: PickRow): number | null {
  if (pick.market === 'moneyline') {
    if (sharp.mlHome === null || sharp.mlAway === null) return null
    const devigged = devigTwoWay(sharp.mlHome, sharp.mlAway)
    return pick.side === 'home' ? devigged.home : devigged.away
  }
  if (pick.market === 'total') {
    if (sharp.over === null || sharp.under === null) return null
    const devigged = devigTwoWay(sharp.over, sharp.under)
    return pick.side === 'over' ? devigged.home : devigged.away
  }
  return null
}

/**
 * Best (most generous) American odds across the allowlisted books for the
 * side this pick is on. Returns null if no allowed book has a price.
 *
 * "Best" = highest American odds: e.g. -105 is better than -110, +120 is
 * better than +110.
 */
function pickBestBookPrice(
  an: ActionNetworkOdds,
  pick: PickRow,
  allowed: string[]
): number | null {
  const allowSet = new Set(allowed.map((b) => b.toLowerCase()))
  const candidates: number[] = []

  for (const book of an.books) {
    if (!allowSet.has(book.bookName.toLowerCase())) continue
    let price: number | null = null
    if (pick.market === 'moneyline') {
      if (pick.side === 'home') price = book.mlHome
      else if (pick.side === 'away') price = book.mlAway
    } else if (pick.market === 'total') {
      if (pick.side === 'over') price = book.over
      else if (pick.side === 'under') price = book.under
    }
    if (price !== null && price !== undefined) candidates.push(price)
  }

  if (candidates.length === 0) return null
  return Math.max(...candidates)
}
