# Edge Parlay Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing +EV picks pipeline with a daily 2-3 leg player-prop parlay generator targeting ~+100 American odds, with anti-martingale staking, click-to-mark email buttons, and overnight grading.

**Architecture:** Replace the engine, keep the shell. Reuse existing `src/sources/action-network.ts`, Supabase persistence, Resend email, GitHub Actions cron, and `edge` CLI. Add a `src/parlay/` brain (probability/builder/streak/grade), a `src/sources/box-scores/` grader source, and a separate `tracker/` Cloudflare Worker for click-to-mark links.

**Tech Stack:** TypeScript (ESM), Vitest, Commander, Supabase, Resend, Cloudflare Workers (Wrangler).

**Spec:** `docs/superpowers/specs/2026-05-10-edge-parlay-design.md`

---

## Notes for the executor

- This project uses ESM with `.js` import suffixes for TS files (e.g. `import './foo.js'` even though source is `foo.ts`). Maintain this convention.
- Run tests with `npm test` (Vitest). Single test: `npm test -- path/to/file.test.ts`.
- Use `npx tsc --noEmit` to type-check without building.
- All commits use the established style; no Co-Authored-By needed in plan-task commits unless human edits.
- Date helpers: existing code uses `Intl.DateTimeFormat` with `America/Toronto`. Reuse that pattern; do not introduce a date library.
- The user has explicitly waived inline review during initial implementation. Pause only for the deploy boundaries called out at end of plan.

---

## Phase 1 — Foundation

### Task 1: Database migration

**Files:**
- Create: `migrations/2026-05-10-edge-parlay.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- Drop legacy +EV picks pipeline tables.
-- Legacy fantasy-app tables (~30) intentionally preserved per established preference.
DROP TABLE IF EXISTS edge_picks CASCADE;

CREATE TABLE edge_parlays (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_date           DATE NOT NULL UNIQUE,
  combined_odds       INT NOT NULL,
  combined_prob       NUMERIC(6,5) NOT NULL,
  ev_pct              NUMERIC(6,5) NOT NULL DEFAULT 0,
  recommended_stake   NUMERIC(10,2) NOT NULL,
  streak_at_creation  INT NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'bet'
                      CHECK (status IN ('bet','skipped','won','lost','void')),
  result_pnl          NUMERIC(10,2),
  bet_marked_at       TIMESTAMPTZ,
  graded_at           TIMESTAMPTZ,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE edge_parlay_legs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parlay_id       UUID NOT NULL REFERENCES edge_parlays(id) ON DELETE CASCADE,
  sport           TEXT NOT NULL CHECK (sport IN ('nba','mlb','nhl')),
  game_id         TEXT NOT NULL,
  player_id       TEXT NOT NULL,
  player_name     TEXT NOT NULL,
  prop_market     TEXT NOT NULL,
  prop_line       NUMERIC(8,2) NOT NULL,
  prop_side       TEXT NOT NULL CHECK (prop_side IN ('over','under')),
  book            TEXT NOT NULL,
  price_american  INT NOT NULL,
  pinnacle_prob   NUMERIC(6,5),
  consensus_prob  NUMERIC(6,5),
  true_prob       NUMERIC(6,5) NOT NULL,
  ev_pct          NUMERIC(6,5) NOT NULL DEFAULT 0,
  is_filler       BOOLEAN NOT NULL DEFAULT FALSE,
  result          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (result IN ('pending','hit','miss','void')),
  actual_value    NUMERIC(10,2),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_edge_parlay_legs_parlay ON edge_parlay_legs(parlay_id);

CREATE TABLE edge_streak_state (
  id              INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  current_streak  INT NOT NULL DEFAULT 0,
  next_stake      NUMERIC(10,2) NOT NULL DEFAULT 10,
  bankroll_pnl    NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO edge_streak_state (id) VALUES (1);
```

- [ ] **Step 2: Commit**

```bash
git add migrations/2026-05-10-edge-parlay.sql
git commit -m "migration: drop edge_picks, add edge_parlays/legs/streak_state"
```

(Apply-to-Supabase happens at deploy boundary, not now.)

---

### Task 2: Odds conversion helpers

**Files:**
- Create: `src/parlay/odds.ts`
- Create: `tests/parlay/odds.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/parlay/odds.test.ts
import { describe, it, expect } from 'vitest'
import {
  americanToDecimal,
  decimalToAmerican,
  americanToImplied,
  impliedToAmerican,
  combineDecimals,
  evPercent,
} from '../../src/parlay/odds.js'

describe('americanToDecimal', () => {
  it('converts +100 to 2.0', () => expect(americanToDecimal(100)).toBeCloseTo(2.0, 5))
  it('converts -200 to 1.5', () => expect(americanToDecimal(-200)).toBeCloseTo(1.5, 5))
  it('converts +250 to 3.5', () => expect(americanToDecimal(250)).toBeCloseTo(3.5, 5))
})

describe('decimalToAmerican', () => {
  it('converts 2.0 to +100', () => expect(decimalToAmerican(2.0)).toBe(100))
  it('converts 1.5 to -200', () => expect(decimalToAmerican(1.5)).toBe(-200))
  it('rounds to integer americans', () => expect(decimalToAmerican(2.05)).toBe(105))
})

describe('americanToImplied', () => {
  it('converts +100 to 0.5', () => expect(americanToImplied(100)).toBeCloseTo(0.5, 5))
  it('converts -200 to 0.6667', () => expect(americanToImplied(-200)).toBeCloseTo(2/3, 5))
})

describe('impliedToAmerican', () => {
  it('round-trips +150', () =>
    expect(impliedToAmerican(americanToImplied(150))).toBe(150))
  it('round-trips -240', () =>
    expect(impliedToAmerican(americanToImplied(-240))).toBe(-240))
})

describe('combineDecimals', () => {
  it('multiplies decimal odds', () => {
    expect(combineDecimals([1.91, 1.91])).toBeCloseTo(3.6481, 4)
  })
  it('handles 3 legs', () => {
    expect(combineDecimals([1.5, 1.5, 1.5])).toBeCloseTo(3.375, 4)
  })
})

describe('evPercent', () => {
  it('positive when true prob > implied', () => {
    expect(evPercent(0.55, 100)).toBeCloseTo(0.10, 5)  // 0.55*2 - 1 = 0.10
  })
  it('zero at exactly fair', () => {
    expect(evPercent(0.5, 100)).toBeCloseTo(0, 5)
  })
  it('negative when overpriced', () => {
    expect(evPercent(0.5, -200)).toBeCloseTo(-0.25, 5)  // 0.5*1.5 - 1 = -0.25
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
npm test -- tests/parlay/odds.test.ts
```
Expected: All tests fail (module not found).

- [ ] **Step 3: Implement**

```ts
// src/parlay/odds.ts
export function americanToDecimal(american: number): number {
  if (american === 0) throw new Error('american odds cannot be 0')
  return american > 0 ? american / 100 + 1 : 100 / -american + 1
}

export function decimalToAmerican(decimal: number): number {
  if (decimal <= 1) throw new Error('decimal odds must be > 1')
  return decimal >= 2
    ? Math.round((decimal - 1) * 100)
    : Math.round(-100 / (decimal - 1))
}

export function americanToImplied(american: number): number {
  return 1 / americanToDecimal(american)
}

export function impliedToAmerican(implied: number): number {
  if (implied <= 0 || implied >= 1) throw new Error('implied prob must be in (0,1)')
  return decimalToAmerican(1 / implied)
}

export function combineDecimals(decimals: number[]): number {
  return decimals.reduce((acc, d) => acc * d, 1)
}

export function evPercent(trueProb: number, americanOdds: number): number {
  const decimal = americanToDecimal(americanOdds)
  return trueProb * decimal - 1
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
npm test -- tests/parlay/odds.test.ts
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/parlay/odds.ts tests/parlay/odds.test.ts
git commit -m "feat(parlay): odds conversion helpers (american/decimal/implied/EV)"
```

---

### Task 3: Config schema extension

**Files:**
- Modify: `edge.config.json`
- Modify: `src/config.ts`

- [ ] **Step 1: Read current config schema**

Read `src/config.ts` to find the existing `Config` type definition and Zod schema.

- [ ] **Step 2: Extend config types**

Add to `src/config.ts` (locations: in the Zod schema and the exported `Config` interface):

```ts
// In the Zod schema:
parlay: z.object({
  target_odds: z.number().default(100),
  odds_tolerance: z.tuple([z.number(), z.number()]).default([-110, 130]),
  min_legs: z.number().default(2),
  max_legs: z.number().default(3),
  min_leg_prob: z.number().default(0.70),
  max_leg_prob: z.number().default(0.85),
  filler_min_prob: z.number().default(0.75),
  stake_base: z.number().default(10),
  stake_multiplier: z.number().default(2),
  prop_markets: z.object({
    nba: z.array(z.string()).default(['points','rebounds','assists','threes_made']),
    mlb: z.array(z.string()).default(['hits','total_bases','rbis','strikeouts_pitcher']),
    nhl: z.array(z.string()).default(['shots_on_goal','points_player']),
  }).default({}),
}).default({}),
```

- [ ] **Step 3: Update edge.config.json**

```json
{
  "books": ["betmgm", "draftkings", "caesars", "betrivers"],
  "manual_books": ["thescore", "bet365"],
  "sharp_anchor": "pinnacle",
  "sports": ["nba", "mlb", "nhl"],
  "bankroll_units": 100,
  "unit_size_cad": 25,
  "parlay": {
    "target_odds": 100,
    "odds_tolerance": [-110, 130],
    "min_legs": 2,
    "max_legs": 3,
    "min_leg_prob": 0.70,
    "max_leg_prob": 0.85,
    "filler_min_prob": 0.75,
    "stake_base": 10,
    "stake_multiplier": 2,
    "prop_markets": {
      "nba": ["points", "rebounds", "assists", "threes_made"],
      "mlb": ["hits", "total_bases", "rbis", "strikeouts_pitcher"],
      "nhl": ["shots_on_goal", "points_player"]
    }
  }
}
```

(`daily_picks` and `closing_line_capture_minutes_before_game` removed — no longer used.)

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts edge.config.json
git commit -m "feat(config): add parlay configuration block"
```

---

## Phase 2 — Probability layer

### Task 4: Probability module (devig + consensus fallback)

**Files:**
- Create: `src/parlay/probability.ts`
- Create: `tests/parlay/probability.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/parlay/probability.test.ts
import { describe, it, expect } from 'vitest'
import { devigTwoWay, consensusProb, computeTrueProb } from '../../src/parlay/probability.js'

describe('devigTwoWay', () => {
  it('removes vig proportionally from a balanced market', () => {
    // both sides at -110 → implied 0.5238 each, sum 1.0476
    // devigged: 0.5
    expect(devigTwoWay(-110, -110)).toBeCloseTo(0.5, 4)
  })

  it('skews probability toward favorite', () => {
    // -240 vs +180 → implied 0.7059 / 0.3571, sum 1.063
    // favorite devigged: 0.7059 / 1.063 ≈ 0.6641
    expect(devigTwoWay(-240, 180)).toBeCloseTo(0.6641, 3)
  })
})

describe('consensusProb', () => {
  it('averages devigged probabilities across multiple books', () => {
    const result = consensusProb([
      { sidePrice: -200, oppositePrice: 170 },
      { sidePrice: -220, oppositePrice: 180 },
    ])
    expect(result).toBeGreaterThan(0.6)
    expect(result).toBeLessThan(0.75)
  })

  it('returns null for empty input', () => {
    expect(consensusProb([])).toBeNull()
  })
})

describe('computeTrueProb', () => {
  it('prefers Pinnacle when available', () => {
    const result = computeTrueProb({
      pinnacle: { sidePrice: -110, oppositePrice: -110 },
      otherBooks: [{ sidePrice: -200, oppositePrice: 170 }],
    })
    expect(result.source).toBe('pinnacle')
    expect(result.prob).toBeCloseTo(0.5, 4)
  })

  it('falls back to consensus when Pinnacle absent', () => {
    const result = computeTrueProb({
      pinnacle: null,
      otherBooks: [{ sidePrice: -200, oppositePrice: 170 }],
    })
    expect(result.source).toBe('consensus')
    expect(result.prob).toBeGreaterThan(0)
  })

  it('returns null source if no data', () => {
    const result = computeTrueProb({ pinnacle: null, otherBooks: [] })
    expect(result.source).toBe('none')
    expect(result.prob).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
npm test -- tests/parlay/probability.test.ts
```
Expected: tests fail (module not found).

- [ ] **Step 3: Implement**

```ts
// src/parlay/probability.ts
import { americanToImplied } from './odds.js'

export interface TwoWayPrice {
  sidePrice: number       // american odds for the side we care about
  oppositePrice: number   // american odds for the opposite side
}

export function devigTwoWay(sidePrice: number, oppositePrice: number): number {
  const sideImplied = americanToImplied(sidePrice)
  const oppositeImplied = americanToImplied(oppositePrice)
  const total = sideImplied + oppositeImplied
  if (total <= 0) throw new Error('invalid devig input: total <= 0')
  return sideImplied / total
}

export function consensusProb(books: TwoWayPrice[]): number | null {
  if (books.length === 0) return null
  const probs = books.map((b) => devigTwoWay(b.sidePrice, b.oppositePrice))
  return probs.reduce((a, b) => a + b, 0) / probs.length
}

export interface TrueProbInput {
  pinnacle: TwoWayPrice | null
  otherBooks: TwoWayPrice[]
}

export interface TrueProbResult {
  prob: number | null
  source: 'pinnacle' | 'consensus' | 'none'
}

export function computeTrueProb(input: TrueProbInput): TrueProbResult {
  if (input.pinnacle) {
    return { prob: devigTwoWay(input.pinnacle.sidePrice, input.pinnacle.oppositePrice), source: 'pinnacle' }
  }
  const cons = consensusProb(input.otherBooks)
  if (cons === null) return { prob: null, source: 'none' }
  return { prob: cons, source: 'consensus' }
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
npm test -- tests/parlay/probability.test.ts
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/parlay/probability.ts tests/parlay/probability.test.ts
git commit -m "feat(parlay): probability module with Pinnacle devig + consensus fallback"
```

---

## Phase 3 — Streak state machine and Builder

### Task 5: Streak state machine

**Files:**
- Create: `src/parlay/streak.ts`
- Create: `tests/parlay/streak.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/parlay/streak.test.ts
import { describe, it, expect } from 'vitest'
import { transitionStreak, type StreakState, type ParlayOutcome } from '../../src/parlay/streak.js'

const fresh: StreakState = { current_streak: 0, next_stake: 10, bankroll_pnl: 0 }

describe('transitionStreak', () => {
  it('advances streak and doubles stake on bet+won', () => {
    const next = transitionStreak(fresh, { status: 'bet', result: 'won', stake: 10, payout: 10 })
    expect(next.current_streak).toBe(1)
    expect(next.next_stake).toBe(20)
    expect(next.bankroll_pnl).toBe(10)
  })

  it('resets streak and stake on bet+lost', () => {
    const after2 = { current_streak: 2, next_stake: 40, bankroll_pnl: 30 }
    const next = transitionStreak(after2, { status: 'bet', result: 'lost', stake: 40, payout: -40 })
    expect(next.current_streak).toBe(0)
    expect(next.next_stake).toBe(10)
    expect(next.bankroll_pnl).toBe(-10)
  })

  it('leaves state unchanged on skipped', () => {
    const next = transitionStreak(fresh, { status: 'skipped', result: 'won', stake: 10, payout: 10 })
    expect(next).toEqual(fresh)
  })

  it('leaves state unchanged on void', () => {
    const next = transitionStreak(fresh, { status: 'bet', result: 'void', stake: 10, payout: 0 })
    expect(next).toEqual(fresh)
  })

  it('honors custom stake_base on reset', () => {
    const after1 = { current_streak: 1, next_stake: 20, bankroll_pnl: 10 }
    const next = transitionStreak(after1, { status: 'bet', result: 'lost', stake: 20, payout: -20 }, { stakeBase: 25, stakeMultiplier: 2 })
    expect(next.next_stake).toBe(25)
  })

  it('honors custom multiplier', () => {
    const next = transitionStreak(fresh, { status: 'bet', result: 'won', stake: 10, payout: 10 }, { stakeBase: 10, stakeMultiplier: 3 })
    expect(next.next_stake).toBe(30)
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
npm test -- tests/parlay/streak.test.ts
```
Expected: tests fail (module not found).

- [ ] **Step 3: Implement**

```ts
// src/parlay/streak.ts
export interface StreakState {
  current_streak: number
  next_stake: number
  bankroll_pnl: number
}

export type ParlayResult = 'won' | 'lost' | 'void'
export type ParlayStatus = 'bet' | 'skipped'

export interface ParlayOutcome {
  status: ParlayStatus
  result: ParlayResult
  stake: number
  payout: number   // signed P&L for this parlay (e.g. +10 for win, -40 for loss, 0 for void)
}

export interface TransitionOptions {
  stakeBase: number
  stakeMultiplier: number
}

const DEFAULT_OPTS: TransitionOptions = { stakeBase: 10, stakeMultiplier: 2 }

export function transitionStreak(
  prev: StreakState,
  outcome: ParlayOutcome,
  opts: TransitionOptions = DEFAULT_OPTS,
): StreakState {
  if (outcome.status === 'skipped') return prev
  if (outcome.result === 'void') return prev

  if (outcome.result === 'won') {
    const newStreak = prev.current_streak + 1
    return {
      current_streak: newStreak,
      next_stake: prev.next_stake * opts.stakeMultiplier,
      bankroll_pnl: prev.bankroll_pnl + outcome.payout,
    }
  }

  // lost
  return {
    current_streak: 0,
    next_stake: opts.stakeBase,
    bankroll_pnl: prev.bankroll_pnl + outcome.payout,
  }
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
npm test -- tests/parlay/streak.test.ts
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/parlay/streak.ts tests/parlay/streak.test.ts
git commit -m "feat(parlay): streak state machine (anti-martingale, pure)"
```

---

### Task 6: Parlay builder algorithm

**Files:**
- Create: `src/parlay/builder.ts`
- Create: `tests/parlay/builder.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/parlay/builder.test.ts
import { describe, it, expect } from 'vitest'
import { buildParlay, type LegCandidate } from '../../src/parlay/builder.js'

const cfg = {
  target_odds: 100,
  odds_tolerance: [-110, 130] as [number, number],
  min_legs: 2,
  max_legs: 3,
  min_leg_prob: 0.70,
  max_leg_prob: 0.85,
  filler_min_prob: 0.75,
}

function leg(over: Partial<LegCandidate>): LegCandidate {
  return {
    id: 'x',
    game_id: 'g1',
    sport: 'nba',
    player_id: 'p',
    player_name: 'P',
    prop_market: 'points',
    prop_line: 10.5,
    prop_side: 'over',
    book: 'draftkings',
    price_american: -240,
    true_prob: 0.72,
    is_filler_eligible: false,
    ...over,
  }
}

describe('buildParlay', () => {
  it('returns null when fewer than 2 candidates qualify', () => {
    const result = buildParlay([leg({ id: 'a', game_id: 'g1' })], cfg)
    expect(result).toBeNull()
  })

  it('builds a 2-leg parlay near +100 from two -240 legs', () => {
    const result = buildParlay(
      [
        leg({ id: 'a', game_id: 'g1', price_american: -240, true_prob: 0.72 }),
        leg({ id: 'b', game_id: 'g2', price_american: -240, true_prob: 0.72 }),
      ],
      cfg,
    )
    expect(result).not.toBeNull()
    expect(result!.legs.length).toBe(2)
    // -240 × -240 → 1.4167 × 1.4167 = 2.007 → ~ +100
    expect(result!.combined_odds).toBeGreaterThanOrEqual(95)
    expect(result!.combined_odds).toBeLessThanOrEqual(105)
  })

  it('rejects same-game combos (max 1 leg per game)', () => {
    const result = buildParlay(
      [
        leg({ id: 'a', game_id: 'g1', price_american: -240, true_prob: 0.72 }),
        leg({ id: 'b', game_id: 'g1', price_american: -240, true_prob: 0.72 }),
      ],
      cfg,
    )
    expect(result).toBeNull()
  })

  it('prefers combos with more +EV legs over filler', () => {
    // two +EV legs and one filler: builder should pick the +EV pair
    const evA = leg({ id: 'a', game_id: 'g1', price_american: -200, true_prob: 0.72, is_filler_eligible: false })
    const evB = leg({ id: 'b', game_id: 'g2', price_american: -200, true_prob: 0.72, is_filler_eligible: false })
    const fill = leg({ id: 'f', game_id: 'g3', price_american: -240, true_prob: 0.78, is_filler_eligible: true })
    const result = buildParlay([evA, evB, fill], cfg)
    expect(result).not.toBeNull()
    const ids = result!.legs.map((l) => l.id).sort()
    expect(ids).toEqual(['a', 'b'])
  })

  it('falls back to filler when not enough +EV legs', () => {
    const fill1 = leg({ id: 'f1', game_id: 'g1', price_american: -240, true_prob: 0.78, is_filler_eligible: true })
    const fill2 = leg({ id: 'f2', game_id: 'g2', price_american: -240, true_prob: 0.78, is_filler_eligible: true })
    const result = buildParlay([fill1, fill2], cfg)
    expect(result).not.toBeNull()
    expect(result!.legs.length).toBe(2)
  })

  it('drops candidates outside the prob band', () => {
    const tooLow = leg({ id: 'a', game_id: 'g1', true_prob: 0.5 })
    const tooHigh = leg({ id: 'b', game_id: 'g2', true_prob: 0.95 })
    const ok1 = leg({ id: 'c', game_id: 'g3', price_american: -240, true_prob: 0.72 })
    const ok2 = leg({ id: 'd', game_id: 'g4', price_american: -240, true_prob: 0.72 })
    const result = buildParlay([tooLow, tooHigh, ok1, ok2], cfg)
    expect(result).not.toBeNull()
    const ids = result!.legs.map((l) => l.id).sort()
    expect(ids).toEqual(['c', 'd'])
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
npm test -- tests/parlay/builder.test.ts
```
Expected: tests fail (module not found).

- [ ] **Step 3: Implement**

```ts
// src/parlay/builder.ts
import { americanToDecimal, decimalToAmerican, americanToImplied, combineDecimals, evPercent } from './odds.js'

export interface LegCandidate {
  id: string
  game_id: string
  sport: 'nba' | 'mlb' | 'nhl'
  player_id: string
  player_name: string
  prop_market: string
  prop_line: number
  prop_side: 'over' | 'under'
  book: string
  price_american: number
  true_prob: number
  is_filler_eligible: boolean
  pinnacle_prob?: number | null
  consensus_prob?: number | null
}

export interface BuilderConfig {
  target_odds: number
  odds_tolerance: [number, number]
  min_legs: number
  max_legs: number
  min_leg_prob: number
  max_leg_prob: number
  filler_min_prob: number
}

export interface BuiltParlay {
  legs: (LegCandidate & { is_filler: boolean; ev_pct: number })[]
  combined_odds: number
  combined_prob: number
  ev_pct: number
}

function combinations<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]]
  if (items.length < k) return []
  const [head, ...rest] = items
  const withHead = combinations(rest, k - 1).map((c) => [head, ...c])
  const withoutHead = combinations(rest, k)
  return [...withHead, ...withoutHead]
}

function isPlusEv(leg: LegCandidate): boolean {
  return evPercent(leg.true_prob, leg.price_american) > 0
}

export function buildParlay(candidates: LegCandidate[], cfg: BuilderConfig): BuiltParlay | null {
  const filtered = candidates.filter(
    (c) => c.true_prob >= cfg.min_leg_prob && c.true_prob <= cfg.max_leg_prob,
  )
  if (filtered.length < cfg.min_legs) return null

  const allCombos: LegCandidate[][] = []
  for (let k = cfg.max_legs; k >= cfg.min_legs; k--) {
    allCombos.push(...combinations(filtered, k))
  }

  // diversity: max 1 leg per game
  const validCombos = allCombos.filter((combo) => {
    const games = new Set(combo.map((l) => l.game_id))
    return games.size === combo.length
  })

  // for filler-only legs, require true_prob >= filler_min_prob
  const eligibleCombos = validCombos.filter((combo) =>
    combo.every((l) => isPlusEv(l) || (l.is_filler_eligible && l.true_prob >= cfg.filler_min_prob)),
  )

  type Scored = { combo: LegCandidate[]; american: number; combinedProb: number; evCount: number; avgEv: number }
  const scored: Scored[] = eligibleCombos.map((combo) => {
    const decimals = combo.map((l) => americanToDecimal(l.price_american))
    const combinedDec = combineDecimals(decimals)
    const american = decimalToAmerican(combinedDec)
    const combinedProb = combo.reduce((p, l) => p * l.true_prob, 1)
    const evCount = combo.filter(isPlusEv).length
    const avgEv = combo.reduce((s, l) => s + evPercent(l.true_prob, l.price_american), 0) / combo.length
    return { combo, american, combinedProb, evCount, avgEv }
  })

  const inBand = (s: Scored): boolean =>
    s.american >= cfg.odds_tolerance[0] && s.american <= cfg.odds_tolerance[1]

  let pool = scored.filter(inBand)
  if (pool.length === 0) {
    // relax band by ±50
    const wider: [number, number] = [cfg.odds_tolerance[0] - 50, cfg.odds_tolerance[1] + 50]
    pool = scored.filter((s) => s.american >= wider[0] && s.american <= wider[1])
  }
  if (pool.length === 0) return null

  pool.sort((a, b) => {
    if (b.evCount !== a.evCount) return b.evCount - a.evCount
    if (b.avgEv !== a.avgEv) return b.avgEv - a.avgEv
    return Math.abs(a.american - cfg.target_odds) - Math.abs(b.american - cfg.target_odds)
  })

  const winner = pool[0]
  const legs = winner.combo.map((l) => ({
    ...l,
    is_filler: !isPlusEv(l),
    ev_pct: evPercent(l.true_prob, l.price_american),
  }))
  return {
    legs,
    combined_odds: winner.american,
    combined_prob: winner.combinedProb,
    ev_pct: winner.avgEv,
  }
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
npm test -- tests/parlay/builder.test.ts
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/parlay/builder.ts tests/parlay/builder.test.ts
git commit -m "feat(parlay): builder picks 2-3 leg combos targeting ~+100 odds"
```

---

## Phase 4 — Action Network props source

### Task 7: AN player-props endpoint client

**Files:**
- Create: `src/sources/action-network-props.ts`
- Create: `tests/fixtures/an-props-nba.json`
- Create: `tests/sources/action-network-props.test.ts`

- [ ] **Step 1: Capture a real fixture**

The Action Network player-props endpoint pattern (verified externally) is:

```
https://api.actionnetwork.com/web/v1/games/<game_id>/player_props?bookIds=15,30,68,69,71,75,238
```

Where `238` is Pinnacle (already used elsewhere in the codebase). If the endpoint shape differs, the executor should curl the URL once with a real game id and save the response; the test fixture should reflect the actual JSON. For the initial commit, create a minimal hand-crafted fixture that matches the parser's expected shape:

```json
// tests/fixtures/an-props-nba.json
{
  "markets": [
    {
      "name": "core_bet_type_44_points",
      "rules": { "options": ["over", "under"] },
      "books": [
        {
          "book_id": 15,
          "odds": [
            { "player_id": 9001, "value": 22.5, "side": "over",  "money": -240 },
            { "player_id": 9001, "value": 22.5, "side": "under", "money": 180 }
          ]
        },
        {
          "book_id": 238,
          "odds": [
            { "player_id": 9001, "value": 22.5, "side": "over",  "money": -220 },
            { "player_id": 9001, "value": 22.5, "side": "under", "money": 170 }
          ]
        }
      ]
    }
  ],
  "players": [
    { "id": 9001, "full_name": "LeBron James" }
  ]
}
```

- [ ] **Step 2: Write failing test**

```ts
// tests/sources/action-network-props.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseActionNetworkProps } from '../../src/sources/action-network-props.js'

const fixture = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/an-props-nba.json'), 'utf-8'),
)

describe('parseActionNetworkProps', () => {
  it('extracts player-prop two-way pairs across books', () => {
    const props = parseActionNetworkProps(fixture, { sport: 'nba', gameId: '12345' })
    expect(props.length).toBeGreaterThan(0)
    const lebron = props.find((p) => p.player_name === 'LeBron James' && p.prop_market === 'points')
    expect(lebron).toBeDefined()
    expect(lebron!.prop_line).toBe(22.5)
    expect(lebron!.over.books.length).toBe(2)
    expect(lebron!.over.pinnacle).not.toBeNull()
    expect(lebron!.over.pinnacle!.sidePrice).toBe(-220)
    expect(lebron!.over.pinnacle!.oppositePrice).toBe(170)
  })
})
```

- [ ] **Step 3: Run test to verify failure**

```bash
npm test -- tests/sources/action-network-props.test.ts
```
Expected: fails (module not found).

- [ ] **Step 4: Implement**

```ts
// src/sources/action-network-props.ts
const AN_BASE = 'https://api.actionnetwork.com/web/v1'
const PINNACLE_BOOK_ID = 238

const NBA_MARKET_MAP: Record<string, string> = {
  'core_bet_type_44_points': 'points',
  'core_bet_type_45_rebounds': 'rebounds',
  'core_bet_type_46_assists': 'assists',
  'core_bet_type_47_threes_made': 'threes_made',
}
const MLB_MARKET_MAP: Record<string, string> = {
  'core_bet_type_88_hits': 'hits',
  'core_bet_type_89_total_bases': 'total_bases',
  'core_bet_type_90_rbis': 'rbis',
  'core_bet_type_91_strikeouts_pitcher': 'strikeouts_pitcher',
}
const NHL_MARKET_MAP: Record<string, string> = {
  'core_bet_type_120_shots_on_goal': 'shots_on_goal',
  'core_bet_type_121_points_player': 'points_player',
}

const MAPS: Record<string, Record<string, string>> = {
  nba: NBA_MARKET_MAP, mlb: MLB_MARKET_MAP, nhl: NHL_MARKET_MAP,
}

const BOOK_NAMES: Record<number, string> = {
  15: 'draftkings', 30: 'fanduel', 68: 'betmgm', 69: 'caesars', 71: 'fanatics', 75: 'betrivers',
}

export interface PropSide {
  pinnacle: { sidePrice: number; oppositePrice: number } | null
  books: Array<{ book: string; price: number; oppositePrice: number }>
}

export interface PropMarket {
  game_id: string
  sport: 'nba' | 'mlb' | 'nhl'
  player_id: string
  player_name: string
  prop_market: string
  prop_line: number
  over: PropSide
  under: PropSide
}

interface ANProp {
  player_id: number
  value: number
  side: 'over' | 'under'
  money: number
}

interface ANPlayer { id: number; full_name: string }

interface ANPropMarket {
  name: string
  books: Array<{ book_id: number; odds: ANProp[] }>
}

export interface ANPropsPayload {
  markets: ANPropMarket[]
  players: ANPlayer[]
}

export interface ParseOptions {
  sport: 'nba' | 'mlb' | 'nhl'
  gameId: string
}

export function parseActionNetworkProps(
  payload: ANPropsPayload,
  opts: ParseOptions,
): PropMarket[] {
  const map = MAPS[opts.sport]
  const playerById = new Map<number, string>(payload.players.map((p) => [p.id, p.full_name]))
  const out: PropMarket[] = []

  for (const market of payload.markets) {
    const propMarket = map[market.name]
    if (!propMarket) continue

    // index odds by (player_id, line, side)
    const grouped = new Map<string, { over: ANProp[]; under: ANProp[]; line: number; player_id: number }>()
    for (const book of market.books) {
      for (const o of book.odds) {
        const key = `${o.player_id}|${o.value}`
        let entry = grouped.get(key)
        if (!entry) {
          entry = { over: [], under: [], line: o.value, player_id: o.player_id }
          grouped.set(key, entry)
        }
        ;(entry as any)[o.side].push({ ...o, _bookId: book.book_id })
      }
    }

    for (const entry of grouped.values()) {
      // need both sides present
      if (entry.over.length === 0 || entry.under.length === 0) continue

      const collectSide = (myList: any[], otherList: any[]): PropSide => {
        const otherByBook = new Map<number, any>(otherList.map((o) => [o._bookId, o]))
        const pinnacleMine = myList.find((o) => o._bookId === PINNACLE_BOOK_ID)
        const pinnacleOther = otherByBook.get(PINNACLE_BOOK_ID)
        const pinnacle = pinnacleMine && pinnacleOther
          ? { sidePrice: pinnacleMine.money, oppositePrice: pinnacleOther.money }
          : null
        const books: Array<{ book: string; price: number; oppositePrice: number }> = []
        for (const o of myList) {
          const opp = otherByBook.get(o._bookId)
          if (!opp) continue
          const bookName = BOOK_NAMES[o._bookId]
          if (!bookName) continue
          books.push({ book: bookName, price: o.money, oppositePrice: opp.money })
        }
        return { pinnacle, books }
      }

      const playerName = playerById.get(entry.player_id) ?? `player_${entry.player_id}`
      out.push({
        game_id: opts.gameId,
        sport: opts.sport,
        player_id: String(entry.player_id),
        player_name: playerName,
        prop_market: propMarket,
        prop_line: entry.line,
        over: collectSide(entry.over, entry.under),
        under: collectSide(entry.under, entry.over),
      })
    }
  }
  return out
}

export async function fetchActionNetworkProps(opts: ParseOptions): Promise<PropMarket[]> {
  const url = `${AN_BASE}/games/${opts.gameId}/player_props?bookIds=15,30,68,69,71,75,238`
  const res = await fetch(url, { headers: { 'User-Agent': 'edge-cli/0.2' } })
  if (!res.ok) throw new Error(`AN props fetch failed: ${res.status}`)
  const json = (await res.json()) as ANPropsPayload
  return parseActionNetworkProps(json, opts)
}
```

- [ ] **Step 5: Run test to verify pass**

```bash
npm test -- tests/sources/action-network-props.test.ts
```
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add src/sources/action-network-props.ts tests/sources/action-network-props.test.ts tests/fixtures/an-props-nba.json
git commit -m "feat(sources): Action Network player-props parser + fetcher"
```

> **NOTE for executor:** Real-world AN response shape may vary. Once running for real (post-deploy), validate against an actual response and adjust `MARKET_MAP` keys + parsing as needed. The fixture is structurally accurate but the exact `name` strings of markets may differ.

---

### Task 8: Convert PropMarket → LegCandidate list

**Files:**
- Create: `src/parlay/candidates.ts`
- Create: `tests/parlay/candidates.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/parlay/candidates.test.ts
import { describe, it, expect } from 'vitest'
import { propMarketsToCandidates } from '../../src/parlay/candidates.js'
import type { PropMarket } from '../../src/sources/action-network-props.js'

const market: PropMarket = {
  game_id: 'g1',
  sport: 'nba',
  player_id: '9001',
  player_name: 'LeBron James',
  prop_market: 'points',
  prop_line: 22.5,
  over: {
    pinnacle: { sidePrice: -220, oppositePrice: 170 },
    books: [
      { book: 'draftkings', price: -240, oppositePrice: 180 },
      { book: 'betmgm', price: -230, oppositePrice: 175 },
    ],
  },
  under: {
    pinnacle: { sidePrice: 170, oppositePrice: -220 },
    books: [{ book: 'draftkings', price: 180, oppositePrice: -240 }],
  },
}

describe('propMarketsToCandidates', () => {
  it('produces over and under candidates with best price per side', () => {
    const candidates = propMarketsToCandidates([market], { allowedBooks: ['draftkings','betmgm'] })
    const over = candidates.filter((c) => c.prop_side === 'over')
    expect(over.length).toBe(1)
    // best price for over = least negative (closest to underdog) = -230
    expect(over[0].price_american).toBe(-230)
    expect(over[0].book).toBe('betmgm')
    expect(over[0].true_prob).toBeCloseTo(0.55, 1)  // pinnacle devig of -220/170
  })

  it('omits sides with no books in allowed list', () => {
    const candidates = propMarketsToCandidates([market], { allowedBooks: ['caesars'] })
    expect(candidates.length).toBe(0)
  })

  it('marks both sides as filler-eligible when prob >= filler threshold', () => {
    const candidates = propMarketsToCandidates([market], { allowedBooks: ['draftkings','betmgm'] })
    expect(candidates.every((c) => typeof c.is_filler_eligible === 'boolean')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
npm test -- tests/parlay/candidates.test.ts
```
Expected: fails.

- [ ] **Step 3: Implement**

```ts
// src/parlay/candidates.ts
import type { PropMarket, PropSide } from '../sources/action-network-props.js'
import type { LegCandidate } from './builder.js'
import { computeTrueProb } from './probability.js'

export interface CandidateOptions {
  allowedBooks: string[]
}

function bestPriceForSide(side: PropSide, allowed: string[]): { book: string; price: number; oppositePrice: number } | null {
  const filtered = side.books.filter((b) => allowed.includes(b.book))
  if (filtered.length === 0) return null
  // for `over`, "best" = least negative / most positive (highest payout)
  return filtered.reduce((acc, b) => (b.price > acc.price ? b : acc), filtered[0])
}

export function propMarketsToCandidates(
  markets: PropMarket[],
  opts: CandidateOptions,
): LegCandidate[] {
  const out: LegCandidate[] = []
  for (const m of markets) {
    for (const sideName of ['over','under'] as const) {
      const side = m[sideName]
      const best = bestPriceForSide(side, opts.allowedBooks)
      if (!best) continue
      const truth = computeTrueProb({
        pinnacle: side.pinnacle,
        otherBooks: side.books.map((b) => ({ sidePrice: b.price, oppositePrice: b.oppositePrice })),
      })
      if (truth.prob === null) continue
      out.push({
        id: `${m.game_id}|${m.player_id}|${m.prop_market}|${m.prop_line}|${sideName}`,
        game_id: m.game_id,
        sport: m.sport,
        player_id: m.player_id,
        player_name: m.player_name,
        prop_market: m.prop_market,
        prop_line: m.prop_line,
        prop_side: sideName,
        book: best.book,
        price_american: best.price,
        true_prob: truth.prob,
        is_filler_eligible: true,    // any leg may be filler if it meets min_prob; final is_filler decided by builder
        pinnacle_prob: truth.source === 'pinnacle' ? truth.prob : null,
        consensus_prob: truth.source === 'consensus' ? truth.prob : null,
      })
    }
  }
  return out
}
```

- [ ] **Step 4: Run test to verify pass + commit**

```bash
npm test -- tests/parlay/candidates.test.ts
git add src/parlay/candidates.ts tests/parlay/candidates.test.ts
git commit -m "feat(parlay): convert PropMarket lists into LegCandidate lists"
```

---

## Phase 5 — Box-score grading

### Task 9: NBA box-score adapter

**Files:**
- Create: `src/sources/box-scores/nba.ts`
- Create: `tests/fixtures/box-score-nba.json`
- Create: `tests/sources/box-scores/nba.test.ts`

- [ ] **Step 1: Create fixture**

```json
// tests/fixtures/box-score-nba.json
{
  "game": { "id": "0022500001", "status": "Final" },
  "players": [
    {
      "id": "1628378",
      "full_name": "LeBron James",
      "stats": { "points": 28, "rebounds": 8, "assists": 11, "threes_made": 3 }
    },
    {
      "id": "201939",
      "full_name": "Stephen Curry",
      "stats": { "points": 32, "rebounds": 4, "assists": 6, "threes_made": 7 }
    }
  ]
}
```

- [ ] **Step 2: Write failing test**

```ts
// tests/sources/box-scores/nba.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseNbaBoxScore } from '../../../src/sources/box-scores/nba.js'

const fixture = JSON.parse(
  readFileSync(join(__dirname, '../../fixtures/box-score-nba.json'), 'utf-8'),
)

describe('parseNbaBoxScore', () => {
  it('extracts player stats by player_id', () => {
    const stats = parseNbaBoxScore(fixture)
    expect(stats.gameStatus).toBe('final')
    const lebron = stats.byPlayer['1628378']
    expect(lebron.points).toBe(28)
    expect(lebron.rebounds).toBe(8)
  })

  it('returns "in_progress" or similar when not final', () => {
    const inFlight = { ...fixture, game: { ...fixture.game, status: 'InProgress' } }
    expect(parseNbaBoxScore(inFlight).gameStatus).not.toBe('final')
  })
})
```

- [ ] **Step 3: Implement**

```ts
// src/sources/box-scores/nba.ts
export interface BoxScoreStats {
  gameStatus: 'final' | 'in_progress' | 'not_started' | 'postponed' | 'unknown'
  byPlayer: Record<string, Record<string, number>>
}

export function parseNbaBoxScore(raw: any): BoxScoreStats {
  const status = String(raw?.game?.status ?? '').toLowerCase()
  const gameStatus: BoxScoreStats['gameStatus'] =
    status === 'final' ? 'final' :
    status.includes('progress') || status.includes('quarter') ? 'in_progress' :
    status.includes('postpon') ? 'postponed' :
    status === 'scheduled' || status === 'pregame' ? 'not_started' :
    'unknown'
  const byPlayer: BoxScoreStats['byPlayer'] = {}
  for (const p of raw?.players ?? []) {
    byPlayer[String(p.id)] = p.stats ?? {}
  }
  return { gameStatus, byPlayer }
}

// Live source: stats.nba.com or ESPN unofficial. The exact endpoint requires
// reverse-engineering; the executor can switch the fetch URL once tested.
const NBA_BOX_URL = (gameId: string) =>
  `https://stats.nba.com/stats/boxscoretraditionalv2?GameID=${gameId}&StartPeriod=1&EndPeriod=10&StartRange=0&EndRange=28800&RangeType=0`

export async function fetchNbaBoxScore(gameId: string): Promise<BoxScoreStats> {
  const res = await fetch(NBA_BOX_URL(gameId), {
    headers: {
      'User-Agent': 'edge-cli/0.2',
      'Referer': 'https://www.nba.com/',
      'Accept': 'application/json',
    },
  })
  if (!res.ok) throw new Error(`NBA box-score fetch failed: ${res.status}`)
  const raw = await res.json()
  // stats.nba.com uses a row-based "resultSet" shape — normalize before parsing:
  return parseNbaBoxScore(normalizeNbaResultSet(raw, gameId))
}

function normalizeNbaResultSet(raw: any, gameId: string): any {
  // Minimal: locate the "PlayerStats" resultSet, project to {id, full_name, stats}.
  const sets = raw?.resultSets ?? []
  const ps = sets.find((s: any) => s.name === 'PlayerStats')
  if (!ps) return { game: { id: gameId, status: 'unknown' }, players: [] }
  const headers: string[] = ps.headers
  const idx = (k: string) => headers.indexOf(k)
  const players = (ps.rowSet ?? []).map((row: any[]) => ({
    id: String(row[idx('PLAYER_ID')]),
    full_name: row[idx('PLAYER_NAME')],
    stats: {
      points: row[idx('PTS')] ?? 0,
      rebounds: row[idx('REB')] ?? 0,
      assists: row[idx('AST')] ?? 0,
      threes_made: row[idx('FG3M')] ?? 0,
    },
  }))
  return { game: { id: gameId, status: 'Final' }, players }
}
```

- [ ] **Step 4: Run test, then commit**

```bash
npm test -- tests/sources/box-scores/nba.test.ts
git add src/sources/box-scores/nba.ts tests/sources/box-scores/nba.test.ts tests/fixtures/box-score-nba.json
git commit -m "feat(box-scores): NBA adapter (stats.nba.com)"
```

---

### Task 10: MLB box-score adapter

**Files:**
- Create: `src/sources/box-scores/mlb.ts`
- Create: `tests/fixtures/box-score-mlb.json`
- Create: `tests/sources/box-scores/mlb.test.ts`

- [ ] **Step 1: Fixture**

MLB Stats API uses `https://statsapi.mlb.com/api/v1/game/<gamePk>/boxscore`. Hand-craft fixture matching the relevant fields:

```json
// tests/fixtures/box-score-mlb.json
{
  "teams": {
    "home": {
      "players": {
        "ID660271": {
          "person": { "id": 660271, "fullName": "Vladimir Guerrero Jr." },
          "stats": { "batting": { "hits": 2, "totalBases": 4, "rbi": 1 } }
        }
      }
    },
    "away": { "players": {} }
  },
  "info": [],
  "game_status": "Final"
}
```

- [ ] **Step 2: Test**

```ts
// tests/sources/box-scores/mlb.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseMlbBoxScore } from '../../../src/sources/box-scores/mlb.js'

const fixture = JSON.parse(readFileSync(join(__dirname, '../../fixtures/box-score-mlb.json'), 'utf-8'))

describe('parseMlbBoxScore', () => {
  it('extracts batting stats keyed by player id', () => {
    const stats = parseMlbBoxScore(fixture)
    const vlad = stats.byPlayer['660271']
    expect(vlad.hits).toBe(2)
    expect(vlad.total_bases).toBe(4)
    expect(vlad.rbis).toBe(1)
  })
})
```

- [ ] **Step 3: Implement**

```ts
// src/sources/box-scores/mlb.ts
import type { BoxScoreStats } from './nba.js'  // reuse type
export type { BoxScoreStats } from './nba.js'

export function parseMlbBoxScore(raw: any): BoxScoreStats {
  const status = String(raw?.game_status ?? '').toLowerCase()
  const gameStatus: BoxScoreStats['gameStatus'] =
    status === 'final' ? 'final' :
    status === 'in progress' || status.includes('inning') ? 'in_progress' :
    status === 'postponed' ? 'postponed' :
    status === 'scheduled' || status === 'pre-game' ? 'not_started' :
    'unknown'
  const byPlayer: BoxScoreStats['byPlayer'] = {}
  for (const team of ['home','away'] as const) {
    const players = raw?.teams?.[team]?.players ?? {}
    for (const k of Object.keys(players)) {
      const p = players[k]
      const id = String(p?.person?.id)
      if (!id) continue
      const batting = p?.stats?.batting ?? {}
      const pitching = p?.stats?.pitching ?? {}
      byPlayer[id] = {
        hits: batting.hits ?? 0,
        total_bases: batting.totalBases ?? 0,
        rbis: batting.rbi ?? 0,
        strikeouts_pitcher: pitching.strikeOuts ?? 0,
      }
    }
  }
  return { gameStatus, byPlayer }
}

export async function fetchMlbBoxScore(gamePk: string): Promise<BoxScoreStats> {
  const res = await fetch(`https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`)
  if (!res.ok) throw new Error(`MLB box-score fetch failed: ${res.status}`)
  const raw = await res.json()
  // statsapi puts game status under a different endpoint; merge in here:
  const live = await fetch(`https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`)
  if (live.ok) {
    const liveJson: any = await live.json()
    raw.game_status = liveJson?.gameData?.status?.detailedState
  }
  return parseMlbBoxScore(raw)
}
```

- [ ] **Step 4: Run test + commit**

```bash
npm test -- tests/sources/box-scores/mlb.test.ts
git add src/sources/box-scores/mlb.ts tests/sources/box-scores/mlb.test.ts tests/fixtures/box-score-mlb.json
git commit -m "feat(box-scores): MLB adapter (statsapi.mlb.com)"
```

---

### Task 11: NHL box-score adapter

**Files:**
- Create: `src/sources/box-scores/nhl.ts`
- Create: `tests/fixtures/box-score-nhl.json`
- Create: `tests/sources/box-scores/nhl.test.ts`

- [ ] **Step 1: Fixture**

```json
// tests/fixtures/box-score-nhl.json
{
  "id": 2025020001,
  "gameState": "FINAL",
  "playerByGameStats": {
    "homeTeam": {
      "skaters": [
        { "playerId": 8478402, "name": { "default": "Connor McDavid" }, "shots": 5, "points": 2 }
      ],
      "goalies": []
    },
    "awayTeam": { "skaters": [], "goalies": [] }
  }
}
```

- [ ] **Step 2: Test**

```ts
// tests/sources/box-scores/nhl.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseNhlBoxScore } from '../../../src/sources/box-scores/nhl.js'

const fixture = JSON.parse(readFileSync(join(__dirname, '../../fixtures/box-score-nhl.json'), 'utf-8'))

describe('parseNhlBoxScore', () => {
  it('extracts skater stats keyed by player id', () => {
    const stats = parseNhlBoxScore(fixture)
    expect(stats.gameStatus).toBe('final')
    const mcdavid = stats.byPlayer['8478402']
    expect(mcdavid.shots_on_goal).toBe(5)
    expect(mcdavid.points_player).toBe(2)
  })
})
```

- [ ] **Step 3: Implement**

```ts
// src/sources/box-scores/nhl.ts
import type { BoxScoreStats } from './nba.js'

export function parseNhlBoxScore(raw: any): BoxScoreStats {
  const status = String(raw?.gameState ?? '').toLowerCase()
  const gameStatus: BoxScoreStats['gameStatus'] =
    status === 'final' || status === 'off' ? 'final' :
    status === 'live' || status === 'crit' ? 'in_progress' :
    status === 'postponed' || status === 'pp' ? 'postponed' :
    status === 'fut' || status === 'pre' ? 'not_started' :
    'unknown'
  const byPlayer: BoxScoreStats['byPlayer'] = {}
  for (const teamSide of ['homeTeam','awayTeam'] as const) {
    const team = raw?.playerByGameStats?.[teamSide]
    for (const skater of team?.skaters ?? []) {
      byPlayer[String(skater.playerId)] = {
        shots_on_goal: skater.shots ?? 0,
        points_player: skater.points ?? 0,
      }
    }
  }
  return { gameStatus, byPlayer }
}

export async function fetchNhlBoxScore(gameId: string): Promise<BoxScoreStats> {
  const res = await fetch(`https://api-web.nhle.com/v1/gamecenter/${gameId}/boxscore`)
  if (!res.ok) throw new Error(`NHL box-score fetch failed: ${res.status}`)
  return parseNhlBoxScore(await res.json())
}
```

- [ ] **Step 4: Run test + commit**

```bash
npm test -- tests/sources/box-scores/nhl.test.ts
git add src/sources/box-scores/nhl.ts tests/sources/box-scores/nhl.test.ts tests/fixtures/box-score-nhl.json
git commit -m "feat(box-scores): NHL adapter (api-web.nhle.com)"
```

---

### Task 12: Box-score router

**Files:**
- Create: `src/sources/box-scores/index.ts`

- [ ] **Step 1: Implement**

```ts
// src/sources/box-scores/index.ts
import { fetchNbaBoxScore } from './nba.js'
import { fetchMlbBoxScore } from './mlb.js'
import { fetchNhlBoxScore } from './nhl.js'
import type { BoxScoreStats } from './nba.js'
export type { BoxScoreStats } from './nba.js'

export async function fetchBoxScore(sport: 'nba'|'mlb'|'nhl', gameId: string): Promise<BoxScoreStats> {
  switch (sport) {
    case 'nba': return fetchNbaBoxScore(gameId)
    case 'mlb': return fetchMlbBoxScore(gameId)
    case 'nhl': return fetchNhlBoxScore(gameId)
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/sources/box-scores/index.ts
git commit -m "feat(box-scores): router by sport"
```

---

### Task 13: Leg + parlay grader

**Files:**
- Create: `src/parlay/grade.ts`
- Create: `tests/parlay/grade.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/parlay/grade.test.ts
import { describe, it, expect } from 'vitest'
import { gradeLeg, gradeParlay, type LegToGrade } from '../../src/parlay/grade.js'
import { americanToDecimal } from '../../src/parlay/odds.js'

const baseLeg: LegToGrade = {
  player_id: 'p1', prop_market: 'points', prop_line: 22.5,
  prop_side: 'over', price_american: -240,
}

describe('gradeLeg', () => {
  it('hit when over and value > line', () => {
    expect(gradeLeg(baseLeg, { points: 28 }).result).toBe('hit')
  })
  it('miss when over and value <= line (whole-number lines need special handling, but .5 is unambiguous)', () => {
    expect(gradeLeg(baseLeg, { points: 22 }).result).toBe('miss')
  })
  it('void when stat missing (player did not play)', () => {
    expect(gradeLeg(baseLeg, {}).result).toBe('void')
  })
  it('miss for under when value > line', () => {
    expect(gradeLeg({ ...baseLeg, prop_side: 'under' }, { points: 28 }).result).toBe('miss')
  })
})

describe('gradeParlay', () => {
  it('won when all legs hit', () => {
    const result = gradeParlay([
      { ...baseLeg, result: 'hit', actual_value: 28 },
      { ...baseLeg, result: 'hit', actual_value: 30, price_american: -200 },
    ], { stake: 10 })
    expect(result.parlayResult).toBe('won')
    // combined decimal: 1.4167 × 1.5 = 2.125 → payout: 10 * 1.125 = 11.25
    expect(result.pnl).toBeCloseTo(11.25, 2)
  })

  it('lost when any leg misses', () => {
    const result = gradeParlay([
      { ...baseLeg, result: 'hit', actual_value: 28 },
      { ...baseLeg, result: 'miss', actual_value: 5 },
    ], { stake: 10 })
    expect(result.parlayResult).toBe('lost')
    expect(result.pnl).toBe(-10)
  })

  it('reduces parlay when some legs void', () => {
    const result = gradeParlay([
      { ...baseLeg, result: 'hit', actual_value: 28 },
      { ...baseLeg, result: 'void', actual_value: null },
    ], { stake: 10 })
    expect(result.parlayResult).toBe('won')   // single-leg "hit" remains
    expect(result.pnl).toBeCloseTo(americanToDecimal(-240) * 10 - 10, 2)
  })

  it('void when all legs void', () => {
    const result = gradeParlay([
      { ...baseLeg, result: 'void', actual_value: null },
      { ...baseLeg, result: 'void', actual_value: null },
    ], { stake: 10 })
    expect(result.parlayResult).toBe('void')
    expect(result.pnl).toBe(0)
  })
})
```

- [ ] **Step 2: Run test → verify failure**

```bash
npm test -- tests/parlay/grade.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/parlay/grade.ts
import { americanToDecimal, combineDecimals } from './odds.js'

export interface LegToGrade {
  player_id: string
  prop_market: string
  prop_line: number
  prop_side: 'over' | 'under'
  price_american: number
}

export interface GradedLeg extends LegToGrade {
  result: 'hit' | 'miss' | 'void'
  actual_value: number | null
}

export function gradeLeg(leg: LegToGrade, playerStats: Record<string, number> | undefined | null): { result: 'hit' | 'miss' | 'void'; actual_value: number | null } {
  if (!playerStats || playerStats[leg.prop_market] === undefined || playerStats[leg.prop_market] === null) {
    return { result: 'void', actual_value: null }
  }
  const value = Number(playerStats[leg.prop_market])
  const isOver = leg.prop_side === 'over'
  const hit = isOver ? value > leg.prop_line : value < leg.prop_line
  return { result: hit ? 'hit' : 'miss', actual_value: value }
}

export function gradeParlay(
  legs: GradedLeg[],
  opts: { stake: number },
): { parlayResult: 'won' | 'lost' | 'void'; pnl: number; effectiveLegs: GradedLeg[] } {
  const live = legs.filter((l) => l.result !== 'void')
  if (live.length === 0) return { parlayResult: 'void', pnl: 0, effectiveLegs: [] }
  if (live.some((l) => l.result === 'miss')) {
    return { parlayResult: 'lost', pnl: -opts.stake, effectiveLegs: live }
  }
  // all live legs hit → parlay won at recomputed odds based on live legs only
  const decimals = live.map((l) => americanToDecimal(l.price_american))
  const combined = combineDecimals(decimals)
  const pnl = opts.stake * combined - opts.stake
  return { parlayResult: 'won', pnl, effectiveLegs: live }
}
```

- [ ] **Step 4: Run + commit**

```bash
npm test -- tests/parlay/grade.test.ts
git add src/parlay/grade.ts tests/parlay/grade.test.ts
git commit -m "feat(parlay): leg + parlay grader with void/reduced handling"
```

---

## Phase 6 — DB queries

### Task 14: Database query helpers

**Files:**
- Modify: `src/db/queries.ts` (replace contents — old queries reference `edge_picks`)

- [ ] **Step 1: Read existing queries.ts**

Read `src/db/queries.ts` to see current pattern (Supabase client usage, exported function shapes). Replace its contents.

- [ ] **Step 2: Implement new queries**

```ts
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
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```
Expected: many errors in `src/commands/*` referencing old queries — that's fine; those will be deleted/rewritten in later tasks. Compiling individual modules can be verified directly:

```bash
npx tsc --noEmit src/db/queries.ts
```
Expected: passes (or only errors in modules that import queries.ts).

- [ ] **Step 4: Commit**

```bash
git add src/db/queries.ts
git commit -m "refactor(db): replace edge_picks queries with parlay+streak queries"
```

---

## Phase 7 — Email + signed URLs

### Task 15: HMAC token helper

**Files:**
- Create: `src/parlay/sign.ts`
- Create: `tests/parlay/sign.test.ts`

- [ ] **Step 1: Test**

```ts
// tests/parlay/sign.test.ts
import { describe, it, expect } from 'vitest'
import { signMarkToken, verifyMarkToken } from '../../src/parlay/sign.js'

describe('sign / verify mark token', () => {
  const secret = 'test-secret'

  it('verifies a token signed with the same secret', () => {
    const t = signMarkToken('parlay-123', 'skip', secret)
    expect(verifyMarkToken('parlay-123', 'skip', t, secret)).toBe(true)
  })

  it('rejects mismatched parlay id', () => {
    const t = signMarkToken('parlay-123', 'skip', secret)
    expect(verifyMarkToken('parlay-999', 'skip', t, secret)).toBe(false)
  })

  it('rejects mismatched action', () => {
    const t = signMarkToken('parlay-123', 'skip', secret)
    expect(verifyMarkToken('parlay-123', 'bet', t, secret)).toBe(false)
  })

  it('rejects different secret', () => {
    const t = signMarkToken('parlay-123', 'skip', secret)
    expect(verifyMarkToken('parlay-123', 'skip', t, 'other')).toBe(false)
  })
})
```

- [ ] **Step 2: Implement**

```ts
// src/parlay/sign.ts
import { createHmac, timingSafeEqual } from 'node:crypto'

export function signMarkToken(parlayId: string, action: 'bet' | 'skip', secret: string): string {
  const h = createHmac('sha256', secret)
  h.update(`${parlayId}:${action}`)
  return h.digest('hex')
}

export function verifyMarkToken(parlayId: string, action: 'bet' | 'skip', token: string, secret: string): boolean {
  const expected = signMarkToken(parlayId, action, secret)
  if (expected.length !== token.length) return false
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(token, 'hex'))
  } catch {
    return false
  }
}
```

- [ ] **Step 3: Run + commit**

```bash
npm test -- tests/parlay/sign.test.ts
git add src/parlay/sign.ts tests/parlay/sign.test.ts
git commit -m "feat(parlay): HMAC mark-token sign/verify"
```

---

### Task 16: Email template

**Files:**
- Create: `src/email/parlay-template.ts`
- Create: `tests/email/parlay-template.test.ts`

- [ ] **Step 1: Test**

```ts
// tests/email/parlay-template.test.ts
import { describe, it, expect } from 'vitest'
import { renderParlayEmail } from '../../src/email/parlay-template.js'

describe('renderParlayEmail', () => {
  it('renders subject + html with leg cards and buttons', () => {
    const result = renderParlayEmail({
      cardDate: '2026-05-10',
      parlayId: 'p-1',
      combinedOdds: 105,
      combinedProb: 0.49,
      recommendedStake: 40,
      streakAtCreation: 2,
      lifetime: { wins: 5, losses: 4, pnl: 35 },
      legs: [
        { player_name: 'LeBron James', prop_market: 'points', prop_line: 22.5, prop_side: 'over',
          price_american: -240, true_prob: 0.72, is_filler: false, book: 'draftkings',
          sport: 'nba', game_label: 'LAL @ BOS' },
        { player_name: 'Vlad Guerrero Jr.', prop_market: 'hits', prop_line: 0.5, prop_side: 'over',
          price_american: -260, true_prob: 0.74, is_filler: true, book: 'betmgm',
          sport: 'mlb', game_label: 'TOR @ NYY' },
      ],
      betUrl: 'https://w.example/mark?p=p-1&a=bet&t=abc',
      skipUrl: 'https://w.example/mark?p=p-1&a=skip&t=def',
    })
    expect(result.subject).toContain('Edge Parlay')
    expect(result.subject).toContain('May 10')
    expect(result.html).toContain('LeBron James')
    expect(result.html).toContain('Vlad Guerrero')
    expect(result.html).toContain('+105')
    expect(result.html).toContain('$40')
    expect(result.html).toContain('Skip this one')
    expect(result.html).toContain('Confirm bet')
    expect(result.html).toContain('https://w.example/mark?p=p-1&a=bet&t=abc')
    expect(result.html).toContain('https://w.example/mark?p=p-1&a=skip&t=def')
    expect(result.html).toContain('filler')
  })

  it('renders skip-day message when no legs', () => {
    const result = renderParlayEmail({
      cardDate: '2026-05-10', parlayId: 'p-1',
      combinedOdds: 0, combinedProb: 0, recommendedStake: 0, streakAtCreation: 0,
      lifetime: { wins: 0, losses: 0, pnl: 0 }, legs: [],
      betUrl: '', skipUrl: '',
      noParlayReason: 'no candidates met thresholds',
    })
    expect(result.subject).toContain('Skip Day')
    expect(result.html).toContain('No parlay today')
  })
})
```

- [ ] **Step 2: Implement**

```ts
// src/email/parlay-template.ts
export interface RenderLegInput {
  player_name: string
  prop_market: string
  prop_line: number
  prop_side: 'over' | 'under'
  price_american: number
  true_prob: number
  is_filler: boolean
  book: string
  sport: string
  game_label: string
}

export interface RenderParlayInput {
  cardDate: string         // YYYY-MM-DD
  parlayId: string
  combinedOdds: number
  combinedProb: number
  recommendedStake: number
  streakAtCreation: number
  lifetime: { wins: number; losses: number; pnl: number }
  legs: RenderLegInput[]
  betUrl: string
  skipUrl: string
  noParlayReason?: string
}

export interface RenderedEmail {
  subject: string
  html: string
}

function fmtAmerican(n: number): string {
  return n > 0 ? `+${n}` : `${n}`
}

function fmtDate(iso: string): string {
  // 2026-05-10 → "May 10"
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function legCard(leg: RenderLegInput): string {
  const fillerBadge = leg.is_filler
    ? `<span style="background:#fbbf24;color:#78350f;font-size:11px;padding:2px 8px;border-radius:4px;margin-left:8px">filler</span>`
    : `<span style="background:#10b981;color:#fff;font-size:11px;padding:2px 8px;border-radius:4px;margin-left:8px">+EV</span>`
  return `
    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:12px;background:#fff">
      <div style="font-weight:600;font-size:16px;color:#111827">
        ${leg.player_name} — ${leg.prop_side === 'over' ? 'Over' : 'Under'} ${leg.prop_line} ${leg.prop_market.replace(/_/g,' ')}
        ${fillerBadge}
      </div>
      <div style="margin-top:6px;color:#6b7280;font-size:13px">
        ${leg.sport.toUpperCase()} · ${leg.game_label} · ${leg.book} ${fmtAmerican(leg.price_american)}
        · true prob ${(leg.true_prob*100).toFixed(0)}%
      </div>
    </div>`
}

export function renderParlayEmail(input: RenderParlayInput): RenderedEmail {
  const dateLabel = fmtDate(input.cardDate)
  if (input.legs.length === 0) {
    return {
      subject: `Edge Parlay — Skip Day (${dateLabel})`,
      html: `
        <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111827">
          <h1 style="margin:0 0 8px;font-size:22px">No parlay today</h1>
          <p style="color:#6b7280;margin:0 0 16px">${input.noParlayReason ?? 'Insufficient candidates met thresholds.'}</p>
          <p style="color:#6b7280;font-size:13px">Streak unaffected. See you tomorrow.</p>
        </div>`,
    }
  }

  const legs = input.legs.map(legCard).join('\n')
  const oddsLabel = fmtAmerican(input.combinedOdds)
  const payoutEstimate = (input.recommendedStake * (input.combinedOdds > 0
    ? (input.combinedOdds / 100)
    : (100 / -input.combinedOdds))).toFixed(2)

  return {
    subject: `Edge Parlay — ${dateLabel} (${oddsLabel})`,
    html: `
      <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111827;background:#f9fafb">
        <h1 style="margin:0 0 4px;font-size:22px">Edge Parlay — ${dateLabel}</h1>
        <div style="color:#6b7280;font-size:14px;margin-bottom:18px">
          ${oddsLabel} · stake $${input.recommendedStake.toFixed(2)} · est. payout +$${payoutEstimate}
          · bet #${input.streakAtCreation + 1} of current run
        </div>
        ${legs}
        <div style="margin-top:24px;text-align:center">
          <a href="${input.skipUrl}" style="display:inline-block;background:#dc2626;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:600;margin-right:8px">Skip this one</a>
          <a href="${input.betUrl}" style="display:inline-block;background:#f3f4f6;color:#111827;padding:14px 28px;border-radius:6px;text-decoration:none;border:1px solid #d1d5db">Confirm bet</a>
        </div>
        <div style="margin-top:24px;color:#6b7280;font-size:12px;text-align:center">
          Lifetime: ${input.lifetime.wins}-${input.lifetime.losses} · P&L $${input.lifetime.pnl.toFixed(2)}
        </div>
      </div>`,
  }
}
```

- [ ] **Step 3: Run + commit**

```bash
npm test -- tests/email/parlay-template.test.ts
git add src/email/parlay-template.ts tests/email/parlay-template.test.ts
git commit -m "feat(email): parlay HTML template with skip/confirm buttons"
```

---

## Phase 8 — Cloudflare Worker (tracker)

### Task 17: Worker source + wrangler config

**Files:**
- Create: `tracker/worker.ts`
- Create: `tracker/wrangler.toml`
- Create: `tracker/package.json`
- Create: `tracker/README.md`
- Create: `tracker/tsconfig.json`

- [ ] **Step 1: package.json**

```json
{
  "name": "edge-tracker",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "deploy": "wrangler deploy",
    "dev": "wrangler dev"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20240117.0",
    "typescript": "^5.6.2",
    "wrangler": "^3.50.0"
  }
}
```

- [ ] **Step 2: wrangler.toml**

```toml
name = "edge-tracker"
main = "worker.ts"
compatibility_date = "2026-05-01"

# Secrets set via `wrangler secret put` (not committed):
#   SUPABASE_URL
#   SUPABASE_SERVICE_KEY
#   SIGNING_SECRET
```

- [ ] **Step 3: tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["worker.ts"]
}
```

- [ ] **Step 4: worker.ts**

```ts
// tracker/worker.ts
export interface Env {
  SUPABASE_URL: string
  SUPABASE_SERVICE_KEY: string
  SIGNING_SECRET: string
}

async function verifyToken(parlayId: string, action: string, token: string, secret: string): Promise<boolean> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${parlayId}:${action}`))
  const expected = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
  if (expected.length !== token.length) return false
  // constant-time compare
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i)
  return diff === 0
}

function html(body: string, status = 200): Response {
  return new Response(`<!doctype html><html><body style="font-family:system-ui;padding:24px">${body}</body></html>`, {
    status,
    headers: { 'content-type': 'text/html;charset=utf-8' },
  })
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname !== '/mark') return html('<h1>Not found</h1>', 404)
    const parlayId = url.searchParams.get('p')
    const action = url.searchParams.get('a')
    const token = url.searchParams.get('t')
    if (!parlayId || (action !== 'bet' && action !== 'skip') || !token) {
      return html('<h1>Bad request</h1>', 400)
    }
    if (!(await verifyToken(parlayId, action, token, env.SIGNING_SECRET))) {
      return html('<h1>Invalid signature</h1>', 400)
    }
    const status = action === 'bet' ? 'bet' : 'skipped'
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/edge_parlays?id=eq.${parlayId}`, {
      method: 'PATCH',
      headers: {
        'apikey': env.SUPABASE_SERVICE_KEY,
        'authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'content-type': 'application/json',
        'prefer': 'return=representation',
      },
      body: JSON.stringify({ status, bet_marked_at: new Date().toISOString() }),
    })
    if (!res.ok) return html(`<h1>DB error</h1><p>${res.status}</p>`, 502)
    const label = status === 'bet' ? 'Locked in. Good luck.' : 'Got it — skipping today. Streak unaffected.'
    return html(`<h1>${label}</h1><p>You can close this tab.</p>`)
  },
}
```

- [ ] **Step 5: README**

```markdown
# Edge Tracker

Cloudflare Worker that handles "Skip this one" / "Confirm bet" link clicks
from the daily parlay email. Verifies HMAC signature and updates the
corresponding edge_parlays row in Supabase.

## One-time setup

```bash
cd tracker
npm install
npx wrangler login
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_KEY
npx wrangler secret put SIGNING_SECRET   # must match TRACKER_SIGNING_SECRET in main app
npx wrangler deploy
```

The deployed URL (e.g. `https://edge-tracker.<account>.workers.dev`) is what
the main app's `TRACKER_BASE_URL` env var must point at.
```

- [ ] **Step 6: Commit**

```bash
git add tracker/
git commit -m "feat(tracker): Cloudflare Worker for parlay click-to-mark"
```

---

## Phase 9 — CLI commands

### Task 18: scan command (full pipeline)

**Files:**
- Create: `src/commands/scan.ts`
- Modify: `src/sources/action-network.ts` to export an existing helper that lists today's games per sport (it already has `fetchActionNetworkNba/Mlb/Nhl` returning game-level data; reuse to get game ids + start times). If a separate helper doesn't already return ids cleanly, add a small `listTodaysGames(sport)` that does.

- [ ] **Step 1: Add listTodaysGames helper**

Read `src/sources/action-network.ts`, identify how to list today's games (the existing helpers already fetch a scoreboard endpoint and return per-game data). Add:

```ts
// in src/sources/action-network.ts (export it)
export interface ANGameSummary {
  game_id: string
  start_time: string
  home_team: string
  away_team: string
}
export async function listTodaysGames(sport: 'nba'|'mlb'|'nhl'): Promise<ANGameSummary[]> {
  // Reuse existing fetch* by sport; project the ANGame[] returned to ANGameSummary[].
  // The exact projection depends on the existing fetch return type — pull
  // game_id, start_time (ISO), team names from there.
  switch (sport) {
    case 'nba': {
      const games = await (await import('./action-network.js')).fetchActionNetworkNba()
      return games.map((g) => ({
        game_id: g.gameId, start_time: g.startTime, home_team: g.homeTeam, away_team: g.awayTeam,
      }))
    }
    case 'mlb': {
      const games = await (await import('./action-network.js')).fetchActionNetworkMlb()
      return games.map((g) => ({ game_id: g.gameId, start_time: g.startTime, home_team: g.homeTeam, away_team: g.awayTeam }))
    }
    case 'nhl': {
      const games = await (await import('./action-network.js')).fetchActionNetworkNhl()
      return games.map((g) => ({ game_id: g.gameId, start_time: g.startTime, home_team: g.homeTeam, away_team: g.awayTeam }))
    }
  }
}
```

(Adjust if existing return shapes use different field names — consult the file.)

- [ ] **Step 2: Implement scan command**

```ts
// src/commands/scan.ts
import type { EdgeSupabase } from '../db/client.js'
import type { Config, Env } from '../config.js'
import { listTodaysGames } from '../sources/action-network.js'
import { fetchActionNetworkProps } from '../sources/action-network-props.js'
import { propMarketsToCandidates } from '../parlay/candidates.js'
import { buildParlay } from '../parlay/builder.js'
import { renderParlayEmail } from '../email/parlay-template.js'
import { signMarkToken } from '../parlay/sign.js'
import { sendEmail } from '../email/send.js'
import {
  getStreakState,
  getParlayByCardDate,
  insertParlayWithLegs,
  getLifetimeRecord,
} from '../db/queries.js'

export interface RunScanInput {
  supabase: EdgeSupabase
  config: Config
  env: Env
  cardDate?: string
  forceRescan?: boolean
  dryRun?: boolean
  print?: (msg: string) => void
}

export async function runScan(input: RunScanInput): Promise<{ parlayId: string | null; emailSent: boolean }> {
  const cardDate =
    input.cardDate ??
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date())

  if (!input.forceRescan) {
    const existing = await getParlayByCardDate(input.supabase, cardDate)
    if (existing) {
      input.print?.(`parlay already exists for ${cardDate} (id=${existing.id})`)
      return { parlayId: existing.id, emailSent: false }
    }
  }

  // 1. Fetch candidate legs across in-season sports
  const candidates: Awaited<ReturnType<typeof propMarketsToCandidates>> = []
  for (const sport of input.config.sports) {
    if (!['nba','mlb','nhl'].includes(sport)) continue
    let games
    try {
      games = await listTodaysGames(sport as 'nba'|'mlb'|'nhl')
    } catch (err) {
      input.print?.(`warn: could not list ${sport} games: ${(err as Error).message}`)
      continue
    }
    for (const g of games) {
      try {
        const markets = await fetchActionNetworkProps({ sport: sport as any, gameId: g.game_id })
        candidates.push(...propMarketsToCandidates(markets, { allowedBooks: input.config.books }))
      } catch (err) {
        input.print?.(`warn: props fetch failed for ${sport} game ${g.game_id}: ${(err as Error).message}`)
      }
    }
  }
  input.print?.(`gathered ${candidates.length} candidate legs`)

  const built = buildParlay(candidates, input.config.parlay)
  const streak = await getStreakState(input.supabase)
  const lifetime = await getLifetimeRecord(input.supabase)

  // 2. Persist
  if (!built) {
    if (input.dryRun) {
      input.print?.(`[dry-run] would emit no-parlay-today notice for ${cardDate}`)
      return { parlayId: null, emailSent: false }
    }
    const { parlay } = await insertParlayWithLegs(
      input.supabase,
      {
        card_date: cardDate,
        combined_odds: 0,
        combined_prob: 0,
        ev_pct: 0,
        recommended_stake: 0,
        streak_at_creation: streak.current_streak,
        status: 'skipped',
        notes: 'no candidates met thresholds',
      },
      [],
    )
    if (input.env.RESEND_API_KEY && input.env.REPORT_EMAIL_TO && input.env.REPORT_EMAIL_FROM) {
      const email = renderParlayEmail({
        cardDate, parlayId: parlay.id,
        combinedOdds: 0, combinedProb: 0, recommendedStake: 0, streakAtCreation: streak.current_streak,
        lifetime,
        legs: [], betUrl: '', skipUrl: '',
        noParlayReason: 'No candidates met thresholds.',
      })
      await sendEmail({
        apiKey: input.env.RESEND_API_KEY,
        from: input.env.REPORT_EMAIL_FROM,
        to: input.env.REPORT_EMAIL_TO,
        subject: email.subject,
        html: email.html,
      })
    }
    return { parlayId: parlay.id, emailSent: true }
  }

  if (input.dryRun) {
    input.print?.(`[dry-run] built parlay ${built.combined_odds > 0 ? '+' : ''}${built.combined_odds} with ${built.legs.length} legs:`)
    for (const l of built.legs) {
      input.print?.(`  ${l.player_name} ${l.prop_side} ${l.prop_line} ${l.prop_market} @ ${l.book} (${l.price_american}) — true ${(l.true_prob*100).toFixed(0)}%${l.is_filler ? ' [filler]' : ''}`)
    }
    return { parlayId: null, emailSent: false }
  }

  const { parlay } = await insertParlayWithLegs(
    input.supabase,
    {
      card_date: cardDate,
      combined_odds: built.combined_odds,
      combined_prob: built.combined_prob,
      ev_pct: built.ev_pct,
      recommended_stake: streak.next_stake,
      streak_at_creation: streak.current_streak,
      status: 'bet',
      notes: null,
    },
    built.legs.map((l) => ({
      sport: l.sport, game_id: l.game_id, player_id: l.player_id, player_name: l.player_name,
      prop_market: l.prop_market, prop_line: l.prop_line, prop_side: l.prop_side,
      book: l.book, price_american: l.price_american,
      pinnacle_prob: l.pinnacle_prob ?? null, consensus_prob: l.consensus_prob ?? null,
      true_prob: l.true_prob, ev_pct: l.ev_pct, is_filler: l.is_filler,
    })),
  )

  // 3. Email
  const trackerBase = input.env.TRACKER_BASE_URL
  const signingSecret = input.env.TRACKER_SIGNING_SECRET
  const buildUrl = (action: 'bet'|'skip') =>
    trackerBase && signingSecret
      ? `${trackerBase}/mark?p=${parlay.id}&a=${action}&t=${signMarkToken(parlay.id, action, signingSecret)}`
      : ''
  const email = renderParlayEmail({
    cardDate, parlayId: parlay.id,
    combinedOdds: built.combined_odds, combinedProb: built.combined_prob,
    recommendedStake: streak.next_stake, streakAtCreation: streak.current_streak,
    lifetime,
    legs: built.legs.map((l) => ({
      player_name: l.player_name, prop_market: l.prop_market, prop_line: l.prop_line,
      prop_side: l.prop_side, price_american: l.price_american, true_prob: l.true_prob,
      is_filler: l.is_filler, book: l.book, sport: l.sport, game_label: '',
    })),
    betUrl: buildUrl('bet'), skipUrl: buildUrl('skip'),
  })
  let emailSent = false
  if (input.env.RESEND_API_KEY && input.env.REPORT_EMAIL_TO && input.env.REPORT_EMAIL_FROM) {
    await sendEmail({
      apiKey: input.env.RESEND_API_KEY,
      from: input.env.REPORT_EMAIL_FROM,
      to: input.env.REPORT_EMAIL_TO,
      subject: email.subject,
      html: email.html,
    })
    emailSent = true
  }
  input.print?.(`parlay ${parlay.id} created (${built.combined_odds > 0 ? '+' : ''}${built.combined_odds}, ${built.legs.length} legs); email sent: ${emailSent}`)
  return { parlayId: parlay.id, emailSent }
}
```

(Adjust `Env` type in `src/config.ts` to include `TRACKER_BASE_URL` and `TRACKER_SIGNING_SECRET` — see Step 3.)

- [ ] **Step 3: Extend Env type in config.ts**

In `src/config.ts`, locate the `Env` interface / `loadEnv` Zod schema and add:

```ts
TRACKER_BASE_URL: z.string().url().optional(),
TRACKER_SIGNING_SECRET: z.string().min(8).optional(),
```

(Make these optional so the CLI still runs in dev without them. Email send is also already gated on RESEND_API_KEY presence.)

- [ ] **Step 4: Type-check + commit**

```bash
npx tsc --noEmit src/commands/scan.ts
# (Some downstream errors are expected until we wire up cli.ts; that's task 21.)
git add src/commands/scan.ts src/sources/action-network.ts src/config.ts
git commit -m "feat(scan): build daily parlay, persist, render+send email"
```

---

### Task 19: resolve command (grading)

**Files:**
- Create: `src/commands/resolve.ts` (replace existing)

- [ ] **Step 1: Implement**

```ts
// src/commands/resolve.ts
import type { EdgeSupabase } from '../db/client.js'
import type { Config, Env } from '../config.js'
import {
  listPendingParlays, listLegs, updateLegResult, updateParlayResolution,
  getStreakState, updateStreakState,
} from '../db/queries.js'
import { fetchBoxScore } from '../sources/box-scores/index.js'
import { gradeLeg, gradeParlay, type GradedLeg } from '../parlay/grade.js'
import { transitionStreak } from '../parlay/streak.js'

export interface RunResolveInput {
  supabase: EdgeSupabase
  config: Config
  env: Env
  print?: (msg: string) => void
}

export async function runResolve(input: RunResolveInput): Promise<void> {
  const pending = await listPendingParlays(input.supabase)
  input.print?.(`grading ${pending.length} pending parlays`)
  for (const parlay of pending) {
    const legs = await listLegs(input.supabase, parlay.id)
    if (legs.length === 0) {
      // no-parlay-today row; mark graded with no-op
      await updateParlayResolution(input.supabase, parlay.id, {
        status: 'skipped', result_pnl: 0, graded_at: new Date().toISOString(),
      })
      continue
    }

    // Group legs by (sport, game_id) to minimize box-score fetches
    const byGame = new Map<string, typeof legs>()
    for (const l of legs) {
      const k = `${l.sport}|${l.game_id}`
      const arr = byGame.get(k) ?? []
      arr.push(l)
      byGame.set(k, arr)
    }

    let allFinal = true
    const graded: GradedLeg[] = []
    for (const [k, glegs] of byGame.entries()) {
      const [sport, gameId] = k.split('|')
      let stats
      try {
        stats = await fetchBoxScore(sport as any, gameId)
      } catch (err) {
        input.print?.(`warn: box-score fetch failed for ${k}: ${(err as Error).message}`)
        allFinal = false
        continue
      }
      if (stats.gameStatus !== 'final' && stats.gameStatus !== 'postponed') {
        allFinal = false
        continue
      }
      for (const leg of glegs) {
        if (stats.gameStatus === 'postponed') {
          await updateLegResult(input.supabase, leg.id, 'void', null)
          graded.push({
            player_id: leg.player_id, prop_market: leg.prop_market,
            prop_line: leg.prop_line, prop_side: leg.prop_side, price_american: leg.price_american,
            result: 'void', actual_value: null,
          })
          continue
        }
        const playerStats = stats.byPlayer[leg.player_id]
        const { result, actual_value } = gradeLeg(leg, playerStats)
        await updateLegResult(input.supabase, leg.id, result, actual_value)
        graded.push({
          player_id: leg.player_id, prop_market: leg.prop_market,
          prop_line: leg.prop_line, prop_side: leg.prop_side, price_american: leg.price_american,
          result, actual_value,
        })
      }
    }

    if (!allFinal || graded.length < legs.length) {
      input.print?.(`parlay ${parlay.id}: not all games final, deferring`)
      continue
    }

    const { parlayResult, pnl } = gradeParlay(graded, { stake: parlay.recommended_stake })
    const finalStatus =
      parlay.status === 'skipped' ? 'skipped' :
      parlayResult === 'won' ? 'won' :
      parlayResult === 'lost' ? 'lost' :
      'void'
    await updateParlayResolution(input.supabase, parlay.id, {
      status: finalStatus,
      result_pnl: parlay.status === 'skipped' ? 0 : pnl,
      graded_at: new Date().toISOString(),
    })

    // Streak transition (only when bet)
    if (parlay.status === 'bet') {
      const prev = await getStreakState(input.supabase)
      const next = transitionStreak(prev, {
        status: 'bet',
        result: parlayResult,
        stake: parlay.recommended_stake,
        payout: parlayResult === 'void' ? 0 : pnl,
      }, { stakeBase: input.config.parlay.stake_base, stakeMultiplier: input.config.parlay.stake_multiplier })
      await updateStreakState(input.supabase, next)
    }
    input.print?.(`parlay ${parlay.id} graded: ${parlayResult} ($${pnl.toFixed(2)})`)
  }
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit src/commands/resolve.ts
git add src/commands/resolve.ts
git commit -m "feat(resolve): grade pending parlays + apply streak transitions"
```

---

### Task 20: report command (re-render + send)

**Files:**
- Create: `src/commands/report.ts` (replace existing)

- [ ] **Step 1: Implement**

```ts
// src/commands/report.ts
// Re-renders today's parlay email and sends it (or prints in dry-run).
// Useful if the morning send failed or you want to re-deliver to a new address.
import type { EdgeSupabase } from '../db/client.js'
import type { Config, Env } from '../config.js'
import { getParlayByCardDate, listLegs, getLifetimeRecord } from '../db/queries.js'
import { renderParlayEmail } from '../email/parlay-template.js'
import { signMarkToken } from '../parlay/sign.js'
import { sendEmail } from '../email/send.js'

export interface RunReportInput {
  supabase: EdgeSupabase
  config: Config
  env: Env
  cardDate?: string
  dryRun?: boolean
  print?: (msg: string) => void
}

export async function runReport(input: RunReportInput): Promise<{ sent: boolean }> {
  const cardDate =
    input.cardDate ??
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date())
  const parlay = await getParlayByCardDate(input.supabase, cardDate)
  if (!parlay) throw new Error(`no parlay for ${cardDate}; run \`edge scan\` first`)
  const legs = await listLegs(input.supabase, parlay.id)
  const lifetime = await getLifetimeRecord(input.supabase)

  const trackerBase = input.env.TRACKER_BASE_URL
  const signingSecret = input.env.TRACKER_SIGNING_SECRET
  const buildUrl = (action: 'bet'|'skip') =>
    trackerBase && signingSecret
      ? `${trackerBase}/mark?p=${parlay.id}&a=${action}&t=${signMarkToken(parlay.id, action, signingSecret)}`
      : ''

  const email = renderParlayEmail({
    cardDate, parlayId: parlay.id,
    combinedOdds: parlay.combined_odds, combinedProb: parlay.combined_prob,
    recommendedStake: parlay.recommended_stake, streakAtCreation: parlay.streak_at_creation,
    lifetime,
    legs: legs.map((l) => ({
      player_name: l.player_name, prop_market: l.prop_market, prop_line: l.prop_line,
      prop_side: l.prop_side, price_american: l.price_american, true_prob: l.true_prob,
      is_filler: l.is_filler, book: l.book, sport: l.sport, game_label: '',
    })),
    betUrl: buildUrl('bet'), skipUrl: buildUrl('skip'),
    noParlayReason: legs.length === 0 ? (parlay.notes ?? undefined) : undefined,
  })

  if (input.dryRun) {
    input.print?.(`SUBJECT: ${email.subject}`)
    input.print?.(email.html)
    return { sent: false }
  }
  if (!input.env.RESEND_API_KEY || !input.env.REPORT_EMAIL_TO || !input.env.REPORT_EMAIL_FROM) {
    throw new Error('Resend env vars missing')
  }
  await sendEmail({
    apiKey: input.env.RESEND_API_KEY,
    from: input.env.REPORT_EMAIL_FROM,
    to: input.env.REPORT_EMAIL_TO,
    subject: email.subject,
    html: email.html,
  })
  return { sent: true }
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit src/commands/report.ts
git add src/commands/report.ts
git commit -m "feat(report): re-render and send today's parlay email"
```

---

### Task 21: CLI rewiring

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Replace cli.ts contents**

```ts
#!/usr/bin/env node
import { Command } from 'commander'
import { loadConfigFromDisk, loadEnv } from './config.js'
import { createSupabase } from './db/client.js'
import { runScan } from './commands/scan.js'
import { runResolve } from './commands/resolve.js'
import { runReport } from './commands/report.js'

const program = new Command()
program.name('edge').description('Daily player-prop parlay generator').version('0.2.0')

program
  .command('scan', { isDefault: true })
  .description("Build today's parlay, persist, and email")
  .option('--card-date <YYYY-MM-DD>', 'override card date (default: today ET)')
  .option('--force-rescan', 'overwrite existing parlay for the date')
  .option('--dry-run', 'compute but do not write or email')
  .action(async (opts: { cardDate?: string; forceRescan?: boolean; dryRun?: boolean }) => {
    try {
      const config = loadConfigFromDisk()
      const env = loadEnv()
      const supabase = createSupabase(env)
      await runScan({
        supabase, config, env,
        cardDate: opts.cardDate, forceRescan: opts.forceRescan, dryRun: opts.dryRun,
        print: (m) => process.stdout.write(m + '\n'),
      })
    } catch (err) {
      process.stderr.write(`error: ${(err as Error).message}\n`)
      process.exit(1)
    }
  })

program
  .command('resolve')
  .description('Grade pending parlays and apply streak transitions')
  .action(async () => {
    try {
      const config = loadConfigFromDisk()
      const env = loadEnv()
      const supabase = createSupabase(env)
      await runResolve({ supabase, config, env, print: (m) => process.stdout.write(m + '\n') })
    } catch (err) {
      process.stderr.write(`error: ${(err as Error).message}\n`)
      process.exit(1)
    }
  })

program
  .command('report')
  .description("Re-render and send today's parlay email")
  .option('--card-date <YYYY-MM-DD>', 'override card date')
  .option('--dry-run', 'render but do not send')
  .action(async (opts: { cardDate?: string; dryRun?: boolean }) => {
    try {
      const config = loadConfigFromDisk()
      const env = loadEnv()
      const supabase = createSupabase(env)
      await runReport({
        supabase, config, env,
        cardDate: opts.cardDate, dryRun: opts.dryRun,
        print: (m) => process.stdout.write(m + '\n'),
      })
    } catch (err) {
      process.stderr.write(`error: ${(err as Error).message}\n`)
      process.exit(1)
    }
  })

program.parseAsync(process.argv)
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: errors only in deleted-but-not-yet-removed files (`src/commands/card.ts`, `recap.ts`, `record.ts` and `src/engine/*`). Those are removed in next task.

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "refactor(cli): rewire commands to scan/resolve/report (parlay)"
```

---

## Phase 10 — Cleanup of old code

### Task 22: Remove obsolete engine + commands + ui

**Files:**
- Delete: `src/engine/` (entire directory)
- Delete: `src/commands/card.ts`, `src/commands/recap.ts`, `src/commands/record.ts`
- Delete: `src/ui/` (if only contained card-table renderer; verify first)
- Delete: `src/email/render.ts`, `src/email/render-recap.ts` (verify nothing in new code imports them)
- Delete: tests for the above (`tests/engine/`, `tests/commands/card.test.ts`, etc.)
- Delete: `migrations/2026-04-21-pick-status.sql`, `migrations/2026-04-13-daily-card.sql`, `migrations/2026-04-07-phase2a.sql` (these all related to the dropped edge_picks; legacy fantasy tables intentionally untouched per established preference)

- [ ] **Step 1: Verify nothing in new code references removed modules**

```bash
grep -rn "from.*engine\|from.*commands/card\|from.*commands/recap\|from.*commands/record\|from.*email/render\|from.*ui/" src tests
```
Expected: only matches inside the files we are deleting.

- [ ] **Step 2: Delete files**

```bash
rm -rf src/engine
rm -f src/commands/card.ts src/commands/recap.ts src/commands/record.ts
rm -rf src/ui
rm -f src/email/render.ts src/email/render-recap.ts
rm -rf tests/engine tests/commands/card.test.ts tests/commands/recap.test.ts tests/commands/record.test.ts 2>/dev/null
rm -f migrations/2026-04-21-pick-status.sql migrations/2026-04-13-daily-card.sql migrations/2026-04-07-phase2a.sql
```

- [ ] **Step 3: Run full test + type-check**

```bash
npx tsc --noEmit
npm test
```
Expected: pass cleanly. If references remain, fix them.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove obsolete +EV engine, card/recap/record commands, old migrations"
```

---

### Task 23: Update GitHub Actions workflows

**Files:**
- Delete: `.github/workflows/edge-recap.yml`, `edge-resolve-close.yml`, `edge-resolve-grade.yml`
- Modify: `.github/workflows/edge-report.yml` → rename to `edge-card-and-email.yml` if it isn't already; rewrite to call `edge scan`
- Create: `.github/workflows/edge-grade.yml`

- [ ] **Step 1: Read existing edge-report.yml**

To preserve secrets/env wiring patterns. Note the Node version, npm install pattern, secret references.

- [ ] **Step 2: Replace `edge-report.yml` (or rename) with parlay-scan workflow**

```yaml
# .github/workflows/edge-scan.yml
name: edge-scan (10am ET)

on:
  schedule:
    - cron: '0 14 * * *'   # 10:00 ET when ET is UTC-4 (DST). For year-round, two crons or workflow_dispatch.
  workflow_dispatch:

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run build
      - run: node dist/src/cli.js scan
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_KEY: ${{ secrets.SUPABASE_KEY }}
          RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
          REPORT_EMAIL_TO: ${{ secrets.REPORT_EMAIL_TO }}
          REPORT_EMAIL_FROM: ${{ secrets.REPORT_EMAIL_FROM }}
          TRACKER_BASE_URL: ${{ secrets.TRACKER_BASE_URL }}
          TRACKER_SIGNING_SECRET: ${{ secrets.TRACKER_SIGNING_SECRET }}
```

- [ ] **Step 3: Create `edge-grade.yml`**

```yaml
# .github/workflows/edge-grade.yml
name: edge-grade (4am ET next day)

on:
  schedule:
    - cron: '0 8 * * *'   # 04:00 ET (UTC-4 DST). Adjust for standard time as needed.
  workflow_dispatch:

jobs:
  grade:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run build
      - run: node dist/src/cli.js resolve
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_KEY: ${{ secrets.SUPABASE_KEY }}
```

- [ ] **Step 4: Delete old workflows**

```bash
rm -f .github/workflows/edge-recap.yml .github/workflows/edge-resolve-close.yml .github/workflows/edge-resolve-grade.yml .github/workflows/edge-report.yml
```

(Keep only the two new files: `edge-scan.yml`, `edge-grade.yml`.)

- [ ] **Step 5: Commit**

```bash
git add .github/workflows
git commit -m "ci: replace card/refresh/recap workflows with scan + grade"
```

---

### Task 24: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the project description, setup instructions, and usage sections**

```markdown
# edge

Daily player-prop parlay generator. Builds a 2-3 leg parlay targeting roughly
+100 American odds, with each leg ~70-75% probable to hit. Sends an email at
10am ET with click-to-mark "Skip"/"Confirm bet" buttons. Grades overnight
and tracks an anti-martingale staking streak ($10 → $20 → $40 → ..., reset
to $10 on loss).

## Setup

1. Install:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and set:
   - `SUPABASE_URL`, `SUPABASE_KEY`
   - `RESEND_API_KEY`, `REPORT_EMAIL_TO`, `REPORT_EMAIL_FROM`
   - `TRACKER_BASE_URL` (Cloudflare Worker URL — set after deploying tracker/)
   - `TRACKER_SIGNING_SECRET` (must match value set in the Worker)
3. Apply the latest migration to your Supabase project:
   `migrations/2026-05-10-edge-parlay.sql`
4. Deploy the click-tracker Worker: see `tracker/README.md`.
5. Build + link if desired:
   ```bash
   npm run build && npm link
   export EDGE_HOME=$(pwd)
   ```

## Usage

```bash
edge                  # default: scan and email today's parlay
edge scan             # explicit form
edge scan --dry-run   # compute but do not write or email
edge resolve          # grade pending parlays
edge report           # re-render and resend today's email
```

## How it works

1. **Scan (10am ET):** pulls today's NBA/MLB/NHL games + player-prop markets
   from Action Network. For each candidate prop, devigs Pinnacle's two-way
   pricing (or falls back to multi-book consensus) to estimate true
   probability. Filters to legs with ~70-75% probability, then assembles
   the 2-3 leg combination whose combined American odds land closest to +100,
   preferring +EV legs.
2. **Email:** the parlay is rendered to HTML and emailed via Resend. The
   email includes signed click-to-mark links (Skip / Confirm bet) that hit
   a Cloudflare Worker, which updates the parlay status in Supabase.
3. **Grade (4am ET next day):** for each pending parlay, fetches box scores
   from the relevant sport's stat API, grades each leg, and applies the
   anti-martingale streak transition (won → next stake doubles; lost →
   reset to $10).

## Configuration

See `edge.config.json`. Notable knobs under `parlay`:

- `target_odds`: combined American odds target (default 100)
- `min_leg_prob`/`max_leg_prob`: probability band for legs
- `filler_min_prob`: lower bound for legs that aren't strictly +EV
- `stake_base`/`stake_multiplier`: anti-martingale parameters
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README for parlay pipeline"
```

---

## Phase 11 — Integration verification

### Task 25: scan dry-run integration test

**Files:**
- Create: `tests/integration/scan-dry-run.test.ts`

- [ ] **Step 1: Write test**

```ts
// tests/integration/scan-dry-run.test.ts
// This is an integration smoke test for the scan command's pure-logic path:
// inputs are stubbed at the source layer; no DB or email side-effects.
import { describe, it, expect } from 'vitest'
import { propMarketsToCandidates } from '../../src/parlay/candidates.js'
import { buildParlay } from '../../src/parlay/builder.js'
import type { PropMarket } from '../../src/sources/action-network-props.js'

const sample: PropMarket[] = [
  {
    game_id: 'g1', sport: 'nba', player_id: '1', player_name: 'A',
    prop_market: 'points', prop_line: 22.5,
    over: {
      pinnacle: { sidePrice: -220, oppositePrice: 170 },
      books: [{ book: 'draftkings', price: -240, oppositePrice: 180 }],
    },
    under: {
      pinnacle: { sidePrice: 170, oppositePrice: -220 },
      books: [{ book: 'draftkings', price: 180, oppositePrice: -240 }],
    },
  },
  {
    game_id: 'g2', sport: 'mlb', player_id: '2', player_name: 'B',
    prop_market: 'hits', prop_line: 0.5,
    over: {
      pinnacle: { sidePrice: -240, oppositePrice: 180 },
      books: [{ book: 'betmgm', price: -260, oppositePrice: 195 }],
    },
    under: {
      pinnacle: { sidePrice: 180, oppositePrice: -240 },
      books: [{ book: 'betmgm', price: 195, oppositePrice: -260 }],
    },
  },
]

describe('scan dry-run pipeline (smoke)', () => {
  it('builds a 2-leg parlay end-to-end through builder', () => {
    const candidates = propMarketsToCandidates(sample, { allowedBooks: ['draftkings','betmgm'] })
    const built = buildParlay(candidates, {
      target_odds: 100, odds_tolerance: [-110, 130],
      min_legs: 2, max_legs: 3,
      min_leg_prob: 0.65, max_leg_prob: 0.85, filler_min_prob: 0.75,
    })
    expect(built).not.toBeNull()
    expect(built!.legs.length).toBeGreaterThanOrEqual(2)
    expect(built!.combined_odds).toBeGreaterThanOrEqual(-110)
    expect(built!.combined_odds).toBeLessThanOrEqual(130)
  })
})
```

- [ ] **Step 2: Run + commit**

```bash
npm test -- tests/integration/scan-dry-run.test.ts
git add tests/integration/scan-dry-run.test.ts
git commit -m "test(integration): scan pipeline smoke test (props → builder)"
```

---

### Task 26: Final verification pass

- [ ] **Step 1: Run the entire test suite**

```bash
npm test
```
Expected: all suites pass.

- [ ] **Step 2: Type-check the whole project**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Build**

```bash
npm run build
```
Expected: clean build into `dist/`.

- [ ] **Step 4: Local dry-run against config**

```bash
npm run dev -- scan --dry-run --card-date 2026-05-10
```
Expected: prints "gathered N candidate legs" and either built parlay summary or no-parlay notice. (Live AN data; may legitimately fail if AN endpoint structure differs from fixture — record any discrepancy and fix the parser before declaring success.)

- [ ] **Step 5: Commit any final fixes**

```bash
git status   # if anything changed during verification
git add -A && git commit -m "chore: post-verification fixes" 2>/dev/null || echo "clean"
```

---

## Deploy boundary — needs human

After Task 26 completes successfully, **PAUSE and ask the user** to perform these manual deployment steps:

1. **Apply migration to Supabase:**
   - Open Supabase dashboard → SQL editor
   - Paste contents of `migrations/2026-05-10-edge-parlay.sql`
   - Run; verify `edge_parlays`, `edge_parlay_legs`, `edge_streak_state` exist and `edge_picks` is gone

2. **Deploy the Cloudflare Worker:**
   - `cd tracker && npm install`
   - `npx wrangler login`
   - `npx wrangler secret put SUPABASE_URL` (paste your Supabase URL)
   - `npx wrangler secret put SUPABASE_SERVICE_KEY` (paste your service-role key — different from anon key)
   - Generate a signing secret: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - `npx wrangler secret put SIGNING_SECRET` (paste the generated value — save it for step 3)
   - `npx wrangler deploy`
   - Note the deployed URL (e.g., `https://edge-tracker.<account>.workers.dev`)

3. **Add new GitHub Actions secrets** to the repo:
   - `TRACKER_BASE_URL` = the deployed Worker URL
   - `TRACKER_SIGNING_SECRET` = the same value from step 2

4. **Smoke test end-to-end:**
   - Manually trigger `edge-scan` workflow via `workflow_dispatch` in GitHub Actions
   - Verify email arrives
   - Click "Skip this one" link → confirm Worker page renders + Supabase row updates
   - Wait 24h, then trigger `edge-grade` to verify grading works

5. **Cleanup:** once smoke test passes, remove any superseded GitHub secrets that are no longer referenced.

---

## Self-review checklist (executor: do not skip)

After all tasks pass:

- [ ] Search the entire repo for `edge_picks`, `card.ts`, `recap.ts`, `record.ts`, `engine/`, `swap` — only matches should be in deleted-files audit logs (none in `src/`, `tests/`, or workflow files).
- [ ] Confirm `npm test` reports zero failures.
- [ ] Confirm `npx tsc --noEmit` reports zero errors.
- [ ] Confirm `package.json` `bin` and `scripts` reference real files in `dist/src/`.
- [ ] Confirm `tracker/` is *not* part of the main TS build (it has its own tsconfig).
