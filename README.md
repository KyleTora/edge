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

   - `books` — your sportsbook allowlist (must match Action Network book names: BetMGM, DraftKings, Caesars, BetRivers, FanDuel, Fanatics; bet365 is also supported via The Odds API)
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
- bet365 lines come from The Odds API's `eu` region.
- theScore Bet has no usable feed; tracked in `manual_books` only.
- Pinnacle is used as the sharp anchor; never as a book to bet at.
