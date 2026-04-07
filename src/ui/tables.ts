import Table from 'cli-table3'
import chalk from 'chalk'
import type { PickRow } from '../db/queries.js'

const TEAM_ABBR: Record<string, string> = {
  'Los Angeles Lakers': 'LAL',
  'Denver Nuggets': 'DEN',
}

function abbr(team: string): string {
  if (TEAM_ABBR[team]) return TEAM_ABBR[team]
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

function fmtTime(iso: string): string {
  const d = new Date(iso)
  const hh = d.getHours()
  const mm = d.getMinutes().toString().padStart(2, '0')
  const ampm = hh >= 12 ? 'p' : 'a'
  const h12 = hh % 12 || 12
  return `${h12}:${mm}${ampm}`
}

function colorEv(ev: number, label: string): string {
  if (ev >= 0.04) return chalk.green(label)
  if (ev >= 0.02) return chalk.yellow(label)
  return chalk.dim(label)
}

export function renderPicksTable(picks: PickRow[]): string {
  if (picks.length === 0) {
    return chalk.dim('No +EV picks at the current threshold.')
  }

  const table = new Table({
    head: ['EV%', 'SPORT', 'MATCHUP', 'PICK', 'BOOK', 'PRICE', 'SHARP', 'START'],
    style: { head: ['bold'], border: ['gray'] },
  })

  for (const p of picks) {
    const matchup = `${abbr(p.away_team)} @ ${abbr(p.home_team)}`
    const evLabel = fmtEv(p.ev_pct)
    table.push([
      colorEv(p.ev_pct, evLabel),
      p.sport.toUpperCase(),
      matchup,
      pickLabel(p),
      p.best_book,
      fmtPrice(p.best_price),
      `${(p.sharp_implied * 100).toFixed(1)}%`,
      fmtTime(p.game_time),
    ])
  }

  return table.toString() + `\n\n${picks.length} pick${picks.length === 1 ? '' : 's'}.`
}
