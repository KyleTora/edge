// tests/sources/action-network-props.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseActionNetworkProps } from '../../src/sources/action-network-props.js'

const fixture = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/an-props-nba.json'), 'utf-8'),
)

describe('parseActionNetworkProps', () => {
  it('extracts player-prop two-way pairs across books', () => {
    const props = parseActionNetworkProps(fixture, { sport: 'nba', gameId: '12345' })
    expect(props.length).toBeGreaterThan(0)
    const lebron = props.find((p) => p.player_name === 'LeBron James' && p.prop_market === 'points')
    expect(lebron).toBeDefined()
    expect(lebron!.prop_line).toBe(22.5)
    expect(lebron!.over.books.length).toBe(2)
    expect(lebron!.over.pinnacle).not.toBeNull()
    expect(lebron!.over.pinnacle!.sidePrice).toBe(-220)
    expect(lebron!.over.pinnacle!.oppositePrice).toBe(170)
  })
})
