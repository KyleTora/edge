import { describe, it, expect, beforeEach } from 'vitest'
import { createFakeSupabase, type FakeSupabase } from './fake-supabase.js'

describe('fake-supabase', () => {
  let fake: FakeSupabase

  beforeEach(() => {
    fake = createFakeSupabase()
  })

  it('inserts a row and selects it back', async () => {
    const ins = await fake
      .from('edge_picks')
      .insert({ id: 'a', ev_pct: 0.05 })
    expect(ins.error).toBeNull()

    const sel = await fake.from('edge_picks').select('*')
    expect(sel.error).toBeNull()
    expect(sel.data).toEqual([{ id: 'a', ev_pct: 0.05 }])
  })

  it('upsert with onConflict ignore returns count=0 on duplicate id', async () => {
    await fake.from('edge_picks').upsert({ id: 'a', v: 1 }, { onConflict: 'id', ignoreDuplicates: true })
    const second = await fake
      .from('edge_picks')
      .upsert({ id: 'a', v: 2 }, { onConflict: 'id', ignoreDuplicates: true })
    expect(second.error).toBeNull()

    const sel = await fake.from('edge_picks').select('*')
    expect(sel.data).toEqual([{ id: 'a', v: 1 }]) // first write preserved
  })

  it('eq filter narrows results', async () => {
    await fake.from('edge_picks').insert({ id: 'a', sport: 'mlb' })
    await fake.from('edge_picks').insert({ id: 'b', sport: 'nba' })
    const sel = await fake.from('edge_picks').select('*').eq('sport', 'mlb')
    expect(sel.data).toEqual([{ id: 'a', sport: 'mlb' }])
  })

  it('lt and gte filters work on date strings', async () => {
    await fake.from('edge_picks').insert({ id: 'a', game_date: '2026-04-01' })
    await fake.from('edge_picks').insert({ id: 'b', game_date: '2026-04-05' })
    await fake.from('edge_picks').insert({ id: 'c', game_date: '2026-04-10' })
    const sel = await fake
      .from('edge_picks')
      .select('*')
      .gte('game_date', '2026-04-02')
      .lt('game_date', '2026-04-08')
    expect(sel.data?.map((r) => r.id)).toEqual(['b'])
  })

  it('order then limit', async () => {
    await fake.from('edge_picks').insert({ id: 'a', ev_pct: 0.01 })
    await fake.from('edge_picks').insert({ id: 'b', ev_pct: 0.05 })
    await fake.from('edge_picks').insert({ id: 'c', ev_pct: 0.03 })
    const sel = await fake
      .from('edge_picks')
      .select('*')
      .order('ev_pct', { ascending: false })
      .limit(2)
    expect(sel.data?.map((r) => r.id)).toEqual(['b', 'c'])
  })

  it('in() filter narrows to rows whose column matches one of the values', async () => {
    await fake.from('edge_picks').insert({ id: 'a', sport: 'mlb' })
    await fake.from('edge_picks').insert({ id: 'b', sport: 'nba' })
    await fake.from('edge_picks').insert({ id: 'c', sport: 'nhl' })
    const sel = await fake.from('edge_picks').select('*').in('sport', ['mlb', 'nhl'])
    expect(sel.data?.map((r) => r.id).sort()).toEqual(['a', 'c'])
  })

  it('is(column, null) matches rows where the column is null or undefined', async () => {
    await fake.from('edge_picks').insert({ id: 'a', line: null })
    await fake.from('edge_picks').insert({ id: 'b', line: 8.5 })
    await fake.from('edge_picks').insert({ id: 'c' }) // line undefined
    const sel = await fake.from('edge_picks').select('*').is('line', null)
    expect(sel.data?.map((r) => r.id).sort()).toEqual(['a', 'c'])
  })

  it('not(column, "is", null) matches rows where the column has a non-null value', async () => {
    await fake.from('edge_picks').insert({ id: 'a', line: null })
    await fake.from('edge_picks').insert({ id: 'b', line: 8.5 })
    const sel = await fake.from('edge_picks').select('*').not('line', 'is', null)
    expect(sel.data?.map((r) => r.id)).toEqual(['b'])
  })

  it('supports update().eq() to mutate matching rows', async () => {
    const fake = createFakeSupabase()
    await fake.from('edge_picks').insert([
      { id: 'a', status: 'active' },
      { id: 'b', status: 'active' },
    ])

    const res = await fake.from('edge_picks').update({ status: 'swapped_off' }).eq('id', 'a')

    expect(res.error).toBeNull()
    expect(fake._tables.edge_picks).toEqual([
      { id: 'a', status: 'swapped_off' },
      { id: 'b', status: 'active' },
    ])
  })
})
