import type { GradedPickRow } from '../db/queries.js'
import type { RecordMetrics, SportBreakdown } from '../record/aggregate.js'
import { unitProfit } from '../record/grading-math.js'

export interface RenderRecapInput {
  newlySettled: GradedPickRow[]
  metrics7d: RecordMetrics
  metrics30d: RecordMetrics
  metricsAll: RecordMetrics
  asOf: Date
}

export interface BuildRecapSubjectInput {
  settledCount: number
  units7d: number
}

const dash = '—'

function pct(n: number | null): string {
  if (n === null) return dash
  const sign = n >= 0 ? '+' : ''
  return `${sign}${(n * 100).toFixed(1)}%`
}

function ratio(n: number | null): string {
  return n === null ? dash : `${(n * 100).toFixed(1)}%`
}

function units(n: number): string {
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}u`
}

function lastWord(team: string): string {
  const parts = team.split(' ')
  return parts[parts.length - 1] ?? team
}

function pickLabel(p: GradedPickRow): string {
  if (p.market === 'moneyline') {
    const team = p.side === 'home' ? p.home_team : p.away_team
    return `${lastWord(team)} ML`
  }
  if (p.market === 'total') {
    const dir = p.side === 'over' ? 'Over' : 'Under'
    return `${dir} ${p.line}`
  }
  // spread
  const team = p.side === 'home' ? p.home_team : p.away_team
  const ln = p.line ?? 0
  const sign = ln >= 0 ? '+' : ''
  return `${lastWord(team)} ${sign}${ln}`
}

function fmtPrice(price: number): string {
  return price > 0 ? `+${price}` : `${price}`
}

function outcomeLabel(o: GradedPickRow['outcome']): string {
  if (o === 'won') return '✓ Won'
  if (o === 'lost') return '✗ Lost'
  if (o === 'push') return 'Push'
  return 'Void'
}

function fmtUtcDateTime(d: Date): string {
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mn = String(d.getUTCMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mn} UTC`
}

function renderHeadlineTable(
  m7: RecordMetrics,
  m30: RecordMetrics,
  mAll: RecordMetrics
): string {
  const rows: Array<[string, string, string, string]> = [
    ['Picks', String(m7.picks), String(m30.picks), String(mAll.picks)],
    [
      'Record (W-L-P)',
      `${m7.won}-${m7.lost}-${m7.push}`,
      `${m30.won}-${m30.lost}-${m30.push}`,
      `${mAll.won}-${mAll.lost}-${mAll.push}`,
    ],
    ['Hit rate', ratio(m7.hitRate), ratio(m30.hitRate), ratio(mAll.hitRate)],
    ['Units', units(m7.units), units(m30.units), units(mAll.units)],
    ['ROI', pct(m7.roi), pct(m30.roi), pct(mAll.roi)],
    ['Avg EV', pct(m7.avgEv), pct(m30.avgEv), pct(mAll.avgEv)],
    ['CLV avg', pct(m7.clvAvg), pct(m30.clvAvg), pct(mAll.clvAvg)],
    ['CLV beat rate', ratio(m7.clvBeatRate), ratio(m30.clvBeatRate), ratio(mAll.clvBeatRate)],
  ]

  const body = rows
    .map(
      ([label, a, b, c]) => `
  <tr>
    <td style="padding:6px 10px;color:#666;">${label}</td>
    <td style="padding:6px 10px;text-align:right;font-weight:600;">${a}</td>
    <td style="padding:6px 10px;text-align:right;">${b}</td>
    <td style="padding:6px 10px;text-align:right;">${c}</td>
  </tr>`
    )
    .join('')

  return `<h3 style="margin:24px 0 8px 0;font-family:system-ui,sans-serif;">Rolling totals</h3>
<table style="border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px;min-width:480px;">
  <thead>
    <tr style="background:#f4f4f4;">
      <th style="padding:6px 10px;text-align:left;">Metric</th>
      <th style="padding:6px 10px;text-align:right;">7d</th>
      <th style="padding:6px 10px;text-align:right;">30d</th>
      <th style="padding:6px 10px;text-align:right;">All-time</th>
    </tr>
  </thead>
  <tbody>${body}
  </tbody>
</table>`
}

function renderSettledTable(picks: GradedPickRow[]): string {
  if (picks.length === 0) {
    return ''
  }
  const sorted = [...picks].sort((a, b) => (a.graded_at < b.graded_at ? 1 : -1))
  const rows = sorted
    .map((p) => {
      const matchup = `${lastWord(p.away_team)} @ ${lastWord(p.home_team)}`
      const u = unitProfit(p.outcome, p.best_price)
      const uColor = u > 0 ? '#0a7c2f' : u < 0 ? '#a8201a' : '#666'
      return `
  <tr>
    <td style="padding:6px 10px;">${p.sport.toUpperCase()}</td>
    <td style="padding:6px 10px;">${matchup}</td>
    <td style="padding:6px 10px;">${pickLabel(p)}</td>
    <td style="padding:6px 10px;">${fmtPrice(p.best_price)}</td>
    <td style="padding:6px 10px;">${outcomeLabel(p.outcome)}</td>
    <td style="padding:6px 10px;text-align:right;color:${uColor};font-weight:600;">${units(u)}</td>
  </tr>`
    })
    .join('')

  return `<h3 style="margin:24px 0 8px 0;font-family:system-ui,sans-serif;">Settled overnight</h3>
<table style="border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px;">
  <thead>
    <tr style="background:#f4f4f4;">
      <th style="padding:6px 10px;text-align:left;">Sport</th>
      <th style="padding:6px 10px;text-align:left;">Matchup</th>
      <th style="padding:6px 10px;text-align:left;">Pick</th>
      <th style="padding:6px 10px;text-align:left;">Price</th>
      <th style="padding:6px 10px;text-align:left;">Result</th>
      <th style="padding:6px 10px;text-align:right;">Units</th>
    </tr>
  </thead>
  <tbody>${rows}
  </tbody>
</table>`
}

function renderBySportTable(bySport: SportBreakdown[]): string {
  if (bySport.length === 0) return ''
  const rows = bySport
    .map(
      (s) => `
  <tr>
    <td style="padding:6px 10px;">${s.sport.toUpperCase()}</td>
    <td style="padding:6px 10px;text-align:right;">${s.picks}</td>
    <td style="padding:6px 10px;text-align:right;">${s.won}-${s.lost}-${s.push}</td>
    <td style="padding:6px 10px;text-align:right;">${units(s.units)}</td>
    <td style="padding:6px 10px;text-align:right;">${pct(s.picks > 0 ? s.units / s.picks : null)}</td>
    <td style="padding:6px 10px;text-align:right;">${pct(s.clvAvg)}</td>
  </tr>`
    )
    .join('')
  return `<h3 style="margin:24px 0 8px 0;font-family:system-ui,sans-serif;">Last 7 days by sport</h3>
<table style="border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px;">
  <thead>
    <tr style="background:#f4f4f4;">
      <th style="padding:6px 10px;text-align:left;">Sport</th>
      <th style="padding:6px 10px;text-align:right;">Picks</th>
      <th style="padding:6px 10px;text-align:right;">W-L-P</th>
      <th style="padding:6px 10px;text-align:right;">Units</th>
      <th style="padding:6px 10px;text-align:right;">ROI</th>
      <th style="padding:6px 10px;text-align:right;">CLV</th>
    </tr>
  </thead>
  <tbody>${rows}
  </tbody>
</table>`
}

function renderFooter(input: RenderRecapInput): string {
  const ts = fmtUtcDateTime(input.asOf)
  const settled = input.newlySettled.length
  const allTime = input.metricsAll.picks
  return `<div style="margin-top:24px;font-family:system-ui,sans-serif;font-size:12px;color:#999;">
  <hr style="border:none;border-top:1px solid #ddd;margin:16px 0;">
  Generated ${ts} · ${settled} settled · ${allTime} graded all-time
</div>`
}

export function renderRecapHtml(input: RenderRecapInput): string {
  const header = `<h2 style="margin:0 0 8px 0;font-family:system-ui,sans-serif;">edge recap</h2>`
  const settled = renderSettledTable(input.newlySettled)
  const headline = renderHeadlineTable(input.metrics7d, input.metrics30d, input.metricsAll)
  const bySport = renderBySportTable(input.metrics7d.bySport)
  const footer = renderFooter(input)

  return `<!doctype html>
<html><body style="background:#fafafa;padding:20px;margin:0;">
<div style="max-width:760px;margin:0 auto;background:white;padding:24px;border-radius:8px;border:1px solid #e5e5e5;">
${header}
${settled}
${headline}
${bySport}
${footer}
</div>
</body></html>`
}

export function buildRecapSubject(input: BuildRecapSubjectInput): string {
  const noun = input.settledCount === 1 ? 'pick' : 'picks'
  return `Edge recap — ${input.settledCount} ${noun} settled, ${units(input.units7d)} (7d)`
}
