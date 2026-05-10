import { americanToDecimal, combineDecimals } from './odds.js'

export interface LegToGrade {
  player_id: string
  prop_market: string
  prop_line: number
  prop_side: 'over' | 'under'
  price_american: number
}

export interface GradedLeg extends LegToGrade {
  result: 'hit' | 'miss' | 'void'
  actual_value: number | null
}

export function gradeLeg(leg: LegToGrade, playerStats: Record<string, number> | undefined | null): { result: 'hit' | 'miss' | 'void'; actual_value: number | null } {
  if (!playerStats || playerStats[leg.prop_market] === undefined || playerStats[leg.prop_market] === null) {
    return { result: 'void', actual_value: null }
  }
  const value = Number(playerStats[leg.prop_market])
  const isOver = leg.prop_side === 'over'
  const hit = isOver ? value > leg.prop_line : value < leg.prop_line
  return { result: hit ? 'hit' : 'miss', actual_value: value }
}

export function gradeParlay(
  legs: GradedLeg[],
  opts: { stake: number },
): { parlayResult: 'won' | 'lost' | 'void'; pnl: number; effectiveLegs: GradedLeg[] } {
  const live = legs.filter((l) => l.result !== 'void')
  if (live.length === 0) return { parlayResult: 'void', pnl: 0, effectiveLegs: [] }
  if (live.some((l) => l.result === 'miss')) {
    return { parlayResult: 'lost', pnl: -opts.stake, effectiveLegs: live }
  }
  // all live legs hit → parlay won at recomputed odds based on live legs only
  const decimals = live.map((l) => americanToDecimal(l.price_american))
  const combined = combineDecimals(decimals)
  const pnl = opts.stake * combined - opts.stake
  return { parlayResult: 'won', pnl, effectiveLegs: live }
}
