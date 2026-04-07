-- edge Phase 2a — picks, closing lines, results, grades
-- Run manually in the Supabase SQL editor for project mlokvmawnzgtyuzpccjj.
-- All tables prefixed `edge_` to namespace away from legacy ballpark-social tables.

CREATE TABLE IF NOT EXISTS edge_picks (
  id              TEXT PRIMARY KEY,
  detected_at     TIMESTAMPTZ NOT NULL,
  sport           TEXT NOT NULL,
  game_id         TEXT NOT NULL,
  game_date       DATE NOT NULL,
  game_time       TIMESTAMPTZ NOT NULL,
  away_team       TEXT NOT NULL,
  home_team       TEXT NOT NULL,
  market          TEXT NOT NULL,
  side            TEXT NOT NULL,
  line            NUMERIC,
  best_book       TEXT NOT NULL,
  best_price      INTEGER NOT NULL,
  sharp_book      TEXT NOT NULL,
  sharp_implied   NUMERIC NOT NULL,
  ev_pct          NUMERIC NOT NULL,
  all_prices      JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_edge_picks_game_date ON edge_picks (game_date DESC);
CREATE INDEX IF NOT EXISTS idx_edge_picks_ev ON edge_picks (ev_pct DESC);
CREATE INDEX IF NOT EXISTS idx_edge_picks_game_time ON edge_picks (game_time);

CREATE TABLE IF NOT EXISTS edge_closing_lines (
  pick_id         TEXT PRIMARY KEY REFERENCES edge_picks(id) ON DELETE CASCADE,
  closed_at       TIMESTAMPTZ NOT NULL,
  sharp_close     INTEGER NOT NULL,
  sharp_implied   NUMERIC NOT NULL,
  best_book_close INTEGER,
  capture_lag_min INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS edge_results (
  game_id         TEXT PRIMARY KEY,
  sport           TEXT NOT NULL,
  game_date       DATE NOT NULL,
  home_score      INTEGER NOT NULL,
  away_score      INTEGER NOT NULL,
  status          TEXT NOT NULL,
  resolved_at     TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_edge_results_game_date ON edge_results (game_date DESC);

CREATE TABLE IF NOT EXISTS edge_pick_grades (
  pick_id         TEXT PRIMARY KEY REFERENCES edge_picks(id) ON DELETE CASCADE,
  outcome         TEXT NOT NULL,
  graded_at       TIMESTAMPTZ NOT NULL
);

ALTER TABLE edge_picks DISABLE ROW LEVEL SECURITY;
ALTER TABLE edge_closing_lines DISABLE ROW LEVEL SECURITY;
ALTER TABLE edge_results DISABLE ROW LEVEL SECURITY;
ALTER TABLE edge_pick_grades DISABLE ROW LEVEL SECURITY;
