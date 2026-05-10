// src/sources/action-network-props.ts
const AN_BASE = 'https://api.actionnetwork.com/web/v1'
const PINNACLE_BOOK_ID = 238

const NBA_MARKET_MAP: Record<string, string> = {
  'core_bet_type_44_points': 'points',
  'core_bet_type_45_rebounds': 'rebounds',
  'core_bet_type_46_assists': 'assists',
  'core_bet_type_47_threes_made': 'threes_made',
}
const MLB_MARKET_MAP: Record<string, string> = {
  'core_bet_type_88_hits': 'hits',
  'core_bet_type_89_total_bases': 'total_bases',
  'core_bet_type_90_rbis': 'rbis',
  'core_bet_type_91_strikeouts_pitcher': 'strikeouts_pitcher',
}
const NHL_MARKET_MAP: Record<string, string> = {
  'core_bet_type_120_shots_on_goal': 'shots_on_goal',
  'core_bet_type_121_points_player': 'points_player',
}

const MAPS: Record<string, Record<string, string>> = {
  nba: NBA_MARKET_MAP, mlb: MLB_MARKET_MAP, nhl: NHL_MARKET_MAP,
}

const BOOK_NAMES: Record<number, string> = {
  15: 'draftkings', 30: 'fanduel', 68: 'betmgm', 69: 'caesars', 71: 'fanatics', 75: 'betrivers',
  238: 'pinnacle',
}

export interface PropSide {
  pinnacle: { sidePrice: number; oppositePrice: number } | null
  books: Array<{ book: string; price: number; oppositePrice: number }>
}

export interface PropMarket {
  game_id: string
  sport: 'nba' | 'mlb' | 'nhl'
  player_id: string
  player_name: string
  prop_market: string
  prop_line: number
  over: PropSide
  under: PropSide
}

interface ANProp {
  player_id: number
  value: number
  side: 'over' | 'under'
  money: number
}

interface ANPlayer { id: number; full_name: string }

interface ANPropMarket {
  name: string
  books: Array<{ book_id: number; odds: ANProp[] }>
}

export interface ANPropsPayload {
  markets: ANPropMarket[]
  players: ANPlayer[]
}

export interface ParseOptions {
  sport: 'nba' | 'mlb' | 'nhl'
  gameId: string
}

export function parseActionNetworkProps(
  payload: ANPropsPayload,
  opts: ParseOptions,
): PropMarket[] {
  const map = MAPS[opts.sport] ?? {}
  const playerById = new Map<number, string>(payload.players.map((p) => [p.id, p.full_name]))
  const out: PropMarket[] = []

  for (const market of payload.markets) {
    const propMarket = map[market.name]
    if (!propMarket) continue

    // index odds by (player_id, line, side)
    const grouped = new Map<string, { over: ANProp[]; under: ANProp[]; line: number; player_id: number }>()
    for (const book of market.books) {
      for (const o of book.odds) {
        const key = `${o.player_id}|${o.value}`
        let entry = grouped.get(key)
        if (!entry) {
          entry = { over: [], under: [], line: o.value, player_id: o.player_id }
          grouped.set(key, entry)
        }
        ;(entry as any)[o.side].push({ ...o, _bookId: book.book_id })
      }
    }

    for (const entry of grouped.values()) {
      // need both sides present
      if (entry.over.length === 0 || entry.under.length === 0) continue

      const collectSide = (myList: any[], otherList: any[]): PropSide => {
        const otherByBook = new Map<number, any>(otherList.map((o) => [o._bookId, o]))
        const pinnacleMine = myList.find((o) => o._bookId === PINNACLE_BOOK_ID)
        const pinnacleOther = otherByBook.get(PINNACLE_BOOK_ID)
        const pinnacle = pinnacleMine && pinnacleOther
          ? { sidePrice: pinnacleMine.money, oppositePrice: pinnacleOther.money }
          : null
        const books: Array<{ book: string; price: number; oppositePrice: number }> = []
        for (const o of myList) {
          const opp = otherByBook.get(o._bookId)
          if (!opp) continue
          const bookName = BOOK_NAMES[o._bookId]
          if (!bookName) continue
          books.push({ book: bookName, price: o.money, oppositePrice: opp.money })
        }
        return { pinnacle, books }
      }

      const playerName = playerById.get(entry.player_id) ?? `player_${entry.player_id}`
      out.push({
        game_id: opts.gameId,
        sport: opts.sport,
        player_id: String(entry.player_id),
        player_name: playerName,
        prop_market: propMarket,
        prop_line: entry.line,
        over: collectSide(entry.over, entry.under),
        under: collectSide(entry.under, entry.over),
      })
    }
  }
  return out
}

export async function fetchActionNetworkProps(opts: ParseOptions): Promise<PropMarket[]> {
  const url = `${AN_BASE}/games/${opts.gameId}/player_props?bookIds=15,30,68,69,71,75,238`
  const res = await fetch(url, { headers: { 'User-Agent': 'edge-cli/0.2' } })
  if (!res.ok) throw new Error(`AN props fetch failed: ${res.status}`)
  const json = (await res.json()) as ANPropsPayload
  return parseActionNetworkProps(json, opts)
}
