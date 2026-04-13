# Daily Card Ranker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the EV-threshold scanner with a top-5 daily card ranker that scores all betting opportunities using `ev_pct * sqrt(trueProb * payout)` and selects the best 5 across all sports.

**Architecture:** The scanner module is rewritten as a ranker that scores every candidate without filtering. The command layer slices the top N and persists them with a `card_date` for idempotency. All downstream systems (grading, closing lines, recap) are unchanged.

**Tech Stack:** TypeScript, Vitest, Zod, Supabase, Commander, cli-table3, chalk

---

### Task 1: Update config schema

**Files:**
- Modify: `src/config.ts:7-19`
- Modify: `edge.config.json`
- Modify: `tests/engine/scanner.test.ts:9-18` (config fixture — updated in Task 3, but noting dependency)

- [ ] **Step 1: Update the Zod schema in `src/config.ts`**

Replace lines 7–19 with:

```typescript
export const ConfigSchema = z.object({
  books: z.array(z.string()).min(1),
  manual_books: z.array(z.string()),
  sharp_anchor: z.literal('pinnacle'),
  daily_picks: z.number().int().positive().default(5),
  sports: z.array(z.string()).min(1),
  bankroll_units: z.number().positive(),
  unit_size_cad: z.number().positive(),
  closing_line_capture_minutes_before_game: z.number().int().positive(),
})
```

Removed fields: `ev_threshold`, `max_sharp_implied_prob`, `watch_interval_minutes`, `stale_sharp_max_age_minutes`.
Added field: `daily_picks`.

- [ ] **Step 2: Update `edge.config.json`**

Replace the entire file with:

```json
{
  "books": ["betmgm", "draftkings", "caesars", "betrivers"],
  "manual_books": ["thescore", "bet365"],
  "sharp_anchor": "pinnacle",
  "daily_picks": 5,
  "sports": ["nba", "mlb", "nhl"],
  "bankroll_units": 100,
  "unit_size_cad": 25,
  "closing_line_capture_minutes_before_game": 5
}
```

- [ ] **Step 3: Verify the project compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: Compilation errors in files that reference removed config fields (`scanner.ts`, `scanner.test.ts`). That's expected — we fix those in subsequent tasks.

- [ ] **Step 4: Commit**

```bash
git add src/config.ts edge.config.json
git commit -m "refactor(config): remove threshold fields, add daily_picks"
```

---

### Task 2: Add `score` and `card_date` to PickRow and queries

**Files:**
- Modify: `src/db/queries.ts:1-21` (PickRow interface)
- Modify: `src/db/queries.ts:27-39` (upsertPick — it already inserts the full `pick` object, so the new fields flow through automatically)

- [ ] **Step 1: Add fields to the `PickRow` interface in `src/db/queries.ts`**

Add `score` and `card_date` to the interface. After the `all_prices` field (line 20), add:

```typescript
  score: number
  card_date: string
```

The full interface becomes:

```typescript
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
}
```

- [ ] **Step 2: Add `listPicksForCardDate` query in `src/db/queries.ts`**

Add this after the existing `listPicksForDate` function (after line 53):

```typescript
export async function listPicksForCardDate(
  supabase: EdgeSupabase,
  cardDate: string
): Promise<PickRow[]> {
  const res = await supabase
    .from('edge_picks')
    .select('*')
    .eq('card_date', cardDate)
    .order('score', { ascending: false })
  if (res.error) throw new Error(`listPicksForCardDate error: ${res.error.message}`)
  return (res.data ?? []) as PickRow[]
}
```

- [ ] **Step 3: Commit**

```bash
git add src/db/queries.ts
git commit -m "feat(db): add score and card_date to PickRow, add listPicksForCardDate"
```

---

### Task 3: Rewrite scanner as ranker (TDD)

**Files:**
- Modify: `src/engine/scanner.ts` (full rewrite)
- Modify: `tests/engine/scanner.test.ts` (full rewrite)

- [ ] **Step 1: Write the new test file `tests/engine/scanner.test.ts`**

Replace the entire file with:

```typescript
import { describe, it, expect } from 'vitest'
import { rankCandidates } from '../../src/engine/scanner.js'
import type { MarketSnapshot } from '../../src/sources/normalize.js'
import type { Config } from '../../src/config.js'

const baseConfig: Config = {
  books: ['BetMGM', 'DraftKings', 'bet365'],
  manual_books: [],
  sharp_anchor: 'pinnacle',
  daily_picks: 5,
  sports: ['nba'],
  bankroll_units: 100,
  unit_size_cad: 25,
  closing_line_capture_minutes_before_game: 5,
}

const detectedAt = '2026-04-06T18:00:00Z'

const snap: MarketSnapshot = {
  market: 'moneyline',
  sport: 'nba',
  gameId: '12345',
  startTime: '2026-04-07T01:30:00Z',
  homeTeam: 'Denver Nuggets',
  awayTeam: 'Los Angeles Lakers',
  line: null,
  sharp: { home: -130, away: 112 },
  bookPrices: {
    BetMGM: { home: -120, away: 110 },
    DraftKings: { home: -118, away: 108 },
    bet365: { home: -108, away: 105 },
  },
}

describe('rankCandidates', () => {
  it('returns candidates sorted by score descending', () => {
    const candidates = rankCandidates({ snapshots: [snap], config: baseConfig, detectedAt })
    expect(candidates.length).toBeGreaterThan(0)
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i - 1]!.score).toBeGreaterThanOrEqual(candidates[i]!.score)
    }
  })

  it('computes score as ev_pct * sqrt(trueProb * payout)', () => {
    const candidates = rankCandidates({ snapshots: [snap], config: baseConfig, detectedAt })
    const home = candidates.find((c) => c.side === 'home')!
    // bet365 -108: payout = 100/108 ≈ 0.9259
    // devigged home prob ≈ 0.5452
    // ev = 0.5452 * 0.9259 - (1 - 0.5452) ≈ 0.0499
    // score = 0.0499 * sqrt(0.5452 * 0.9259) ≈ 0.0499 * 0.7105 ≈ 0.0354
    expect(home.score).toBeGreaterThan(0)
    expect(home.score).toBeCloseTo(home.ev_pct * Math.sqrt(home.sharp_implied * (home.best_price > 0 ? home.best_price / 100 : 100 / -home.best_price)), 4)
  })

  it('includes all sides even with negative EV', () => {
    const candidates = rankCandidates({ snapshots: [snap], config: baseConfig, detectedAt })
    // Both home and away sides should appear
    expect(candidates.find((c) => c.side === 'home')).toBeDefined()
    expect(candidates.find((c) => c.side === 'away')).toBeDefined()
  })

  it('skips games that have already started', () => {
    const liveSnap: MarketSnapshot = {
      ...snap,
      startTime: '2026-04-06T17:00:00Z',
    }
    const candidates = rankCandidates({ snapshots: [liveSnap], config: baseConfig, detectedAt })
    expect(candidates).toHaveLength(0)
  })

  it('only considers books in the allowlist for best price', () => {
    const snapWithFanduel: MarketSnapshot = {
      ...snap,
      bookPrices: {
        ...(snap as Extract<MarketSnapshot, { market: 'moneyline' }>).bookPrices,
        FanDuel: { home: 500, away: -700 },
      },
    }
    const candidates = rankCandidates({ snapshots: [snapWithFanduel], config: baseConfig, detectedAt })
    const home = candidates.find((c) => c.side === 'home')!
    expect(home.best_book).not.toBe('FanDuel')
  })

  it('handles totals market', () => {
    const totalSnap: MarketSnapshot = {
      market: 'total',
      sport: 'nba',
      gameId: '12345',
      startTime: '2026-04-07T01:30:00Z',
      homeTeam: 'Denver Nuggets',
      awayTeam: 'Los Angeles Lakers',
      line: 224.5,
      sharp: { over: -115, under: -105 },
      bookPrices: {
        BetMGM: { over: -115, under: -105 },
        DraftKings: { over: -110, under: -110 },
        bet365: { over: 100, under: -120 },
      },
    }
    const candidates = rankCandidates({ snapshots: [totalSnap], config: baseConfig, detectedAt })
    const over = candidates.find((c) => c.side === 'over')!
    expect(over).toBeDefined()
    expect(over.market).toBe('total')
    expect(over.line).toBe(224.5)
    expect(over.best_book).toBe('bet365')
  })

  it('generates deterministic pick id', () => {
    const candidates = rankCandidates({ snapshots: [snap], config: baseConfig, detectedAt })
    const home = candidates.find((c) => c.side === 'home')!
    expect(home.id).toBe('2026-04-07:nba:12345:moneyline:home')
  })

  it('ranks across multiple sports when given multiple snapshots', () => {
    const mlbSnap: MarketSnapshot = {
      ...snap,
      sport: 'mlb',
      gameId: '99999',
    }
    const candidates = rankCandidates({ snapshots: [snap, mlbSnap], config: baseConfig, detectedAt })
    const sports = new Set(candidates.map((c) => c.sport))
    expect(sports.has('nba')).toBe(true)
    expect(sports.has('mlb')).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/engine/scanner.test.ts 2>&1 | tail -10`

Expected: FAIL — `rankCandidates` is not exported from scanner.

- [ ] **Step 3: Rewrite `src/engine/scanner.ts`**

Replace the entire file with:

```typescript
import type { Config } from '../config.js'
import type { MarketSnapshot } from '../sources/normalize.js'
import type { PickRow } from '../db/queries.js'
import { devigTwoWay } from './devig.js'
import { computeEv } from './ev.js'
import { americanToPayout } from './ev.js'

export interface RankInput {
  snapshots: MarketSnapshot[]
  config: Config
  detectedAt: string
}

/** Candidate pick — a PickRow without card_date (assigned by the command layer). */
export type Candidate = Omit<PickRow, 'card_date'>

const norm = (s: string): string => s.toLowerCase()

function isAllowed(bookName: string, allowlist: string[]): boolean {
  const normalizedAllow = allowlist.map(norm)
  return normalizedAllow.includes(norm(bookName))
}

function gameDateFromIso(iso: string): string {
  return iso.slice(0, 10)
}

interface BestPrice {
  book: string
  price: number
  ev: number
}

function findBestPrice(
  trueProb: number,
  side: 'home' | 'away' | 'over' | 'under',
  bookPrices: Record<string, { home?: number; away?: number; over?: number; under?: number }>,
  allowlist: string[]
): { best: BestPrice | null; allPrices: Record<string, number> } {
  const allPrices: Record<string, number> = {}
  let best: BestPrice | null = null

  for (const [book, prices] of Object.entries(bookPrices)) {
    const price = (prices as Record<string, number | undefined>)[side]
    if (price === undefined) continue
    allPrices[book] = price
    if (!isAllowed(book, allowlist)) continue
    const ev = computeEv({ trueProb, offeredOdds: price })
    if (!best || ev > best.ev) {
      best = { book, price, ev }
    }
  }

  return { best, allPrices }
}

function computeScore(evPct: number, trueProb: number, payout: number): number {
  return evPct * Math.sqrt(trueProb * payout)
}

/**
 * Score every side of every snapshot and return all candidates sorted by score
 * descending. No filtering — the caller decides how many to take.
 */
export function rankCandidates({ snapshots, config, detectedAt }: RankInput): Candidate[] {
  const candidates: Candidate[] = []
  const detectedAtMs = Date.parse(detectedAt)

  for (const snap of snapshots) {
    if (Date.parse(snap.startTime) <= detectedAtMs) continue

    if (snap.market === 'moneyline') {
      const { home, away } = devigTwoWay(snap.sharp.home, snap.sharp.away)
      const sides: Array<{ side: 'home' | 'away'; trueProb: number }> = [
        { side: 'home', trueProb: home },
        { side: 'away', trueProb: away },
      ]

      for (const { side, trueProb } of sides) {
        const { best, allPrices } = findBestPrice(trueProb, side, snap.bookPrices, config.books)
        if (!best) continue
        const payout = americanToPayout(best.price)
        const score = computeScore(best.ev, trueProb, payout)
        candidates.push({
          id: `${gameDateFromIso(snap.startTime)}:${snap.sport}:${snap.gameId}:moneyline:${side}`,
          detected_at: detectedAt,
          sport: snap.sport,
          game_id: snap.gameId,
          game_date: gameDateFromIso(snap.startTime),
          game_time: snap.startTime,
          away_team: snap.awayTeam,
          home_team: snap.homeTeam,
          market: 'moneyline',
          side,
          line: null,
          best_book: best.book,
          best_price: best.price,
          sharp_book: 'pinnacle',
          sharp_implied: trueProb,
          ev_pct: best.ev,
          all_prices: allPrices,
          score,
        })
      }
    } else if (snap.market === 'total') {
      const { home: overProb, away: underProb } = devigTwoWay(snap.sharp.over, snap.sharp.under)
      const sides: Array<{ side: 'over' | 'under'; trueProb: number }> = [
        { side: 'over', trueProb: overProb },
        { side: 'under', trueProb: underProb },
      ]
      for (const { side, trueProb } of sides) {
        const { best, allPrices } = findBestPrice(trueProb, side, snap.bookPrices, config.books)
        if (!best) continue
        const payout = americanToPayout(best.price)
        const score = computeScore(best.ev, trueProb, payout)
        candidates.push({
          id: `${gameDateFromIso(snap.startTime)}:${snap.sport}:${snap.gameId}:total:${side}`,
          detected_at: detectedAt,
          sport: snap.sport,
          game_id: snap.gameId,
          game_date: gameDateFromIso(snap.startTime),
          game_time: snap.startTime,
          away_team: snap.awayTeam,
          home_team: snap.homeTeam,
          market: 'total',
          side,
          line: snap.line,
          best_book: best.book,
          best_price: best.price,
          sharp_book: 'pinnacle',
          sharp_implied: trueProb,
          ev_pct: best.ev,
          all_prices: allPrices,
          score,
        })
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score)
  return candidates
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/engine/scanner.test.ts 2>&1 | tail -15`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/scanner.ts tests/engine/scanner.test.ts
git commit -m "feat(engine): rewrite scanner as rankCandidates with balanced scoring"
```

---

### Task 4: Create the `card` command

**Files:**
- Create: `src/commands/card.ts`
- Modify: `src/commands/scan.ts` (delete or leave for reference — we delete it)

- [ ] **Step 1: Create `src/commands/card.ts`**

```typescript
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
import { upsertPick, listPicksForCardDate, type PickRow } from '../db/queries.js'
import { renderCardTable } from '../ui/tables.js'

export interface RunCardInput {
  supabase: EdgeSupabase
  config: Config
  env: Env
  detectedAt?: string
  print?: (msg: string) => void
}

export async function runCard({
  supabase,
  config,
  env,
  detectedAt = new Date().toISOString(),
  print,
}: RunCardInput): Promise<PickRow[]> {
  const cardDate = detectedAt.slice(0, 10)

  // Idempotency: if we already have picks for today, return them
  const existing = await listPicksForCardDate(supabase, cardDate)
  if (existing.length >= config.daily_picks) {
    if (print) print(renderCardTable(existing))
    return existing
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

  const allCandidates: Candidate[] = []

  for (const sport of config.sports) {
    const fetchers = sportFetchers[sport]
    if (!fetchers) continue
    const [actionNetwork, pinnacle] = await Promise.all([
      fetchers.actionNetwork(),
      fetchers.pinnacle(env.ODDS_API_KEY),
    ])
    const snapshots = joinSources({ sport, actionNetwork, pinnacle })
    const candidates = rankCandidates({ snapshots, config, detectedAt })
    allCandidates.push(...candidates)
  }

  // Re-sort merged candidates from all sports
  allCandidates.sort((a, b) => b.score - a.score)
  const topN = allCandidates.slice(0, config.daily_picks)

  const picks: PickRow[] = []
  for (const candidate of topN) {
    const pick: PickRow = { ...candidate, card_date: cardDate }
    await upsertPick(supabase, pick)
    picks.push(pick)
  }

  if (print) print(renderCardTable(picks))
  return picks
}
```

- [ ] **Step 2: Delete `src/commands/scan.ts`**

```bash
rm src/commands/scan.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/commands/card.ts
git rm src/commands/scan.ts
git commit -m "feat(commands): add card command, remove scan"
```

---

### Task 5: Update the report command to use rankCandidates

**Files:**
- Modify: `src/commands/report.ts`

- [ ] **Step 1: Update `src/commands/report.ts`**

Replace the `scan` import and usage with `rankCandidates`. The report command calls `runCard` logic inline since it also needs to render an email. Change the import at line 14 from:

```typescript
import { scan } from '../engine/scanner.js'
```

to:

```typescript
import { rankCandidates } from '../engine/scanner.js'
```

Then replace the pick-generation loop (lines 56–71) with:

```typescript
  const detectedAt = new Date().toISOString()
  const cardDate = detectedAt.slice(0, 10)
  const allCandidates: Array<Awaited<ReturnType<typeof rankCandidates>>[number]> = []

  for (const sport of input.sports) {
    const fetchers = sportFetchers[sport]
    if (!fetchers) continue
    const [actionNetwork, pinnacle] = await Promise.all([
      fetchers.actionNetwork(),
      fetchers.pinnacle(input.env.ODDS_API_KEY),
    ])
    const snapshots = joinSources({ sport, actionNetwork, pinnacle })
    const candidates = rankCandidates({ snapshots, config: input.config, detectedAt })
    allCandidates.push(...candidates)
  }

  allCandidates.sort((a, b) => b.score - a.score)
  const topN = allCandidates.slice(0, input.config.daily_picks)

  const allPicks: PickRow[] = []
  for (const candidate of topN) {
    const pick: PickRow = { ...candidate, card_date: cardDate }
    await upsertPick(input.supabase, pick)
    allPicks.push(pick)
  }
```

Also update the import to include `PickRow`:

```typescript
import { upsertPick, type PickRow } from '../db/queries.js'
```

Remove the `allPicks.sort(...)` line (line 73) since candidates are already sorted by score.

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: May still have errors in `cli.ts` (references `scan`). That's fixed in Task 6.

- [ ] **Step 3: Commit**

```bash
git add src/commands/report.ts
git commit -m "refactor(report): use rankCandidates instead of scan"
```

---

### Task 6: Update CLI and table rendering

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/ui/tables.ts`

- [ ] **Step 1: Update `src/cli.ts`**

Replace the scan import (line 5):

```typescript
import { runScan } from './commands/scan.js'
```

with:

```typescript
import { runCard } from './commands/card.js'
```

Replace the scan command block (lines 11–29) with:

```typescript
program
  .command('card', { isDefault: true })
  .description('Generate today\'s top-5 daily card across all sports')
  .action(async () => {
    try {
      const config = loadConfigFromDisk()
      const env = loadEnv()
      const supabase = createSupabase(env)
      await runCard({
        supabase,
        config,
        env,
        print: (msg) => process.stdout.write(msg + '\n'),
      })
    } catch (err) {
      process.stderr.write(`error: ${(err as Error).message}\n`)
      process.exit(1)
    }
  })
```

- [ ] **Step 2: Update `src/ui/tables.ts`**

Add the `renderCardTable` function after the existing `renderPicksTable` function. Also add a `fmtScore` helper:

```typescript
function fmtScore(score: number): string {
  return score.toFixed(4)
}

export function renderCardTable(picks: PickRow[]): string {
  if (picks.length === 0) {
    return chalk.dim('No candidates available for today\'s card.')
  }

  const table = new Table({
    head: ['#', 'SCORE', 'EV%', 'SPORT', 'MATCHUP', 'PICK', 'BOOK', 'PRICE', 'SHARP', 'START'],
    style: { head: ['bold'], border: ['gray'] },
  })

  picks.forEach((p, i) => {
    const matchup = `${abbr(p.away_team)} @ ${abbr(p.home_team)}`
    const evLabel = fmtEv(p.ev_pct)
    table.push([
      chalk.bold(`${i + 1}`),
      fmtScore(p.score),
      colorEv(p.ev_pct, evLabel),
      p.sport.toUpperCase(),
      matchup,
      pickLabel(p),
      p.best_book,
      fmtPrice(p.best_price),
      `${(p.sharp_implied * 100).toFixed(1)}%`,
      fmtTime(p.game_time),
    ])
  })

  return table.toString() + `\n\nDaily card: ${picks.length} pick${picks.length === 1 ? '' : 's'}, 1u each.`
}
```

- [ ] **Step 3: Verify full compilation**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: Clean compilation (no errors).

- [ ] **Step 4: Run all tests**

Run: `npx vitest run 2>&1 | tail -20`

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts src/ui/tables.ts
git commit -m "feat(cli): wire up edge card command with score table"
```

---

### Task 7: Update GitHub Actions workflow

**Files:**
- Modify: `.github/workflows/edge-report.yml`

- [ ] **Step 1: Update the workflow**

The workflow currently calls `npm run edge:report`. The report command has already been updated to use `rankCandidates` in Task 5, so the workflow itself just needs a minor description update. But we also need to check if there's an `edge:scan` npm script.

Run: `grep 'edge:' package.json` to see what scripts exist.

If there's an `edge:scan` script, rename it to `edge:card` in `package.json`. If only `edge:report` exists, the workflow is already correct since `report` now uses the ranker internally.

- [ ] **Step 2: Update job name in workflow for clarity**

In `.github/workflows/edge-report.yml`, change the job name from `scan-and-email` to `card-and-email` (line 18):

```yaml
jobs:
  card-and-email:
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/edge-report.yml package.json
git commit -m "ci(report): rename job to card-and-email"
```

---

### Task 8: Write the migration SQL

**Files:**
- Create: `migrations/2026-04-13-daily-card.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Daily card ranker — add score and card_date to edge_picks.
-- Run manually in the Supabase SQL editor for project mlokvmawnzgtyuzpccjj.

ALTER TABLE edge_picks ADD COLUMN score NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE edge_picks ADD COLUMN card_date DATE NOT NULL DEFAULT '1970-01-01';

-- Backfill card_date from game_date for existing rows
UPDATE edge_picks SET card_date = game_date WHERE card_date = '1970-01-01';

CREATE INDEX IF NOT EXISTS idx_edge_picks_card_date ON edge_picks (card_date DESC);
```

Note: We use a sentinel default `'1970-01-01'` and then backfill because `DEFAULT game_date` (referencing another column) is not valid in a column-add ALTER. The UPDATE immediately sets it correctly for all existing rows.

- [ ] **Step 2: Commit**

```bash
git add migrations/2026-04-13-daily-card.sql
git commit -m "migration: add score and card_date columns to edge_picks"
```

---

### Task 9: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run 2>&1`

Expected: All tests pass.

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 3: Verify the CLI loads**

Run: `npx tsx src/cli.ts --help`

Expected: Shows `card` as the default command (not `scan`).

- [ ] **Step 4: Commit any remaining changes**

If any files were missed, stage and commit them:

```bash
git add -A
git status
# Only commit if there are changes
git commit -m "chore: final cleanup for daily card ranker"
```
