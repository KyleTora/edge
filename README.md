# edge

Personal +EV sports betting CLI. Surfaces betting opportunities by devigging
Pinnacle (sharp anchor) and comparing prices to your allowlisted books.

**Design spec:** see `../ballpark-social/docs/superpowers/specs/2026-04-06-edge-cli-design.md`

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env` from the example and add your Odds API key
   (sign up free at https://the-odds-api.com — 500 req/month tier):

   ```bash
   cp .env.example .env
   # then edit .env to set ODDS_API_KEY
   ```

3. Review `edge.config.json` and adjust:

   - `books` — your sportsbook allowlist (must match Action Network book names: BetMGM, DraftKings, Caesars, BetRivers, FanDuel, Fanatics)
   - `sports` — which sports to scan (`nba`, `mlb`, `nhl`)
   - `ev_threshold` — minimum EV% to surface (default 0.02 = +2%)

4. Build (optional, for global install) and link:

   ```bash
   npm run build
   npm link
   ```

   After `npm link`, set `EDGE_HOME` to the project directory so `edge` can find
   its config and database from anywhere:

   ```bash
   export EDGE_HOME=/Users/kyletora/Desktop/Coding/edge
   ```

   (Add to your shell profile to make permanent.)

   Or run directly with `npm run dev` (uses `tsx`).

## Usage

```bash
edge          # default: scan and print +EV picks
edge scan     # explicit form
```

The first run creates `data/edge.db` (SQLite) and inserts any picks that
exceed the EV threshold. Subsequent runs only insert *new* picks (the same
pick captured at first detection is preserved with its original price and EV).

## How it works

1. Fetches odds from Action Network (free) for your allowlisted books
2. Fetches Pinnacle odds from The Odds API (the sharp anchor)
3. Joins games by team name and devigs Pinnacle's two-sided markets
4. For each market, computes EV at every allowlisted book
5. If best price clears the EV threshold, captures the pick to SQLite
6. Prints all current picks for today/tomorrow ordered by EV%

## Email Automation (Phase 1.5)

`edge` can email you a daily digest of +EV picks via GitHub Actions + Resend.

### One-time setup

1. **Push `edge` to a private GitHub repo.**

   ```bash
   gh repo create edge --private --source=. --remote=origin --push
   ```

   (Or create the repo manually in the GitHub UI and push to it.)

2. **Create a Resend account** at [resend.com](https://resend.com) (free tier: 100 emails/day).
   Generate an API key from the dashboard. Use a "Sending access" key, not full access.

3. **Add four secrets** in your GitHub repo settings → Secrets and variables → Actions:

   - `ODDS_API_KEY` — your Odds API key (same one in your local `.env`)
   - `RESEND_API_KEY` — from step 2
   - `REPORT_EMAIL_TO` — the address to send reports to
   - `REPORT_EMAIL_FROM` — sender address. Use `onboarding@resend.dev` for testing,
     or a verified domain in production.

4. **Verify the workflow runs** by triggering it manually:
   GitHub repo → Actions tab → "edge daily report" → "Run workflow"

   Within ~30 seconds you should receive an email.

### Schedule

The workflow runs automatically at:

- **11am ET (15:00 UTC)** — MLB only (catches afternoon baseball games)
- **4pm ET (20:00 UTC)** — all sports (catches evening NBA/NHL/MLB)

Quota cost: ~16 credits/day = ~480/month, under the 500 free tier.

### Local testing

You can render an email locally without sending it:

```bash
npm run edge:report -- --sports=mlb --dry-run
```

This prints the subject, HTML body, and CSV to stdout. Useful for previewing
formatting changes before pushing.

## Phase 2 (not yet built)

`edge watch`, `edge shop`, `edge place`, `edge record`, `edge resolve`,
closing-line capture, paper-trade UX. See spec § 9.

## Tests

```bash
npm test
```

## Notes

- Single user, local-only. No accounts, no server, no cloud.
- The user is in Ontario, Canada. US Action Network lines are treated as a
  proxy for Ontario lines for BetMGM/DraftKings/Caesars/BetRivers.
- bet365 has no automated feed in v1; tracked under `manual_books` alongside theScore Bet. Re-add it later if you upgrade to a paid Odds API tier.
- theScore Bet has no usable feed; tracked in `manual_books` only.
- Pinnacle is used as the sharp anchor; never as a book to bet at.
