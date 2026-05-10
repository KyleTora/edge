import type { EdgeSupabase } from '../db/client.js'
import type { Config, Env } from '../config.js'
import { listTodaysGames } from '../sources/action-network.js'
import { fetchActionNetworkProps } from '../sources/action-network-props.js'
import { propMarketsToCandidates } from '../parlay/candidates.js'
import { buildParlay } from '../parlay/builder.js'
import { renderParlayEmail } from '../email/parlay-template.js'
import { signMarkToken } from '../parlay/sign.js'
import { sendEmail } from '../email/send.js'
import {
  getStreakState,
  getParlayByCardDate,
  insertParlayWithLegs,
  getLifetimeRecord,
} from '../db/queries.js'

export interface RunScanInput {
  supabase: EdgeSupabase
  config: Config
  env: Env
  cardDate?: string
  forceRescan?: boolean
  dryRun?: boolean
  print?: (msg: string) => void
}

export async function runScan(input: RunScanInput): Promise<{ parlayId: string | null; emailSent: boolean }> {
  const cardDate =
    input.cardDate ??
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date())

  if (!input.forceRescan) {
    const existing = await getParlayByCardDate(input.supabase, cardDate)
    if (existing) {
      input.print?.(`parlay already exists for ${cardDate} (id=${existing.id})`)
      return { parlayId: existing.id, emailSent: false }
    }
  }

  // 1. Fetch candidate legs across in-season sports
  const candidates: Awaited<ReturnType<typeof propMarketsToCandidates>> = []
  for (const sport of input.config.sports) {
    if (!['nba','mlb','nhl'].includes(sport)) continue
    let games
    try {
      games = await listTodaysGames(sport as 'nba'|'mlb'|'nhl')
    } catch (err) {
      input.print?.(`warn: could not list ${sport} games: ${(err as Error).message}`)
      continue
    }
    for (const g of games) {
      try {
        const markets = await fetchActionNetworkProps({ sport: sport as any, gameId: g.game_id })
        candidates.push(...propMarketsToCandidates(markets, { allowedBooks: input.config.books }))
      } catch (err) {
        input.print?.(`warn: props fetch failed for ${sport} game ${g.game_id}: ${(err as Error).message}`)
      }
    }
  }
  input.print?.(`gathered ${candidates.length} candidate legs`)

  const built = buildParlay(candidates, input.config.parlay)
  const streak = await getStreakState(input.supabase)
  const lifetime = await getLifetimeRecord(input.supabase)

  // 2. Persist
  if (!built) {
    if (input.dryRun) {
      input.print?.(`[dry-run] would emit no-parlay-today notice for ${cardDate}`)
      return { parlayId: null, emailSent: false }
    }
    const { parlay } = await insertParlayWithLegs(
      input.supabase,
      {
        card_date: cardDate,
        combined_odds: 0,
        combined_prob: 0,
        ev_pct: 0,
        recommended_stake: 0,
        streak_at_creation: streak.current_streak,
        status: 'skipped',
        notes: 'no candidates met thresholds',
      },
      [],
    )
    if (input.env.RESEND_API_KEY && input.env.REPORT_EMAIL_TO && input.env.REPORT_EMAIL_FROM) {
      const email = renderParlayEmail({
        cardDate, parlayId: parlay.id,
        combinedOdds: 0, combinedProb: 0, recommendedStake: 0, streakAtCreation: streak.current_streak,
        lifetime,
        legs: [], betUrl: '', skipUrl: '',
        noParlayReason: 'No candidates met thresholds.',
      })
      await sendEmail({
        apiKey: input.env.RESEND_API_KEY,
        from: input.env.REPORT_EMAIL_FROM,
        to: input.env.REPORT_EMAIL_TO,
        subject: email.subject,
        html: email.html,
      })
    }
    return { parlayId: parlay.id, emailSent: true }
  }

  if (input.dryRun) {
    input.print?.(`[dry-run] built parlay ${built.combined_odds > 0 ? '+' : ''}${built.combined_odds} with ${built.legs.length} legs:`)
    for (const l of built.legs) {
      input.print?.(`  ${l.player_name} ${l.prop_side} ${l.prop_line} ${l.prop_market} @ ${l.book} (${l.price_american}) — true ${(l.true_prob*100).toFixed(0)}%${l.is_filler ? ' [filler]' : ''}`)
    }
    return { parlayId: null, emailSent: false }
  }

  const { parlay } = await insertParlayWithLegs(
    input.supabase,
    {
      card_date: cardDate,
      combined_odds: built.combined_odds,
      combined_prob: built.combined_prob,
      ev_pct: built.ev_pct,
      recommended_stake: streak.next_stake,
      streak_at_creation: streak.current_streak,
      status: 'bet',
      notes: null,
    },
    built.legs.map((l) => ({
      sport: l.sport, game_id: l.game_id, player_id: l.player_id, player_name: l.player_name,
      prop_market: l.prop_market, prop_line: l.prop_line, prop_side: l.prop_side,
      book: l.book, price_american: l.price_american,
      pinnacle_prob: l.pinnacle_prob ?? null, consensus_prob: l.consensus_prob ?? null,
      true_prob: l.true_prob, ev_pct: l.ev_pct, is_filler: l.is_filler,
    })),
  )

  // 3. Email
  const trackerBase = input.env.TRACKER_BASE_URL
  const signingSecret = input.env.TRACKER_SIGNING_SECRET
  const buildUrl = (action: 'bet'|'skip') =>
    trackerBase && signingSecret
      ? `${trackerBase}/mark?p=${parlay.id}&a=${action}&t=${signMarkToken(parlay.id, action, signingSecret)}`
      : ''
  const email = renderParlayEmail({
    cardDate, parlayId: parlay.id,
    combinedOdds: built.combined_odds, combinedProb: built.combined_prob,
    recommendedStake: streak.next_stake, streakAtCreation: streak.current_streak,
    lifetime,
    legs: built.legs.map((l) => ({
      player_name: l.player_name, prop_market: l.prop_market, prop_line: l.prop_line,
      prop_side: l.prop_side, price_american: l.price_american, true_prob: l.true_prob,
      is_filler: l.is_filler, book: l.book, sport: l.sport, game_label: '',
    })),
    betUrl: buildUrl('bet'), skipUrl: buildUrl('skip'),
  })
  let emailSent = false
  if (input.env.RESEND_API_KEY && input.env.REPORT_EMAIL_TO && input.env.REPORT_EMAIL_FROM) {
    await sendEmail({
      apiKey: input.env.RESEND_API_KEY,
      from: input.env.REPORT_EMAIL_FROM,
      to: input.env.REPORT_EMAIL_TO,
      subject: email.subject,
      html: email.html,
    })
    emailSent = true
  }
  input.print?.(`parlay ${parlay.id} created (${built.combined_odds > 0 ? '+' : ''}${built.combined_odds}, ${built.legs.length} legs); email sent: ${emailSent}`)
  return { parlayId: parlay.id, emailSent }
}
