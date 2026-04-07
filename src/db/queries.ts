import type { EdgeSupabase } from './client.js'

export interface PickRow {
  id: string
  detected_at: string
  sport: string
  game_id: string
  game_date: string
  game_time: string
  away_team: string
  home_team: string
  market: 'moneyline' | 'total' | 'spread'
  side: 'home' | 'away' | 'over' | 'under'
  line: number | null
  best_book: string
  best_price: number
  sharp_book: string
  sharp_implied: number
  ev_pct: number
  all_prices: Record<string, number>
}

/**
 * Insert a pick if its id does not already exist. Returns true on insert,
 * false if the row already existed (idempotent re-detection).
 */
export async function upsertPick(supabase: EdgeSupabase, pick: PickRow): Promise<boolean> {
  // Check existence first so we can report whether this was a new insert.
  const existing = await supabase.from('edge_picks').select('id').eq('id', pick.id).limit(1)
  if (existing.error) throw new Error(`upsertPick.select error: ${existing.error.message}`)
  if (existing.data && existing.data.length > 0) return false

  const ins = await supabase.from('edge_picks').insert(pick)
  if (ins.error) {
    // Race: another process inserted between our select and insert. Treat as duplicate.
    if (ins.error.code === '23505') return false
    throw new Error(`upsertPick.insert error: ${ins.error.message}`)
  }
  return true
}

export async function listPicksForDate(
  supabase: EdgeSupabase,
  gameDate: string
): Promise<PickRow[]> {
  const res = await supabase
    .from('edge_picks')
    .select('*')
    .eq('game_date', gameDate)
    .order('ev_pct', { ascending: false })
  if (res.error) throw new Error(`listPicksForDate error: ${res.error.message}`)
  return (res.data ?? []) as PickRow[]
}

export interface ResultRow {
  game_id: string
  sport: string
  game_date: string
  home_score: number
  away_score: number
  status: 'final' | 'postponed' | 'canceled'
  resolved_at: string
}

export interface PickGradeRow {
  pick_id: string
  outcome: 'won' | 'lost' | 'push' | 'void'
  graded_at: string
}

export async function upsertResult(supabase: EdgeSupabase, row: ResultRow): Promise<void> {
  const res = await supabase.from('edge_results').upsert(row, { onConflict: 'game_id' })
  if (res.error) throw new Error(`upsertResult error: ${res.error.message}`)
}

export async function insertPickGrade(supabase: EdgeSupabase, row: PickGradeRow): Promise<void> {
  const res = await supabase.from('edge_pick_grades').upsert(row, { onConflict: 'pick_id' })
  if (res.error) throw new Error(`insertPickGrade error: ${res.error.message}`)
}

export async function getResultByGameId(
  supabase: EdgeSupabase,
  gameId: string
): Promise<ResultRow | null> {
  const res = await supabase.from('edge_results').select('*').eq('game_id', gameId).limit(1)
  if (res.error) throw new Error(`getResultByGameId error: ${res.error.message}`)
  return (res.data?.[0] as ResultRow | undefined) ?? null
}

/**
 * Picks whose game_date is within `lookbackDays` of `referenceDate` (YYYY-MM-DD)
 * and which have NO row in edge_pick_grades. Implementation: pull picks in date
 * range, pull all grades for those picks, filter in memory. The volumes are tiny
 * (<500 picks/day) so this is fine and avoids the foot-gun of trying to express
 * a NOT EXISTS via the Supabase query builder.
 */
export async function listPicksAwaitingGrade(
  supabase: EdgeSupabase,
  referenceDate: string,
  lookbackDays: number
): Promise<PickRow[]> {
  const ref = new Date(referenceDate + 'T00:00:00Z')
  const start = new Date(ref)
  start.setUTCDate(start.getUTCDate() - lookbackDays)
  const startStr = start.toISOString().slice(0, 10)

  const picksRes = await supabase
    .from('edge_picks')
    .select('*')
    .gte('game_date', startStr)
    .lte('game_date', referenceDate)
  if (picksRes.error) throw new Error(`listPicksAwaitingGrade.picks error: ${picksRes.error.message}`)
  const picks = (picksRes.data ?? []) as PickRow[]
  if (picks.length === 0) return []

  const gradesRes = await supabase
    .from('edge_pick_grades')
    .select('pick_id')
    .in(
      'pick_id',
      picks.map((p) => p.id)
    )
  if (gradesRes.error) throw new Error(`listPicksAwaitingGrade.grades error: ${gradesRes.error.message}`)
  const graded = new Set((gradesRes.data ?? []).map((g: { pick_id: string }) => g.pick_id))
  return picks.filter((p) => !graded.has(p.id))
}

export interface ClosingLineRow {
  pick_id: string
  closed_at: string
  sharp_close: number
  sharp_implied: number
  best_book_close: number | null
  capture_lag_min: number
}

export async function insertClosingLine(
  supabase: EdgeSupabase,
  row: ClosingLineRow
): Promise<void> {
  const res = await supabase.from('edge_closing_lines').upsert(row, { onConflict: 'pick_id' })
  if (res.error) throw new Error(`insertClosingLine error: ${res.error.message}`)
}

/**
 * Picks whose game_time starts within the next `windowMinutes` from `now`
 * and which do NOT already have a row in edge_closing_lines. Same in-memory
 * anti-join pattern as listPicksAwaitingGrade.
 */
export async function listPicksAwaitingClose(
  supabase: EdgeSupabase,
  now: Date,
  windowMinutes: number
): Promise<PickRow[]> {
  const startIso = now.toISOString()
  const endIso = new Date(now.getTime() + windowMinutes * 60_000).toISOString()

  const picksRes = await supabase
    .from('edge_picks')
    .select('*')
    .gte('game_time', startIso)
    .lt('game_time', endIso)
  if (picksRes.error)
    throw new Error(`listPicksAwaitingClose.picks error: ${picksRes.error.message}`)
  const picks = (picksRes.data ?? []) as PickRow[]
  if (picks.length === 0) return []

  const linesRes = await supabase
    .from('edge_closing_lines')
    .select('pick_id')
    .in(
      'pick_id',
      picks.map((p) => p.id)
    )
  if (linesRes.error)
    throw new Error(`listPicksAwaitingClose.lines error: ${linesRes.error.message}`)
  const captured = new Set((linesRes.data ?? []).map((r: { pick_id: string }) => r.pick_id))
  return picks.filter((p) => !captured.has(p.id))
}

export interface GradedPickRow extends PickRow {
  outcome: 'won' | 'lost' | 'push' | 'void'
  graded_at: string
}

/**
 * Picks whose game_date falls in [startDate, endDate] AND which have a grade row.
 * Returns a flat shape (pick fields + outcome + graded_at). The volumes are tiny,
 * so we fetch picks and grades separately and join in memory.
 */
export async function getPicksWithGradesInRange(
  supabase: EdgeSupabase,
  startDate: string,
  endDate: string
): Promise<GradedPickRow[]> {
  const picksRes = await supabase
    .from('edge_picks')
    .select('*')
    .gte('game_date', startDate)
    .lte('game_date', endDate)
  if (picksRes.error) throw new Error(`getPicksWithGradesInRange.picks: ${picksRes.error.message}`)
  const picks = (picksRes.data ?? []) as PickRow[]
  if (picks.length === 0) return []

  const gradesRes = await supabase
    .from('edge_pick_grades')
    .select('*')
    .in(
      'pick_id',
      picks.map((p) => p.id)
    )
  if (gradesRes.error) throw new Error(`getPicksWithGradesInRange.grades: ${gradesRes.error.message}`)
  const grades = new Map(
    ((gradesRes.data ?? []) as PickGradeRow[]).map((g) => [g.pick_id, g])
  )

  const result: GradedPickRow[] = []
  for (const p of picks) {
    const g = grades.get(p.id)
    if (!g) continue
    result.push({ ...p, outcome: g.outcome, graded_at: g.graded_at })
  }
  return result
}

export async function getClosingLinesForPicks(
  supabase: EdgeSupabase,
  pickIds: string[]
): Promise<Map<string, ClosingLineRow>> {
  if (pickIds.length === 0) return new Map()
  const res = await supabase.from('edge_closing_lines').select('*').in('pick_id', pickIds)
  if (res.error) throw new Error(`getClosingLinesForPicks: ${res.error.message}`)
  const map = new Map<string, ClosingLineRow>()
  for (const row of (res.data ?? []) as ClosingLineRow[]) {
    map.set(row.pick_id, row)
  }
  return map
}
