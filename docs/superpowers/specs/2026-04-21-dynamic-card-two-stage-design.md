# Dynamic Card (Two-Stage) — Design Spec

## Summary

Evolve the static daily-card ranker into a two-stage pipeline. A silent morning scan (MLB-only, 10am ET) captures an initial card. A refresh scan (all sports, 3pm ET) re-ranks across the whole candidate pool, swaps any morning pick that's no longer top-5 *for games that haven't started*, and locks everything else. One email fires at refresh with the final card plus a "what changed" narrative.

## Motivation

Current performance over ~8 days of the static daily-card ranker:

| Metric           | 7d      | 30d     |
| ---------------- | ------- | ------- |
| Picks            | 53      | 59      |
| Record (W-L-P)   | 22-31-0 | 27-32-0 |
| Hit rate         | 41.5%   | 45.8%   |
| ROI              | -13.3%  | -4.4%   |
| Avg EV           | -0.4%   | -0.3%   |
| CLV beat rate    | 25.0%   | 23.5%   |

Sample size is small (53 bets), so ROI variance dominates. But two signals *are* informative:

- **Avg EV ≈ 0** — the ranker forces 5 picks/day with no EV floor. On slow days it logs small-negative plays.
- **CLV beat rate of 25%** (target 55%+) — lines are moving *against* our picks 3 out of 4 times. The primary structural cause is staleness: the card locks at 10am/3pm ET but sharp lines continue to move until game time.

This spec targets the staleness cause. Bringing back an EV floor or tuning the scoring formula are independent changes, out of scope here.

## Decisions (all confirmed during design)

- **Primary cause to fix:** staleness of captured lines relative to closing (user selection).
- **Cadence tier:** two-stage (single extra scan/day). Keeps the project inside the Odds API free tier (~420 credits/month).
- **Lock semantics:** lock at game start; refresh is the last chance to swap unstarted picks. Swapped-off picks are removed from grading/CLV/stats entirely.
- **Email cadence:** one email only, at refresh. Morning scan is silent.
- **Email content:** full card + a short narrative of what changed vs. the morning card.
- **Refresh timing:** 3pm ET (current afternoon slot). Morning scan at 10am ET, silent.

Trade-off explicitly accepted: 3pm refresh is still ~4 hours before 7pm NBA/NHL tips, so late-movement capture for evening sports is only partial. User chose this over the alternatives (drop morning scan / move refresh to 6:30pm) to preserve morning MLB coverage for tracking. This can be revisited later by moving refresh timing without further code change.

## Architecture

```
Morning (10am ET, silent)        Refresh (3pm ET, email)
────────────────────────         ──────────────────────────
fetchActionNetworkMlb()          fetchActionNetworkMlb/Nba/Nhl()
fetchPinnacleMlb()               fetchPinnacleMlb/Nba/Nhl()
      │                                 │
joinSources()                    joinSources()
      │                                 │
rankCandidates()                 rankCandidates()
      │                                 │
      │                          ┌──────┴──────────────┐
      │                          │ load prior-active   │
      │                          │ picks for cardDate  │
      │                          └──────┬──────────────┘
      │                                 │
      │                          resolveSwaps(prior, new, now)
      │                                 │ → keep[], kept_started[], drop[], add[]
      │                                 │
upsert top-N as 'active'         apply status transitions & inserts
      │                                 │
(no email)                       renderEmail(finalCard, swapSummary)
                                        │
                                 sendReportEmail()
```

The only net-new logic is `resolveSwaps()`. All upstream (fetching, joining, scoring) and downstream (grading, CLV, recap) code is reused with a single status-column filter added at the query layer.

## Data model

New column on `edge_picks`:

```sql
ALTER TABLE edge_picks ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE edge_picks ADD CONSTRAINT edge_picks_status_check
  CHECK (status IN ('active', 'swapped_off'));
CREATE INDEX idx_edge_picks_card_date_status ON edge_picks (card_date, status);
```

### Status values

Two values — kept minimal:

| Status        | Meaning                                                               | Live for grading/CLV/stats? |
| ------------- | --------------------------------------------------------------------- | --------------------------- |
| `active`      | On the card. Either the game hasn't started, or it has and the pick was never swapped off — either way, the pick is "live." | Yes |
| `swapped_off` | Was on a prior card; displaced at refresh before game start.          | No                          |

The "lock at game start" semantic is implicit rather than stored: once a game starts, no later process modifies its pick row (the only swap event is the daily 3pm refresh, which runs hours before evening tips and handles early-MLB lock-in in the same pass). Storing a separate `locked` status would be redundant — picks either survived to game time (`active`) or didn't (`swapped_off`).

`swapped_off` rows are retained for audit (enables the "what changed" narrative) but excluded from everything downstream. All existing query helpers add `.neq('status', 'swapped_off')`:

- `listPicksAwaitingGrade`
- `getPicksWithGradesInRange`
- `listPicksAwaitingClose`
- `getPicksGradedSince`
- `listPicksForCardDate`

A `swapped_off` row never receives a grade row or closing-line row because those pipelines don't see it — no cleanup risk.

## Swap resolution

New pure module `src/engine/resolve-swaps.ts`:

```ts
interface SwapResolution {
  keep: PickRow[]          // no status change
  kept_started: PickRow[]  // no status change (game already started, stays on card)
  drop: PickRow[]          // 'active' → 'swapped_off'
  add: Candidate[]         // insert as 'active'
}

function resolveSwaps(
  prior: PickRow[],                // today's card_date rows where status='active'
  ranked: Candidate[],             // fresh rankCandidates() output, sorted by score DESC
  alreadySwappedOffIds: Set<string>, // today's card_date ids where status='swapped_off'
  now: Date,
  targetSize: number               // config.daily_picks
): SwapResolution
```

### Algorithm

1. Partition `prior` into `started` (`game_time <= now`) and `live` (`game_time > now`).
2. `kept_started = started` — these hold their slots unconditionally.
3. Remaining slots: `slotsLeft = targetSize - kept_started.length`.
4. From `ranked`, drop any candidate whose `id` is in `kept_started` (slot claimed) or in `alreadySwappedOffIds` (decided-off for today, no reincarnation). Take the top `slotsLeft` of what remains — call this `targetLive`.
5. `keep = live` filtered to IDs in `targetLive`.
6. `drop = live` filtered to IDs NOT in `targetLive`.
7. `add = targetLive` filtered to IDs not already in `prior`.

### Card size invariant

- `|kept_started| + |keep| + |add| = final card size`
- `|keep| + |drop| = |live| = |prior| - |kept_started|`
- `|keep| + |add| = slotsLeft = targetSize - |kept_started|` (or less, if `ranked` provided fewer usable candidates)
- Therefore `|add| - |drop| = targetSize - |prior|`. When `prior` is already `targetSize`, `|add| = |drop|`.

### Edge cases

- **Fewer candidates than slots:** `add` is just what exists; final card may be < `targetSize`. No error.
- **All prior picks have started:** `kept_started = prior`, `slotsLeft = 0`, no swaps possible.
- **Same pick id surfaces in `ranked` with a lower score but isn't top-N anymore:** it lands in `drop`, not `keep`. The model no longer endorses it.
- **Candidate with id matching an `alreadySwappedOffId`:** skipped in step 4. A pick rejected earlier today cannot rejoin the card. Step 4's slot just goes to the next candidate (or stays unfilled if none).
- **Manual re-run of refresh later the same day:** `prior` reflects post-first-refresh active set; `alreadySwappedOffIds` prevents earlier drops from being re-added. Re-run is a no-op if no new data has changed; otherwise applies the same algorithm to the newer state.

### No hysteresis

A pick is swapped off even by a tiny score delta that drops it from rank 5 to rank 6. Justification: with only one swap decision per day (refresh), there is no thrashing risk. Hysteresis can be added later if real operation shows churn.

## Command layer

`src/commands/card.ts` refactored to accept a mode:

```ts
interface RunCardInput {
  supabase: EdgeSupabase
  config: Config
  env: Env
  mode: 'morning' | 'refresh'
  sports: string[]
  detectedAt?: string
  print?: (msg: string) => void
}

interface RunCardResult {
  picks: PickRow[]           // final live card (status='active'), ordered by score DESC
  swapSummary?: SwapSummary  // only for refresh mode with a prior card
}
```

### Morning mode

1. `cardDate = detectedAt.slice(0, 10)`
2. Fetch for sports in input (typically `['mlb']` at morning run).
3. Run `rankCandidates()` per sport, merge, sort by score DESC.
4. Take top `config.daily_picks`; insert each as `status='active'`, `card_date=cardDate`.
5. Return picks. No email.

If an `active` row already exists for the day (e.g., manual re-run), skip — idempotent.

### Refresh mode

1. `cardDate = detectedAt.slice(0, 10)`.
2. Fetch for sports in input.
3. Run `rankCandidates()` per sport, merge, sort.
4. Load `prior` = all rows where `card_date = cardDate AND status = 'active'`.
5. Load `alreadySwappedOffIds` = ids where `card_date = cardDate AND status = 'swapped_off'`.
6. Call `resolveSwaps(prior, ranked, alreadySwappedOffIds, now, config.daily_picks)`.
7. Apply transitions:
   - For each `p` in `drop`: call `updatePickStatus(p.id, 'swapped_off')`
   - For each `c` in `add`: insert row with `status='active'`, `card_date=cardDate`
   - `keep` and `kept_started` require no DB change
8. Build `swapSummary` (see below). Final card = `kept_started ∪ keep ∪ add`, sorted by score DESC.
9. Return picks and `swapSummary`.

### New DB helper

```ts
async function updatePickStatus(
  supabase: EdgeSupabase,
  id: string,
  status: 'active' | 'swapped_off'
): Promise<void>
```

Issues `UPDATE edge_picks SET status=$1 WHERE id=$2`. Throws on error; does not treat "row not found" as error (shouldn't happen under the refresh flow, but benign if it does).

### Swap summary construction

```ts
interface SwapSummary {
  morningCardSize: number
  added: Array<{ pick: PickRow; reason: string }>
  dropped: Array<{ pick: PickRow; reason: string }>
  startedBeforeRefresh: Array<{ pick: PickRow }>  // morning picks whose games started before 3pm
}
```

No pairing between drops and adds — each has an independent reason. This is simpler, and the semantic is more honest: drops and adds are not 1:1 (a drop means "this fell out of top-N"; an add means "this rose into top-N"), and forcing a pairing overstates a causal link that doesn't always exist.

For each dropped pick, compute `reason` by looking up the same `(sport, game_id, market, side)` in the fresh `ranked` list:

- If present: compare stored `sharp_implied` / `ev_pct` with fresh values. Example: "sharp moved from 58.5% to 61.2% implied (+2.7pp); EV fell from +3.1% to −0.8%."
- If absent (e.g., market no longer available at allowlisted books): "no longer offered at allowlisted books at refresh time."

For each added pick, `reason` explains its current standing: "EV +4.2% at current sharp (40.1% implied); top-5 score."

`startedBeforeRefresh` is informational — these rows aren't changing but the email calls them out so the reader understands why they're on the card without a current EV comparison.

## Email rendering

`src/email/render.ts` gains an optional `swapSummary` input:

```ts
interface RenderEmailInput {
  picks: PickRow[]
  quota: QuotaSnapshot | null
  runLabel: string
  runDate: string
  sportsScanned: string[]
  swapSummary?: SwapSummary
}
```

Rendering rules:

- Main card table: unchanged (all live `active` rows, sorted by score).
- "What changed" section: rendered below the main table if `swapSummary` is present AND `added.length + dropped.length + startedBeforeRefresh.length > 0`.
- Section format: one-line narrative per dropped pick ("DROPPED: ..."), one-line per added pick ("ADDED: ..."), one-line per `startedBeforeRefresh` entry ("Morning pick — game started before refresh, kept on card").
- CSV attachment: unchanged (final picks only; no swap info).
- If `swapSummary` is undefined (morning mode would never render email, but a dry-run or first-ever day might), the section is simply omitted.

Both HTML and plain-text variants of the email render the section.

## CLI

`src/cli.ts` registers `edge card` with a new flag:

```
edge card [--mode=morning|refresh] [--sports=mlb,nba,nhl] [--dry-run]
```

- Default mode: `refresh` (matches most local usage).
- Default sports: all configured in `edge.config.json`.
- `--dry-run`: skip email, skip DB writes; print the card and summary.

Email-sending glue lives in `src/commands/report.ts`, which wraps `runCard({mode: 'refresh'})` and pipes the result into `renderEmail` + `sendReportEmail`. Morning runs call `runCard({mode: 'morning'})` directly and exit after DB writes.

## GitHub Actions workflow

`.github/workflows/edge-report.yml` updated to differentiate the two runs:

```yaml
on:
  schedule:
    - cron: '0 14 * * *'   # 10am ET — morning, MLB-only, silent
    - cron: '0 19 * * *'   # 3pm ET — refresh, all sports, email
  workflow_dispatch:
    inputs:
      mode:
        default: 'refresh'
      sports:
        default: 'mlb,nba,nhl'

jobs:
  card-and-email:
    steps:
      - # checkout, node setup, npm ci
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
      - name: Run card
        run: npm run edge:report -- --mode=${{ steps.params.outputs.mode }} --sports=${{ steps.params.outputs.sports }}
```

The morning job omits email env vars (it never sends), reducing the attack surface for a misconfigured run.

## Quota budget

- Each sport call: 1 region × 2 markets = 2 credits.
- Morning (MLB only): 2 credits.
- Refresh (all sports): 6 credits.
- Daily total: 8 credits, same as current schedule.
- Monthly: ~240 credits, well inside the 500/mo free tier.

This spec does **not** increase quota usage vs. today — it redistributes existing scan work into morning-silent + refresh-with-swap shape.

## Config

`edge.config.json` unchanged. `daily_picks`, `sports`, `books` are all still respected. No new config keys.

## Migration

One SQL migration under `migrations/2026-04-21-pick-status.sql`:

```sql
ALTER TABLE edge_picks ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE edge_picks ADD CONSTRAINT edge_picks_status_check
  CHECK (status IN ('active', 'swapped_off'));
CREATE INDEX IF NOT EXISTS idx_edge_picks_card_date_status
  ON edge_picks (card_date, status);
```

Existing rows default to `status='active'`, which is the live state — pre-existing picks remain fully live for grading, CLV, and recap. No behavior change until the new command code ships.

## File change summary

**New:**
- `src/engine/resolve-swaps.ts`
- `tests/engine/resolve-swaps.test.ts`
- `migrations/2026-04-21-pick-status.sql`

**Modified:**
- `src/db/queries.ts` — `PickRow.status`; all listing queries filter `swapped_off`; new `updatePickStatus()` helper
- `src/commands/card.ts` — mode-aware `runCard()`
- `src/commands/report.ts` — wires `runCard({mode: 'refresh'})` to email
- `src/cli.ts` — `--mode` flag
- `src/email/render.ts` — accepts `swapSummary`, renders "what changed" section
- `.github/workflows/edge-report.yml` — per-cron mode/sports dispatch
- `tests/commands/card.test.ts`, `tests/email/render.test.ts`, `tests/db/queries.test.ts`

**Unchanged:**
- `src/engine/devig.ts`, `src/engine/ev.ts`, `src/engine/scanner.ts`
- `src/sources/*`
- `src/resolve/*` (grading logic; only the query-layer filter changes)
- `src/record/*`
- `edge.config.json`

## Tests

### `tests/engine/resolve-swaps.test.ts` (new)

Table-driven cases:

- No prior picks → all new candidates become `add`.
- Prior picks, all games started → all `kept_started`, no swaps possible.
- Prior pick displaced by better candidate (game not started) → `drop` + `add`.
- Prior pick still top-N → `keep`.
- Mix: 2 `kept_started`, 1 `keep`, 1 `drop`, 1 `add`.
- Prior pick surfaces in ranked with lower score but not top-N → goes to `drop`, not `keep`.
- Fewer candidates than `targetSize` → partial card, no error.
- Candidate id matches `alreadySwappedOffIds` → skipped; does not reincarnate.

### `tests/commands/card.test.ts` (updated)

- Morning mode: inserts rows as `active`, never sends email, no swap summary.
- Refresh mode: applies status transitions correctly; returns swap summary with independent drop/add lists; idempotent if refresh runs twice with the same data.

### `tests/email/render.test.ts` (updated)

- Snapshot test with `swapSummary` present (dropped + added).
- Snapshot test with empty `swapSummary` (section omitted).
- Snapshot test for morning-mode output being unused (render not called).

### `tests/db/queries.test.ts` (updated)

- Assert `swapped_off` rows are filtered from `listPicksAwaitingGrade`, `listPicksForCardDate`, `listPicksAwaitingClose`, `getPicksGradedSince`.

## Rollout

1. Apply migration to Supabase.
2. Deploy code (PR merged to main, triggering the next scheduled GHA run).
3. First scheduled run after deploy will run in the deployed mode for that cron slot. If it lands at 10am, it's a silent morning run — no user-visible effect until 3pm refresh. If it lands at 3pm, it's a refresh that finds an empty prior card (first-day condition) and sends a normal email with an empty swap summary.

## Rollback

- Revert code change (one PR revert).
- Leave `status` column in place — `active` default makes existing behavior identical to pre-change.
- No data loss in either direction.
