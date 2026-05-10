// tests/parlay/streak.test.ts
import { describe, it, expect } from 'vitest'
import { transitionStreak, type StreakState, type ParlayOutcome } from '../../src/parlay/streak.js'

const fresh: StreakState = { current_streak: 0, next_stake: 10, bankroll_pnl: 0 }

describe('transitionStreak', () => {
  it('advances streak and doubles stake on bet+won', () => {
    const next = transitionStreak(fresh, { status: 'bet', result: 'won', stake: 10, payout: 10 })
    expect(next.current_streak).toBe(1)
    expect(next.next_stake).toBe(20)
    expect(next.bankroll_pnl).toBe(10)
  })

  it('resets streak and stake on bet+lost', () => {
    const after2 = { current_streak: 2, next_stake: 40, bankroll_pnl: 30 }
    const next = transitionStreak(after2, { status: 'bet', result: 'lost', stake: 40, payout: -40 })
    expect(next.current_streak).toBe(0)
    expect(next.next_stake).toBe(10)
    expect(next.bankroll_pnl).toBe(-10)
  })

  it('leaves state unchanged on skipped', () => {
    const next = transitionStreak(fresh, { status: 'skipped', result: 'won', stake: 10, payout: 10 })
    expect(next).toEqual(fresh)
  })

  it('leaves state unchanged on void', () => {
    const next = transitionStreak(fresh, { status: 'bet', result: 'void', stake: 10, payout: 0 })
    expect(next).toEqual(fresh)
  })

  it('honors custom stake_base on reset', () => {
    const after1 = { current_streak: 1, next_stake: 20, bankroll_pnl: 10 }
    const next = transitionStreak(after1, { status: 'bet', result: 'lost', stake: 20, payout: -20 }, { stakeBase: 25, stakeMultiplier: 2 })
    expect(next.next_stake).toBe(25)
  })

  it('honors custom multiplier', () => {
    const next = transitionStreak(fresh, { status: 'bet', result: 'won', stake: 10, payout: 10 }, { stakeBase: 10, stakeMultiplier: 3 })
    expect(next.next_stake).toBe(30)
  })
})
