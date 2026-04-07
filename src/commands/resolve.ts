import type { EdgeSupabase } from '../db/client.js'
import type { Config, Env } from '../config.js'
import { captureClosingLines, type CaptureSummary } from '../resolve/close.js'
import { gradePicks, type GradeSummary } from '../resolve/grade.js'

export interface RunResolveInput {
  supabase: EdgeSupabase
  config: Config
  env: Env
  mode: 'close' | 'grade' | 'both'
  print?: (msg: string) => void
}

export interface RunResolveResult {
  capture?: CaptureSummary
  grade?: GradeSummary
}

export async function runResolve(input: RunResolveInput): Promise<RunResolveResult> {
  const print = input.print ?? (() => {})
  const result: RunResolveResult = {}

  if (input.mode === 'close' || input.mode === 'both') {
    const summary = await captureClosingLines({
      supabase: input.supabase,
      config: input.config,
      env: input.env,
    })
    result.capture = summary
    if (summary.captured === 0) {
      print('no closing-line work')
    } else {
      print(
        `captured ${summary.captured} closing line${summary.captured === 1 ? '' : 's'} across ${summary.gamesProcessed} game${summary.gamesProcessed === 1 ? '' : 's'}`
      )
    }
  }

  if (input.mode === 'grade' || input.mode === 'both') {
    const today = new Date().toISOString().slice(0, 10)
    const summary = await gradePicks({
      supabase: input.supabase,
      referenceDate: today,
      lookbackDays: 3,
    })
    result.grade = summary
    print(
      `graded ${summary.graded} picks (${summary.won} won, ${summary.lost} lost, ${summary.push} push, ${summary.void} void), ${summary.unmatched} game${summary.unmatched === 1 ? '' : 's'} unmatched, ${summary.postponed} postponed`
    )
    for (const u of summary.unmatchedPicks) {
      print(`  ⚠ unmatched: ${u.sport} ${u.game_date} ${u.away} @ ${u.home} (pick ${u.id})`)
    }
  }

  return result
}
