type Row = Record<string, unknown>

interface QueryState {
  table: string
  filters: Array<(row: Row) => boolean>
  orderBy?: { column: string; ascending: boolean }
  limitN?: number
}

export interface FakeQuery extends Promise<{ data: Row[] | null; error: null }> {
  eq(column: string, value: unknown): FakeQuery
  gte(column: string, value: unknown): FakeQuery
  lte(column: string, value: unknown): FakeQuery
  lt(column: string, value: unknown): FakeQuery
  gt(column: string, value: unknown): FakeQuery
  in(column: string, values: unknown[]): FakeQuery
  not(column: string, op: string, value: unknown): FakeQuery
  is(column: string, value: unknown): FakeQuery
  order(column: string, opts?: { ascending?: boolean }): FakeQuery
  limit(n: number): FakeQuery
}

export interface FakeSupabase {
  from(table: string): {
    select: (cols?: string) => FakeQuery
    insert: (row: Row | Row[]) => Promise<{ error: null }>
    upsert: (
      row: Row | Row[],
      opts?: { onConflict?: string; ignoreDuplicates?: boolean }
    ) => Promise<{ error: null }>
  }
  // test-only inspection helper
  _tables: Record<string, Row[]>
}

function getTable(tables: Record<string, Row[]>, name: string): Row[] {
  let t = tables[name]
  if (!t) {
    t = []
    tables[name] = t
  }
  return t
}

function makeQuery(state: QueryState, tables: Record<string, Row[]>): FakeQuery {
  const exec = async () => {
    let rows = getTable(tables, state.table).slice()
    for (const f of state.filters) rows = rows.filter(f)
    if (state.orderBy) {
      const { column, ascending } = state.orderBy
      rows.sort((a, b) => {
        const av = a[column]
        const bv = b[column]
        if (av === bv) return 0
        if (av === undefined || av === null) return 1
        if (bv === undefined || bv === null) return -1
        const cmp = (av as never) < (bv as never) ? -1 : 1
        return ascending ? cmp : -cmp
      })
    }
    if (state.limitN !== undefined) rows = rows.slice(0, state.limitN)
    return { data: rows, error: null as null }
  }

  const promise = exec() as unknown as FakeQuery
  promise.eq = (column, value) =>
    makeQuery({ ...state, filters: [...state.filters, (r) => r[column] === value] }, tables)
  promise.gte = (column, value) =>
    makeQuery(
      { ...state, filters: [...state.filters, (r) => (r[column] as never) >= (value as never)] },
      tables
    )
  promise.lte = (column, value) =>
    makeQuery(
      { ...state, filters: [...state.filters, (r) => (r[column] as never) <= (value as never)] },
      tables
    )
  promise.lt = (column, value) =>
    makeQuery(
      { ...state, filters: [...state.filters, (r) => (r[column] as never) < (value as never)] },
      tables
    )
  promise.gt = (column, value) =>
    makeQuery(
      { ...state, filters: [...state.filters, (r) => (r[column] as never) > (value as never)] },
      tables
    )
  promise.in = (column, values) =>
    makeQuery(
      { ...state, filters: [...state.filters, (r) => values.includes(r[column])] },
      tables
    )
  promise.not = (column, op, value) =>
    makeQuery(
      {
        ...state,
        filters: [
          ...state.filters,
          (r) => {
            if (op === 'is' && value === null) return r[column] !== null && r[column] !== undefined
            if (op === 'eq') return r[column] !== value
            throw new Error(`fake-supabase: not(${op}) not implemented`)
          },
        ],
      },
      tables
    )
  promise.is = (column, value) =>
    makeQuery(
      {
        ...state,
        filters: [
          ...state.filters,
          (r) =>
            value === null ? r[column] === null || r[column] === undefined : r[column] === value,
        ],
      },
      tables
    )
  promise.order = (column, opts) =>
    makeQuery({ ...state, orderBy: { column, ascending: opts?.ascending ?? true } }, tables)
  promise.limit = (n) => makeQuery({ ...state, limitN: n }, tables)
  return promise
}

export function createFakeSupabase(): FakeSupabase {
  const tables: Record<string, Row[]> = {}
  return {
    _tables: tables,
    from(table: string) {
      getTable(tables, table)
      return {
        select: (_cols?: string) => makeQuery({ table, filters: [] }, tables),
        insert: async (row: Row | Row[]) => {
          const list = Array.isArray(row) ? row : [row]
          const t = getTable(tables, table)
          for (const r of list) t.push({ ...r })
          return { error: null }
        },
        upsert: async (
          row: Row | Row[],
          opts?: { onConflict?: string; ignoreDuplicates?: boolean }
        ) => {
          const list = Array.isArray(row) ? row : [row]
          const conflictKey = opts?.onConflict ?? 'id'
          const t = getTable(tables, table)
          for (const r of list) {
            const existing = t.findIndex((row) => row[conflictKey] === r[conflictKey])
            if (existing >= 0) {
              if (opts?.ignoreDuplicates) continue
              t[existing] = { ...r }
            } else {
              t.push({ ...r })
            }
          }
          return { error: null }
        },
      }
    },
  }
}
