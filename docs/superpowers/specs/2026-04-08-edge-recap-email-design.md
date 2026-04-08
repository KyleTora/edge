# Edge recap email — design

**Status:** Draft
**Date:** 2026-04-08
**Owner:** Kyle

## Goal

Send a daily email recap of betting performance: a list of picks settled in the last 24 hours plus rolling 7d / 30d / all-time totals. Delivered to the same inbox as the existing picks email.

## Non-goals

- Real-time alerts on individual pick outcomes.
- Bankroll management, Kelly sizing, or stake recommendations.
- Per-sport breakdown for the 30d and all-time windows (only 7d gets a breakdown — see Q4 in Decisions).
- Persisting "last recap sent at" state to bridge missed sends. The cutoff is a fixed 24h window. See Known limitations.

## Decisions

| Q | Decision |
|---|---|
| Q1 — Windows | Three rolling windows: **7d / 30d / all-time** |
| Q2 — Trigger | **Standalone workflow** `edge-recap.yml`, daily cron at 09:30 UTC (30 min buffer after `edge-resolve-grade.yml` at 09:00 UTC) |
| Q3 — Recipient | Reuse existing picks-email secrets (`REPORT_EMAIL_TO`, `REPORT_EMAIL_FROM`, `RESEND_API_KEY`) |
| Q4 — Density | Headline 3-column table + per-sport breakdown for the **7d window only** |
| Q5 — Empty days | If no picks settled in last 24h, **skip the send entirely** (clean exit 0) |
| Q6 — "Settled" definition | By **`graded_at`** (graded in last 24h), not by `game_date` — avoids silent loss when a postponed game is graded days later |
| Q7 — Pick-level detail | **Yes** — list each settled pick (sport, matchup, side, price, result, units) |

## Architecture

The feature is mostly an integration of existing pieces. The aggregation engine, the email sender, and the data shape all already exist.

### New files

- `src/commands/recap.ts` — orchestrator, parallel to `report.ts` / `record.ts`
- `src/email/render-recap.ts` — HTML renderer
- `.github/workflows/edge-recap.yml` — daily cron at 09:30 UTC
- `tests/commands/recap.test.ts`
- `tests/email/render-recap.test.ts`

### New code in existing files

**`src/db/queries.ts`** — add:

```ts
export async function getPicksGradedSince(
  supabase: EdgeSupabase,
  sinceIso: string
): Promise<GradedPickRow[]>
```

Implementation pattern: query `edge_pick_grades` where `graded_at >= sinceIso`, then fetch matching `edge_picks` rows by id, join in memory. Same anti-join pattern as `listPicksAwaitingGrade` and `getPicksWithGradesInRange`.

Orphan grades (grade row exists but pick row was deleted) are skipped, not errored.

**`src/email/send.ts`** — make CSV attachment optional:

```ts
export interface SendEmailInput {
  apiKey: string
  from: string
  to: string
  subject: string
  html: string
  csvFilename?: string   // now optional
  csvContent?: string    // now optional
}
```

When both are absent, the `attachments` array is omitted from the Resend payload. Picks email keeps its CSV unchanged (regression test guards this).

**`src/cli.ts`** — register new subcommand:

```ts
program
  .command('recap')
  .description('Send a recap email of recently settled picks and rolling totals')
  .action(async () => { /* loadEnv → createSupabase → runRecap */ })
```

### Reused, untouched

- `aggregateMetrics()` from `src/record/aggregate.ts` — called three times, once per window
- `getPicksWithGradesInRange()` for 7d / 30d / all-time slices
- `getClosingLinesForPicks()` for CLV
- `sendReportEmail()` for delivery (after the optional-CSV tweak)
- `unitProfit()` from `src/record/grading-math.ts` for per-row pick units

## Data flow

```
runRecap({ supabase, env, now })
  │
  ├─ 1. cutoff = now - 24h
  │    newlySettled = getPicksGradedSince(supabase, cutoff)
  │
  ├─ 2. EARLY EXIT: if newlySettled.length === 0
  │      log "recap: no picks settled in last 24h, skipping email"
  │      return { sent: false, reason: 'no settled picks' }
  │
  ├─ 3. today = now.toISOString().slice(0, 10)
  │    pick7d   = getPicksWithGradesInRange(today-7,  today)
  │    pick30d  = getPicksWithGradesInRange(today-30, today)
  │    pickAll  = getPicksWithGradesInRange('2000-01-01', today)
  │
  ├─ 4. Union of pick IDs across {newlySettled, pick7d, pick30d, pickAll}.
  │    closingLines = getClosingLinesForPicks(supabase, [...union])
  │    (one fetch, shared across all aggregator calls)
  │
  ├─ 5. metrics7d  = aggregateMetrics({ picks: pick7d,  closingLines })
  │    metrics30d = aggregateMetrics({ picks: pick30d, closingLines })
  │    metricsAll = aggregateMetrics({ picks: pickAll, closingLines })
  │
  ├─ 6. html = renderRecapHtml({
  │      newlySettled, metrics7d, metrics30d, metricsAll, asOf: now
  │    })
  │
  ├─ 7. subject = `Edge recap — ${N} pick${s} settled, ${signed}u (7d)`
  │    sendReportEmail({ apiKey, from, to, subject, html })  // no CSV
  │
  └─ 8. return { sent: true, settledCount, metrics7d, metrics30d, metricsAll }
```

### Window math

- **7d** = `today - 7` through `today`
- **30d** = `today - 30` through `today`
- **All-time** = `'2000-01-01'` through `today` (sentinel start; no real picks before this)
- "today" is computed as `now.toISOString().slice(0, 10)` — UTC. Consistent with the existing `runResolve` reference-date convention.
- `now` is injected into `runRecap` (defaults to `() => new Date()`), mirroring the `now?: () => Date` parameter on `gradePicks`. Tests pin a fixed clock; production passes nothing.

### Closing-line dedup

The naive implementation would call `getClosingLinesForPicks` four times (once per aggregator call). Picks in the 7d window also appear in 30d and all-time, so we'd refetch the same rows three times.

Instead: compute the union of all pick IDs once, fetch once, pass the same `Map<string, ClosingLineRow>` into all three `aggregateMetrics` calls. The aggregator already accepts a `Map`, so no changes there.

## Email content

Three blocks, top to bottom. Visual style matches `src/email/render.ts` (same inline-CSS table look — no new design system).

### Block 1 — Rolling totals (3-column headline)

| Metric | 7d | 30d | All-time |
|---|---|---|---|
| Picks | `metrics.picks` | | |
| Record (W-L-P) | `${won}-${lost}-${push}` | | |
| Hit rate | `metrics.hitRate` (or `—`) | | |
| Units | `${signed}u` | | |
| ROI | `metrics.roi` (or `—`) | | |
| Avg EV | `metrics.avgEv` (or `—`) | | |
| CLV avg | `metrics.clvAvg` (or `—`) | | |
| CLV beat rate | `metrics.clvBeatRate` (or `—`) | | |

Null values render as em-dash (`—`).

### Block 2 — Settled overnight

A row per pick from `newlySettled`, sorted by `graded_at` descending.

| Sport | Matchup | Pick | Price | Result | Units |
|---|---|---|---|---|---|
| MLB | NYY @ BOS | NYY ML | −145 | ✓ Won | +0.69u |
| NBA | LAL @ DEN | Over 224.5 | −110 | ✗ Lost | −1.00u |
| NHL | TOR @ MTL | TOR −1.5 | +180 | Push | 0.00u |

- **Pick column formatting:**
  - moneyline → `${team} ML`
  - total → `${Over|Under} ${line}`
  - spread → `${team} ${signed line}`
- **Result glyphs:** `✓ Won` / `✗ Lost` / `Push` / `Void`
- **Units:** computed via `unitProfit(outcome, best_price)` — same function the aggregator uses, so the table reconciles to the headline totals.

### Block 3 — Last 7 days by sport

Compact per-sport breakdown from `metrics7d.bySport`. Omitted entirely if `bySport` is empty (don't render an empty table).

| Sport | Picks | W-L-P | Units | ROI | CLV |
|---|---|---|---|---|---|
| MLB | 14 | 8-5-1 | +1.92u | +13.7% | +2.1% |

### Footer

Small grey line:

```
Generated 2026-04-08 09:30 UTC · 4 settled · 612 graded all-time
```

Useful as a heartbeat when debugging "did the cron actually run today".

## Workflow

**`.github/workflows/edge-recap.yml`** — mirrors `edge-resolve-grade.yml` structure:

```yaml
name: edge recap

on:
  schedule:
    - cron: '30 9 * * *'
  workflow_dispatch:

jobs:
  recap:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - name: Run edge recap
        run: npx tsx src/cli.ts recap
        env:
          ODDS_API_KEY: ${{ secrets.ODDS_API_KEY }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
          REPORT_EMAIL_TO: ${{ secrets.REPORT_EMAIL_TO }}
          REPORT_EMAIL_FROM: ${{ secrets.REPORT_EMAIL_FROM }}
          EDGE_HOME: ${{ github.workspace }}
```

**Note on `ODDS_API_KEY`:** The recap command never calls the odds API, but `loadEnv()` currently requires `ODDS_API_KEY` for every CLI invocation (this just bit us on the grade workflow — see commit `f8cddb6`). Passing it defensively here matches the close and grade workflows. A separate task can lazy-validate `ODDS_API_KEY` at the call site instead of in `loadEnv`.

## Error handling

| Failure | Behavior |
|---|---|
| Resend send error | Throw → workflow exits 1, red run. No retry. (Same as `report` today.) |
| Supabase query error in any of the 4 queries | Throw → exit 1. No partial sends. |
| `newlySettled` empty | Clean exit 0, log `"recap: no picks settled in last 24h, skipping email"`, no email sent. |
| Closing lines partially missing | Not an error — `aggregateMetrics` returns `null` CLV fields, renderer shows `—`. |

## Testing

Pattern matches existing tests: vitest + the `tests/helpers/fake-supabase.ts` fake.

### `tests/db/queries.test.ts` — extend

- `getPicksGradedSince` returns picks where `graded_at >= cutoff`
- returns `[]` when no grades match
- skips orphan grade rows (grade exists, pick row missing)

### `tests/email/render-recap.test.ts`

- All three blocks present given populated metrics
- `null` metric values render as `—`
- `bySport` empty → block 3 omitted entirely
- Settled-pick row formatting per market (moneyline / total / spread)
- Per-row units numerically reconcile with `unitProfit()`

### `tests/commands/recap.test.ts`

- Happy path: settled picks present → `sent: true`, all four aggregator inputs computed, `sendReportEmail` called once with expected subject
- Empty path: no settled picks → `sent: false, reason`, `sendReportEmail` NOT called (spy/mock)
- Closing-line union: assert `getClosingLinesForPicks` called exactly once, not four times
- Subject line matches expected format with N and units value

### `tests/email/send.test.ts` — extend (or add)

- Call without `csvFilename`/`csvContent` → no `attachments` array in Resend payload
- Call with both → attachments included as before (regression guard for the picks email)

### Out of scope

No e2e test for recap. The existing e2e suite covers scan/report; recap would be the same shape and isn't worth the duplication.

## Known limitations

1. **Fixed 24h cutoff, no resume cursor.** If a recap email fails or you skip a day, the picks graded during that gap won't be listed individually in any future email. They *will* still appear in the rolling 7d/30d/all-time totals on subsequent runs. Avoiding this would require persisting "last recap sent at" — overkill for v1, can be added later if it becomes a real problem.

2. **UTC date math.** "Today" and "7 days ago" are computed in UTC, not user-local time. Matches existing `runResolve` convention. For an ET-based user, this means the 7d window technically covers ~7 days starting from 19:00 / 20:00 ET on the start day. Acceptable.

3. **`ODDS_API_KEY` defensive pass-through.** The recap command doesn't need the odds API key, but `loadEnv()` requires it eagerly. Passing it in the workflow is a workaround, not a fix. Cleanup tracked separately.
