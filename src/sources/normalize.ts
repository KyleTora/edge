import type { ActionNetworkOdds } from './action-network.js'
import type { PinnacleGame } from './odds-api.js'

export type Market = 'moneyline' | 'total'

export interface MoneylineSnapshot {
  market: 'moneyline'
  sport: string
  gameId: string
  startTime: string
  homeTeam: string
  awayTeam: string
  line: null
  sharp: { home: number; away: number }
  bookPrices: Record<string, { home: number; away: number }>
}

export interface TotalSnapshot {
  market: 'total'
  sport: string
  gameId: string
  startTime: string
  homeTeam: string
  awayTeam: string
  line: number
  sharp: { over: number; under: number }
  bookPrices: Record<string, { over: number; under: number }>
}

export type MarketSnapshot = MoneylineSnapshot | TotalSnapshot

export interface JoinSourcesInput {
  sport: string
  actionNetwork: ActionNetworkOdds[]
  pinnacle: PinnacleGame[]
}

const norm = (s: string): string => s.toLowerCase().trim()

function findPinnacleMatch(
  an: ActionNetworkOdds,
  pinnacle: PinnacleGame[]
): PinnacleGame | undefined {
  return pinnacle.find(
    (p) =>
      norm(p.homeTeam) === norm(an.homeTeam) &&
      norm(p.awayTeam) === norm(an.awayTeam)
  )
}

export function joinSources({
  sport,
  actionNetwork,
  pinnacle,
}: JoinSourcesInput): MarketSnapshot[] {
  const out: MarketSnapshot[] = []

  for (const game of actionNetwork) {
    const sharp = findPinnacleMatch(game, pinnacle)
    if (!sharp) continue

    // Moneyline
    if (sharp.mlHome !== null && sharp.mlAway !== null) {
      const bookPrices: Record<string, { home: number; away: number }> = {}
      for (const b of game.books) {
        if (b.mlHome !== null && b.mlAway !== null) {
          bookPrices[b.bookName] = { home: b.mlHome, away: b.mlAway }
        }
      }
      if (sharp.bet365MlHome !== null && sharp.bet365MlAway !== null) {
        bookPrices['bet365'] = { home: sharp.bet365MlHome, away: sharp.bet365MlAway }
      }
      out.push({
        market: 'moneyline',
        sport,
        gameId: game.gameId,
        startTime: game.startTime,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        line: null,
        sharp: { home: sharp.mlHome, away: sharp.mlAway },
        bookPrices,
      })
    }

    // Totals
    if (sharp.totalLine !== null && sharp.over !== null && sharp.under !== null) {
      const bookPrices: Record<string, { over: number; under: number }> = {}
      for (const b of game.books) {
        if (b.over !== null && b.under !== null && b.total === sharp.totalLine) {
          bookPrices[b.bookName] = { over: b.over, under: b.under }
        }
      }
      if (sharp.bet365Over !== null && sharp.bet365Under !== null) {
        bookPrices['bet365'] = { over: sharp.bet365Over, under: sharp.bet365Under }
      }
      out.push({
        market: 'total',
        sport,
        gameId: game.gameId,
        startTime: game.startTime,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        line: sharp.totalLine,
        sharp: { over: sharp.over, under: sharp.under },
        bookPrices,
      })
    }
  }

  return out
}
