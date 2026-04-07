import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { applySchema } from '../../src/db/schema.js'

describe('applySchema', () => {
  it('creates the picks table', () => {
    const db = new Database(':memory:')
    applySchema(db)
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='picks'")
      .get()
    expect(row).toBeDefined()
  })

  it('is idempotent', () => {
    const db = new Database(':memory:')
    applySchema(db)
    expect(() => applySchema(db)).not.toThrow()
  })

  it('creates required indexes', () => {
    const db = new Database(':memory:')
    applySchema(db)
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='picks'")
      .all() as Array<{ name: string }>
    const names = indexes.map((i) => i.name)
    expect(names).toContain('idx_picks_game_date')
    expect(names).toContain('idx_picks_ev')
  })
})
