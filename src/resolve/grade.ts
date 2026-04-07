import type { EdgeSupabase } from '../db/client.js'
import {
  listPicksAwaitingGrade,
  upsertResult,
  insertPickGrade,
  type PickRow,
  type ResultRow,
} from '../db/queries.js'
import { gradeMoneyline, gradeTotal, gradeSpread, type Outcome } from './grading-rules.js'
import { canonicalTeam } from './team-aliases.js'
import type { EspnGame, EspnSport } from './espn.js'
import { fetchEspnScoreboard } from './espn.js'

export interface GradeSummary {
  graded: number
  won: number
  lost: number
  push: number
  void: number
  unmatched: number
  postponed: number
  unmatchedPicks: Array<{ id: string; sport: string; game_date: string; away: string; home: string }>
}

export interface GradePicksInput {
  supabase: EdgeSupabase
  referenceDate: string // YYYY-MM-DD
  lookbackDays: number
  /** Injectable for tests. Defaults to real ESPN fetch. */
  fetchScoreboard?: (sport: EspnSport, gameDate: string) => Promise<EspnGame[]>
  now?: () => Date
}

export async function gradePicks(input: GradePicksInput): Promise<GradeSummary> {
  const fetcher = input.fetchScoreboard ?? ((sport, date) => fetchEspnScoreboard(sport, date))
  const now = input.now ?? (() => new Date())
  const summary: GradeSummary = {
    graded: 0,
    won: 0,
    lost: 0,
    push: 0,
    void: 0,
    unmatched: 0,
    postponed: 0,
    unmatchedPicks: [],
  }

  const picks = await listPicksAwaitingGrade(input.supabase, input.referenceDate, input.lookbackDays)
  if (picks.length === 0) return summary

  // Group picks by (sport, game_date) so we make one ESPN call per group.
  const groups = new Map<string, PickRow[]>()
  for (const p of picks) {
    const key = `${p.sport}:${p.game_date}`
    const list = groups.get(key) ?? []
    list.push(p)
    groups.set(key, list)
  }

  for (const [key, groupPicks] of groups) {
    const [sport, gameDate] = key.split(':') as [EspnSport, string]
    let scoreboard: EspnGame[] = []
    try {
      scoreboard = await fetcher(sport, gameDate)
    } catch (err) {
      // Surface but do not stop the whole grade run; mark these picks as unmatched.
      console.error(`gradePicks: ESPN fetch failed for ${key}: ${(err as Error).message}`)
    }

    for (const pick of groupPicks) {
      const match = scoreboard.find(
        (g) =>
          g.homeTeamCanonical === canonicalTeam(pick.sport, pick.home_team) &&
          g.awayTeamCanonical === canonicalTeam(pick.sport, pick.away_team)
      )
      if (!match) {
        summary.unmatched++
        summary.unmatchedPicks.push({
          id: pick.id,
          sport: pick.sport,
          game_date: pick.game_date,
          away: pick.away_team,
          home: pick.home_team,
        })
        continue
      }

      // Write/refresh the result row regardless of pick outcome (one row per game).
      const result: ResultRow = {
        game_id: pick.game_id,
        sport: pick.sport,
        game_date: pick.game_date,
        home_score: match.homeScore,
        away_score: match.awayScore,
        status: match.status,
        resolved_at: now().toISOString(),
      }
      await upsertResult(input.supabase, result)

      if (match.status === 'postponed') {
        summary.postponed++
        // Do not grade — will re-check on next run.
        continue
      }

      let outcome: Outcome
      if (match.status === 'canceled') {
        outcome = 'void'
      } else {
        outcome = computeOutcome(pick, match)
      }
      await insertPickGrade(input.supabase, {
        pick_id: pick.id,
        outcome,
        graded_at: now().toISOString(),
      })
      summary.graded++
      summary[outcome]++
    }
  }

  return summary
}

function computeOutcome(pick: PickRow, match: EspnGame): Outcome {
  if (pick.market === 'moneyline') {
    return gradeMoneyline({
      side: pick.side as 'home' | 'away',
      homeScore: match.homeScore,
      awayScore: match.awayScore,
    })
  }
  if (pick.market === 'total') {
    if (pick.line === null) throw new Error(`grade: total pick ${pick.id} has null line`)
    return gradeTotal({
      side: pick.side as 'over' | 'under',
      line: pick.line,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
    })
  }
  if (pick.market === 'spread') {
    if (pick.line === null) throw new Error(`grade: spread pick ${pick.id} has null line`)
    return gradeSpread({
      side: pick.side as 'home' | 'away',
      line: pick.line,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
    })
  }
  throw new Error(`grade: unknown market ${pick.market}`)
}
