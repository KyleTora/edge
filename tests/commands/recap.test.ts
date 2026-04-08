import { describe, it, expect, beforeEach, vi } from 'vitest'
import { runRecap } from '../../src/commands/recap.js'
import {
  upsertPick,
  insertPickGrade,
  insertClosingLine,
  type PickRow,
} from '../../src/db/queries.js'
import { createFakeSupabase, type FakeSupabase } from '../helpers/fake-supabase.js'

function makePick(id: string, overrides: Partial<PickRow> = {}): PickRow {
  return {
    id,
    detected_at: '2026-04-07T18:00:00Z',
    sport: 'mlb',
    game_id: id,
    game_date: '2026-04-07',
    game_time: '2026-04-07T23:05:00Z',
    away_team: 'New York Yankees',
    home_team: 'Boston Red Sox',
    market: 'moneyline',
    side: 'away',
    line: null,
    best_book: 'betmgm',
    best_price: -145,
    sharp_book: 'pinnacle',
    sharp_implied: 0.59,
    ev_pct: 0.03,
    all_prices: { betmgm: -145 },
    ...overrides,
  }
}

const FIXED_NOW = new Date('2026-04-08T09:30:00Z')

describe('runRecap', () => {
  let fake: FakeSupabase

  beforeEach(() => {
    fake = createFakeSupabase()
  })

  it('skips the email when no picks are graded in the last 24h', async () => {
    const send = vi.fn()
    const result = await runRecap({
      supabase: fake as never,
      now: () => FIXED_NOW,
      sendEmail: send,
      resendApiKey: 'unused',
      emailFrom: 'edge <a@b>',
      emailTo: 'me@example.com',
    })
    expect(result.sent).toBe(false)
    expect(result.reason).toMatch(/no picks settled/)
    expect(send).not.toHaveBeenCalled()
  })

  it('sends the email when there is at least one freshly graded pick', async () => {
    await upsertPick(fake as never, makePick('p1'))
    await insertPickGrade(fake as never, {
      pick_id: 'p1',
      outcome: 'won',
      graded_at: '2026-04-08T03:00:00Z',
    })
    await insertClosingLine(fake as never, {
      pick_id: 'p1',
      closed_at: '2026-04-07T22:55:00Z',
      sharp_close: -150,
      sharp_implied: 0.6,
      best_book_close: -145,
      capture_lag_min: -10,
    })
    const send = vi.fn(async () => ({ id: 'resend-123' }))
    const result = await runRecap({
      supabase: fake as never,
      now: () => FIXED_NOW,
      sendEmail: send,
      resendApiKey: 'unused',
      emailFrom: 'edge <a@b>',
      emailTo: 'me@example.com',
    })
    expect(result.sent).toBe(true)
    expect(result.settledCount).toBe(1)
    expect(send).toHaveBeenCalledTimes(1)
    const payload = send.mock.calls[0]![0] as { subject: string; html: string; csvFilename?: string }
    expect(payload.subject).toContain('Edge recap')
    expect(payload.subject).toContain('1 pick settled')
    expect(payload.csvFilename).toBeUndefined() // no CSV attachment
    expect(payload.html).toContain('Yankees ML')
  })

  it('does NOT count picks graded before the 24h cutoff in the settled list', async () => {
    // Two graded picks: one inside cutoff, one outside.
    await upsertPick(fake as never, makePick('inside'))
    await upsertPick(fake as never, makePick('outside', { id: 'outside', game_date: '2026-04-04' }))
    await insertPickGrade(fake as never, {
      pick_id: 'inside',
      outcome: 'won',
      graded_at: '2026-04-08T05:00:00Z',
    })
    await insertPickGrade(fake as never, {
      pick_id: 'outside',
      outcome: 'lost',
      graded_at: '2026-04-05T05:00:00Z', // > 24h before FIXED_NOW
    })
    const send = vi.fn(async () => ({ id: 'resend-123' }))
    const result = await runRecap({
      supabase: fake as never,
      now: () => FIXED_NOW,
      sendEmail: send,
      resendApiKey: 'unused',
      emailFrom: 'edge <a@b>',
      emailTo: 'me@example.com',
    })
    expect(result.sent).toBe(true)
    expect(result.settledCount).toBe(1) // only "inside" appears in the settled block
    // But the older pick is still in the rolling 7d totals (game_date 2026-04-04 is within 7 days of 2026-04-08)
    expect(result.metrics7d.picks).toBe(2)
  })

  it('subject line uses signed 7d units value', async () => {
    await upsertPick(fake as never, makePick('p1'))
    await insertPickGrade(fake as never, {
      pick_id: 'p1',
      outcome: 'won',
      graded_at: '2026-04-08T03:00:00Z',
    })
    const send = vi.fn(async () => ({ id: 'resend-123' }))
    const result = await runRecap({
      supabase: fake as never,
      now: () => FIXED_NOW,
      sendEmail: send,
      resendApiKey: 'unused',
      emailFrom: 'edge <a@b>',
      emailTo: 'me@example.com',
    })
    expect(result.sent).toBe(true)
    const payload = send.mock.calls[0]![0] as { subject: string }
    // -145 won → +0.69u
    expect(payload.subject).toBe('Edge recap — 1 pick settled, +0.69u (7d)')
  })
})
