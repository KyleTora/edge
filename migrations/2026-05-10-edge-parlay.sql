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
