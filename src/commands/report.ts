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
import { rankCandidates } from '../engine/scanner.js'
import { upsertPick, type PickRow } from '../db/queries.js'
import { renderEmail, type RenderedEmail } from '../email/render.js'
import { sendReportEmail } from '../email/send.js'
import { getLastQuotaSnapshot } from '../quota.js'

export interface RunReportInput {
  supabase: EdgeSupabase
  config: Config
  env: Env
  sports: string[]
  runLabel: string
  runDate: string
  dryRun: boolean
  resendApiKey?: string
  emailTo?: string
  emailFrom?: string
}

export interface RunReportResult {
  picks: PickRow[]
  email: RenderedEmail
  sent: boolean
  resendId?: string
}

export async function runReport(input: RunReportInput): Promise<RunReportResult> {
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

  const detectedAt = new Date().toISOString()
  const cardDate = detectedAt.slice(0, 10)
  const allCandidates: Array<Awaited<ReturnType<typeof rankCandidates>>[number]> = []

  for (const sport of input.sports) {
    const fetchers = sportFetchers[sport]
    if (!fetchers) continue
    const [actionNetwork, pinnacle] = await Promise.all([
      fetchers.actionNetwork(),
      fetchers.pinnacle(input.env.ODDS_API_KEY),
    ])
    const snapshots = joinSources({ sport, actionNetwork, pinnacle })
    const candidates = rankCandidates({ snapshots, config: input.config, detectedAt })
    allCandidates.push(...candidates)
  }

  allCandidates.sort((a, b) => b.score - a.score)
  const topN = allCandidates.slice(0, input.config.daily_picks)

  const allPicks: PickRow[] = []
  for (const candidate of topN) {
    const pick: PickRow = { ...candidate, card_date: cardDate }
    await upsertPick(input.supabase, pick)
    allPicks.push(pick)
  }

  const email = renderEmail({
    picks: allPicks,
    quota: getLastQuotaSnapshot(),
    runLabel: input.runLabel,
    runDate: input.runDate,
    sportsScanned: input.sports,
  })

  if (input.dryRun) {
    return { picks: allPicks, email, sent: false }
  }

  if (!input.resendApiKey || !input.emailTo || !input.emailFrom) {
    throw new Error('resendApiKey, emailTo, and emailFrom are required when dryRun is false')
  }

  const csvFilename = `edge-picks-${input.runDate}-${input.runLabel.replace(/\W+/g, '_')}.csv`
  const result = await sendReportEmail({
    apiKey: input.resendApiKey,
    from: input.emailFrom,
    to: input.emailTo,
    subject: email.subject,
    html: email.html,
    csvFilename,
    csvContent: email.csv,
  })

  return { picks: allPicks, email, sent: true, resendId: result.id }
}
