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
