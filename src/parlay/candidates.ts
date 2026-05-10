// src/parlay/candidates.ts
import type { PropMarket, PropSide } from '../sources/action-network-props.js'
import type { LegCandidate } from './builder.js'
import { computeTrueProb } from './probability.js'
import { evPercent } from './odds.js'

export interface CandidateOptions {
  allowedBooks: string[]
}

function bestPriceForSide(side: PropSide, allowed: string[]): { book: string; price: number; oppositePrice: number } | null {
  const filtered = side.books.filter((b) => allowed.includes(b.book))
  if (filtered.length === 0) return null
  // for `over`, "best" = least negative / most positive (highest payout)
  return filtered.reduce((acc, b) => (b.price > acc.price ? b : acc), filtered[0])
}

export function propMarketsToCandidates(
  markets: PropMarket[],
  opts: CandidateOptions,
): LegCandidate[] {
  const out: LegCandidate[] = []
  for (const m of markets) {
    for (const sideName of ['over','under'] as const) {
      const side = m[sideName]
      const best = bestPriceForSide(side, opts.allowedBooks)
      if (!best) continue
      const truth = computeTrueProb({
        pinnacle: side.pinnacle,
        otherBooks: side.books.map((b) => ({ sidePrice: b.price, oppositePrice: b.oppositePrice })),
      })
      if (truth.prob === null) continue
      out.push({
        id: `${m.game_id}|${m.player_id}|${m.prop_market}|${m.prop_line}|${sideName}`,
        game_id: m.game_id,
        sport: m.sport,
        player_id: m.player_id,
        player_name: m.player_name,
        prop_market: m.prop_market,
        prop_line: m.prop_line,
        prop_side: sideName,
        book: best.book,
        price_american: best.price,
        true_prob: truth.prob,
        // A leg is primary (+EV) when true_prob × decimal_odds > 1; filler otherwise
        is_filler_eligible: evPercent(truth.prob, best.price) <= 0,
        pinnacle_prob: truth.source === 'pinnacle' ? truth.prob : null,
        consensus_prob: truth.source === 'consensus' ? truth.prob : null,
      })
    }
  }
  return out
}
