import type { EdgeSupabase } from '../db/client.js'
import type { Config, Env } from '../config.js'
import {
  listPendingParlays, listLegs, updateLegResult, updateParlayResolution,
  getStreakState, updateStreakState,
} from '../db/queries.js'
import { fetchBoxScore } from '../sources/box-scores/index.js'
import { gradeLeg, gradeParlay, type GradedLeg } from '../parlay/grade.js'
import { transitionStreak } from '../parlay/streak.js'

export interface RunResolveInput {
  supabase: EdgeSupabase
  config: Config
  env: Env
  print?: (msg: string) => void
}

export async function runResolve(input: RunResolveInput): Promise<void> {
  const pending = await listPendingParlays(input.supabase)
  input.print?.(`grading ${pending.length} pending parlays`)
  for (const parlay of pending) {
    const legs = await listLegs(input.supabase, parlay.id)
    if (legs.length === 0) {
      // no-parlay-today row; mark graded with no-op
      await updateParlayResolution(input.supabase, parlay.id, {
        status: 'skipped', result_pnl: 0, graded_at: new Date().toISOString(),
      })
      continue
    }

    // Group legs by (sport, game_id) to minimize box-score fetches
    const byGame = new Map<string, typeof legs>()
    for (const l of legs) {
      const k = `${l.sport}|${l.game_id}`
      const arr = byGame.get(k) ?? []
      arr.push(l)
      byGame.set(k, arr)
    }

    let allFinal = true
    const graded: GradedLeg[] = []
    for (const [k, glegs] of byGame.entries()) {
      const parts = k.split('|')
      const sport = parts[0]!
      const gameId = parts[1]!
      let stats
      try {
        stats = await fetchBoxScore(sport as any, gameId)
      } catch (err) {
        input.print?.(`warn: box-score fetch failed for ${k}: ${(err as Error).message}`)
        allFinal = false
        continue
      }
      if (stats.gameStatus !== 'final' && stats.gameStatus !== 'postponed') {
        allFinal = false
        continue
      }
      for (const leg of glegs) {
        if (stats.gameStatus === 'postponed') {
          await updateLegResult(input.supabase, leg.id, 'void', null)
          graded.push({
            player_id: leg.player_id, prop_market: leg.prop_market,
            prop_line: leg.prop_line, prop_side: leg.prop_side, price_american: leg.price_american,
            result: 'void', actual_value: null,
          })
          continue
        }
        const playerStats = stats.byPlayer[leg.player_id]
        const { result, actual_value } = gradeLeg(leg, playerStats)
        await updateLegResult(input.supabase, leg.id, result, actual_value)
        graded.push({
          player_id: leg.player_id, prop_market: leg.prop_market,
          prop_line: leg.prop_line, prop_side: leg.prop_side, price_american: leg.price_american,
          result, actual_value,
        })
      }
    }

    if (!allFinal || graded.length < legs.length) {
      input.print?.(`parlay ${parlay.id}: not all games final, deferring`)
      continue
    }

    const { parlayResult, pnl } = gradeParlay(graded, { stake: parlay.recommended_stake })
    const finalStatus =
      parlay.status === 'skipped' ? 'skipped' :
      parlayResult === 'won' ? 'won' :
      parlayResult === 'lost' ? 'lost' :
      'void'
    await updateParlayResolution(input.supabase, parlay.id, {
      status: finalStatus,
      result_pnl: parlay.status === 'skipped' ? 0 : pnl,
      graded_at: new Date().toISOString(),
    })

    // Streak transition (only when bet)
    if (parlay.status === 'bet') {
      const prev = await getStreakState(input.supabase)
      const next = transitionStreak(prev, {
        status: 'bet',
        result: parlayResult,
        stake: parlay.recommended_stake,
        payout: parlayResult === 'void' ? 0 : pnl,
      }, { stakeBase: input.config.parlay.stake_base, stakeMultiplier: input.config.parlay.stake_multiplier })
      await updateStreakState(input.supabase, next)
    }
    input.print?.(`parlay ${parlay.id} graded: ${parlayResult} ($${pnl.toFixed(2)})`)
  }
}
