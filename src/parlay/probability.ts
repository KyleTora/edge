// src/parlay/probability.ts
import { americanToImplied } from './odds.js'

export interface TwoWayPrice {
  sidePrice: number       // american odds for the side we care about
  oppositePrice: number   // american odds for the opposite side
}

export function devigTwoWay(sidePrice: number, oppositePrice: number): number {
  const sideImplied = americanToImplied(sidePrice)
  const oppositeImplied = americanToImplied(oppositePrice)
  const total = sideImplied + oppositeImplied
  if (total <= 0) throw new Error('invalid devig input: total <= 0')
  return sideImplied / total
}

export function consensusProb(books: TwoWayPrice[]): number | null {
  if (books.length === 0) return null
  const probs = books.map((b) => devigTwoWay(b.sidePrice, b.oppositePrice))
  return probs.reduce((a, b) => a + b, 0) / probs.length
}

export interface TrueProbInput {
  pinnacle: TwoWayPrice | null
  otherBooks: TwoWayPrice[]
}

export interface TrueProbResult {
  prob: number | null
  source: 'pinnacle' | 'consensus' | 'none'
}

export function computeTrueProb(input: TrueProbInput): TrueProbResult {
  if (input.pinnacle) {
    return { prob: devigTwoWay(input.pinnacle.sidePrice, input.pinnacle.oppositePrice), source: 'pinnacle' }
  }
  const cons = consensusProb(input.otherBooks)
  if (cons === null) return { prob: null, source: 'none' }
  return { prob: cons, source: 'consensus' }
}
