import type Database from 'better-sqlite3'

export interface PickRow {
  id: string
  detected_at: string
  sport: string
  game_id: string
  game_date: string
  game_time: string
  away_team: string
  home_team: string
  market: 'moneyline' | 'total' | 'spread'
  side: 'home' | 'away' | 'over' | 'under'
  line: number | null
  best_book: string
  best_price: number
  sharp_book: string
  sharp_implied: number
  ev_pct: number
  all_prices: string // JSON
}

const INSERT_SQL = `
  INSERT INTO picks (
    id, detected_at, sport, game_id, game_date, game_time,
    away_team, home_team, market, side, line,
    best_book, best_price, sharp_book, sharp_implied, ev_pct, all_prices
  ) VALUES (
    @id, @detected_at, @sport, @game_id, @game_date, @game_time,
    @away_team, @home_team, @market, @side, @line,
    @best_book, @best_price, @sharp_book, @sharp_implied, @ev_pct, @all_prices
  )
  ON CONFLICT(id) DO NOTHING
`

export function insertPick(db: Database.Database, pick: PickRow): boolean {
  const result = db.prepare(INSERT_SQL).run(pick)
  return result.changes === 1
}

const LIST_BY_DATE_SQL = `
  SELECT * FROM picks
  WHERE game_date = ?
  ORDER BY ev_pct DESC
`

export function listPicksForDate(db: Database.Database, gameDate: string): PickRow[] {
  return db.prepare(LIST_BY_DATE_SQL).all(gameDate) as PickRow[]
}
