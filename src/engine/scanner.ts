import type { Config } from '../config.js'
import type { MarketSnapshot } from '../sources/normalize.js'
import type { PickRow } from '../db/queries.js'
import { devigTwoWay } from './devig.js'
import { computeEv, americanToPayout } from './ev.js'

export interface RankInput {
  snapshots: MarketSnapshot[]
  config: Config
  detectedAt: string
}

/** Candidate pick — a PickRow without card_date (assigned by the command layer). */
export type Candidate = Omit<PickRow, 'card_date'>

const norm = (s: string): string => s.toLowerCase()

function isAllowed(bookName: string, allowlist: string[]): boolean {
  const normalizedAllow = allowlist.map(norm)
  return normalizedAllow.includes(norm(bookName))
}

function gameDateFromIso(iso: string): string {
  return iso.slice(0, 10)
}

interface BestPrice {
  book: string
  price: number
  ev: number
}

function findBestPrice(
  trueProb: number,
  side: 'home' | 'away' | 'over' | 'under',
  bookPrices: Record<string, { home?: number; away?: number; over?: number; under?: number }>,
  allowlist: string[]
): { best: BestPrice | null; allPrices: Record<string, number> } {
  const allPrices: Record<string, number> = {}
  let best: BestPrice | null = null

  for (const [book, prices] of Object.entries(bookPrices)) {
    const price = (prices as Record<string, number | undefined>)[side]
    if (price === undefined) continue
    allPrices[book] = price
    if (!isAllowed(book, allowlist)) continue
    const ev = computeEv({ trueProb, offeredOdds: price })
    if (!best || ev > best.ev) {
      best = { book, price, ev }
    }
  }

  return { best, allPrices }
}

function computeScore(evPct: number, trueProb: number, payout: number): number {
  return evPct * Math.sqrt(trueProb * payout)
}

/**
 * Score every side of every snapshot and return all candidates sorted by score
 * descending. No filtering — the caller decides how many to take.
 */
export function rankCandidates({ snapshots, config, detectedAt }: RankInput): Candidate[] {
  const candidates: Candidate[] = []
  const detectedAtMs = Date.parse(detectedAt)

  for (const snap of snapshots) {
    if (Date.parse(snap.startTime) <= detectedAtMs) continue

    if (snap.market === 'moneyline') {
      const { home, away } = devigTwoWay(snap.sharp.home, snap.sharp.away)
      const sides: Array<{ side: 'home' | 'away'; trueProb: number }> = [
        { side: 'home', trueProb: home },
        { side: 'away', trueProb: away },
      ]

      for (const { side, trueProb } of sides) {
        const { best, allPrices } = findBestPrice(trueProb, side, snap.bookPrices, config.books)
        if (!best) continue
        const payout = americanToPayout(best.price)
        const score = computeScore(best.ev, trueProb, payout)
        candidates.push({
          id: `${gameDateFromIso(snap.startTime)}:${snap.sport}:${snap.gameId}:moneyline:${side}`,
          detected_at: detectedAt,
          sport: snap.sport,
          game_id: snap.gameId,
          game_date: gameDateFromIso(snap.startTime),
          game_time: snap.startTime,
          away_team: snap.awayTeam,
          home_team: snap.homeTeam,
          market: 'moneyline',
          side,
          line: null,
          best_book: best.book,
          best_price: best.price,
          sharp_book: 'pinnacle',
          sharp_implied: trueProb,
          ev_pct: best.ev,
          all_prices: allPrices,
          score,
          status: 'active',
        })
      }
    } else if (snap.market === 'total') {
      const { home: overProb, away: underProb } = devigTwoWay(snap.sharp.over, snap.sharp.under)
      const sides: Array<{ side: 'over' | 'under'; trueProb: number }> = [
        { side: 'over', trueProb: overProb },
        { side: 'under', trueProb: underProb },
      ]
      for (const { side, trueProb } of sides) {
        const { best, allPrices } = findBestPrice(trueProb, side, snap.bookPrices, config.books)
        if (!best) continue
        const payout = americanToPayout(best.price)
        const score = computeScore(best.ev, trueProb, payout)
        candidates.push({
          id: `${gameDateFromIso(snap.startTime)}:${snap.sport}:${snap.gameId}:total:${side}`,
          detected_at: detectedAt,
          sport: snap.sport,
          game_id: snap.gameId,
          game_date: gameDateFromIso(snap.startTime),
          game_time: snap.startTime,
          away_team: snap.awayTeam,
          home_team: snap.homeTeam,
          market: 'total',
          side,
          line: snap.line,
          best_book: best.book,
          best_price: best.price,
          sharp_book: 'pinnacle',
          sharp_implied: trueProb,
          ev_pct: best.ev,
          all_prices: allPrices,
          score,
          status: 'active',
        })
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score)
  return candidates
}
