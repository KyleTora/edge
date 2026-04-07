import type { PickRow } from '../db/queries.js'
import type { QuotaSnapshot } from '../quota.js'

export interface EmailRenderInput {
  picks: PickRow[]
  quota: QuotaSnapshot | null
  runLabel: string         // e.g. "4pm ET" or "11am ET (MLB only)"
  runDate: string          // YYYY-MM-DD in local time (ET)
  sportsScanned: string[]  // e.g. ['mlb', 'nba', 'nhl']
}

export interface RenderedEmail {
  subject: string
  html: string
  csv: string
}

function abbr(team: string): string {
  const parts = team.split(' ')
  const last = parts[parts.length - 1] ?? team
  return last.slice(0, 3).toUpperCase()
}

function pickLabel(p: PickRow): string {
  if (p.market === 'moneyline') {
    const team = p.side === 'home' ? p.home_team : p.away_team
    const lastWord = team.split(' ').slice(-1)[0] ?? team
    return `${lastWord} ML`
  }
  if (p.market === 'total') {
    return `${p.side === 'over' ? 'Over' : 'Under'} ${p.line}`
  }
  return p.side
}

function fmtPrice(price: number): string {
  return price > 0 ? `+${price}` : `${price}`
}

function fmtEv(ev: number): string {
  const pct = (ev * 100).toFixed(1)
  const sign = ev >= 0 ? '+' : ''
  return `${sign}${pct}%`
}

function fmtDate(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split('-').map(Number)
  const date = new Date(Date.UTC(y!, m! - 1, d!))
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('en-US', {
    timeZone: 'America/Toronto',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function topPickSummary(picks: PickRow[]): string {
  if (picks.length === 0) return ''
  const top = [...picks].sort((a, b) => b.ev_pct - a.ev_pct)[0]!
  return `top: ${fmtEv(top.ev_pct)} ${top.sport.toUpperCase()}`
}

function buildSubject(input: EmailRenderInput): string {
  const dateStr = fmtDate(input.runDate)
  if (input.picks.length === 0) {
    return `edge — quiet day ${dateStr} (no +EV)`
  }
  const count = input.picks.length
  const noun = count === 1 ? 'pick' : 'picks'
  return `edge — ${count} ${noun} for ${dateStr} (${topPickSummary(input.picks)})`
}

function buildHtml(input: EmailRenderInput): string {
  const dateStr = fmtDate(input.runDate)
  const header = `<h2 style="margin:0 0 8px 0;font-family:system-ui,sans-serif;">edge daily report — ${dateStr} — ${input.runLabel}</h2>`

  let body: string
  if (input.picks.length === 0) {
    body = `<p style="font-family:system-ui,sans-serif;color:#555;">No markets crossed +2.0% EV.</p>`
  } else {
    const sorted = [...input.picks].sort((a, b) => b.ev_pct - a.ev_pct)
    const rows = sorted
      .map((p) => {
        const matchup = `${abbr(p.away_team)} @ ${abbr(p.home_team)}`
        const ev = fmtEv(p.ev_pct)
        const evColor = p.ev_pct >= 0.04 ? '#0a7c2f' : '#a86b00'
        return `<tr>
  <td style="padding:6px 10px;color:${evColor};font-weight:600;">${ev}</td>
  <td style="padding:6px 10px;">${p.sport.toUpperCase()}</td>
  <td style="padding:6px 10px;">${matchup}</td>
  <td style="padding:6px 10px;">${pickLabel(p)}</td>
  <td style="padding:6px 10px;">${p.best_book}</td>
  <td style="padding:6px 10px;">${fmtPrice(p.best_price)}</td>
  <td style="padding:6px 10px;color:#666;">${(p.sharp_implied * 100).toFixed(1)}%</td>
  <td style="padding:6px 10px;color:#666;">${fmtTime(p.game_time)}</td>
</tr>`
      })
      .join('\n')
    body = `<table style="border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px;">
  <thead>
    <tr style="background:#f4f4f4;">
      <th style="padding:6px 10px;text-align:left;">EV%</th>
      <th style="padding:6px 10px;text-align:left;">Sport</th>
      <th style="padding:6px 10px;text-align:left;">Matchup</th>
      <th style="padding:6px 10px;text-align:left;">Pick</th>
      <th style="padding:6px 10px;text-align:left;">Book</th>
      <th style="padding:6px 10px;text-align:left;">Price</th>
      <th style="padding:6px 10px;text-align:left;">Sharp</th>
      <th style="padding:6px 10px;text-align:left;">Start</th>
    </tr>
  </thead>
  <tbody>
${rows}
  </tbody>
</table>`
  }

  const quotaLine = input.quota
    ? `Odds API credits used this month: ${input.quota.used} / 500 (${input.quota.remaining} remaining)`
    : 'Odds API credits: unknown (no fetch this run)'

  const stats = `<div style="margin-top:24px;font-family:system-ui,sans-serif;font-size:13px;color:#555;">
  <hr style="border:none;border-top:1px solid #ddd;margin:16px 0;">
  <p style="margin:4px 0;">Picks this run: <strong>${input.picks.length}</strong></p>
  <p style="margin:4px 0;">Sharp anchor: Pinnacle (${input.sportsScanned.length} sport${input.sportsScanned.length === 1 ? '' : 's'} scanned: ${input.sportsScanned.join(', ').toUpperCase()})</p>
  <p style="margin:4px 0;">${quotaLine}</p>
  <p style="margin:12px 0 0 0;color:#999;font-size:12px;">CSV attached for spreadsheet import.</p>
</div>`

  return `<!doctype html>
<html><body style="background:#fafafa;padding:20px;margin:0;">
<div style="max-width:760px;margin:0 auto;background:white;padding:24px;border-radius:8px;border:1px solid #e5e5e5;">
${header}
${body}
${stats}
</div>
</body></html>`
}

function csvEscape(v: string): string {
  if (v.includes(',') || v.includes('"') || v.includes('\n')) {
    return `"${v.replace(/"/g, '""')}"`
  }
  return v
}

function buildCsv(input: EmailRenderInput): string {
  const header = 'ev_pct,sport,matchup,pick,best_book,best_price,sharp_implied_pct,start_time,sharp_book'
  const sorted = [...input.picks].sort((a, b) => b.ev_pct - a.ev_pct)
  const rows = sorted.map((p) => {
    const matchup = `${abbr(p.away_team)} @ ${abbr(p.home_team)}`
    return [
      p.ev_pct.toFixed(4),
      p.sport,
      csvEscape(matchup),
      csvEscape(pickLabel(p)),
      csvEscape(p.best_book),
      String(p.best_price),
      (p.sharp_implied * 100).toFixed(2),
      p.game_time,
      p.sharp_book,
    ].join(',')
  })
  return [header, ...rows].join('\n') + '\n'
}

export function renderEmail(input: EmailRenderInput): RenderedEmail {
  return {
    subject: buildSubject(input),
    html: buildHtml(input),
    csv: buildCsv(input),
  }
}
