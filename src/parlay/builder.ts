// src/parlay/builder.ts
import { americanToDecimal, decimalToAmerican, americanToImplied, combineDecimals, evPercent } from './odds.js'

export interface LegCandidate {
  id: string
  game_id: string
  sport: 'nba' | 'mlb' | 'nhl'
  player_id: string
  player_name: string
  prop_market: string
  prop_line: number
  prop_side: 'over' | 'under'
  book: string
  price_american: number
  true_prob: number
  is_filler_eligible: boolean
  pinnacle_prob?: number | null
  consensus_prob?: number | null
}

export interface BuilderConfig {
  target_odds: number
  odds_tolerance: [number, number]
  min_legs: number
  max_legs: number
  min_leg_prob: number
  max_leg_prob: number
  filler_min_prob: number
}

export interface BuiltParlay {
  legs: (LegCandidate & { is_filler: boolean; ev_pct: number })[]
  combined_odds: number
  combined_prob: number
  ev_pct: number
}

function combinations<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]]
  if (items.length < k) return []
  const [head, ...rest] = items
  const withHead = combinations(rest, k - 1).map((c) => [head, ...c])
  const withoutHead = combinations(rest, k)
  return [...withHead, ...withoutHead]
}

function isPlusEv(leg: LegCandidate): boolean {
  return evPercent(leg.true_prob, leg.price_american) > 0
}

export function buildParlay(candidates: LegCandidate[], cfg: BuilderConfig): BuiltParlay | null {
  const filtered = candidates.filter(
    (c) => c.true_prob >= cfg.min_leg_prob && c.true_prob <= cfg.max_leg_prob,
  )
  if (filtered.length < cfg.min_legs) return null

  const allCombos: LegCandidate[][] = []
  for (let k = cfg.max_legs; k >= cfg.min_legs; k--) {
    allCombos.push(...combinations(filtered, k))
  }

  // diversity: max 1 leg per game
  const validCombos = allCombos.filter((combo) => {
    const games = new Set(combo.map((l) => l.game_id))
    return games.size === combo.length
  })

  // for filler-only legs, require true_prob >= filler_min_prob
  const eligibleCombos = validCombos.filter((combo) =>
    combo.every((l) => isPlusEv(l) || (l.is_filler_eligible && l.true_prob >= cfg.filler_min_prob)),
  )

  type Scored = { combo: LegCandidate[]; american: number; combinedProb: number; evCount: number; avgEv: number }
  const scored: Scored[] = eligibleCombos.map((combo) => {
    const decimals = combo.map((l) => americanToDecimal(l.price_american))
    const combinedDec = combineDecimals(decimals)
    const american = decimalToAmerican(combinedDec)
    const combinedProb = combo.reduce((p, l) => p * l.true_prob, 1)
    const evCount = combo.filter((l) => !l.is_filler_eligible && isPlusEv(l)).length
    const avgEv = combo.reduce((s, l) => s + evPercent(l.true_prob, l.price_american), 0) / combo.length
    return { combo, american, combinedProb, evCount, avgEv }
  })

  const inBand = (s: Scored): boolean =>
    s.american >= cfg.odds_tolerance[0] && s.american <= cfg.odds_tolerance[1]

  let pool = scored.filter(inBand)
  if (pool.length === 0) {
    // relax band by ±50
    const wider: [number, number] = [cfg.odds_tolerance[0] - 50, cfg.odds_tolerance[1] + 50]
    pool = scored.filter((s) => s.american >= wider[0] && s.american <= wider[1])
  }
  if (pool.length === 0) return null

  pool.sort((a, b) => {
    if (b.evCount !== a.evCount) return b.evCount - a.evCount
    if (b.avgEv !== a.avgEv) return b.avgEv - a.avgEv
    return Math.abs(a.american - cfg.target_odds) - Math.abs(b.american - cfg.target_odds)
  })

  const winner = pool[0]
  const legs = winner.combo.map((l) => ({
    ...l,
    is_filler: !isPlusEv(l),
    ev_pct: evPercent(l.true_prob, l.price_american),
  }))
  return {
    legs,
    combined_odds: winner.american,
    combined_prob: winner.combinedProb,
    ev_pct: winner.avgEv,
  }
}
