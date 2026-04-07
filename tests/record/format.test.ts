import { describe, it, expect } from 'vitest'
import { formatRecord } from '../../src/record/format.js'
import type { RecordMetrics } from '../../src/record/aggregate.js'

const metrics: RecordMetrics = {
  picks: 47,
  won: 24,
  lost: 20,
  push: 3,
  void: 0,
  hitRate: 0.545,
  avgEv: 0.038,
  units: 3.2,
  roi: 0.068,
  clvAvg: 0.021,
  clvBeatRate: 0.68,
  picksWithCLV: 47,
  capturedClosesPct: 1,
  approximateCLV: 3,
  bySport: [
    { sport: 'nba', picks: 18, won: 13, lost: 4, push: 1, units: 4.2, clvAvg: 0.051 },
    { sport: 'mlb', picks: 14, won: 7, lost: 7, push: 0, units: -0.8, clvAvg: 0.004 },
  ],
}

describe('formatRecord', () => {
  it('renders all metric labels', () => {
    const out = formatRecord({ metrics, sinceLabel: 'Mar 8', untilLabel: 'Apr 7, 2026' })
    expect(out).toContain('Picks / Bets')
    expect(out).toContain('Hit rate')
    expect(out).toContain('CLV avg')
    expect(out).toContain('Captured closes')
    expect(out).toContain('By sport')
    expect(out).toContain('NBA')
    expect(out).toContain('MLB')
  })

  it('renders dashes for missing real column (always in 2a)', () => {
    const out = formatRecord({ metrics, sinceLabel: 'Mar 8', untilLabel: 'Apr 7, 2026' })
    // Should have at least one "—" in the REAL column area
    expect(out).toMatch(/—/)
  })

  it('renders the approximate-CLV warning when applicable', () => {
    const out = formatRecord({ metrics, sinceLabel: 'Mar 8', untilLabel: 'Apr 7, 2026' })
    expect(out).toContain('approximate CLV')
  })

  it('omits the warning when approximateCLV is 0', () => {
    const out = formatRecord({
      metrics: { ...metrics, approximateCLV: 0 },
      sinceLabel: 'Mar 8',
      untilLabel: 'Apr 7, 2026',
    })
    expect(out).not.toContain('approximate CLV')
  })
})
