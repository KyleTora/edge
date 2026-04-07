import type { RecordMetrics } from './aggregate.js'

export interface FormatRecordInput {
  metrics: RecordMetrics
  sinceLabel: string
  untilLabel: string
}

const dash = '—'

function pct(n: number | null): string {
  if (n === null) return dash
  const sign = n >= 0 ? '+' : ''
  return `${sign}${(n * 100).toFixed(1)}%`
}

function units(n: number): string {
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(1)}u`
}

function ratio(n: number | null): string {
  return n === null ? dash : `${(n * 100).toFixed(1)}%`
}

export function formatRecord(input: FormatRecordInput): string {
  const m = input.metrics
  const lines: string[] = []
  lines.push(`edge record — ${input.sinceLabel} → ${input.untilLabel}`)
  lines.push('')
  lines.push(`                          PAPER (model)         REAL (placed)`)
  lines.push(`Picks / Bets:             ${String(m.picks).padEnd(20)}  ${dash}`)
  lines.push(
    `W / L / Push / Void:      ${`${m.won}-${m.lost}-${m.push}-${m.void}`.padEnd(20)}  ${dash}`
  )
  lines.push(`Hit rate:                 ${ratio(m.hitRate).padEnd(20)}  ${dash}`)
  lines.push(`Avg EV at detection:      ${pct(m.avgEv).padEnd(20)}  ${dash}`)
  lines.push(`ROI (flat 1u):            ${pct(m.roi).padEnd(20)}  ${dash}`)
  lines.push(`Units +/-:                ${units(m.units).padEnd(20)}  ${dash}`)
  lines.push(`CLV avg:                  ${pct(m.clvAvg).padEnd(20)}  ${dash}`)
  lines.push(
    `CLV beat rate:            ${(m.clvBeatRate === null ? dash : `${ratio(m.clvBeatRate)} (${m.picksWithCLV > 0 ? `${Math.round(m.clvBeatRate * m.picksWithCLV)}/${m.picksWithCLV}` : '0/0'})`).padEnd(20)}  ${dash}`
  )
  lines.push(
    `Captured closes:          ${(m.capturedClosesPct === null ? dash : `${m.picksWithCLV}/${m.picks} (${ratio(m.capturedClosesPct)})`).padEnd(20)}  ${dash}`
  )
  lines.push('')
  if (m.bySport.length > 0) {
    lines.push('By sport (paper):')
    for (const s of m.bySport) {
      const wlp = `${s.won}-${s.lost}-${s.push}`
      lines.push(
        `   ${s.sport.toUpperCase().padEnd(6)} ${String(s.picks).padStart(3)} picks   ${wlp.padEnd(8)} ${units(s.units).padEnd(8)} ${pct(s.clvAvg).padEnd(8)} CLV`
      )
    }
    lines.push('')
  }
  if (m.approximateCLV > 0) {
    lines.push(
      `⚠ ${m.approximateCLV} pick${m.approximateCLV === 1 ? '' : 's'} have approximate CLV (closing line captured >5 min after game start)`
    )
  }
  return lines.join('\n')
}
