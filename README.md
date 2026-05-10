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
