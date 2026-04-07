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
import { scan } from '../engine/scanner.js'
import { upsertPick, listPicksForDate, type PickRow } from '../db/queries.js'
import { renderPicksTable } from '../ui/tables.js'

export interface RunScanInput {
  supabase: EdgeSupabase
  config: Config
  env: Env
  detectedAt?: string
  print?: (msg: string) => void
}

export async function runScan({
  supabase,
  config,
  env,
  detectedAt = new Date().toISOString(),
  print,
}: RunScanInput): Promise<PickRow[]> {
  const newPicks: PickRow[] = []

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

  for (const sport of config.sports) {
    const fetchers = sportFetchers[sport]
    if (!fetchers) continue
    const [actionNetwork, pinnacle] = await Promise.all([
      fetchers.actionNetwork(),
      fetchers.pinnacle(env.ODDS_API_KEY),
    ])
    const snapshots = joinSources({ sport, actionNetwork, pinnacle })
    const picks = scan({ snapshots, config, detectedAt })
    for (const p of picks) {
      if (await upsertPick(supabase, p)) newPicks.push(p)
    }
  }

  if (print) {
    const today = detectedAt.slice(0, 10)
    const tomorrow = new Date(today + 'T00:00:00Z')
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
    const tomorrowStr = tomorrow.toISOString().slice(0, 10)
    const allPicks = [
      ...(await listPicksForDate(supabase, today)),
      ...(await listPicksForDate(supabase, tomorrowStr)),
    ].sort((a, b) => b.ev_pct - a.ev_pct)
    print(renderPicksTable(allPicks))
  }

  return newPicks
}
