/**
 * Convert American odds to fractional payout (profit per 1 unit staked).
 *
 * Examples:
 *   -108 → 100/108 = 0.9259
 *   +115 → 115/100 = 1.15
 */
export function americanToPayout(odds: number): number {
  if (odds < 0) {
    return 100 / -odds
  }
  return odds / 100
}

export interface EvInputs {
  trueProb: number    // devigged sharp probability for the side (0-1)
  offeredOdds: number // American odds at the book we'd bet
}

/**
 * Expected value as a fraction of stake.
 *
 * Formula:  ev = (true_prob × payout) − (1 − true_prob)
 *
 * A return of 0.05 means +5% EV.
 */
export function computeEv({ trueProb, offeredOdds }: EvInputs): number {
  const payout = americanToPayout(offeredOdds)
  return trueProb * payout - (1 - trueProb)
}
