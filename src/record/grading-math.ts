import type { Outcome } from '../resolve/grading-rules.js'

/** American odds → decimal payout per 1 unit staked, *excluding* stake. */
export function americanToPayout(american: number): number {
  return american > 0 ? american / 100 : 100 / Math.abs(american)
}

export function americanToImplied(american: number): number {
  if (american > 0) return 100 / (american + 100)
  return Math.abs(american) / (Math.abs(american) + 100)
}

export function unitProfit(outcome: Outcome, americanPrice: number): number {
  if (outcome === 'won') return americanToPayout(americanPrice)
  if (outcome === 'lost') return -1
  return 0 // push or void
}

/**
 * Closing-line value as a probability delta.
 * Positive = the closing implied prob is *higher* than the detected implied prob,
 * meaning the line moved in the bettor's direction (we got better-than-close odds).
 */
export function clv(detectedImplied: number, closingImplied: number): number {
  return closingImplied - detectedImplied
}
