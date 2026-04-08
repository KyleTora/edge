import { describe, it, expect } from 'vitest'
import { renderRecapHtml, buildRecapSubject } from '../../src/email/render-recap.js'
import type { RecordMetrics } from '../../src/record/aggregate.js'
import type { GradedPickRow } from '../../src/db/queries.js'

function emptyMetrics(): RecordMetrics {
  return {
    picks: 0,
    won: 0,
    lost: 0,
    push: 0,
    void: 0,
    hitRate: null,
    avgEv: null,
    units: 0,
    roi: null,
    clvAvg: null,
    clvBeatRate: null,
    picksWithCLV: 0,
    capturedClosesPct: null,
    approximateCLV: 0,
    bySport: [],
  }
}

function populatedMetrics(): RecordMetrics {
  return {
    picks: 23,
    won: 13,
    lost: 9,
    push: 1,
    void: 0,
    hitRate: 13 / 22,
    avgEv: 0.042,
    units: 2.84,
    roi: 0.123,
    clvAvg: 0.018,
    clvBeatRate: 0.64,
    picksWithCLV: 22,
    capturedClosesPct: 22 / 23,
    approximateCLV: 0,
    bySport: [
      {
        sport: 'mlb',
        picks: 14,
        won: 8,
        lost: 5,
        push: 1,
        units: 1.92,
        clvAvg: 0.021,
      },
      {
        sport: 'nba',
        picks: 6,
        won: 3,
        lost: 3,
        push: 0,
        units: 0.42,
        clvAvg: 0.009,
      },
    ],
  }
}

function makeGradedPick(overrides: Partial<GradedPickRow> = {}): GradedPickRow {
  return {
    id: 'pick-1',
    detected_at: '2026-04-07T18:00:00Z',
    sport: 'mlb',
    game_id: 'nyy-bos',
    game_date: '2026-04-07',
    game_time: '2026-04-07T23:05:00Z',
    away_team: 'New York Yankees',
    home_team: 'Boston Red Sox',
    market: 'moneyline',
    side: 'away',
    line: null,
    best_book: 'betmgm',
    best_price: -145,
    sharp_book: 'pinnacle',
    sharp_implied: 0.59,
    ev_pct: 0.03,
    all_prices: { betmgm: -145 },
    outcome: 'won',
    graded_at: '2026-04-08T03:00:00Z',
    ...overrides,
  }
}

describe('renderRecapHtml', () => {
  it('includes the three rolling windows in the headline table', () => {
    const html = renderRecapHtml({
      newlySettled: [makeGradedPick()],
      metrics7d: populatedMetrics(),
      metrics30d: populatedMetrics(),
      metricsAll: populatedMetrics(),
      asOf: new Date('2026-04-08T09:30:00Z'),
    })
    expect(html).toContain('7d')
    expect(html).toContain('30d')
    expect(html).toContain('All-time')
    // Headline values present
    expect(html).toContain('+2.84u')
    expect(html).toContain('13-9-1')
  })

  it('renders null metric values as em-dash', () => {
    const html = renderRecapHtml({
      newlySettled: [makeGradedPick()],
      metrics7d: emptyMetrics(),
      metrics30d: emptyMetrics(),
      metricsAll: emptyMetrics(),
      asOf: new Date('2026-04-08T09:30:00Z'),
    })
    // Hit rate, ROI, CLV avg, CLV beat rate, avg EV are all null in emptyMetrics
    // Each should render as the em-dash glyph at least once
    expect(html).toContain('—')
  })

  it('omits the 7d-by-sport block entirely when bySport is empty', () => {
    const m = populatedMetrics()
    m.bySport = []
    const html = renderRecapHtml({
      newlySettled: [makeGradedPick()],
      metrics7d: m,
      metrics30d: populatedMetrics(),
      metricsAll: populatedMetrics(),
      asOf: new Date('2026-04-08T09:30:00Z'),
    })
    expect(html).not.toContain('Last 7 days by sport')
  })

  it('renders settled-pick rows with moneyline label', () => {
    const html = renderRecapHtml({
      newlySettled: [makeGradedPick({ market: 'moneyline', side: 'away' })],
      metrics7d: populatedMetrics(),
      metrics30d: populatedMetrics(),
      metricsAll: populatedMetrics(),
      asOf: new Date('2026-04-08T09:30:00Z'),
    })
    expect(html).toContain('Yankees ML')
    expect(html).toContain('Won')
    expect(html).toContain('+0.69u') // -145 → won → 100/145 ≈ 0.69
  })

  it('renders settled-pick rows with total label', () => {
    const html = renderRecapHtml({
      newlySettled: [
        makeGradedPick({
          market: 'total',
          side: 'over',
          line: 224.5,
          best_price: -110,
          outcome: 'lost',
        }),
      ],
      metrics7d: populatedMetrics(),
      metrics30d: populatedMetrics(),
      metricsAll: populatedMetrics(),
      asOf: new Date('2026-04-08T09:30:00Z'),
    })
    expect(html).toContain('Over 224.5')
    expect(html).toContain('Lost')
    expect(html).toContain('-1.00u')
  })

  it('renders settled-pick rows with spread label', () => {
    const html = renderRecapHtml({
      newlySettled: [
        makeGradedPick({
          market: 'spread',
          side: 'home',
          line: -1.5,
          best_price: +180,
          outcome: 'push',
          home_team: 'Toronto Maple Leafs',
        }),
      ],
      metrics7d: populatedMetrics(),
      metrics30d: populatedMetrics(),
      metricsAll: populatedMetrics(),
      asOf: new Date('2026-04-08T09:30:00Z'),
    })
    expect(html).toContain('Leafs -1.5')
    expect(html).toContain('Push')
    expect(html).toContain('0.00u')
    expect(html).not.toContain('+0.00u')
  })

  it('sorts settled picks by graded_at descending', () => {
    const html = renderRecapHtml({
      newlySettled: [
        makeGradedPick({ id: 'older', graded_at: '2026-04-08T01:00:00Z', home_team: 'Aaa' }),
        makeGradedPick({ id: 'newer', graded_at: '2026-04-08T05:00:00Z', home_team: 'Zzz' }),
      ],
      metrics7d: populatedMetrics(),
      metrics30d: populatedMetrics(),
      metricsAll: populatedMetrics(),
      asOf: new Date('2026-04-08T09:30:00Z'),
    })
    const newerIdx = html.indexOf('Zzz')
    const olderIdx = html.indexOf('Aaa')
    expect(newerIdx).toBeGreaterThan(-1)
    expect(olderIdx).toBeGreaterThan(-1)
    expect(newerIdx).toBeLessThan(olderIdx)
  })

  it('footer includes generated timestamp and counts', () => {
    const html = renderRecapHtml({
      newlySettled: [makeGradedPick(), makeGradedPick({ id: 'pick-2' })],
      metrics7d: populatedMetrics(),
      metrics30d: populatedMetrics(),
      metricsAll: { ...populatedMetrics(), picks: 612 },
      asOf: new Date('2026-04-08T09:30:00Z'),
    })
    expect(html).toContain('2026-04-08')
    expect(html).toContain('09:30')
    expect(html).toContain('2 settled')
    expect(html).toContain('612 graded all-time')
  })

  it('omits the settled-overnight block when newlySettled is empty', () => {
    const html = renderRecapHtml({
      newlySettled: [],
      metrics7d: populatedMetrics(),
      metrics30d: populatedMetrics(),
      metricsAll: populatedMetrics(),
      asOf: new Date('2026-04-08T09:30:00Z'),
    })
    expect(html).not.toContain('Settled overnight')
    // Headline table should still be present
    expect(html).toContain('Rolling totals')
    expect(html).toContain('+2.84u')
  })
})

describe('buildRecapSubject', () => {
  it('formats subject line with count and 7d units', () => {
    const subject = buildRecapSubject({
      settledCount: 4,
      units7d: 2.84,
    })
    expect(subject).toBe('Edge recap — 4 picks settled, +2.84u (7d)')
  })

  it('singularizes pick when count is 1', () => {
    const subject = buildRecapSubject({
      settledCount: 1,
      units7d: 0.69,
    })
    expect(subject).toBe('Edge recap — 1 pick settled, +0.69u (7d)')
  })

  it('formats negative units correctly', () => {
    const subject = buildRecapSubject({
      settledCount: 3,
      units7d: -1.42,
    })
    expect(subject).toBe('Edge recap — 3 picks settled, -1.42u (7d)')
  })
})
