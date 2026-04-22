import type { PickRow } from '../db/queries.js'
import type { Candidate } from './scanner.js'

export interface SwapResolution {
  keep: PickRow[]          // no status change
  kept_started: PickRow[]  // no status change (game already started)
  drop: PickRow[]          // 'active' → 'swapped_off'
  add: Candidate[]         // insert as 'active'
}

export function resolveSwaps(
  prior: PickRow[],
  ranked: Candidate[],
  alreadySwappedOffIds: Set<string>,
  now: Date,
  targetSize: number
): SwapResolution {
  const nowMs = now.getTime()
  const started: PickRow[] = []
  const live: PickRow[] = []
  for (const p of prior) {
    if (Date.parse(p.game_time) <= nowMs) started.push(p)
    else live.push(p)
  }

  const kept_started = started
  const slotsLeft = Math.max(0, targetSize - kept_started.length)
  const startedIds = new Set(kept_started.map((p) => p.id))

  const eligible = ranked.filter(
    (c) => !startedIds.has(c.id) && !alreadySwappedOffIds.has(c.id)
  )
  const targetLive = eligible.slice(0, slotsLeft)
  const targetLiveIds = new Set(targetLive.map((c) => c.id))
  const priorLiveIds = new Set(live.map((p) => p.id))

  const keep = live.filter((p) => targetLiveIds.has(p.id))
  const drop = live.filter((p) => !targetLiveIds.has(p.id))
  const add = targetLive.filter((c) => !priorLiveIds.has(c.id))

  return { keep, kept_started, drop, add }
}
