export interface RenderLegInput {
  player_name: string
  prop_market: string
  prop_line: number
  prop_side: 'over' | 'under'
  price_american: number
  true_prob: number
  is_filler: boolean
  book: string
  sport: string
  game_label: string
}

export interface RenderParlayInput {
  cardDate: string         // YYYY-MM-DD
  parlayId: string
  combinedOdds: number
  combinedProb: number
  recommendedStake: number
  streakAtCreation: number
  lifetime: { wins: number; losses: number; pnl: number }
  legs: RenderLegInput[]
  betUrl: string
  skipUrl: string
  noParlayReason?: string
}

export interface RenderedEmail {
  subject: string
  html: string
}

function fmtAmerican(n: number): string {
  return n > 0 ? `+${n}` : `${n}`
}

function fmtDate(iso: string): string {
  // 2026-05-10 → "May 10"
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function legCard(leg: RenderLegInput): string {
  const fillerBadge = leg.is_filler
    ? `<span style="background:#fbbf24;color:#78350f;font-size:11px;padding:2px 8px;border-radius:4px;margin-left:8px">filler</span>`
    : `<span style="background:#10b981;color:#fff;font-size:11px;padding:2px 8px;border-radius:4px;margin-left:8px">+EV</span>`
  return `
    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:12px;background:#fff">
      <div style="font-weight:600;font-size:16px;color:#111827">
        ${leg.player_name} — ${leg.prop_side === 'over' ? 'Over' : 'Under'} ${leg.prop_line} ${leg.prop_market.replace(/_/g,' ')}
        ${fillerBadge}
      </div>
      <div style="margin-top:6px;color:#6b7280;font-size:13px">
        ${leg.sport.toUpperCase()} · ${leg.game_label} · ${leg.book} ${fmtAmerican(leg.price_american)}
        · true prob ${(leg.true_prob*100).toFixed(0)}%
      </div>
    </div>`
}

export function renderParlayEmail(input: RenderParlayInput): RenderedEmail {
  const dateLabel = fmtDate(input.cardDate)
  if (input.legs.length === 0) {
    return {
      subject: `Edge Parlay — Skip Day (${dateLabel})`,
      html: `
        <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111827">
          <h1 style="margin:0 0 8px;font-size:22px">No parlay today</h1>
          <p style="color:#6b7280;margin:0 0 16px">${input.noParlayReason ?? 'Insufficient candidates met thresholds.'}</p>
          <p style="color:#6b7280;font-size:13px">Streak unaffected. See you tomorrow.</p>
        </div>`,
    }
  }

  const legs = input.legs.map(legCard).join('\n')
  const oddsLabel = fmtAmerican(input.combinedOdds)
  const payoutEstimate = (input.recommendedStake * (input.combinedOdds > 0
    ? (input.combinedOdds / 100)
    : (100 / -input.combinedOdds))).toFixed(2)

  return {
    subject: `Edge Parlay — ${dateLabel} (${oddsLabel})`,
    html: `
      <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111827;background:#f9fafb">
        <h1 style="margin:0 0 4px;font-size:22px">Edge Parlay — ${dateLabel}</h1>
        <div style="color:#6b7280;font-size:14px;margin-bottom:18px">
          ${oddsLabel} · stake $${input.recommendedStake.toFixed(2)} · est. payout +$${payoutEstimate}
          · bet #${input.streakAtCreation + 1} of current run
        </div>
        ${legs}
        <div style="margin-top:24px;text-align:center">
          <a href="${input.skipUrl}" style="display:inline-block;background:#dc2626;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:600;margin-right:8px">Skip this one</a>
          <a href="${input.betUrl}" style="display:inline-block;background:#f3f4f6;color:#111827;padding:14px 28px;border-radius:6px;text-decoration:none;border:1px solid #d1d5db">Confirm bet</a>
        </div>
        <div style="margin-top:24px;color:#6b7280;font-size:12px;text-align:center">
          Lifetime: ${input.lifetime.wins}-${input.lifetime.losses} · P&L $${input.lifetime.pnl.toFixed(2)}
        </div>
      </div>`,
  }
}
