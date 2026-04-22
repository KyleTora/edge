# Dynamic Card (Two-Stage) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the static daily-card ranker into a two-stage pipeline: a silent morning MLB scan + a 3pm refresh that re-ranks across all sports, swaps unstarted picks that fell out of the top-N, and sends one email with a "what changed" narrative.

**Architecture:** Add a `status` column (`active` | `swapped_off`) on `edge_picks`. Introduce a pure `resolveSwaps()` function that decides which prior picks stay, which are dropped, and which new candidates are added, given the fresh ranking and "now." The card command becomes mode-aware (`morning` | `refresh`); the email report wraps refresh-mode runs and includes a swap summary.

**Tech Stack:** TypeScript, commander (CLI), Supabase (DB), vitest (tests), GitHub Actions (scheduler), Resend (email).

**Spec:** `docs/superpowers/specs/2026-04-21-dynamic-card-two-stage-design.md`

---

## File Structure

**New files:**
- `migrations/2026-04-21-pick-status.sql` — the status column + CHECK constraint + index
- `src/engine/resolve-swaps.ts` — pure function: decides keep/kept_started/drop/add
- `src/engine/swap-summary.ts` — pure function: builds `SwapSummary` for email rendering
- `tests/engine/resolve-swaps.test.ts`
- `tests/engine/swap-summary.test.ts`

**Modified files:**
- `src/db/queries.ts` — `PickRow.status`; filter `swapped_off` in listing queries; new `updatePickStatus` and `listSwappedOffPickIdsForCardDate` helpers
- `src/commands/card.ts` — mode-aware `runCard()`
- `src/commands/report.ts` — delegate to `runCard({mode: 'refresh'})`; pass swap summary into email render
- `src/email/render.ts` — accept `swapSummary?`; render "What changed" section below main card
- `src/cli.ts` — `edge card` and `edge report` gain `--mode` flag
- `.github/workflows/edge-report.yml` — morning cron runs in `morning` mode MLB-only; afternoon cron runs in `refresh` mode all-sports
- `tests/helpers/fake-supabase.ts` — add `update()` support so `updatePickStatus` is testable
- `tests/db/queries.test.ts` — cover status filter + `updatePickStatus` + `listSwappedOffPickIdsForCardDate`
- `tests/commands/scan.test.ts` — rename to `card.test.ts`; cover morning + refresh modes
- `tests/commands/report.test.ts` — update for delegated flow and swap summary
- `tests/email/render.test.ts` — cover `swapSummary` rendering

---

## Task 1: Create the SQL migration

**Files:**
- Create: `migrations/2026-04-21-pick-status.sql`

- [ ] **Step 1: Write the migration file**

Create `migrations/2026-04-21-pick-status.sql` with content:

```sql
-- Add a status column to edge_picks to distinguish live picks from ones
-- that were swapped off the daily card at refresh time. Two values today:
--
--   'active'      — on the card, live for grading/CLV/stats
--   'swapped_off' — dropped at refresh before game start; excluded from
--                   grading/CLV/stats. Retained for audit / email diff.
--
-- Existing rows default to 'active' so pre-migration picks remain live.

ALTER TABLE edge_picks
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE edge_picks
  ADD CONSTRAINT edge_picks_status_check
  CHECK (status IN ('active', 'swapped_off'));

CREATE INDEX IF NOT EXISTS idx_edge_picks_card_date_status
  ON edge_picks (card_date, status);
```

- [ ] **Step 2: Commit**

```bash
git add migrations/2026-04-21-pick-status.sql
git commit -m "migration: add status column to edge_picks"
```

Note: apply to Supabase manually (same process as previous migrations in `migrations/`). Application is out of scope for this plan's code steps.

---

## Task 2: Add `update()` to the fake Supabase test helper

We need this before `updatePickStatus` can be tested against the fake.

**Files:**
- Modify: `tests/helpers/fake-supabase.ts`
- Test: `tests/helpers/fake-supabase.test.ts`

- [ ] **Step 1: Add a failing test for `update()` on the fake**

Open `tests/helpers/fake-supabase.test.ts` and append a new test inside the existing `describe` block:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- tests/helpers/fake-supabase.test.ts
```

Expected: FAIL — `from(...).update is not a function`.

- [ ] **Step 3: Implement `update()` on the fake**

In `tests/helpers/fake-supabase.ts`, extend the `FakeSupabase` interface's `from(table)` return type and the implementation inside `createFakeSupabase`.

First, update the `FakeSupabase` type:

```ts
export interface FakeSupabase {
  from(table: string): {
    select: (cols?: string) => FakeQuery
    insert: (row: Row | Row[]) => Promise<{ error: null }>
    upsert: (
      row: Row | Row[],
      opts?: { onConflict?: string; ignoreDuplicates?: boolean }
    ) => Promise<{ error: null }>
    update: (patch: Row) => FakeUpdateBuilder
  }
  _tables: Record<string, Row[]>
}

export interface FakeUpdateBuilder extends Promise<{ error: null }> {
  eq(column: string, value: unknown): FakeUpdateBuilder
}
```

Then add the implementation inside the `from(table)` returned object in `createFakeSupabase`:

```ts
update: (patch: Row) => {
  const filters: Array<(row: Row) => boolean> = []
  const exec = async () => {
    const t = getTable(tables, table)
    for (const r of t) {
      if (filters.every((f) => f(r))) Object.assign(r, patch)
    }
    return { error: null as null }
  }
  const builder = exec() as unknown as FakeUpdateBuilder
  builder.eq = (column: string, value: unknown) => {
    filters.push((r) => r[column] === value)
    const b = exec() as unknown as FakeUpdateBuilder
    b.eq = builder.eq
    return b
  }
  return builder
},
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- tests/helpers/fake-supabase.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/fake-supabase.ts tests/helpers/fake-supabase.test.ts
git commit -m "test(helpers): add update().eq() to fake-supabase"
```

---

## Task 3: Add `status` to `PickRow` and filter `swapped_off` in listing queries

**Files:**
- Modify: `src/db/queries.ts`
- Test: `tests/db/queries.test.ts`

- [ ] **Step 1: Add a failing test that `listPicksForCardDate` excludes swapped_off**

Append to `tests/db/queries.test.ts` (inside any existing describe block, or wrap in a new one):

```ts
import { listPicksForCardDate } from '../../src/db/queries.js'

describe('listPicksForCardDate', () => {
  it('excludes rows with status=swapped_off', async () => {
    const fake = createFakeSupabase()
    await fake.from('edge_picks').insert([
      { id: 'a', card_date: '2026-04-21', status: 'active', score: 0.05 },
      { id: 'b', card_date: '2026-04-21', status: 'swapped_off', score: 0.07 },
      { id: 'c', card_date: '2026-04-21', status: 'active', score: 0.03 },
    ])

    const rows = await listPicksForCardDate(fake as never, '2026-04-21')

    expect(rows.map((r) => r.id)).toEqual(['a', 'c'])
  })
})
```

(If `createFakeSupabase` isn't already imported in the file, add `import { createFakeSupabase } from '../helpers/fake-supabase.js'`.)

- [ ] **Step 2: Run the test, expect FAIL**

```bash
npm test -- tests/db/queries.test.ts
```

Expected: FAIL — the query currently returns all three rows because no status filter exists.

- [ ] **Step 3: Add `status` to `PickRow` interface**

In `src/db/queries.ts`, modify the `PickRow` interface to include `status`:

```ts
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
  score: number
  card_date: string
  status: 'active' | 'swapped_off'
}
```

- [ ] **Step 4: Add `.neq('status', 'swapped_off')` to each listing query**

In the same file, modify these five functions:

- `listPicksForCardDate` — add `.neq('status', 'swapped_off')` after the `.eq('card_date', ...)` call:

```ts
export async function listPicksForCardDate(
  supabase: EdgeSupabase,
  cardDate: string
): Promise<PickRow[]> {
  const res = await supabase
    .from('edge_picks')
    .select('*')
    .eq('card_date', cardDate)
    .neq('status', 'swapped_off')
    .order('score', { ascending: false })
  if (res.error) throw new Error(`listPicksForCardDate error: ${res.error.message}`)
  return (res.data ?? []) as PickRow[]
}
```

- `listPicksAwaitingGrade` — add to the picks query in the same file:

```ts
  const picksRes = await supabase
    .from('edge_picks')
    .select('*')
    .gte('game_date', startStr)
    .lte('game_date', referenceDate)
    .neq('status', 'swapped_off')
```

- `listPicksAwaitingClose`:

```ts
  const picksRes = await supabase
    .from('edge_picks')
    .select('*')
    .gte('game_time', startIso)
    .lt('game_time', endIso)
    .neq('status', 'swapped_off')
```

- `getPicksWithGradesInRange`:

```ts
  const picksRes = await supabase
    .from('edge_picks')
    .select('*')
    .gte('game_date', startDate)
    .lte('game_date', endDate)
    .neq('status', 'swapped_off')
```

- `getPicksGradedSince` — the picks fetch (not the grades fetch):

```ts
  const picksRes = await supabase
    .from('edge_picks')
    .select('*')
    .in(
      'id',
      grades.map((g) => g.pick_id)
    )
    .neq('status', 'swapped_off')
```

Do not touch `listPicksForDate` (legacy, uses `ev_pct` ordering) — it is not called by current code and adding a filter would introduce a divergence with zero call sites. Leave as is.

Wait — check call sites first:

```bash
grep -rn "listPicksForDate" src tests
```

If there are call sites, add the filter too; otherwise leave untouched.

- [ ] **Step 5: Add the `neq` method to the FakeQuery interface and implementation**

The fake Supabase already supports `.not(col, 'eq', value)`, but production code uses `.neq()` directly. Add it to `tests/helpers/fake-supabase.ts`.

In the `FakeQuery` interface:

```ts
export interface FakeQuery extends Promise<{ data: Row[] | null; error: null }> {
  eq(column: string, value: unknown): FakeQuery
  neq(column: string, value: unknown): FakeQuery
  gte(column: string, value: unknown): FakeQuery
  // ... (rest unchanged)
}
```

In `makeQuery`, after the `promise.eq` assignment:

```ts
promise.neq = (column, value) =>
  makeQuery({ ...state, filters: [...state.filters, (r) => r[column] !== value] }, tables)
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
npm test -- tests/db/queries.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run the full test suite to catch regressions**

```bash
npm test
```

Expected: all tests pass. If any fail because they insert pick rows without `status`, those tests need to insert with `status: 'active'` explicitly OR the fake's `insert()` needs to default `status='active'` for the edge_picks table. Prefer fixing the tests to be explicit (less magic in the fake).

- [ ] **Step 8: Commit**

```bash
git add src/db/queries.ts tests/db/queries.test.ts tests/helpers/fake-supabase.ts
git commit -m "feat(db): add status to PickRow and filter swapped_off in listings"
```

---

## Task 4: Add `updatePickStatus` DB helper

**Files:**
- Modify: `src/db/queries.ts`
- Test: `tests/db/queries.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/db/queries.test.ts`:

```ts
import { updatePickStatus } from '../../src/db/queries.js'

describe('updatePickStatus', () => {
  it('updates a row from active to swapped_off by id', async () => {
    const fake = createFakeSupabase()
    await fake.from('edge_picks').insert([
      { id: 'a', card_date: '2026-04-21', status: 'active' },
      { id: 'b', card_date: '2026-04-21', status: 'active' },
    ])

    await updatePickStatus(fake as never, 'a', 'swapped_off')

    const rows = fake._tables.edge_picks!
    expect(rows.find((r) => r.id === 'a')!.status).toBe('swapped_off')
    expect(rows.find((r) => r.id === 'b')!.status).toBe('active')
  })
})
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npm test -- tests/db/queries.test.ts
```

Expected: FAIL — `updatePickStatus is not a function` (import error).

- [ ] **Step 3: Implement `updatePickStatus`**

Append to `src/db/queries.ts`:

```ts
export async function updatePickStatus(
  supabase: EdgeSupabase,
  id: string,
  status: 'active' | 'swapped_off'
): Promise<void> {
  const res = await supabase.from('edge_picks').update({ status }).eq('id', id)
  if (res.error) throw new Error(`updatePickStatus error: ${res.error.message}`)
}
```

- [ ] **Step 4: Update `EdgeSupabase` type to allow `update` calls**

Check `src/db/client.ts` to see how `EdgeSupabase` is typed. If it wraps the Supabase client directly, `update` will already be part of the type. If there is a custom type narrowing, extend it to include `update`. For the real Supabase client, no change is needed. For the fake, Task 2 already added the method.

- [ ] **Step 5: Run, expect PASS**

```bash
npm test -- tests/db/queries.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/queries.ts tests/db/queries.test.ts
git commit -m "feat(db): add updatePickStatus helper"
```

---

## Task 5: Add `listActivePicksForCardDate` and `listSwappedOffPickIdsForCardDate`

These are the inputs to `resolveSwaps`. We keep them separate from `listPicksForCardDate` so the semantics stay explicit — refresh mode needs to treat `active` and `swapped_off` rows differently, and conflating them in one call would be a foot-gun.

**Files:**
- Modify: `src/db/queries.ts`
- Test: `tests/db/queries.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/db/queries.test.ts`:

```ts
import {
  listActivePicksForCardDate,
  listSwappedOffPickIdsForCardDate,
} from '../../src/db/queries.js'

describe('listActivePicksForCardDate', () => {
  it('returns only active rows for the given card date', async () => {
    const fake = createFakeSupabase()
    await fake.from('edge_picks').insert([
      { id: 'a', card_date: '2026-04-21', status: 'active' },
      { id: 'b', card_date: '2026-04-21', status: 'swapped_off' },
      { id: 'c', card_date: '2026-04-20', status: 'active' },
    ])

    const rows = await listActivePicksForCardDate(fake as never, '2026-04-21')

    expect(rows.map((r) => r.id)).toEqual(['a'])
  })
})

describe('listSwappedOffPickIdsForCardDate', () => {
  it('returns ids of swapped_off rows for the given card date', async () => {
    const fake = createFakeSupabase()
    await fake.from('edge_picks').insert([
      { id: 'a', card_date: '2026-04-21', status: 'active' },
      { id: 'b', card_date: '2026-04-21', status: 'swapped_off' },
      { id: 'c', card_date: '2026-04-20', status: 'swapped_off' },
    ])

    const ids = await listSwappedOffPickIdsForCardDate(fake as never, '2026-04-21')

    expect(Array.from(ids)).toEqual(['b'])
  })
})
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npm test -- tests/db/queries.test.ts
```

Expected: FAIL with "is not a function".

- [ ] **Step 3: Implement the two helpers**

Append to `src/db/queries.ts`:

```ts
export async function listActivePicksForCardDate(
  supabase: EdgeSupabase,
  cardDate: string
): Promise<PickRow[]> {
  const res = await supabase
    .from('edge_picks')
    .select('*')
    .eq('card_date', cardDate)
    .eq('status', 'active')
    .order('score', { ascending: false })
  if (res.error) throw new Error(`listActivePicksForCardDate error: ${res.error.message}`)
  return (res.data ?? []) as PickRow[]
}

export async function listSwappedOffPickIdsForCardDate(
  supabase: EdgeSupabase,
  cardDate: string
): Promise<Set<string>> {
  const res = await supabase
    .from('edge_picks')
    .select('id')
    .eq('card_date', cardDate)
    .eq('status', 'swapped_off')
  if (res.error) throw new Error(`listSwappedOffPickIdsForCardDate error: ${res.error.message}`)
  const rows = (res.data ?? []) as Array<{ id: string }>
  return new Set(rows.map((r) => r.id))
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npm test -- tests/db/queries.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/queries.ts tests/db/queries.test.ts
git commit -m "feat(db): add listActivePicksForCardDate + listSwappedOffPickIdsForCardDate"
```

---

## Task 6: Create `resolveSwaps` pure function

**Files:**
- Create: `src/engine/resolve-swaps.ts`
- Test: `tests/engine/resolve-swaps.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `tests/engine/resolve-swaps.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveSwaps } from '../../src/engine/resolve-swaps.js'
import type { PickRow } from '../../src/db/queries.js'
import type { Candidate } from '../../src/engine/scanner.js'

function row(id: string, gameTime: string, score = 0.05): PickRow {
  return {
    id,
    detected_at: '2026-04-21T10:00:00Z',
    sport: 'mlb',
    game_id: id,
    game_date: gameTime.slice(0, 10),
    game_time: gameTime,
    away_team: 'A',
    home_team: 'B',
    market: 'moneyline',
    side: 'home',
    line: null,
    best_book: 'betmgm',
    best_price: 110,
    sharp_book: 'pinnacle',
    sharp_implied: 0.5,
    ev_pct: 0.03,
    all_prices: {},
    score,
    card_date: '2026-04-21',
    status: 'active',
  }
}

function cand(id: string, gameTime: string, score: number): Candidate {
  return {
    id,
    detected_at: '2026-04-21T15:00:00Z',
    sport: 'mlb',
    game_id: id,
    game_date: gameTime.slice(0, 10),
    game_time: gameTime,
    away_team: 'A',
    home_team: 'B',
    market: 'moneyline',
    side: 'home',
    line: null,
    best_book: 'betmgm',
    best_price: 110,
    sharp_book: 'pinnacle',
    sharp_implied: 0.5,
    ev_pct: 0.03,
    all_prices: {},
    score,
  }
}

const NOW = new Date('2026-04-21T15:00:00Z') // 3pm ET refresh
const LATER = '2026-04-21T23:00:00Z' // evening game
const EARLIER = '2026-04-21T14:00:00Z' // already started

describe('resolveSwaps', () => {
  it('returns all new candidates as add when prior is empty', () => {
    const ranked = [cand('x', LATER, 0.10), cand('y', LATER, 0.08)]
    const r = resolveSwaps([], ranked, new Set(), NOW, 2)
    expect(r.add.map((c) => c.id)).toEqual(['x', 'y'])
    expect(r.keep).toEqual([])
    expect(r.kept_started).toEqual([])
    expect(r.drop).toEqual([])
  })

  it('locks in all prior picks whose games have started', () => {
    const prior = [row('a', EARLIER, 0.05), row('b', EARLIER, 0.04)]
    const ranked = [cand('x', LATER, 0.10)]
    const r = resolveSwaps(prior, ranked, new Set(), NOW, 2)
    expect(r.kept_started.map((p) => p.id)).toEqual(['a', 'b'])
    expect(r.keep).toEqual([])
    expect(r.drop).toEqual([])
    expect(r.add).toEqual([]) // no slots left
  })

  it('drops a prior pick that fell out of top-N, adds the displacer', () => {
    const prior = [row('a', LATER, 0.05)]
    const ranked = [cand('x', LATER, 0.10)] // x outscores a
    const r = resolveSwaps(prior, ranked, new Set(), NOW, 1)
    expect(r.drop.map((p) => p.id)).toEqual(['a'])
    expect(r.add.map((c) => c.id)).toEqual(['x'])
    expect(r.keep).toEqual([])
  })

  it('keeps a prior pick that is still in top-N', () => {
    const prior = [row('a', LATER, 0.05)]
    const ranked = [cand('a', LATER, 0.09), cand('x', LATER, 0.02)]
    const r = resolveSwaps(prior, ranked, new Set(), NOW, 1)
    expect(r.keep.map((p) => p.id)).toEqual(['a'])
    expect(r.drop).toEqual([])
    expect(r.add).toEqual([])
  })

  it('handles a mixed case: 2 kept_started, 1 keep, 1 drop, 1 add', () => {
    const prior = [
      row('started1', EARLIER, 0.09),
      row('started2', EARLIER, 0.08),
      row('keepme', LATER, 0.07),
      row('dropme', LATER, 0.02),
    ]
    const ranked = [
      cand('keepme', LATER, 0.07),
      cand('newone', LATER, 0.05),
      cand('dropme', LATER, 0.02),
    ]
    const r = resolveSwaps(prior, ranked, new Set(), NOW, 4)
    expect(r.kept_started.map((p) => p.id).sort()).toEqual(['started1', 'started2'])
    expect(r.keep.map((p) => p.id)).toEqual(['keepme'])
    expect(r.drop.map((p) => p.id)).toEqual(['dropme'])
    expect(r.add.map((c) => c.id)).toEqual(['newone'])
  })

  it('skips candidates whose id is in alreadySwappedOffIds', () => {
    const ranked = [cand('rejected', LATER, 0.10), cand('fresh', LATER, 0.05)]
    const r = resolveSwaps([], ranked, new Set(['rejected']), NOW, 2)
    expect(r.add.map((c) => c.id)).toEqual(['fresh'])
    // Slot for rejected is not backfilled — card is size 1 instead of 2. OK.
  })

  it('yields a partial card when fewer candidates than targetSize', () => {
    const ranked = [cand('only', LATER, 0.10)]
    const r = resolveSwaps([], ranked, new Set(), NOW, 3)
    expect(r.add).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npm test -- tests/engine/resolve-swaps.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `resolveSwaps`**

Create `src/engine/resolve-swaps.ts`:

```ts
import type { PickRow } from '../db/queries.js'
import type { Candidate } from './scanner.js'

export interface SwapResolution {
  keep: PickRow[]          // no status change
  kept_started: PickRow[]  // no status change (game already started)
  drop: PickRow[]          // 'active' → 'swapped_off'
  add: Candidate[]         // insert as 'active'
}

export function resolveSwaps(
  prior: PickRow[],
  ranked: Candidate[],
  alreadySwappedOffIds: Set<string>,
  now: Date,
  targetSize: number
): SwapResolution {
  const nowMs = now.getTime()
  const started: PickRow[] = []
  const live: PickRow[] = []
  for (const p of prior) {
    if (Date.parse(p.game_time) <= nowMs) started.push(p)
    else live.push(p)
  }

  const kept_started = started
  const slotsLeft = Math.max(0, targetSize - kept_started.length)
  const startedIds = new Set(kept_started.map((p) => p.id))

  const eligible = ranked.filter(
    (c) => !startedIds.has(c.id) && !alreadySwappedOffIds.has(c.id)
  )
  const targetLive = eligible.slice(0, slotsLeft)
  const targetLiveIds = new Set(targetLive.map((c) => c.id))
  const priorLiveIds = new Set(live.map((p) => p.id))

  const keep = live.filter((p) => targetLiveIds.has(p.id))
  const drop = live.filter((p) => !targetLiveIds.has(p.id))
  const add = targetLive.filter((c) => !priorLiveIds.has(c.id))

  return { keep, kept_started, drop, add }
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npm test -- tests/engine/resolve-swaps.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/resolve-swaps.ts tests/engine/resolve-swaps.test.ts
git commit -m "feat(engine): add resolveSwaps for two-stage card"
```

---

## Task 7: Create `SwapSummary` types + builder

**Files:**
- Create: `src/engine/swap-summary.ts`
- Test: `tests/engine/swap-summary.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/engine/swap-summary.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildSwapSummary } from '../../src/engine/swap-summary.js'
import type { PickRow } from '../../src/db/queries.js'
import type { Candidate } from '../../src/engine/scanner.js'
import type { SwapResolution } from '../../src/engine/resolve-swaps.js'

function row(id: string, overrides: Partial<PickRow> = {}): PickRow {
  return {
    id,
    detected_at: '2026-04-21T10:00:00Z',
    sport: 'mlb',
    game_id: id,
    game_date: '2026-04-21',
    game_time: '2026-04-21T23:00:00Z',
    away_team: 'Yankees',
    home_team: 'Red Sox',
    market: 'moneyline',
    side: 'home',
    line: null,
    best_book: 'betmgm',
    best_price: -135,
    sharp_book: 'pinnacle',
    sharp_implied: 0.585,
    ev_pct: 0.031,
    all_prices: {},
    score: 0.03,
    card_date: '2026-04-21',
    status: 'active',
    ...overrides,
  }
}

function cand(id: string, overrides: Partial<Candidate> = {}): Candidate {
  const base = row(id)
  return {
    ...base,
    ...overrides,
  } as Candidate
}

describe('buildSwapSummary', () => {
  it('reports morningCardSize as the size of prior active set', () => {
    const resolution: SwapResolution = {
      keep: [row('a')],
      kept_started: [row('b', { game_time: '2026-04-21T14:00:00Z' })],
      drop: [],
      add: [],
    }
    const s = buildSwapSummary(resolution, [])
    expect(s.morningCardSize).toBe(2)
  })

  it('explains a dropped pick by comparing stored vs. fresh sharp', () => {
    const dropped = row('y', {
      sport: 'mlb',
      game_id: 'g1',
      market: 'moneyline',
      side: 'home',
      sharp_implied: 0.585,
      ev_pct: 0.031,
    })
    const fresh: Candidate = cand('y', {
      sport: 'mlb',
      game_id: 'g1',
      market: 'moneyline',
      side: 'home',
      sharp_implied: 0.612,
      ev_pct: -0.008,
    })
    const resolution: SwapResolution = {
      keep: [],
      kept_started: [],
      drop: [dropped],
      add: [],
    }

    const s = buildSwapSummary(resolution, [fresh])

    expect(s.dropped).toHaveLength(1)
    const reason = s.dropped[0]!.reason
    expect(reason).toContain('58.5%')
    expect(reason).toContain('61.2%')
    expect(reason).toContain('+3.1%')
    expect(reason).toContain('-0.8%')
  })

  it('reports "no longer offered" when a dropped pick is missing from fresh ranked', () => {
    const dropped = row('y', { game_id: 'gone' })
    const resolution: SwapResolution = {
      keep: [],
      kept_started: [],
      drop: [dropped],
      add: [],
    }
    const s = buildSwapSummary(resolution, [])
    expect(s.dropped[0]!.reason).toMatch(/no longer offered/i)
  })

  it('explains an added pick by citing its current EV and implied prob', () => {
    const added: Candidate = cand('new', { sharp_implied: 0.401, ev_pct: 0.042 })
    const resolution: SwapResolution = {
      keep: [],
      kept_started: [],
      drop: [],
      add: [added],
    }
    const s = buildSwapSummary(resolution, [added])
    expect(s.added[0]!.reason).toContain('40.1%')
    expect(s.added[0]!.reason).toContain('+4.2%')
  })

  it('includes startedBeforeRefresh for kept_started picks', () => {
    const started = row('s', { game_time: '2026-04-21T14:00:00Z' })
    const resolution: SwapResolution = {
      keep: [],
      kept_started: [started],
      drop: [],
      add: [],
    }
    const s = buildSwapSummary(resolution, [])
    expect(s.startedBeforeRefresh).toHaveLength(1)
    expect(s.startedBeforeRefresh[0]!.pick.id).toBe('s')
  })
})
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npm test -- tests/engine/swap-summary.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `buildSwapSummary` and `SwapSummary`**

Create `src/engine/swap-summary.ts`:

```ts
import type { PickRow } from '../db/queries.js'
import type { Candidate } from './scanner.js'
import type { SwapResolution } from './resolve-swaps.js'

export interface SwapSummary {
  morningCardSize: number
  added: Array<{ pick: Candidate; reason: string }>
  dropped: Array<{ pick: PickRow; reason: string }>
  startedBeforeRefresh: Array<{ pick: PickRow }>
}

function matches(a: PickRow | Candidate, b: PickRow | Candidate): boolean {
  return (
    a.sport === b.sport &&
    a.game_id === b.game_id &&
    a.market === b.market &&
    a.side === b.side
  )
}

function fmtPct(v: number): string {
  const sign = v >= 0 ? '+' : ''
  return `${sign}${(v * 100).toFixed(1)}%`
}

function fmtImplied(p: number): string {
  return `${(p * 100).toFixed(1)}%`
}

function explainDrop(pick: PickRow, fresh: Candidate | undefined): string {
  if (!fresh) {
    return 'no longer offered at allowlisted books at refresh time.'
  }
  const impliedDelta = fresh.sharp_implied - pick.sharp_implied
  return (
    `sharp moved from ${fmtImplied(pick.sharp_implied)} to ${fmtImplied(fresh.sharp_implied)} implied ` +
    `(${fmtPct(impliedDelta)}); EV went ${fmtPct(pick.ev_pct)} → ${fmtPct(fresh.ev_pct)}.`
  )
}

function explainAdd(pick: Candidate): string {
  return `EV ${fmtPct(pick.ev_pct)} at current sharp (${fmtImplied(pick.sharp_implied)} implied); top-N score.`
}

export function buildSwapSummary(
  resolution: SwapResolution,
  ranked: Candidate[]
): SwapSummary {
  const morningCardSize =
    resolution.kept_started.length +
    resolution.keep.length +
    resolution.drop.length

  const dropped = resolution.drop.map((p) => {
    const fresh = ranked.find((c) => matches(p, c))
    return { pick: p, reason: explainDrop(p, fresh) }
  })

  const added = resolution.add.map((c) => ({ pick: c, reason: explainAdd(c) }))

  const startedBeforeRefresh = resolution.kept_started.map((p) => ({ pick: p }))

  return { morningCardSize, added, dropped, startedBeforeRefresh }
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npm test -- tests/engine/swap-summary.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/swap-summary.ts tests/engine/swap-summary.test.ts
git commit -m "feat(engine): add buildSwapSummary helper"
```

---

## Task 8: Refactor `runCard` to accept `mode`

**Files:**
- Modify: `src/commands/card.ts`
- Test: `tests/commands/scan.test.ts` → rename to `tests/commands/card.test.ts` if not already, then update

- [ ] **Step 1: Rename test file (if needed) and update**

If `tests/commands/scan.test.ts` still exists, rename it:

```bash
git mv tests/commands/scan.test.ts tests/commands/card.test.ts
```

(Skip if file is already `card.test.ts`.)

- [ ] **Step 2: Write failing tests for morning mode**

Open `tests/commands/card.test.ts` and replace the content with:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { runCard } from '../../src/commands/card.js'
import { createFakeSupabase, type FakeSupabase } from '../helpers/fake-supabase.js'
import type { Config, Env } from '../../src/config.js'
import type { MarketSnapshot } from '../../src/sources/normalize.js'

vi.mock('../../src/sources/action-network.js', () => ({
  fetchActionNetworkNba: vi.fn().mockResolvedValue([]),
  fetchActionNetworkMlb: vi.fn().mockResolvedValue([]),
  fetchActionNetworkNhl: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../src/sources/odds-api.js', () => ({
  fetchPinnacleNba: vi.fn().mockResolvedValue([]),
  fetchPinnacleMlb: vi.fn().mockResolvedValue([]),
  fetchPinnacleNhl: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../src/sources/normalize.js', () => ({
  joinSources: vi.fn().mockReturnValue([] as MarketSnapshot[]),
}))

const config: Config = {
  books: ['betmgm'],
  manual_books: [],
  sharp_anchor: 'pinnacle',
  daily_picks: 5,
  sports: ['mlb'],
  bankroll_units: 100,
  unit_size_cad: 25,
  closing_line_capture_minutes_before_game: 5,
}
const env: Env = {
  ODDS_API_KEY: 'test',
  SUPABASE_URL: 'http://localhost',
  SUPABASE_SERVICE_ROLE_KEY: 'test',
}

describe('runCard', () => {
  let fake: FakeSupabase
  beforeEach(() => {
    fake = createFakeSupabase()
  })

  describe('morning mode', () => {
    it('returns an empty card and writes nothing when no candidates', async () => {
      const result = await runCard({
        supabase: fake as never,
        config,
        env,
        mode: 'morning',
        sports: ['mlb'],
        detectedAt: '2026-04-21T14:00:00Z',
      })
      expect(result.picks).toEqual([])
      expect(result.swapSummary).toBeUndefined()
      expect(fake._tables.edge_picks ?? []).toHaveLength(0)
    })

    it('does not re-insert when active picks already exist for today', async () => {
      await fake.from('edge_picks').insert([
        { id: 'existing', card_date: '2026-04-21', status: 'active' },
      ])
      const result = await runCard({
        supabase: fake as never,
        config,
        env,
        mode: 'morning',
        sports: ['mlb'],
        detectedAt: '2026-04-21T14:00:00Z',
      })
      expect(result.picks).toHaveLength(1)
      expect(result.picks[0]!.id).toBe('existing')
      expect(fake._tables.edge_picks).toHaveLength(1)
    })
  })

  describe('refresh mode', () => {
    it('returns an empty card when no prior and no candidates', async () => {
      const result = await runCard({
        supabase: fake as never,
        config,
        env,
        mode: 'refresh',
        sports: ['mlb'],
        detectedAt: '2026-04-21T19:00:00Z',
      })
      expect(result.picks).toEqual([])
      // no prior → swapSummary still returned but with zeros
      expect(result.swapSummary?.morningCardSize).toBe(0)
    })
  })
})
```

- [ ] **Step 3: Run, expect FAIL**

```bash
npm test -- tests/commands/card.test.ts
```

Expected: FAIL — `runCard` currently takes no `mode`; TypeScript compilation or runtime assertion will fail.

- [ ] **Step 4: Rewrite `src/commands/card.ts`**

Replace the entire file with:

```ts
import type { EdgeSupabase } from '../db/client.js'
import type { Config, Env } from '../config.js'
import {
  fetchActionNetworkNba,
  fetchActionNetworkMlb,
  fetchActionNetworkNhl,
} from '../sources/action-network.js'
import {
  fetchPinnacleNba,
  fetchPinnacleMlb,
  fetchPinnacleNhl,
} from '../sources/odds-api.js'
import { joinSources } from '../sources/normalize.js'
import { rankCandidates, type Candidate } from '../engine/scanner.js'
import { resolveSwaps } from '../engine/resolve-swaps.js'
import { buildSwapSummary, type SwapSummary } from '../engine/swap-summary.js'
import {
  upsertPick,
  listActivePicksForCardDate,
  listSwappedOffPickIdsForCardDate,
  updatePickStatus,
  type PickRow,
} from '../db/queries.js'
import { renderCardTable } from '../ui/tables.js'

export type CardMode = 'morning' | 'refresh'

export interface RunCardInput {
  supabase: EdgeSupabase
  config: Config
  env: Env
  mode: CardMode
  sports: string[]
  detectedAt?: string
  print?: (msg: string) => void
}

export interface RunCardResult {
  picks: PickRow[]
  swapSummary?: SwapSummary
}

const sportFetchers: Record<
  string,
  {
    actionNetwork: () => Promise<Awaited<ReturnType<typeof fetchActionNetworkNba>>>
    pinnacle: (key: string) => Promise<Awaited<ReturnType<typeof fetchPinnacleNba>>>
  }
> = {
  nba: { actionNetwork: fetchActionNetworkNba, pinnacle: fetchPinnacleNba },
  mlb: { actionNetwork: fetchActionNetworkMlb, pinnacle: fetchPinnacleMlb },
  nhl: { actionNetwork: fetchActionNetworkNhl, pinnacle: fetchPinnacleNhl },
}

async function fetchAllRanked(
  sports: string[],
  config: Config,
  env: Env,
  detectedAt: string
): Promise<Candidate[]> {
  const all: Candidate[] = []
  for (const sport of sports) {
    const fetchers = sportFetchers[sport]
    if (!fetchers) continue
    const [actionNetwork, pinnacle] = await Promise.all([
      fetchers.actionNetwork(),
      fetchers.pinnacle(env.ODDS_API_KEY),
    ])
    const snapshots = joinSources({ sport, actionNetwork, pinnacle })
    const candidates = rankCandidates({ snapshots, config, detectedAt })
    all.push(...candidates)
  }
  all.sort((a, b) => b.score - a.score)
  return all
}

export async function runCard(input: RunCardInput): Promise<RunCardResult> {
  const detectedAt = input.detectedAt ?? new Date().toISOString()
  const cardDate = detectedAt.slice(0, 10)

  if (input.mode === 'morning') {
    const existing = await listActivePicksForCardDate(input.supabase, cardDate)
    if (existing.length >= input.config.daily_picks) {
      if (input.print) input.print(renderCardTable(existing))
      return { picks: existing }
    }
    const ranked = await fetchAllRanked(input.sports, input.config, input.env, detectedAt)
    const topN = ranked.slice(0, input.config.daily_picks)

    const picks: PickRow[] = []
    for (const candidate of topN) {
      const pick: PickRow = { ...candidate, card_date: cardDate, status: 'active' }
      await upsertPick(input.supabase, pick)
      picks.push(pick)
    }
    if (input.print) input.print(renderCardTable(picks))
    return { picks }
  }

  // refresh mode
  const ranked = await fetchAllRanked(input.sports, input.config, input.env, detectedAt)
  const prior = await listActivePicksForCardDate(input.supabase, cardDate)
  const alreadySwappedOffIds = await listSwappedOffPickIdsForCardDate(input.supabase, cardDate)
  const now = new Date(detectedAt)

  const resolution = resolveSwaps(
    prior,
    ranked,
    alreadySwappedOffIds,
    now,
    input.config.daily_picks
  )

  for (const p of resolution.drop) {
    await updatePickStatus(input.supabase, p.id, 'swapped_off')
  }
  const addedPicks: PickRow[] = []
  for (const c of resolution.add) {
    const pick: PickRow = { ...c, card_date: cardDate, status: 'active' }
    await upsertPick(input.supabase, pick)
    addedPicks.push(pick)
  }

  const finalPicks: PickRow[] = [
    ...resolution.kept_started,
    ...resolution.keep,
    ...addedPicks,
  ].sort((a, b) => b.score - a.score)

  const swapSummary = buildSwapSummary(resolution, ranked)

  if (input.print) input.print(renderCardTable(finalPicks))
  return { picks: finalPicks, swapSummary }
}
```

- [ ] **Step 5: Run, expect PASS on card.test.ts**

```bash
npm test -- tests/commands/card.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run full suite, fix fallout**

```bash
npm test
```

Expected: most pass, but `tests/commands/report.test.ts` may fail because `runReport` hasn't been refactored yet and its expectations may have changed. If failures are isolated to Task 9's scope, that's fine — the next task fixes them. If other tests break, investigate and fix.

- [ ] **Step 7: Commit**

```bash
git add src/commands/card.ts tests/commands/card.test.ts
git commit -m "feat(card): mode-aware runCard with morning and refresh paths"
```

---

## Task 9: Update `runReport` to delegate to `runCard`

**Files:**
- Modify: `src/commands/report.ts`
- Test: `tests/commands/report.test.ts`

- [ ] **Step 1: Update failing test to assert delegation + swap summary**

Open `tests/commands/report.test.ts`. Find any test that currently asserts `runReport` inserts picks directly via its own code path. Update the expectations so that:

- `runReport` now takes a `mode` argument (default `'refresh'`).
- The rendered email includes a `swapSummary` when one exists.

Add a new test:

```ts
it('passes swapSummary from runCard into renderEmail on refresh', async () => {
  const fake = createFakeSupabase()
  // Pre-populate a prior active pick whose game has started — it should
  // become kept_started (no status change) and surface in swapSummary.
  await fake.from('edge_picks').insert([
    {
      id: '2026-04-21:mlb:g1:moneyline:home',
      card_date: '2026-04-21',
      status: 'active',
      game_time: '2026-04-21T14:00:00Z',
      sport: 'mlb',
      game_id: 'g1',
      market: 'moneyline',
      side: 'home',
      score: 0.05,
      sharp_implied: 0.5,
      ev_pct: 0.02,
      away_team: 'A',
      home_team: 'B',
      game_date: '2026-04-21',
      best_book: 'betmgm',
      best_price: 110,
      sharp_book: 'pinnacle',
      all_prices: {},
      detected_at: '2026-04-21T10:00:00Z',
      line: null,
    },
  ])

  const result = await runReport({
    supabase: fake as never,
    config,
    env,
    sports: ['mlb'],
    runLabel: 'refresh',
    runDate: '2026-04-21',
    dryRun: true,
    mode: 'refresh',
  })

  expect(result.email.html).toMatch(/game started before refresh/i)
})
```

(Adapt the imports / typing to match the existing file.)

- [ ] **Step 2: Run, expect FAIL**

```bash
npm test -- tests/commands/report.test.ts
```

Expected: FAIL — `mode` is not yet on `RunReportInput`; email doesn't render a swap section.

- [ ] **Step 3: Refactor `src/commands/report.ts`**

Replace the file content with:

```ts
import type { EdgeSupabase } from '../db/client.js'
import type { Config, Env } from '../config.js'
import { runCard, type CardMode } from './card.js'
import { renderEmail, type RenderedEmail } from '../email/render.js'
import { sendReportEmail } from '../email/send.js'
import { getLastQuotaSnapshot } from '../quota.js'
import type { PickRow } from '../db/queries.js'

export interface RunReportInput {
  supabase: EdgeSupabase
  config: Config
  env: Env
  sports: string[]
  runLabel: string
  runDate: string
  dryRun: boolean
  mode?: CardMode                     // default: 'refresh'
  resendApiKey?: string
  emailTo?: string
  emailFrom?: string
}

export interface RunReportResult {
  picks: PickRow[]
  email: RenderedEmail
  sent: boolean
  resendId?: string
}

export async function runReport(input: RunReportInput): Promise<RunReportResult> {
  const mode: CardMode = input.mode ?? 'refresh'
  const cardResult = await runCard({
    supabase: input.supabase,
    config: input.config,
    env: input.env,
    mode,
    sports: input.sports,
  })

  const email = renderEmail({
    picks: cardResult.picks,
    quota: getLastQuotaSnapshot(),
    runLabel: input.runLabel,
    runDate: input.runDate,
    sportsScanned: input.sports,
    swapSummary: cardResult.swapSummary,
  })

  if (input.dryRun) {
    return { picks: cardResult.picks, email, sent: false }
  }

  if (!input.resendApiKey || !input.emailTo || !input.emailFrom) {
    throw new Error('resendApiKey, emailTo, and emailFrom are required when dryRun is false')
  }

  const csvFilename = `edge-picks-${input.runDate}-${input.runLabel.replace(/\W+/g, '_')}.csv`
  const result = await sendReportEmail({
    apiKey: input.resendApiKey,
    from: input.emailFrom,
    to: input.emailTo,
    subject: email.subject,
    html: email.html,
    csvFilename,
    csvContent: email.csv,
  })

  return { picks: cardResult.picks, email, sent: true, resendId: result.id }
}
```

Note: `runReport` no longer sends email when `mode === 'morning'` unless explicitly wired. But to avoid surprise, if the caller passes `mode='morning'` AND `dryRun=false`, we still *would* send whatever the morning card produced. That's intentional — the caller decides. Morning runs in the workflow go through `runCard` directly (Task 10) and bypass `runReport` to ensure no email ever fires.

- [ ] **Step 4: Update `renderEmail` signature**

This requires the `swapSummary` field in `EmailRenderInput`. Jump to Task 10 and complete it before running this test — otherwise the TypeScript compiler will reject `swapSummary` in the input object.

Alternative: do Task 10 first, then come back to Task 9's Step 5. The plan treats Tasks 9 and 10 as interleaved — the handoff point is step 4 of this task.

- [ ] **Step 5: Run, expect PASS (after Task 10 is done)**

```bash
npm test -- tests/commands/report.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/commands/report.ts tests/commands/report.test.ts
git commit -m "refactor(report): delegate to runCard and pass swap summary to email"
```

---

## Task 10: Render `swapSummary` in the email

**Files:**
- Modify: `src/email/render.ts`
- Test: `tests/email/render.test.ts`

- [ ] **Step 1: Write failing test**

Append to `tests/email/render.test.ts` (reusing any existing `makePick` helper):

```ts
import type { SwapSummary } from '../../src/engine/swap-summary.js'

describe('renderEmail with swapSummary', () => {
  it('renders a "What changed" section with drop + add + started reasons', () => {
    const picks: PickRow[] = [] // not the focus of this test
    const swapSummary: SwapSummary = {
      morningCardSize: 3,
      dropped: [
        { pick: makePick({ id: 'd1', away_team: 'Yankees', home_team: 'Red Sox' }), reason: 'sharp moved from 58.5% to 61.2%; EV +3.1% → -0.8%.' },
      ],
      added: [
        { pick: makeCandidate({ id: 'a1', away_team: 'Red Sox', home_team: 'Yankees' }), reason: 'EV +4.2% at current sharp (40.1% implied); top-N score.' },
      ],
      startedBeforeRefresh: [
        { pick: makePick({ id: 's1', game_time: '2026-04-21T14:00:00Z' }) },
      ],
    }

    const out = renderEmail({
      picks,
      quota: null,
      runLabel: '3pm ET',
      runDate: '2026-04-21',
      sportsScanned: ['mlb', 'nba', 'nhl'],
      swapSummary,
    })

    expect(out.html).toMatch(/What changed since morning/i)
    expect(out.html).toContain('DROPPED')
    expect(out.html).toContain('ADDED')
    expect(out.html).toMatch(/game started before refresh/i)
    expect(out.html).toContain('EV +4.2%')
  })

  it('omits the section when swapSummary has no changes', () => {
    const out = renderEmail({
      picks: [],
      quota: null,
      runLabel: '3pm ET',
      runDate: '2026-04-21',
      sportsScanned: ['mlb'],
      swapSummary: {
        morningCardSize: 0,
        dropped: [],
        added: [],
        startedBeforeRefresh: [],
      },
    })
    expect(out.html).not.toMatch(/What changed/)
  })
})
```

Add `makeCandidate` helper if one doesn't exist — it's identical to `makePick` minus the `card_date`/`status` fields.

- [ ] **Step 2: Run, expect FAIL**

```bash
npm test -- tests/email/render.test.ts
```

Expected: FAIL — `swapSummary` is not on `EmailRenderInput`; section is not rendered.

- [ ] **Step 3: Add `swapSummary` to `EmailRenderInput` and render it**

In `src/email/render.ts`:

1. Update the input interface:

```ts
import type { SwapSummary } from '../engine/swap-summary.js'

export interface EmailRenderInput {
  picks: PickRow[]
  quota: QuotaSnapshot | null
  runLabel: string
  runDate: string
  sportsScanned: string[]
  swapSummary?: SwapSummary
}
```

2. Add a new helper at the end of the file (before `renderEmail`):

```ts
function buildSwapHtml(summary: SwapSummary): string {
  const hasChanges =
    summary.added.length + summary.dropped.length + summary.startedBeforeRefresh.length > 0
  if (!hasChanges) return ''

  const rows: string[] = []
  for (const d of summary.dropped) {
    rows.push(
      `<li><strong style="color:#a53030;">DROPPED</strong> ${pickLabel(d.pick)} (${d.pick.sport.toUpperCase()} — ${abbr(d.pick.away_team)} @ ${abbr(d.pick.home_team)}): ${d.reason}</li>`
    )
  }
  for (const a of summary.added) {
    rows.push(
      `<li><strong style="color:#0a7c2f;">ADDED</strong> ${pickLabel(a.pick as unknown as PickRow)} (${a.pick.sport.toUpperCase()} — ${abbr(a.pick.away_team)} @ ${abbr(a.pick.home_team)}): ${a.reason}</li>`
    )
  }
  for (const s of summary.startedBeforeRefresh) {
    rows.push(
      `<li>${pickLabel(s.pick)} (${s.pick.sport.toUpperCase()}): game started before refresh, kept on card.</li>`
    )
  }

  return `<div style="margin-top:20px;font-family:system-ui,sans-serif;font-size:13px;color:#333;">
  <h3 style="margin:8px 0;font-size:15px;">What changed since morning</h3>
  <ul style="padding-left:18px;margin:4px 0;line-height:1.5;">
${rows.join('\n')}
  </ul>
</div>`
}
```

3. Inside `buildHtml`, inject the section after `body` and before `stats`:

```ts
const swapHtml = input.swapSummary ? buildSwapHtml(input.swapSummary) : ''

return `<!doctype html>
<html><body style="background:#fafafa;padding:20px;margin:0;">
<div style="max-width:760px;margin:0 auto;background:white;padding:24px;border-radius:8px;border:1px solid #e5e5e5;">
${header}
${body}
${swapHtml}
${stats}
</div>
</body></html>`
```

- [ ] **Step 4: Run, expect PASS**

```bash
npm test -- tests/email/render.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/email/render.ts tests/email/render.test.ts
git commit -m "feat(email): render swap summary 'What changed' section"
```

- [ ] **Step 6: Return to Task 9 Step 5 and run that test**

```bash
npm test -- tests/commands/report.test.ts
```

Expected: PASS.

---

## Task 11: Add `--mode` flag to the CLI

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Inspect current `edge card` and `edge report` action blocks**

Open `src/cli.ts`. The `card` command currently calls `runCard({... })` with no mode. The `report` command calls `runReport` with no mode.

- [ ] **Step 2: Update the `card` command**

Replace the `card` command block with:

```ts
program
  .command('card', { isDefault: true })
  .description('Generate or refresh today\'s top-N daily card across sports')
  .option('--mode <mode>', 'morning | refresh (default: refresh)', 'refresh')
  .option('--sports <list>', 'comma-separated sports list (overrides config.sports)')
  .action(async (opts: { mode: string; sports?: string }) => {
    try {
      if (opts.mode !== 'morning' && opts.mode !== 'refresh') {
        throw new Error(`invalid mode: ${opts.mode} (expected 'morning' or 'refresh')`)
      }
      const config = loadConfigFromDisk()
      const env = loadEnv()
      const supabase = createSupabase(env)
      const sports = opts.sports ? opts.sports.split(',').map((s) => s.trim()) : config.sports
      await runCard({
        supabase,
        config,
        env,
        mode: opts.mode,
        sports,
        print: (msg) => process.stdout.write(msg + '\n'),
      })
    } catch (err) {
      process.stderr.write(`error: ${(err as Error).message}\n`)
      process.exit(1)
    }
  })
```

- [ ] **Step 3: Update the `report` command**

Replace the `report` command block with:

```ts
program
  .command('report')
  .description('Run a card stage and email the results via Resend')
  .option('--mode <mode>', 'morning | refresh (default: refresh)', 'refresh')
  .option('--sports <list>', 'comma-separated sports list (overrides config.sports)')
  .option('--dry-run', 'render the email but do not send it; print to stdout instead')
  .action(async (opts: { mode: string; sports?: string; dryRun?: boolean }) => {
    try {
      if (opts.mode !== 'morning' && opts.mode !== 'refresh') {
        throw new Error(`invalid mode: ${opts.mode} (expected 'morning' or 'refresh')`)
      }
      const config = loadConfigFromDisk()
      const env = loadEnv()
      const supabase = createSupabase(env)
      const sports = opts.sports ? opts.sports.split(',').map((s) => s.trim()) : config.sports
      const now = new Date()
      const runDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Toronto',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(now)
      const runLabel = opts.mode === 'morning' ? '10am ET (morning)' : '3pm ET (refresh)'

      // Morning runs never email — short-circuit via runCard directly.
      if (opts.mode === 'morning') {
        await runCard({
          supabase,
          config,
          env,
          mode: 'morning',
          sports,
          print: (msg) => process.stdout.write(msg + '\n'),
        })
        return
      }

      const result = await runReport({
        supabase,
        config,
        env,
        sports,
        runLabel,
        runDate,
        dryRun: !!opts.dryRun,
        mode: 'refresh',
        resendApiKey: process.env.RESEND_API_KEY,
        emailTo: process.env.REPORT_EMAIL_TO,
        emailFrom: process.env.REPORT_EMAIL_FROM,
      })

      if (opts.dryRun) {
        process.stdout.write(`SUBJECT: ${result.email.subject}\n\n`)
        process.stdout.write(`HTML:\n${result.email.html}\n\n`)
        process.stdout.write(`CSV:\n${result.email.csv}\n`)
      } else {
        process.stdout.write(`Sent email (${result.picks.length} picks). Resend id: ${result.resendId}\n`)
      }
    } catch (err) {
      process.stderr.write(`error: ${(err as Error).message}\n`)
      process.exit(1)
    }
  })
```

- [ ] **Step 4: Smoke-run the CLI locally in dry-run mode**

```bash
npm run dev -- card --mode=refresh --sports=mlb
```

Expected: exits cleanly (may print an empty card if no live games / no API responses configured). If it errors because `ODDS_API_KEY` is unset, that's expected in a clean environment — just confirm the mode is parsed correctly and the error is from downstream.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): add --mode flag to card and report commands"
```

---

## Task 12: Update the GitHub Actions workflow

**Files:**
- Modify: `.github/workflows/edge-report.yml`

- [ ] **Step 1: Rewrite the workflow**

Replace the content of `.github/workflows/edge-report.yml` with:

```yaml
name: edge daily report

on:
  schedule:
    # 14:00 UTC = 10am EDT / 9am EST — silent morning MLB run
    - cron: '0 14 * * *'
    # 19:00 UTC = 3pm EDT / 2pm EST — refresh, all sports, email
    - cron: '0 19 * * *'
  workflow_dispatch:
    inputs:
      mode:
        description: 'morning | refresh'
        required: false
        default: 'refresh'
      sports:
        description: 'Comma-separated sports list'
        required: false
        default: 'mlb,nba,nhl'

jobs:
  card-and-email:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci

      - name: Determine run parameters
        id: params
        run: |
          if [ "${{ github.event_name }}" = "workflow_dispatch" ]; then
            echo "mode=${{ inputs.mode }}" >> "$GITHUB_OUTPUT"
            echo "sports=${{ inputs.sports }}" >> "$GITHUB_OUTPUT"
          elif [ "${{ github.event.schedule }}" = "0 14 * * *" ]; then
            echo "mode=morning" >> "$GITHUB_OUTPUT"
            echo "sports=mlb" >> "$GITHUB_OUTPUT"
          else
            echo "mode=refresh" >> "$GITHUB_OUTPUT"
            echo "sports=mlb,nba,nhl" >> "$GITHUB_OUTPUT"
          fi

      - name: Run report
        run: npm run edge:report -- --mode=${{ steps.params.outputs.mode }} --sports=${{ steps.params.outputs.sports }}
        env:
          ODDS_API_KEY: ${{ secrets.ODDS_API_KEY }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
          REPORT_EMAIL_TO: ${{ secrets.REPORT_EMAIL_TO }}
          REPORT_EMAIL_FROM: ${{ secrets.REPORT_EMAIL_FROM }}
          EDGE_HOME: ${{ github.workspace }}
```

Note: the morning run technically has email env vars available, but the CLI short-circuits to `runCard` before `runReport` so no email fires. We keep the env on both jobs for simplicity (one `env:` block, no conditional).

- [ ] **Step 2: Validate locally**

Workflow syntax is hard to validate offline. Instead, run:

```bash
npm run build
```

Expected: clean TS compile. Catches upstream type errors that would bite at runtime.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/edge-report.yml
git commit -m "ci(report): mode-aware cron — 10am morning, 3pm refresh"
```

---

## Task 13: Full regression pass

**Files:** none

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Build the TypeScript**

```bash
npm run build
```

Expected: zero TS errors. If errors exist, fix them (common culprit: a test helper that constructs a `PickRow` without the new `status` field; add `status: 'active'`).

- [ ] **Step 3: Dry-run the refresh mode end-to-end**

```bash
npm run dev -- report --mode=refresh --sports=mlb,nba,nhl --dry-run
```

(This requires `ODDS_API_KEY` in `.env`. If not available locally, skip this step and rely on the production GHA run for live validation.)

Expected: subject, HTML body (including "What changed" section if applicable), and CSV are printed to stdout without error.

- [ ] **Step 4: Apply the migration to Supabase**

This is a manual step — log into Supabase SQL editor or use the project's preferred migration tooling to run `migrations/2026-04-21-pick-status.sql`. Verify the column exists:

```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'edge_picks' AND column_name = 'status';
```

Expected: one row, `text`, default `'active'::text`.

- [ ] **Step 5: Commit any lingering fixes and open the PR**

If Steps 1–3 required any small fixes (e.g., a test helper missing `status: 'active'`), commit those with:

```bash
git add <files>
git commit -m "chore: wire up two-stage card rollout"
```

Then open the PR against `main`:

```bash
gh pr create --title "Dynamic card: two-stage morning + refresh" --body "$(cat <<'EOF'
## Summary
- Adds `status` column (`active` | `swapped_off`) to `edge_picks`.
- `runCard` becomes mode-aware: morning (silent, MLB) and refresh (all sports, swap + email).
- New `resolveSwaps` + `buildSwapSummary` pure helpers drive the swap logic.
- Email gains a "What changed" section.

## Spec
`docs/superpowers/specs/2026-04-21-dynamic-card-two-stage-design.md`

## Test plan
- [ ] `npm test` passes
- [ ] `npm run build` succeeds
- [ ] Migration applied to Supabase (status column present)
- [ ] First 10am scheduled run inserts active MLB rows silently
- [ ] First 3pm scheduled run emails a card (possibly with swap summary on day 2+)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Coverage check (self-review)

Spec section → plan task:
- Motivation / decisions → captured in spec header; plan implements the structural changes they imply
- Architecture → Task 6, 7, 8 together
- Data model (status column) → Tasks 1, 3
- Swap resolution → Task 6
- Command layer → Task 8
- Email rendering → Task 10
- CLI → Task 11
- GitHub Actions workflow → Task 12
- Quota budget → no code change needed; documented in spec
- Config → no change; verified in Task 11 (loadConfigFromDisk continues to parse existing shape)
- Migration → Task 1
- File change summary → matches Tasks 1–12
- Tests → Tasks 2, 3, 4, 5, 6, 7, 8, 9, 10
- Rollout / rollback → Task 13

All spec sections have at least one implementing task.
