import type { EdgeSupabase } from '../db/client.js'
import { getPicksWithGradesInRange, getClosingLinesForPicks } from '../db/queries.js'
import { aggregateMetrics, type RecordMetrics } from '../record/aggregate.js'
import { formatRecord } from '../record/format.js'

export interface RunRecordInput {
  supabase: EdgeSupabase
  since?: string // YYYY-MM-DD
  until?: string // YYYY-MM-DD; defaults to today
  sport?: string
  print?: (msg: string) => void
}

export interface RunRecordResult {
  metrics: RecordMetrics
  rendered: string
}

export async function runRecord(input: RunRecordInput): Promise<RunRecordResult> {
  const today = new Date().toISOString().slice(0, 10)
  const until = input.until ?? today
  const since =
    input.since ??
    (() => {
      const d = new Date(today + 'T00:00:00Z')
      d.setUTCDate(d.getUTCDate() - 30)
      return d.toISOString().slice(0, 10)
    })()

  let picks = await getPicksWithGradesInRange(input.supabase, since, until)
  if (input.sport) picks = picks.filter((p) => p.sport === input.sport)

  const lines = await getClosingLinesForPicks(
    input.supabase,
    picks.map((p) => p.id)
  )

  const metrics = aggregateMetrics({ picks, closingLines: lines })
  const rendered = formatRecord({
    metrics,
    sinceLabel: since,
    untilLabel: until,
  })

  if (input.print) input.print(rendered)
  return { metrics, rendered }
}
