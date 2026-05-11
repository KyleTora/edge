// src/commands/report.ts
// Re-renders today's parlay email and sends it (or prints in dry-run).
// Useful if the morning send failed or you want to re-deliver to a new address.
import type { EdgeSupabase } from '../db/client.js'
import type { Config, Env } from '../config.js'
import { getParlayByCardDate, listLegs, getLifetimeRecord } from '../db/queries.js'
import { renderParlayEmail } from '../email/parlay-template.js'
import { sendEmail } from '../email/send.js'

export interface RunReportInput {
  supabase: EdgeSupabase
  config: Config
  env: Env
  cardDate?: string
  dryRun?: boolean
  print?: (msg: string) => void
}

export async function runReport(input: RunReportInput): Promise<{ sent: boolean }> {
  const cardDate =
    input.cardDate ??
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date())
  const parlay = await getParlayByCardDate(input.supabase, cardDate)
  if (!parlay) throw new Error(`no parlay for ${cardDate}; run \`edge scan\` first`)
  const legs = await listLegs(input.supabase, parlay.id)
  const lifetime = await getLifetimeRecord(input.supabase)

  const email = renderParlayEmail({
    cardDate, parlayId: parlay.id,
    combinedOdds: parlay.combined_odds, combinedProb: parlay.combined_prob,
    recommendedStake: parlay.recommended_stake, streakAtCreation: parlay.streak_at_creation,
    lifetime,
    legs: legs.map((l) => ({
      player_name: l.player_name, prop_market: l.prop_market, prop_line: l.prop_line,
      prop_side: l.prop_side, price_american: l.price_american, true_prob: l.true_prob,
      is_filler: l.is_filler, book: l.book, sport: l.sport, game_label: '',
    })),
    noParlayReason: legs.length === 0 ? (parlay.notes ?? undefined) : undefined,
  })

  if (input.dryRun) {
    input.print?.(`SUBJECT: ${email.subject}`)
    input.print?.(email.html)
    return { sent: false }
  }
  if (!input.env.RESEND_API_KEY || !input.env.REPORT_EMAIL_TO || !input.env.REPORT_EMAIL_FROM) {
    throw new Error('Resend env vars missing')
  }
  await sendEmail({
    apiKey: input.env.RESEND_API_KEY,
    from: input.env.REPORT_EMAIL_FROM,
    to: input.env.REPORT_EMAIL_TO,
    subject: email.subject,
    html: email.html,
  })
  return { sent: true }
}
