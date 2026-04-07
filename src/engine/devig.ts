/**
 * Convert American odds to implied probability (vig-inclusive).
 *
 * Examples:
 *   -130 → 130/(130+100) = 0.5652
 *   +112 → 100/(100+112) = 0.4717
 */
export function americanToImpliedProb(odds: number): number {
  if (odds < 0) {
    return -odds / (-odds + 100)
  }
  return 100 / (odds + 100)
}

export interface DevigResult {
  home: number
  away: number
}

/**
 * Strip vig from a two-sided market using the multiplicative method.
 *
 * Both probabilities are divided by their sum (the "overround"), so the
 * result always sums to exactly 1.0.
 *
 * Convention: first arg = home/over, second arg = away/under.
 */
export function devigTwoWay(homeOdds: number, awayOdds: number): DevigResult {
  const homeImplied = americanToImpliedProb(homeOdds)
  const awayImplied = americanToImpliedProb(awayOdds)
  const sum = homeImplied + awayImplied
  return {
    home: homeImplied / sum,
    away: awayImplied / sum,
  }
}
