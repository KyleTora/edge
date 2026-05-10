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
