// src/parlay/streak.ts
export interface StreakState {
  current_streak: number
  next_stake: number
  bankroll_pnl: number
}

export type ParlayResult = 'won' | 'lost' | 'void'
export type ParlayStatus = 'bet' | 'skipped'

export interface ParlayOutcome {
  status: ParlayStatus
  result: ParlayResult
  stake: number
  payout: number   // signed P&L for this parlay (e.g. +10 for win, -40 for loss, 0 for void)
}

export interface TransitionOptions {
  stakeBase: number
  stakeMultiplier: number
}

const DEFAULT_OPTS: TransitionOptions = { stakeBase: 10, stakeMultiplier: 2 }

export function transitionStreak(
  prev: StreakState,
  outcome: ParlayOutcome,
  opts: TransitionOptions = DEFAULT_OPTS,
): StreakState {
  if (outcome.status === 'skipped') return prev
  if (outcome.result === 'void') return prev

  if (outcome.result === 'won') {
    const newStreak = prev.current_streak + 1
    return {
      current_streak: newStreak,
      next_stake: prev.next_stake * opts.stakeMultiplier,
      bankroll_pnl: prev.bankroll_pnl + outcome.payout,
    }
  }

  // lost
  return {
    current_streak: 0,
    next_stake: opts.stakeBase,
    bankroll_pnl: prev.bankroll_pnl + outcome.payout,
  }
}
