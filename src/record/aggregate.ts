import type { GradedPickRow, ClosingLineRow } from '../db/queries.js'
import { unitProfit, clv } from './grading-math.js'

export interface SportBreakdown {
  sport: string
  picks: number
  won: number
  lost: number
  push: number
  units: number
  roi: number | null
  clvAvg: number | null
}

export interface RecordMetrics {
  picks: number // excludes voids
  won: number
  lost: number
  push: number
  void: number
  hitRate: number | null
  avgEv: number | null
  units: number
  roi: number | null
  clvAvg: number | null
  clvBeatRate: number | null
  picksWithCLV: number
  capturedClosesPct: number | null
  approximateCLV: number
  bySport: SportBreakdown[]
}

export interface AggregateInput {
  picks: GradedPickRow[]
  closingLines: Map<string, ClosingLineRow>
}

export function aggregateMetrics(input: AggregateInput): RecordMetrics {
  const allPicks = input.picks
  const nonVoid = allPicks.filter((p) => p.outcome !== 'void')

  let won = 0
  let lost = 0
  let push = 0
  let voidCount = 0
  let units = 0
  let evSum = 0

  for (const p of allPicks) {
    if (p.outcome === 'won') won++
    else if (p.outcome === 'lost') lost++
    else if (p.outcome === 'push') push++
    else if (p.outcome === 'void') voidCount++
  }

  for (const p of nonVoid) {
    units += unitProfit(p.outcome, p.best_price)
    evSum += p.ev_pct
  }

  const decided = won + lost
  const hitRate = decided > 0 ? won / decided : null
  const avgEv = nonVoid.length > 0 ? evSum / nonVoid.length : null
  // ROI = units / staked. Flat 1u per non-void pick, so staked = nonVoid.length.
  const roi = nonVoid.length > 0 ? units / nonVoid.length : null

  // CLV
  let clvSum = 0
  let clvBeatCount = 0
  let picksWithCLV = 0
  let approximateCLV = 0
  for (const p of nonVoid) {
    const close = input.closingLines.get(p.id)
    if (!close) continue
    picksWithCLV++
    const value = clv(p.sharp_implied, close.sharp_implied)
    clvSum += value
    if (value > 0) clvBeatCount++
    if (close.capture_lag_min > 5) approximateCLV++
  }

  const clvAvg = picksWithCLV > 0 ? clvSum / picksWithCLV : null
  const clvBeatRate = picksWithCLV > 0 ? clvBeatCount / picksWithCLV : null
  const capturedClosesPct =
    nonVoid.length > 0 ? picksWithCLV / nonVoid.length : null

  // Per-sport breakdown
  const bySportMap = new Map<string, SportBreakdown>()
  for (const p of nonVoid) {
    const entry =
      bySportMap.get(p.sport) ??
      ({
        sport: p.sport,
        picks: 0,
        won: 0,
        lost: 0,
        push: 0,
        units: 0,
        roi: null,
        clvAvg: null,
      } as SportBreakdown)
    entry.picks++
    if (p.outcome === 'won') entry.won++
    else if (p.outcome === 'lost') entry.lost++
    else if (p.outcome === 'push') entry.push++
    entry.units += unitProfit(p.outcome, p.best_price)
    bySportMap.set(p.sport, entry)
  }
  // Add per-sport ROI (units / picks, where picks already excludes voids)
  for (const entry of bySportMap.values()) {
    entry.roi = entry.picks > 0 ? entry.units / entry.picks : null
  }
  // Add per-sport CLV averages
  for (const entry of bySportMap.values()) {
    let sum = 0
    let n = 0
    for (const p of nonVoid) {
      if (p.sport !== entry.sport) continue
      const close = input.closingLines.get(p.id)
      if (!close) continue
      sum += clv(p.sharp_implied, close.sharp_implied)
      n++
    }
    entry.clvAvg = n > 0 ? sum / n : null
  }

  return {
    picks: nonVoid.length,
    won,
    lost,
    push,
    void: voidCount,
    hitRate,
    avgEv,
    units,
    roi,
    clvAvg,
    clvBeatRate,
    picksWithCLV,
    capturedClosesPct,
    approximateCLV,
    bySport: [...bySportMap.values()].sort((a, b) => b.picks - a.picks),
  }
}
