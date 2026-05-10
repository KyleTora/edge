// src/db/queries.ts
import type { EdgeSupabase } from './client.js'

export interface ParlayRow {
  id: string
  card_date: string
  combined_odds: number
  combined_prob: number
  ev_pct: number
  recommended_stake: number
  streak_at_creation: number
  status: 'bet' | 'skipped' | 'won' | 'lost' | 'void'
  result_pnl: number | null
  bet_marked_at: string | null
  graded_at: string | null
  notes: string | null
  created_at: string
}

export interface ParlayLegRow {
  id: string
  parlay_id: string
  sport: 'nba' | 'mlb' | 'nhl'
  game_id: string
  player_id: string
  player_name: string
  prop_market: string
  prop_line: number
  prop_side: 'over' | 'under'
  book: string
  price_american: number
  pinnacle_prob: number | null
  consensus_prob: number | null
  true_prob: number
  ev_pct: number
  is_filler: boolean
  result: 'pending' | 'hit' | 'miss' | 'void'
  actual_value: number | null
  created_at: string
}

export interface StreakRow {
  id: number
  current_streak: number
  next_stake: number
  bankroll_pnl: number
  updated_at: string
}

export async function getStreakState(supabase: EdgeSupabase): Promise<StreakRow> {
  const { data, error } = await supabase.from('edge_streak_state').select('*').eq('id', 1).single()
  if (error) throw new Error(`getStreakState: ${error.message}`)
  return data as StreakRow
}

export async function updateStreakState(supabase: EdgeSupabase, patch: Partial<Omit<StreakRow,'id'|'updated_at'>>): Promise<void> {
  const { error } = await supabase
    .from('edge_streak_state')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', 1)
  if (error) throw new Error(`updateStreakState: ${error.message}`)
}

export async function getParlayByCardDate(supabase: EdgeSupabase, cardDate: string): Promise<ParlayRow | null> {
  const { data, error } = await supabase.from('edge_parlays').select('*').eq('card_date', cardDate).maybeSingle()
  if (error) throw new Error(`getParlayByCardDate: ${error.message}`)
  return (data as ParlayRow) ?? null
}

export async function insertParlayWithLegs(
  supabase: EdgeSupabase,
  parlay: Omit<ParlayRow, 'id' | 'created_at' | 'result_pnl' | 'bet_marked_at' | 'graded_at'>,
  legs: Omit<ParlayLegRow, 'id' | 'parlay_id' | 'created_at' | 'result' | 'actual_value'>[],
): Promise<{ parlay: ParlayRow; legs: ParlayLegRow[] }> {
  const { data: parlayData, error: pErr } = await supabase.from('edge_parlays').insert(parlay).select('*').single()
  if (pErr) throw new Error(`insertParlay: ${pErr.message}`)
  const parlayRow = parlayData as ParlayRow
  const legRows = legs.map((l) => ({ ...l, parlay_id: parlayRow.id }))
  const { data: legsData, error: lErr } = await supabase.from('edge_parlay_legs').insert(legRows).select('*')
  if (lErr) throw new Error(`insertLegs: ${lErr.message}`)
  return { parlay: parlayRow, legs: legsData as ParlayLegRow[] }
}

export async function listPendingParlays(supabase: EdgeSupabase): Promise<ParlayRow[]> {
  const { data, error } = await supabase
    .from('edge_parlays')
    .select('*')
    .is('graded_at', null)
    .order('card_date', { ascending: true })
  if (error) throw new Error(`listPendingParlays: ${error.message}`)
  return (data as ParlayRow[]) ?? []
}

export async function listLegs(supabase: EdgeSupabase, parlayId: string): Promise<ParlayLegRow[]> {
  const { data, error } = await supabase.from('edge_parlay_legs').select('*').eq('parlay_id', parlayId)
  if (error) throw new Error(`listLegs: ${error.message}`)
  return (data as ParlayLegRow[]) ?? []
}

export async function updateLegResult(
  supabase: EdgeSupabase,
  legId: string,
  result: 'hit' | 'miss' | 'void',
  actual_value: number | null,
): Promise<void> {
  const { error } = await supabase.from('edge_parlay_legs').update({ result, actual_value }).eq('id', legId)
  if (error) throw new Error(`updateLegResult: ${error.message}`)
}

export async function updateParlayResolution(
  supabase: EdgeSupabase,
  parlayId: string,
  patch: Partial<Pick<ParlayRow, 'status' | 'result_pnl' | 'graded_at'>>,
): Promise<void> {
  const { error } = await supabase.from('edge_parlays').update(patch).eq('id', parlayId)
  if (error) throw new Error(`updateParlayResolution: ${error.message}`)
}

export async function getLifetimeRecord(supabase: EdgeSupabase): Promise<{ wins: number; losses: number; pnl: number }> {
  const { data, error } = await supabase
    .from('edge_parlays')
    .select('status, result_pnl')
    .in('status', ['won', 'lost'])
  if (error) throw new Error(`getLifetimeRecord: ${error.message}`)
  let wins = 0, losses = 0, pnl = 0
  for (const row of (data ?? []) as Array<{ status: string; result_pnl: number | null }>) {
    if (row.status === 'won') wins += 1
    else if (row.status === 'lost') losses += 1
    pnl += Number(row.result_pnl ?? 0)
  }
  return { wins, losses, pnl }
}
