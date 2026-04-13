# Daily Card Ranker — Design Spec

## Summary

Replace the current EV-threshold scanner with a daily card ranker that scores all betting opportunities across sports and selects the top 5 as a daily card. Flat 1u per pick, tracked and graded through the existing pipeline.

## Motivation

The current scanner finds every line that clears a +2% EV threshold vs. Pinnacle. In practice this produces false edges — the odds are often stale by the time the scan runs (2x/day), so picks that look +EV are already priced in. The new approach picks the 5 strongest plays per day using a balanced scoring formula, producing a focused daily card instead of a noisy stream of marginal edges.

## Scoring Formula

```
score = ev_pct * sqrt(trueProb * payout)
```

- `ev_pct`: expected value as fraction of stake (from `computeEv`)
- `trueProb`: devigged sharp probability for the side (from `devigTwoWay`)
- `payout`: fractional profit per unit staked (from `americanToPayout`)

The geometric mean of trueProb and payout balances confidence and upside — a -170 favorite and a +400 longshot with similar EV% score comparably rather than the longshot dominating.

## Card Rules

- **5 picks per day**, always. Even if only 3 have meaningful EV, the top 5 by score are selected.
- **Flat 1u per pick**, 5u total daily risk.
- **Idempotent per day**: if 5 picks already exist for today's `card_date`, the command prints the existing card and exits. No re-ranking mid-day.
- **All sports, all markets**: candidates come from moneyline and totals across NBA, MLB, NHL (configurable).
- **No EV floor or chalk cap**: every side of every game is scored. The ranking handles selection.

## Architecture

### Data flow

```
Action Network + Odds API (Pinnacle)
        |
   joinSources()          — unchanged
        |
   rankCandidates()       — NEW: replaces scan()
        |                    scores every side, returns sorted candidates
   top 5 by score
        |
   upsertPick()           — adds score + card_date fields
        |
   existing grading/recap pipeline — unchanged
```

### Scanner rewrite: `src/engine/scanner.ts`

The `scan()` function is replaced by `rankCandidates()`:

- Input: same `ScanInput` (snapshots, config, detectedAt)
- Iterates every side of every snapshot (moneyline home/away, total over/under)
- For each side: devigs sharp, finds best book price, computes EV, computes score
- Returns ALL candidates sorted by score descending (no filtering)
- Candidates with negative EV still appear — they just rank low

The `findBestPrice()` helper is unchanged.

### Command layer: `src/commands/card.ts`

Replaces `src/commands/scan.ts`:

1. Checks if 5 picks already exist for today's `card_date` — if yes, prints existing card and returns
2. Fetches all sports (same parallel fetch pattern as `runScan`)
3. Calls `rankCandidates()` per sport, merges all candidates
4. Sorts merged list by score descending, takes top `config.daily_picks` (default 5)
5. Upserts picks to `edge_picks` with `score` and `card_date`
6. Prints the card table

### Database changes

Add to `edge_picks`:

- `score NUMERIC NOT NULL DEFAULT 0` — ranking score
- `card_date DATE NOT NULL DEFAULT game_date` — which daily card this pick belongs to
- `CREATE INDEX idx_edge_picks_card_date ON edge_picks (card_date DESC)`

No new tables. All existing foreign keys and downstream tables (`edge_closing_lines`, `edge_results`, `edge_pick_grades`) are unchanged.

### Config changes

`edge.config.json` new shape:

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

Removed: `ev_threshold`, `max_sharp_implied_prob`, `stale_sharp_max_age_minutes`, `watch_interval_minutes`.

Added: `daily_picks`.

### CLI changes

- `edge card` replaces `edge scan`
- `src/cli.ts` updated to register new subcommand
- `.github/workflows/edge-report.yml` updated to call `edge card`

### UI changes

- `src/ui/tables.ts` updated to include `score` column in the picks table

## File change summary

**Unchanged:**
- `src/engine/devig.ts`
- `src/engine/ev.ts`
- `src/sources/action-network.ts`
- `src/sources/odds-api.ts`
- `src/sources/normalize.ts`
- `src/resolve/*`
- `src/db/client.ts`
- `src/record/*`
- `src/email/*`
- `src/commands/record.ts`
- `src/commands/resolve.ts`
- `src/commands/recap.ts`

**Modified:**
- `src/engine/scanner.ts` — `scan()` replaced by `rankCandidates()`
- `src/commands/scan.ts` → `src/commands/card.ts` — new daily card command
- `src/cli.ts` — register `card`, remove `scan`
- `src/config.ts` — updated schema
- `src/ui/tables.ts` — add score column
- `src/db/queries.ts` — `PickRow` gets `score` and `card_date`; `upsertPick` includes them
- `edge.config.json` — new shape
- `.github/workflows/edge-report.yml` — `edge card` instead of `edge scan`

**Tests:**
- `tests/engine/scanner.test.ts` — rewritten for `rankCandidates()` scoring and sort order

## Migration

```sql
ALTER TABLE edge_picks ADD COLUMN score NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE edge_picks ADD COLUMN card_date DATE NOT NULL DEFAULT game_date;
CREATE INDEX IF NOT EXISTS idx_edge_picks_card_date ON edge_picks (card_date DESC);
```
