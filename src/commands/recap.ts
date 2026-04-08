import type { EdgeSupabase } from '../db/client.js'
import {
  getPicksGradedSince,
  getPicksWithGradesInRange,
  getClosingLinesForPicks,
  type GradedPickRow,
} from '../db/queries.js'
import { aggregateMetrics, type RecordMetrics } from '../record/aggregate.js'
import { renderRecapHtml, buildRecapSubject } from '../email/render-recap.js'
import {
  sendReportEmail,
  type SendEmailInput,
  type SendEmailResult,
} from '../email/send.js'

export interface RunRecapInput {
  supabase: EdgeSupabase
  now?: () => Date
  /** Injectable for tests. Defaults to the real Resend-backed sender. */
  sendEmail?: (input: SendEmailInput) => Promise<SendEmailResult>
  resendApiKey: string
  emailFrom: string
  emailTo: string
}

export interface RunRecapResult {
  sent: boolean
  reason?: string
  settledCount: number
  metrics7d: RecordMetrics
  metrics30d: RecordMetrics
  metricsAll: RecordMetrics
  resendId?: string
}

const ALL_TIME_START = '2000-01-01'

function dateMinusDays(d: Date, days: number): string {
  const out = new Date(d)
  out.setUTCDate(out.getUTCDate() - days)
  return out.toISOString().slice(0, 10)
}

export async function runRecap(input: RunRecapInput): Promise<RunRecapResult> {
  const now = input.now ?? (() => new Date())
  const send = input.sendEmail ?? sendReportEmail

  const nowDate = now()
  const cutoffIso = new Date(nowDate.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const newlySettled = await getPicksGradedSince(input.supabase, cutoffIso)

  // Compute window date strings up front so we can return zeroed metrics on the empty path.
  const today = nowDate.toISOString().slice(0, 10)
  const start7 = dateMinusDays(nowDate, 7)
  const start30 = dateMinusDays(nowDate, 30)

  if (newlySettled.length === 0) {
    const empty: RecordMetrics = {
      picks: 0,
      won: 0,
      lost: 0,
      push: 0,
      void: 0,
      hitRate: null,
      avgEv: null,
      units: 0,
      roi: null,
      clvAvg: null,
      clvBeatRate: null,
      picksWithCLV: 0,
      capturedClosesPct: null,
      approximateCLV: 0,
      bySport: [],
    }
    return {
      sent: false,
      reason: 'no picks settled in last 24h',
      settledCount: 0,
      metrics7d: empty,
      metrics30d: empty,
      metricsAll: empty,
    }
  }

  const [pick7d, pick30d, pickAll] = await Promise.all([
    getPicksWithGradesInRange(input.supabase, start7, today),
    getPicksWithGradesInRange(input.supabase, start30, today),
    getPicksWithGradesInRange(input.supabase, ALL_TIME_START, today),
  ])

  // Dedup pick IDs across all four collections, fetch closing lines once.
  const idSet = new Set<string>()
  for (const lst of [newlySettled, pick7d, pick30d, pickAll]) {
    for (const p of lst) idSet.add(p.id)
  }
  const closingLines = await getClosingLinesForPicks(input.supabase, [...idSet])

  const metrics7d = aggregateMetrics({ picks: pick7d, closingLines })
  const metrics30d = aggregateMetrics({ picks: pick30d, closingLines })
  const metricsAll = aggregateMetrics({ picks: pickAll, closingLines })

  const html = renderRecapHtml({
    newlySettled,
    metrics7d,
    metrics30d,
    metricsAll,
    asOf: nowDate,
  })
  const subject = buildRecapSubject({
    settledCount: newlySettled.length,
    units7d: metrics7d.units,
  })

  const sendResult = await send({
    apiKey: input.resendApiKey,
    from: input.emailFrom,
    to: input.emailTo,
    subject,
    html,
  })

  return {
    sent: true,
    settledCount: newlySettled.length,
    metrics7d,
    metrics30d,
    metricsAll,
    resendId: sendResult.id,
  }
}

// Re-export for ergonomic single import in cli.ts
export type { GradedPickRow }
