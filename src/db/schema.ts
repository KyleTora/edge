import type Database from 'better-sqlite3'

export function applySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS picks (
      id              TEXT PRIMARY KEY,
      detected_at     TEXT NOT NULL,
      sport           TEXT NOT NULL,
      game_id         TEXT NOT NULL,
      game_date       TEXT NOT NULL,
      game_time       TEXT NOT NULL,
      away_team       TEXT NOT NULL,
      home_team       TEXT NOT NULL,
      market          TEXT NOT NULL,
      side            TEXT NOT NULL,
      line            REAL,
      best_book       TEXT NOT NULL,
      best_price      INTEGER NOT NULL,
      sharp_book      TEXT NOT NULL,
      sharp_implied   REAL NOT NULL,
      ev_pct          REAL NOT NULL,
      all_prices      TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_picks_game_date ON picks (game_date DESC);
    CREATE INDEX IF NOT EXISTS idx_picks_ev ON picks (ev_pct DESC);
  `)
}
