// src/parlay/odds.ts
export function americanToDecimal(american: number): number {
  if (american === 0) throw new Error('american odds cannot be 0')
  return american > 0 ? american / 100 + 1 : 100 / -american + 1
}

export function decimalToAmerican(decimal: number): number {
  if (decimal <= 1) throw new Error('decimal odds must be > 1')
  return decimal >= 2
    ? Math.round((decimal - 1) * 100)
    : Math.round(-100 / (decimal - 1))
}

export function americanToImplied(american: number): number {
  return 1 / americanToDecimal(american)
}

export function impliedToAmerican(implied: number): number {
  if (implied <= 0 || implied >= 1) throw new Error('implied prob must be in (0,1)')
  return decimalToAmerican(1 / implied)
}

export function combineDecimals(decimals: number[]): number {
  return decimals.reduce((acc, d) => acc * d, 1)
}

export function evPercent(trueProb: number, americanOdds: number): number {
  const decimal = americanToDecimal(americanOdds)
  return trueProb * decimal - 1
}
