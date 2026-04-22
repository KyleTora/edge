import type { EdgeSupabase } from '../db/client.js'
import type { Config, Env } from '../config.js'
import {
  fetchActionNetworkNba,
  fetchActionNetworkMlb,
  fetchActionNetworkNhl,
} from '../sources/action-network.js'
import {
  fetchPinnacleNba,
  fetchPinnacleMlb,
  fetchPinnacleNhl,
} from '../sources/odds-api.js'
import { joinSources } from '../sources/normalize.js'
import { rankCandidates, type Candidate } from '../engine/scanner.js'
import { resolveSwaps } from '../engine/resolve-swaps.js'
import { buildSwapSummary, type SwapSummary } from '../engine/swap-summary.js'
import {
  upsertPick,
  listActivePicksForCardDate,
  listSwappedOffPickIdsForCardDate,
  updatePickStatus,
  type PickRow,
} from '../db/queries.js'
import { renderCardTable } from '../ui/tables.js'

export type CardMode = 'morning' | 'refresh'

export interface RunCardInput {
  supabase: EdgeSupabase
  config: Config
  env: Env
  mode: CardMode
  sports: string[]
  detectedAt?: string
  print?: (msg: string) => void
}

export interface RunCardResult {
  picks: PickRow[]
  swapSummary?: SwapSummary
}

const sportFetchers: Record<
  string,
  {
    actionNetwork: () => Promise<Awaited<ReturnType<typeof fetchActionNetworkNba>>>
    pinnacle: (key: string) => Promise<Awaited<ReturnType<typeof fetchPinnacleNba>>>
  }
> = {
  nba: { actionNetwork: fetchActionNetworkNba, pinnacle: fetchPinnacleNba },
  mlb: { actionNetwork: fetchActionNetworkMlb, pinnacle: fetchPinnacleMlb },
  nhl: { actionNetwork: fetchActionNetworkNhl, pinnacle: fetchPinnacleNhl },
}

async function fetchAllRanked(
  sports: string[],
  config: Config,
  env: Env,
  detectedAt: string
): Promise<Candidate[]> {
  const all: Candidate[] = []
  for (const sport of sports) {
    const fetchers = sportFetchers[sport]
    if (!fetchers) continue
    const [actionNetwork, pinnacle] = await Promise.all([
      fetchers.actionNetwork(),
      fetchers.pinnacle(env.ODDS_API_KEY),
    ])
    const snapshots = joinSources({ sport, actionNetwork, pinnacle })
    const candidates = rankCandidates({ snapshots, config, detectedAt })
    all.push(...candidates)
  }
  all.sort((a, b) => b.score - a.score)
  return all
}

export async function runCard(input: RunCardInput): Promise<RunCardResult> {
  const detectedAt = input.detectedAt ?? new Date().toISOString()
  const cardDate = detectedAt.slice(0, 10)

  if (input.mode === 'morning') {
    const existing = await listActivePicksForCardDate(input.supabase, cardDate)
    if (existing.length >= input.config.daily_picks) {
      if (input.print) input.print(renderCardTable(existing))
      return { picks: existing }
    }
    const ranked = await fetchAllRanked(input.sports, input.config, input.env, detectedAt)
    const existingIds = new Set(existing.map((p) => p.id))
    const slotsLeft = input.config.daily_picks - existing.length
    const newCandidates = ranked.filter((c) => !existingIds.has(c.id)).slice(0, slotsLeft)

    const addedPicks: PickRow[] = []
    for (const candidate of newCandidates) {
      const pick: PickRow = { ...candidate, card_date: cardDate, status: 'active' }
      await upsertPick(input.supabase, pick)
      addedPicks.push(pick)
    }
    const picks = [...existing, ...addedPicks].sort((a, b) => b.score - a.score)
    if (input.print) input.print(renderCardTable(picks))
    return { picks }
  }

  // refresh mode
  const ranked = await fetchAllRanked(input.sports, input.config, input.env, detectedAt)
  const prior = await listActivePicksForCardDate(input.supabase, cardDate)
  const alreadySwappedOffIds = await listSwappedOffPickIdsForCardDate(input.supabase, cardDate)
  const now = new Date(detectedAt)

  const resolution = resolveSwaps(
    prior,
    ranked,
    alreadySwappedOffIds,
    now,
    input.config.daily_picks
  )

  for (const p of resolution.drop) {
    await updatePickStatus(input.supabase, p.id, 'swapped_off')
  }
  const addedPicks: PickRow[] = []
  for (const c of resolution.add) {
    const pick: PickRow = { ...c, card_date: cardDate, status: 'active' }
    await upsertPick(input.supabase, pick)
    addedPicks.push(pick)
  }

  const finalPicks: PickRow[] = [
    ...resolution.kept_started,
    ...resolution.keep,
    ...addedPicks,
  ].sort((a, b) => b.score - a.score)

  const swapSummary = buildSwapSummary(resolution, ranked)

  if (input.print) input.print(renderCardTable(finalPicks))
  return { picks: finalPicks, swapSummary }
}
