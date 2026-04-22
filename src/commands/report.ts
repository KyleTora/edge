import type { EdgeSupabase } from '../db/client.js'
import type { Config, Env } from '../config.js'
import { runCard, type CardMode } from './card.js'
import { renderEmail, type RenderedEmail } from '../email/render.js'
import { sendReportEmail } from '../email/send.js'
import { getLastQuotaSnapshot } from '../quota.js'
import type { PickRow } from '../db/queries.js'

export interface RunReportInput {
  supabase: EdgeSupabase
  config: Config
  env: Env
  sports: string[]
  runLabel: string
  runDate: string
  dryRun: boolean
  mode?: CardMode                     // default: 'refresh'
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
  const mode: CardMode = input.mode ?? 'refresh'
  const detectedAt = new Date().toISOString()
  const cardResult = await runCard({
    supabase: input.supabase,
    config: input.config,
    env: input.env,
    mode,
    sports: input.sports,
    detectedAt,
  })

  const email = renderEmail({
    picks: cardResult.picks,
    quota: getLastQuotaSnapshot(),
    runLabel: input.runLabel,
    runDate: input.runDate,
    sportsScanned: input.sports,
    swapSummary: cardResult.swapSummary,
  })

  if (input.dryRun) {
    return { picks: cardResult.picks, email, sent: false }
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

  return { picks: cardResult.picks, email, sent: true, resendId: result.id }
}
