# Edge Parlay Pipeline — Design Spec

## Summary

Replace the existing +EV moneyline/totals daily-card pipeline with a daily 2-3 leg
player-prop parlay generator targeting roughly +100 combined American odds. Each leg
is selected to be ~70-75% probable to hit (devigged Pinnacle prob, with multi-book
consensus fallback). Output is a single 10am ET email with click-to-mark "Skip"/"Confirm
bet" buttons. The system tracks an anti-martingale staking streak (start $10, double on
each consecutive bet+win, reset to $10 on bet+loss) and grades each parlay overnight
from public box-score endpoints.

## Motivation

Current +EV picks system has not produced subjective value for the user:

> "we can probably cancel this project. im not seeing a benefit, picks havent been good"

Rather than scrap the project entirely, the user wants to redirect the existing
infrastructure (Action Network source layer, Resend email, Supabase persistence,
GitHub Actions cron, `edge` CLI) toward a different betting product: a daily parlay
of "almost-guaranteed" player props that can be ridden anti-martingale style ($10 →
$20 → $40 → ...).

The math reality was surfaced and accepted during brainstorming: each leg ~71-75%
to hit, parlay hits ~50% of the time at +100. Not actually "almost guaranteed," but
the closest viable approximation given vig and sportsbook prop pricing.

## Decisions (all confirmed during brainstorming)

- **Leg selection:** hybrid — prefer +EV legs (true_prob > implied), fall back to
  high-probability filler (≥75% true_prob) when fewer than 2-3 +EV legs qualify.
  System always emits a parlay (or a "no parlay today" notice on the rare days
  with insufficient candidates).
- **Sports scope:** NBA, MLB, NHL — whatever's in season. (NFL deferred.)
- **Data source:** Action Network only, with multi-book consensus as fallback when
  Pinnacle prop pricing is unavailable for a given prop. (Paid Odds API deferred
  until/unless free path proves insufficient.)
- **Delivery:** single daily email at 10am ET. Replaces the current
  scan/card/email pipeline entirely. No 3pm refresh.
- **Streak tracking:** system tracks streak in DB. User must mark each parlay
  via click-to-mark buttons in the email.
- **Marking interaction:** click-to-mark links → Cloudflare Worker → Supabase
  status update.
- **Default if unmarked:** "bet" (matches user's typical intent; `Skip` button is
  the active choice on days the user does not bet).
- **Architectural shape:** replace the engine, keep the shell. Reuse source layer,
  DB, email, cron, CLI scaffolding. Rip out `edge_picks` and `src/engine/`.

## Architecture

### Pipeline (daily)

```
Morning (10am ET, GitHub Actions cron):
  edge scan
    1. Fetch today's games for in-season sports (NBA/MLB/NHL) from Action Network
    2. For each game: pull player-prop markets from Action Network
    3. For each candidate prop:
         a. Devig Pinnacle two-way market → pinnacle_prob
         b. If Pinnacle absent: compute multi-book consensus → consensus_prob
         c. Pick true_prob = pinnacle_prob ?? consensus_prob
    4. Filter candidates: 70-75% true_prob band, valid pricing, not "no action" risk
       (e.g., starter confirmed for MLB/NHL where reasonable to check)
    5. Builder picks 2-3 legs:
         - Greedy/exhaustive search (small candidate space) for combo whose
           combined American odds fall closest to +100, ties broken by:
              (a) higher count of +EV legs,
              (b) higher weighted-avg EV%,
              (c) lower combined variance.
         - Prefer +EV legs; fill remaining slots with high-prob filler if needed.
    6. Read edge_streak_state → compute current recommended_stake (= next_stake)
    7. Insert edge_parlays row + edge_parlay_legs rows (status='bet' default)
    8. Render email with leg summary + Skip/Confirm buttons (signed URLs)
    9. Send via Resend

User interaction (any time before grading):
  Click "Skip"         → tracker worker → Supabase: status='skipped'
  Click "Confirm bet"  → tracker worker → Supabase: status='bet' (idempotent)

Late night / next-morning (4am ET, GitHub Actions cron):
  edge resolve
    1. SELECT edge_parlays WHERE card_date <= today AND graded_at IS NULL
    2. For each parlay:
         a. For each leg: fetch box score from sport-specific stat source
            (NBA: stats.nba.com or ESPN; MLB: MLB Stats API; NHL: NHL API)
         b. Compute leg result: hit | miss | void
         c. Compute parlay result:
              - any miss → lost
              - all hits → won
              - some void + rest hits → "reduced": recompute as smaller parlay
                at recomputed odds (book-style void handling)
              - all void → void (treat as skipped for streak purposes)
         d. Update edge_parlays.result_pnl based on status × result × stake
    3. If status='bet' (including default), update edge_streak_state:
         - won  → current_streak += 1, next_stake *= 2
         - lost → current_streak = 0, next_stake = 10
         - void/reduced-void → no streak change
       If status='skipped', no streak change regardless of result.
```

### Data model

```sql
-- One row per daily parlay
edge_parlays
  id                 uuid pk
  card_date          date          -- e.g. 2026-05-10
  combined_odds      int           -- American
  combined_prob      numeric       -- 0-1
  ev_pct             numeric       -- weighted-avg EV across legs
  recommended_stake  numeric       -- $ from streak at creation
  streak_at_creation int
  status             text          -- 'bet' | 'skipped' | 'won' | 'lost' | 'void'
  result_pnl         numeric       -- nullable until graded
  bet_marked_at      timestamptz   -- nullable
  graded_at          timestamptz   -- nullable
  notes              text          -- e.g. "no parlay today" reason
  created_at         timestamptz

-- One row per leg of each parlay (2-3 per parlay)
edge_parlay_legs
  id              uuid pk
  parlay_id       uuid fk → edge_parlays.id
  sport           text          -- 'nba' | 'mlb' | 'nhl'
  game_id         text          -- AN game id, used by grader
  player_id       text          -- normalized id for box-score lookup
  player_name     text
  prop_market     text          -- 'points' | 'hits' | 'shots_on_goal' | 'total_bases' | ...
  prop_line       numeric       -- 9.5, 0.5, 1.5, ...
  prop_side       text          -- 'over' | 'under'
  book            text          -- best-priced book at scan time
  price_american  int
  pinnacle_prob   numeric       -- nullable
  consensus_prob  numeric       -- nullable
  true_prob       numeric       -- chosen one used for builder
  ev_pct          numeric
  is_filler       boolean       -- true if not strictly +EV
  result          text          -- 'pending' | 'hit' | 'miss' | 'void'
  actual_value    numeric       -- e.g. 12 (player scored 12 pts), null until graded

-- Singleton streak/bankroll state
edge_streak_state
  id             int pk default 1
  current_streak int                -- 0 = fresh start
  next_stake     numeric            -- base × 2^current_streak; $10 at fresh
  bankroll_pnl   numeric            -- lifetime cumulative
  updated_at     timestamptz

-- Constraint: one parlay per card_date
ALTER TABLE edge_parlays ADD CONSTRAINT unique_card_date UNIQUE (card_date);
```

Re-running `edge scan` for the same `card_date` is a no-op (existing parlay returned)
unless explicitly forced via `--force-rescan`.

Migration drops `edge_picks` and any other tables created by the prior +EV pipeline.
Legacy fantasy-app tables (~30) are left untouched per established preference.

### Component layout

```
src/
  cli.ts                          (existing — re-wire commands)
  config.ts                       (existing — extend for parlay config)
  edge.config.json                (extend: target_odds, prop_markets, stake_base)
  sources/
    action-network.ts             (existing — keep utility helpers)
    action-network-props.ts       (NEW — props endpoint client)
    normalize.ts                  (existing — extend for prop shapes)
    box-scores/                   (NEW)
      nba.ts                      (stats.nba.com or ESPN unofficial)
      mlb.ts                      (MLB Stats API — free, official)
      nhl.ts                      (NHL API — free, official)
      index.ts                    (router by sport)
  parlay/                         (NEW — replaces src/engine/)
    probability.ts                (devig two-way prop, consensus fallback)
    builder.ts                    (pick 2-3 legs targeting ~+100 odds)
    streak.ts                     (state machine: bet/skip × win/loss → next stake)
    grade.ts                      (per-leg + parlay-level grading w/ void handling)
    odds.ts                       (american ↔ decimal ↔ implied helpers)
  email/
    parlay-template.ts            (NEW — leg cards + Skip/Confirm buttons)
    resend.ts                     (existing — minor signature change)
  commands/
    scan.ts                       (rewritten — builds parlay, writes DB, emails)
    resolve.ts                    (rewritten — grades + updates streak)
    report.ts                     (rewritten — re-renders/re-sends today's card)
  db/
    schema.ts                     (new tables)
    migrations.sql                (drop edge_picks, add new tables)

tracker/                          (NEW — separate Cloudflare Worker deploy)
  worker.ts                       (~50 lines: verify HMAC signature, flip status)
  wrangler.toml

tests/
  parlay/
    probability.test.ts
    builder.test.ts
    streak.test.ts
    grade.test.ts
    odds.test.ts
  email/parlay-template.test.ts
  fixtures/                       (AN responses, box-score samples)
```

Files removed: `src/engine/devig.ts`, `ev.ts`, `scanner.ts`, `swap-summary.ts`,
`resolve-swaps.ts`; `src/commands/card.ts`, `recap.ts`, `record.ts`,
`commands/resolve.ts` (existing — replaced by new resolve).

### Click-to-mark tracker (Cloudflare Worker)

Lives in `tracker/`, deployed independently to Cloudflare Workers free tier.

- Each email contains two URLs:
  - `https://<worker>/mark?p=<parlay_id>&a=skip&t=<hmac>`
  - `https://<worker>/mark?p=<parlay_id>&a=bet&t=<hmac>`
- HMAC token = `hmac_sha256(SIGNING_SECRET, parlay_id + ":" + action)`, hex-encoded,
  prevents tampering.
- Worker verifies token, then writes `status=bet|skipped` and `bet_marked_at=now()`
  to the corresponding `edge_parlays` row via Supabase service-role key.
- Idempotent: re-clicking is safe; later click overrides earlier.
- Returns a tiny HTML confirmation page ("Got it — your streak is now N. See you
  tomorrow.").
- Secrets stored as Worker env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`,
  `SIGNING_SECRET`.

### Streak state machine

Pure function `transition(prevState, parlayResult, parlayStatus) → newState`:

| status   | result   | streak             | next_stake          |
| -------- | -------- | ------------------ | ------------------- |
| bet      | won      | streak + 1         | next_stake × 2      |
| bet      | lost     | 0                  | base ($10)          |
| bet      | void     | unchanged          | unchanged           |
| bet      | reduced  | recurse over inner | recurse over inner  |
| skipped  | (any)    | unchanged          | unchanged           |

`reduced` (some legs voided, rest graded) is treated as a normal bet at recomputed
odds; the inner won/lost result drives the transition.

### Builder algorithm

Input: list of candidate legs `{price, true_prob, ev_pct, is_filler_eligible, ...}`
filtered to true_prob ∈ [0.65, 0.85] (slightly wider than 70-75% to give the
combo-search headroom).

Algorithm:

1. Generate all combinations of 2 and 3 legs from candidates (small N, exhaustive
   search is fine — typically <50 candidates per day).
2. For each combo: compute combined American odds.
3. Filter to combos with combined odds ∈ [-110, +130] (tolerance around +100).
4. Score each remaining combo:
   - `score = +EV_count * 100 + weighted_avg_ev_pct * 10 - combined_variance`
   - +EV count dominates; EV% is secondary; lower variance breaks ties.
5. Return top combo. If empty after step 3, relax band to [-150, +160] and retry.
   If still empty, emit "no parlay today" notice.
6. Apply diversity constraint: max 1 leg per game (avoid same-game correlation
   that would inflate combined probability above realistic).

### Email format

Subject: `Edge Parlay — May 10` (or `Edge Parlay — Skip Day` on no-parlay days)

Body (HTML, mobile-first):
- Header: today's date, combined odds (e.g. "+105"), recommended stake ("$40 — bet
  #3 of current run"), expected payout
- Per-leg card (×2-3): player photo (if AN provides), market line ("LeBron James —
  10+ Points (-280)"), book name, true probability, EV badge ("✓ +EV" or "filler"),
  game info, tip-off time
- Two big buttons: `Skip this one` (prominent, primary action), `Confirm bet`
  (secondary)
- Footer: lifetime W-L, lifetime P&L, current run length

### Configuration (`edge.config.json` extensions)

```json
{
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

Existing top-level `books`, `sports`, `bankroll_units`, `unit_size_cad` retained
for back-compat where useful.

## Error handling and edge cases

- **Action Network fetch failure:** retry up to 3× with exponential backoff. If all
  fail, send "no parlay today — data source unavailable" email; streak unaffected.
- **No Pinnacle prop pricing for a leg:** fall back silently to multi-book consensus.
  Stored separately so EV is auditable.
- **Insufficient candidates for builder:** relax odds tolerance; if still none,
  emit no-parlay notice. Do not synthesize sub-quality legs.
- **Player scratched between scan and game:** detected at grading time; leg voids,
  parlay reduces to remaining legs at recomputed odds.
- **Game postponed:** leg voids; reduced parlay handling.
- **Box-score fetch failure during grading:** leave `result='pending'`, `graded_at`
  null; resolver retries on next run.
- **Click-to-mark token tamper:** worker returns 400, no DB write.
- **Double-click:** idempotent; later mark overrides.
- **User clicks after grading completes:** allowed; updates status but does not
  retroactively change streak (transition already applied).

## Testing

- **Unit tests** on pure-logic modules: `probability.ts`, `builder.ts`,
  `streak.ts`, `grade.ts`, `odds.ts`. Fixtures-based; no network.
- **Integration tests** for full scan pipeline using fixture AN response →
  assert DB rows + email render correctness.
- **Snapshot tests** on `parlay-template.ts` HTML output.
- **Cloudflare Worker tests** using Wrangler's `unstable_dev` for local execution
  with mocked Supabase.
- **E2E dry-run** mode (`edge scan --dry-run`) using local fixtures, exercises full
  pipeline without DB writes or email send.

## Out of scope

- NFL coverage (deferred until preseason)
- Paid Odds API tier (deferred — Action Network only first)
- Same-game parlays / leg correlation modeling beyond the "max 1 leg per game"
  diversity rule
- A web dashboard or non-email UI for the user
- Multi-user support — this remains single-user (singleton streak state)
- Historical replay/backtesting tools
- Bet-size guidance beyond doubling-on-win (e.g. Kelly sizing)

## Deployment steps requiring user action

(These cannot be performed by Claude and will be flagged at the appropriate time
during implementation.)

1. Apply migration to live Supabase project (drop `edge_picks`, create new tables).
2. Cloudflare account: create Worker project, deploy `tracker/` via `wrangler
   deploy`, set Worker env vars (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`,
   `SIGNING_SECRET`).
3. Add new env vars to GitHub Actions repo secrets:
   - `TRACKER_BASE_URL` (Cloudflare Worker URL)
   - `TRACKER_SIGNING_SECRET` (matches Worker)
4. Update GitHub Actions cron schedule (existing two-job cadence → single 10am ET
   scan + 4am ET grade).
5. Smoke-test the email flow once end-to-end before retiring the old pipeline.
