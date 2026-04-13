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
import { upsertPick, listPicksForCardDate, type PickRow } from '../db/queries.js'
import { renderCardTable } from '../ui/tables.js'

export interface RunCardInput {
  supabase: EdgeSupabase
  config: Config
  env: Env
  detectedAt?: string
  print?: (msg: string) => void
}

export async function runCard({
  supabase,
  config,
  env,
  detectedAt = new Date().toISOString(),
  print,
}: RunCardInput): Promise<PickRow[]> {
  const cardDate = detectedAt.slice(0, 10)

  // Idempotency: if we already have picks for today, return them
  const existing = await listPicksForCardDate(supabase, cardDate)
  if (existing.length >= config.daily_picks) {
    if (print) print(renderCardTable(existing))
    return existing
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

  const allCandidates: Candidate[] = []

  for (const sport of config.sports) {
    const fetchers = sportFetchers[sport]
    if (!fetchers) continue
    const [actionNetwork, pinnacle] = await Promise.all([
      fetchers.actionNetwork(),
      fetchers.pinnacle(env.ODDS_API_KEY),
    ])
    const snapshots = joinSources({ sport, actionNetwork, pinnacle })
    const candidates = rankCandidates({ snapshots, config, detectedAt })
    allCandidates.push(...candidates)
  }

  // Re-sort merged candidates from all sports
  allCandidates.sort((a, b) => b.score - a.score)
  const topN = allCandidates.slice(0, config.daily_picks)

  const picks: PickRow[] = []
  for (const candidate of topN) {
    const pick: PickRow = { ...candidate, card_date: cardDate }
    await upsertPick(supabase, pick)
    picks.push(pick)
  }

  if (print) print(renderCardTable(picks))
  return picks
}
