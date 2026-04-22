import type { PickRow } from '../db/queries.js'
import type { Candidate } from './scanner.js'
import type { SwapResolution } from './resolve-swaps.js'

export interface SwapSummary {
  morningCardSize: number
  added: Array<{ pick: Candidate; reason: string }>
  dropped: Array<{ pick: PickRow; reason: string }>
  startedBeforeRefresh: Array<{ pick: PickRow }>
}

function matches(a: PickRow | Candidate, b: PickRow | Candidate): boolean {
  return (
    a.sport === b.sport &&
    a.game_id === b.game_id &&
    a.market === b.market &&
    a.side === b.side
  )
}

function fmtPct(v: number): string {
  const sign = v >= 0 ? '+' : ''
  return `${sign}${(v * 100).toFixed(1)}%`
}

function fmtImplied(p: number): string {
  return `${(p * 100).toFixed(1)}%`
}

function explainDrop(pick: PickRow, fresh: Candidate | undefined): string {
  if (!fresh) {
    return 'no longer offered at allowlisted books at refresh time.'
  }
  const impliedDelta = fresh.sharp_implied - pick.sharp_implied
  return (
    `sharp moved from ${fmtImplied(pick.sharp_implied)} to ${fmtImplied(fresh.sharp_implied)} implied ` +
    `(${fmtPct(impliedDelta)}); EV went ${fmtPct(pick.ev_pct)} → ${fmtPct(fresh.ev_pct)}.`
  )
}

function explainAdd(pick: Candidate): string {
  return `EV ${fmtPct(pick.ev_pct)} at current sharp (${fmtImplied(pick.sharp_implied)} implied); top-N score.`
}

export function buildSwapSummary(
  resolution: SwapResolution,
  ranked: Candidate[]
): SwapSummary {
  const morningCardSize =
    resolution.kept_started.length +
    resolution.keep.length +
    resolution.drop.length

  const dropped = resolution.drop.map((p) => {
    const fresh = ranked.find((c) => matches(p, c))
    return { pick: p, reason: explainDrop(p, fresh) }
  })

  const added = resolution.add.map((c) => ({ pick: c, reason: explainAdd(c) }))

  const startedBeforeRefresh = resolution.kept_started.map((p) => ({ pick: p }))

  return { morningCardSize, added, dropped, startedBeforeRefresh }
}
