# Edge Recap Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send a daily email recap of betting performance — settled picks from the last 24h plus rolling 7d / 30d / all-time totals — via a new `edge recap` command and standalone GitHub Actions workflow.

**Architecture:** New `runRecap` orchestrator queries newly graded picks via a new `getPicksGradedSince` query, computes three rolling-window aggregates by reusing the existing `aggregateMetrics` function with deduped closing-line lookups, renders an HTML email via a new `render-recap.ts` module, and sends via the existing Resend client (which we refactor to make CSV attachments optional). A new daily-cron workflow at 09:30 UTC invokes the command.

**Tech Stack:** TypeScript, Node 20, vitest, commander.js (CLI), `@supabase/supabase-js`, Resend (`resend` package), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-04-08-edge-recap-email-design.md`

---

## Pre-flight

- [ ] **Step 1: Confirm tests currently pass**

Run: `npm test`
Expected: all tests pass.

If anything is red before we start, stop and surface it.

---

## Task 1: Make `sendReportEmail` CSV-optional and client-injectable

**Why:** The recap email has no CSV attachment, but `sendReportEmail` currently requires `csvFilename` and `csvContent`. We also need a way to test the function without hitting the network — so we add an optional `client` injection point.

**Files:**
- Modify: `src/email/send.ts`
- Create: `tests/email/send.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/email/send.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { sendReportEmail, type ResendLike } from '../../src/email/send.js'

function makeFakeClient(): { client: ResendLike; calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = []
  const client: ResendLike = {
    emails: {
      send: vi.fn(async (payload: Record<string, unknown>) => {
        calls.push(payload)
        return { data: { id: 'fake-id-123' }, error: null }
      }),
    },
  }
  return { client, calls }
}

describe('sendReportEmail', () => {
  it('includes attachments when csvFilename and csvContent are provided', async () => {
    const { client, calls } = makeFakeClient()
    const result = await sendReportEmail({
      apiKey: 'unused',
      from: 'edge <a@b>',
      to: 'me@example.com',
      subject: 'subj',
      html: '<p>hi</p>',
      csvFilename: 'picks.csv',
      csvContent: 'a,b\n1,2\n',
      client,
    })
    expect(result.id).toBe('fake-id-123')
    expect(calls).toHaveLength(1)
    const payload = calls[0]!
    expect(payload.attachments).toBeDefined()
    expect((payload.attachments as Array<{ filename: string }>)[0]?.filename).toBe('picks.csv')
  })

  it('omits attachments entirely when csv params are absent', async () => {
    const { client, calls } = makeFakeClient()
    const result = await sendReportEmail({
      apiKey: 'unused',
      from: 'edge <a@b>',
      to: 'me@example.com',
      subject: 'subj',
      html: '<p>hi</p>',
      client,
    })
    expect(result.id).toBe('fake-id-123')
    expect(calls).toHaveLength(1)
    expect(calls[0]).not.toHaveProperty('attachments')
  })

  it('throws when Resend returns an error', async () => {
    const client: ResendLike = {
      emails: {
        send: vi.fn(async () => ({ data: null, error: { message: 'rate limited' } })),
      },
    }
    await expect(
      sendReportEmail({
        apiKey: 'unused',
        from: 'edge <a@b>',
        to: 'me@example.com',
        subject: 'subj',
        html: '<p>hi</p>',
        client,
      })
    ).rejects.toThrow(/rate limited/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/email/send.test.ts`
Expected: FAIL — `ResendLike` type missing, optional CSV not yet supported, `client` param not accepted.

- [ ] **Step 3: Refactor `src/email/send.ts`**

Replace the entire contents of `src/email/send.ts` with:

```ts
import { Resend } from 'resend'

/**
 * Minimal interface over the Resend client we depend on. Lets tests inject a
 * fake without standing up the network. Production paths use the real Resend
 * client (created from `apiKey` when `client` is not provided).
 */
export interface ResendLike {
  emails: {
    send: (payload: Record<string, unknown>) => Promise<{
      data: { id: string } | null
      error: { message: string } | null
    }>
  }
}

export interface SendEmailInput {
  apiKey: string
  from: string         // e.g. "edge <onboarding@resend.dev>"
  to: string           // recipient address
  subject: string
  html: string
  /** Optional CSV attachment. Both fields must be provided together. */
  csvFilename?: string
  csvContent?: string
  /** Optional injection point for tests. Production omits and a real Resend client is built from apiKey. */
  client?: ResendLike
}

export interface SendEmailResult {
  id: string
}

export async function sendReportEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const client: ResendLike = input.client ?? (new Resend(input.apiKey) as unknown as ResendLike)

  const payload: Record<string, unknown> = {
    from: input.from,
    to: input.to,
    subject: input.subject,
    html: input.html,
  }
  if (input.csvFilename && input.csvContent) {
    payload.attachments = [
      {
        filename: input.csvFilename,
        content: Buffer.from(input.csvContent, 'utf8').toString('base64'),
      },
    ]
  }

  const { data, error } = await client.emails.send(payload)
  if (error) throw new Error(`Resend error: ${error.message}`)
  if (!data) throw new Error('Resend returned no data')
  return { id: data.id }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/email/send.test.ts`
Expected: all 3 tests pass.

- [ ] **Step 5: Run the full suite to verify the existing picks email still works**

Run: `npm test`
Expected: all tests pass — especially anything that exercises `runReport`, which still passes both CSV fields.

- [ ] **Step 6: Commit**

```bash
git add src/email/send.ts tests/email/send.test.ts
git commit -m "$(cat <<'EOF'
refactor(email): make CSV attachment optional and inject Resend client

The recap email needs to call sendReportEmail without an attachment, and
we want a way to unit-test the sender without the network. Introduces a
ResendLike interface and an optional client param; CSV fields become
optional and only attached when both are present. Picks email keeps its
CSV unchanged.

EOF
)"
```

---

## Task 2: Add `getPicksGradedSince` query

**Why:** The recap email lists picks settled in the last 24 hours. "Settled" means `graded_at >= cutoff` (per spec Q6 — by graded_at, not game_date, to avoid silent loss when a postponed game grades days later).

**Files:**
- Modify: `src/db/queries.ts`
- Modify: `tests/db/queries.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/db/queries.test.ts` (inside the existing `describe('queries (Supabase)', ...)` block, before its closing brace):

```ts
  describe('getPicksGradedSince', () => {
    it('returns picks whose graded_at is at or after the cutoff', async () => {
      const { upsertPick: up, insertPickGrade: grade, getPicksGradedSince } = await import(
        '../../src/db/queries.js'
      )
      await up(fake as never, makePick({ id: 'old' }))
      await up(fake as never, makePick({ id: 'new' }))
      await grade(fake as never, {
        pick_id: 'old',
        outcome: 'won',
        graded_at: '2026-04-07T08:00:00Z',
      })
      await grade(fake as never, {
        pick_id: 'new',
        outcome: 'lost',
        graded_at: '2026-04-08T08:00:00Z',
      })
      const result = await getPicksGradedSince(fake as never, '2026-04-08T00:00:00Z')
      expect(result.map((p) => p.id).sort()).toEqual(['new'])
      expect(result[0]?.outcome).toBe('lost')
    })

    it('returns an empty array when nothing has been graded since cutoff', async () => {
      const { getPicksGradedSince } = await import('../../src/db/queries.js')
      const result = await getPicksGradedSince(fake as never, '2026-04-08T00:00:00Z')
      expect(result).toEqual([])
    })

    it('skips orphan grade rows whose pick row no longer exists', async () => {
      const { insertPickGrade: grade, getPicksGradedSince } = await import(
        '../../src/db/queries.js'
      )
      await grade(fake as never, {
        pick_id: 'orphan',
        outcome: 'won',
        graded_at: '2026-04-08T08:00:00Z',
      })
      const result = await getPicksGradedSince(fake as never, '2026-04-08T00:00:00Z')
      expect(result).toEqual([])
    })
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/db/queries.test.ts`
Expected: FAIL — `getPicksGradedSince` is not exported.

- [ ] **Step 3: Add the function to `src/db/queries.ts`**

Append after the existing `getPicksWithGradesInRange` function (and before `getClosingLinesForPicks`):

```ts
/**
 * Picks whose grade row has graded_at >= sinceIso. Joins to edge_picks in
 * memory using the same anti-join pattern as listPicksAwaitingGrade. Orphan
 * grade rows (no matching pick) are silently dropped — they should not exist
 * but we don't want one bad row to take down the recap email.
 */
export async function getPicksGradedSince(
  supabase: EdgeSupabase,
  sinceIso: string
): Promise<GradedPickRow[]> {
  const gradesRes = await supabase
    .from('edge_pick_grades')
    .select('*')
    .gte('graded_at', sinceIso)
  if (gradesRes.error) throw new Error(`getPicksGradedSince.grades: ${gradesRes.error.message}`)
  const grades = (gradesRes.data ?? []) as PickGradeRow[]
  if (grades.length === 0) return []

  const picksRes = await supabase
    .from('edge_picks')
    .select('*')
    .in(
      'id',
      grades.map((g) => g.pick_id)
    )
  if (picksRes.error) throw new Error(`getPicksGradedSince.picks: ${picksRes.error.message}`)
  const pickById = new Map(((picksRes.data ?? []) as PickRow[]).map((p) => [p.id, p]))

  const result: GradedPickRow[] = []
  for (const g of grades) {
    const p = pickById.get(g.pick_id)
    if (!p) continue
    result.push({ ...p, outcome: g.outcome, graded_at: g.graded_at })
  }
  return result
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/db/queries.test.ts`
Expected: all tests pass, including the 3 new ones.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/db/queries.ts tests/db/queries.test.ts
git commit -m "$(cat <<'EOF'
feat(db): add getPicksGradedSince query for recap email

Returns graded picks whose graded_at is at or after a cutoff timestamp,
joined to edge_picks in memory. Used by the upcoming recap command to
list picks settled in the last 24 hours. Drops orphan grade rows
defensively.

EOF
)"
```

---

## Task 3: Build the recap HTML renderer

**Why:** Pure rendering function. Easy to test in isolation. Building this before the orchestrator means the orchestrator's tests can pin a known HTML shape.

**Files:**
- Create: `src/email/render-recap.ts`
- Create: `tests/email/render-recap.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/email/render-recap.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/email/render-recap.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `src/email/render-recap.ts`**

```ts
import type { GradedPickRow } from '../db/queries.js'
import type { RecordMetrics, SportBreakdown } from '../record/aggregate.js'
import { unitProfit } from '../record/grading-math.js'

export interface RenderRecapInput {
  newlySettled: GradedPickRow[]
  metrics7d: RecordMetrics
  metrics30d: RecordMetrics
  metricsAll: RecordMetrics
  asOf: Date
}

export interface BuildRecapSubjectInput {
  settledCount: number
  units7d: number
}

const dash = '—'

function pct(n: number | null): string {
  if (n === null) return dash
  const sign = n >= 0 ? '+' : ''
  return `${sign}${(n * 100).toFixed(1)}%`
}

function ratio(n: number | null): string {
  return n === null ? dash : `${(n * 100).toFixed(1)}%`
}

function units(n: number): string {
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}u`
}

function lastWord(team: string): string {
  const parts = team.split(' ')
  return parts[parts.length - 1] ?? team
}

function pickLabel(p: GradedPickRow): string {
  if (p.market === 'moneyline') {
    const team = p.side === 'home' ? p.home_team : p.away_team
    return `${lastWord(team)} ML`
  }
  if (p.market === 'total') {
    const dir = p.side === 'over' ? 'Over' : 'Under'
    return `${dir} ${p.line}`
  }
  // spread
  const team = p.side === 'home' ? p.home_team : p.away_team
  const ln = p.line ?? 0
  const sign = ln >= 0 ? '+' : ''
  return `${lastWord(team)} ${sign}${ln}`
}

function fmtPrice(price: number): string {
  return price > 0 ? `+${price}` : `${price}`
}

function outcomeLabel(o: GradedPickRow['outcome']): string {
  if (o === 'won') return '✓ Won'
  if (o === 'lost') return '✗ Lost'
  if (o === 'push') return 'Push'
  return 'Void'
}

function fmtUtcDateTime(d: Date): string {
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mn = String(d.getUTCMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mn} UTC`
}

function renderHeadlineTable(
  m7: RecordMetrics,
  m30: RecordMetrics,
  mAll: RecordMetrics
): string {
  const rows: Array<[string, string, string, string]> = [
    ['Picks', String(m7.picks), String(m30.picks), String(mAll.picks)],
    [
      'Record (W-L-P)',
      `${m7.won}-${m7.lost}-${m7.push}`,
      `${m30.won}-${m30.lost}-${m30.push}`,
      `${mAll.won}-${mAll.lost}-${mAll.push}`,
    ],
    ['Hit rate', ratio(m7.hitRate), ratio(m30.hitRate), ratio(mAll.hitRate)],
    ['Units', units(m7.units), units(m30.units), units(mAll.units)],
    ['ROI', pct(m7.roi), pct(m30.roi), pct(mAll.roi)],
    ['Avg EV', pct(m7.avgEv), pct(m30.avgEv), pct(mAll.avgEv)],
    ['CLV avg', pct(m7.clvAvg), pct(m30.clvAvg), pct(mAll.clvAvg)],
    ['CLV beat rate', ratio(m7.clvBeatRate), ratio(m30.clvBeatRate), ratio(mAll.clvBeatRate)],
  ]

  const body = rows
    .map(
      ([label, a, b, c]) => `
  <tr>
    <td style="padding:6px 10px;color:#666;">${label}</td>
    <td style="padding:6px 10px;text-align:right;font-weight:600;">${a}</td>
    <td style="padding:6px 10px;text-align:right;">${b}</td>
    <td style="padding:6px 10px;text-align:right;">${c}</td>
  </tr>`
    )
    .join('')

  return `<h3 style="margin:24px 0 8px 0;font-family:system-ui,sans-serif;">Rolling totals</h3>
<table style="border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px;min-width:480px;">
  <thead>
    <tr style="background:#f4f4f4;">
      <th style="padding:6px 10px;text-align:left;">Metric</th>
      <th style="padding:6px 10px;text-align:right;">7d</th>
      <th style="padding:6px 10px;text-align:right;">30d</th>
      <th style="padding:6px 10px;text-align:right;">All-time</th>
    </tr>
  </thead>
  <tbody>${body}
  </tbody>
</table>`
}

function renderSettledTable(picks: GradedPickRow[]): string {
  if (picks.length === 0) {
    return ''
  }
  const sorted = [...picks].sort((a, b) => (a.graded_at < b.graded_at ? 1 : -1))
  const rows = sorted
    .map((p) => {
      const matchup = `${lastWord(p.away_team)} @ ${lastWord(p.home_team)}`
      const u = unitProfit(p.outcome, p.best_price)
      const uColor = u > 0 ? '#0a7c2f' : u < 0 ? '#a8201a' : '#666'
      return `
  <tr>
    <td style="padding:6px 10px;">${p.sport.toUpperCase()}</td>
    <td style="padding:6px 10px;">${matchup}</td>
    <td style="padding:6px 10px;">${pickLabel(p)}</td>
    <td style="padding:6px 10px;">${fmtPrice(p.best_price)}</td>
    <td style="padding:6px 10px;">${outcomeLabel(p.outcome)}</td>
    <td style="padding:6px 10px;text-align:right;color:${uColor};font-weight:600;">${units(u)}</td>
  </tr>`
    })
    .join('')

  return `<h3 style="margin:24px 0 8px 0;font-family:system-ui,sans-serif;">Settled overnight</h3>
<table style="border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px;">
  <thead>
    <tr style="background:#f4f4f4;">
      <th style="padding:6px 10px;text-align:left;">Sport</th>
      <th style="padding:6px 10px;text-align:left;">Matchup</th>
      <th style="padding:6px 10px;text-align:left;">Pick</th>
      <th style="padding:6px 10px;text-align:left;">Price</th>
      <th style="padding:6px 10px;text-align:left;">Result</th>
      <th style="padding:6px 10px;text-align:right;">Units</th>
    </tr>
  </thead>
  <tbody>${rows}
  </tbody>
</table>`
}

function renderBySportTable(bySport: SportBreakdown[]): string {
  if (bySport.length === 0) return ''
  const rows = bySport
    .map(
      (s) => `
  <tr>
    <td style="padding:6px 10px;">${s.sport.toUpperCase()}</td>
    <td style="padding:6px 10px;text-align:right;">${s.picks}</td>
    <td style="padding:6px 10px;text-align:right;">${s.won}-${s.lost}-${s.push}</td>
    <td style="padding:6px 10px;text-align:right;">${units(s.units)}</td>
    <td style="padding:6px 10px;text-align:right;">${pct(s.picks > 0 ? s.units / s.picks : null)}</td>
    <td style="padding:6px 10px;text-align:right;">${pct(s.clvAvg)}</td>
  </tr>`
    )
    .join('')
  return `<h3 style="margin:24px 0 8px 0;font-family:system-ui,sans-serif;">Last 7 days by sport</h3>
<table style="border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px;">
  <thead>
    <tr style="background:#f4f4f4;">
      <th style="padding:6px 10px;text-align:left;">Sport</th>
      <th style="padding:6px 10px;text-align:right;">Picks</th>
      <th style="padding:6px 10px;text-align:right;">W-L-P</th>
      <th style="padding:6px 10px;text-align:right;">Units</th>
      <th style="padding:6px 10px;text-align:right;">ROI</th>
      <th style="padding:6px 10px;text-align:right;">CLV</th>
    </tr>
  </thead>
  <tbody>${rows}
  </tbody>
</table>`
}

function renderFooter(input: RenderRecapInput): string {
  const ts = fmtUtcDateTime(input.asOf)
  const settled = input.newlySettled.length
  const allTime = input.metricsAll.picks
  return `<div style="margin-top:24px;font-family:system-ui,sans-serif;font-size:12px;color:#999;">
  <hr style="border:none;border-top:1px solid #ddd;margin:16px 0;">
  Generated ${ts} · ${settled} settled · ${allTime} graded all-time
</div>`
}

export function renderRecapHtml(input: RenderRecapInput): string {
  const header = `<h2 style="margin:0 0 8px 0;font-family:system-ui,sans-serif;">edge recap</h2>`
  const settled = renderSettledTable(input.newlySettled)
  const headline = renderHeadlineTable(input.metrics7d, input.metrics30d, input.metricsAll)
  const bySport = renderBySportTable(input.metrics7d.bySport)
  const footer = renderFooter(input)

  return `<!doctype html>
<html><body style="background:#fafafa;padding:20px;margin:0;">
<div style="max-width:760px;margin:0 auto;background:white;padding:24px;border-radius:8px;border:1px solid #e5e5e5;">
${header}
${settled}
${headline}
${bySport}
${footer}
</div>
</body></html>`
}

export function buildRecapSubject(input: BuildRecapSubjectInput): string {
  const noun = input.settledCount === 1 ? 'pick' : 'picks'
  return `Edge recap — ${input.settledCount} ${noun} settled, ${units(input.units7d)} (7d)`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/email/render-recap.test.ts`
Expected: all 11 tests pass. If the moneyline-units test fails, double-check the rounding (`-145` → `100/145` → `0.689…` → `+0.69u`).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/email/render-recap.ts tests/email/render-recap.test.ts
git commit -m "$(cat <<'EOF'
feat(email): add recap HTML renderer with rolling totals and settled list

renderRecapHtml produces three blocks: a 3-column rolling-totals table
(7d/30d/all-time), a settled-overnight pick list sorted by graded_at,
and a per-sport breakdown for the 7d window. Empty by-sport input
omits the per-sport block entirely. buildRecapSubject formats the
subject line as "Edge recap — N picks settled, +X.XXu (7d)".

EOF
)"
```

---

## Task 4: Build the `runRecap` orchestrator

**Why:** The orchestrator wires together the new query, the existing aggregator, the new renderer, and the (now-CSV-optional) sender. It also enforces the early-exit-on-empty rule from spec Q5.

**Files:**
- Create: `src/commands/recap.ts`
- Create: `tests/commands/recap.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/commands/recap.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { runRecap } from '../../src/commands/recap.js'
import {
  upsertPick,
  insertPickGrade,
  insertClosingLine,
  type PickRow,
} from '../../src/db/queries.js'
import { createFakeSupabase, type FakeSupabase } from '../helpers/fake-supabase.js'

function makePick(id: string, overrides: Partial<PickRow> = {}): PickRow {
  return {
    id,
    detected_at: '2026-04-07T18:00:00Z',
    sport: 'mlb',
    game_id: id,
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
    ...overrides,
  }
}

const FIXED_NOW = new Date('2026-04-08T09:30:00Z')

describe('runRecap', () => {
  let fake: FakeSupabase

  beforeEach(() => {
    fake = createFakeSupabase()
  })

  it('skips the email when no picks are graded in the last 24h', async () => {
    const send = vi.fn()
    const result = await runRecap({
      supabase: fake as never,
      now: () => FIXED_NOW,
      sendEmail: send,
      resendApiKey: 'unused',
      emailFrom: 'edge <a@b>',
      emailTo: 'me@example.com',
    })
    expect(result.sent).toBe(false)
    expect(result.reason).toMatch(/no picks settled/)
    expect(send).not.toHaveBeenCalled()
  })

  it('sends the email when there is at least one freshly graded pick', async () => {
    await upsertPick(fake as never, makePick('p1'))
    await insertPickGrade(fake as never, {
      pick_id: 'p1',
      outcome: 'won',
      graded_at: '2026-04-08T03:00:00Z',
    })
    await insertClosingLine(fake as never, {
      pick_id: 'p1',
      closed_at: '2026-04-07T22:55:00Z',
      sharp_close: -150,
      sharp_implied: 0.6,
      best_book_close: -145,
      capture_lag_min: -10,
    })
    const send = vi.fn(async () => ({ id: 'resend-123' }))
    const result = await runRecap({
      supabase: fake as never,
      now: () => FIXED_NOW,
      sendEmail: send,
      resendApiKey: 'unused',
      emailFrom: 'edge <a@b>',
      emailTo: 'me@example.com',
    })
    expect(result.sent).toBe(true)
    expect(result.settledCount).toBe(1)
    expect(send).toHaveBeenCalledTimes(1)
    const payload = send.mock.calls[0]![0] as { subject: string; html: string; csvFilename?: string }
    expect(payload.subject).toContain('Edge recap')
    expect(payload.subject).toContain('1 pick settled')
    expect(payload.csvFilename).toBeUndefined() // no CSV attachment
    expect(payload.html).toContain('Yankees ML')
  })

  it('does NOT count picks graded before the 24h cutoff in the settled list', async () => {
    // Two graded picks: one inside cutoff, one outside.
    await upsertPick(fake as never, makePick('inside'))
    await upsertPick(fake as never, makePick('outside', { id: 'outside', game_date: '2026-04-04' }))
    await insertPickGrade(fake as never, {
      pick_id: 'inside',
      outcome: 'won',
      graded_at: '2026-04-08T05:00:00Z',
    })
    await insertPickGrade(fake as never, {
      pick_id: 'outside',
      outcome: 'lost',
      graded_at: '2026-04-05T05:00:00Z', // > 24h before FIXED_NOW
    })
    const send = vi.fn(async () => ({ id: 'resend-123' }))
    const result = await runRecap({
      supabase: fake as never,
      now: () => FIXED_NOW,
      sendEmail: send,
      resendApiKey: 'unused',
      emailFrom: 'edge <a@b>',
      emailTo: 'me@example.com',
    })
    expect(result.sent).toBe(true)
    expect(result.settledCount).toBe(1) // only "inside" appears in the settled block
    // But the older pick is still in the rolling 7d totals (game_date 2026-04-04 is within 7 days of 2026-04-08)
    expect(result.metrics7d.picks).toBe(2)
  })

  it('subject line uses signed 7d units value', async () => {
    await upsertPick(fake as never, makePick('p1'))
    await insertPickGrade(fake as never, {
      pick_id: 'p1',
      outcome: 'won',
      graded_at: '2026-04-08T03:00:00Z',
    })
    const send = vi.fn(async () => ({ id: 'resend-123' }))
    const result = await runRecap({
      supabase: fake as never,
      now: () => FIXED_NOW,
      sendEmail: send,
      resendApiKey: 'unused',
      emailFrom: 'edge <a@b>',
      emailTo: 'me@example.com',
    })
    expect(result.sent).toBe(true)
    const payload = send.mock.calls[0]![0] as { subject: string }
    // -145 won → +0.69u
    expect(payload.subject).toBe('Edge recap — 1 pick settled, +0.69u (7d)')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/commands/recap.test.ts`
Expected: FAIL — `runRecap` does not exist.

- [ ] **Step 3: Create `src/commands/recap.ts`**

```ts
import type { EdgeSupabase } from '../db/client.js'
import {
  getPicksGradedSince,
  getPicksWithGradesInRange,
  getClosingLinesForPicks,
  type GradedPickRow,
} from '../db/queries.js'
import { aggregateMetrics, type RecordMetrics } from '../record/aggregate.js'
import { renderRecapHtml, buildRecapSubject } from '../email/render-recap.js'
import {
  sendReportEmail,
  type SendEmailInput,
  type SendEmailResult,
} from '../email/send.js'

export interface RunRecapInput {
  supabase: EdgeSupabase
  now?: () => Date
  /** Injectable for tests. Defaults to the real Resend-backed sender. */
  sendEmail?: (input: SendEmailInput) => Promise<SendEmailResult>
  resendApiKey: string
  emailFrom: string
  emailTo: string
}

export interface RunRecapResult {
  sent: boolean
  reason?: string
  settledCount: number
  metrics7d: RecordMetrics
  metrics30d: RecordMetrics
  metricsAll: RecordMetrics
  resendId?: string
}

const ALL_TIME_START = '2000-01-01'

function dateMinusDays(d: Date, days: number): string {
  const out = new Date(d)
  out.setUTCDate(out.getUTCDate() - days)
  return out.toISOString().slice(0, 10)
}

export async function runRecap(input: RunRecapInput): Promise<RunRecapResult> {
  const now = input.now ?? (() => new Date())
  const send = input.sendEmail ?? sendReportEmail

  const nowDate = now()
  const cutoffIso = new Date(nowDate.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const newlySettled = await getPicksGradedSince(input.supabase, cutoffIso)

  // Compute window date strings up front so we can return zeroed metrics on the empty path.
  const today = nowDate.toISOString().slice(0, 10)
  const start7 = dateMinusDays(nowDate, 7)
  const start30 = dateMinusDays(nowDate, 30)

  if (newlySettled.length === 0) {
    const empty: RecordMetrics = {
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
    return {
      sent: false,
      reason: 'no picks settled in last 24h',
      settledCount: 0,
      metrics7d: empty,
      metrics30d: empty,
      metricsAll: empty,
    }
  }

  const [pick7d, pick30d, pickAll] = await Promise.all([
    getPicksWithGradesInRange(input.supabase, start7, today),
    getPicksWithGradesInRange(input.supabase, start30, today),
    getPicksWithGradesInRange(input.supabase, ALL_TIME_START, today),
  ])

  // Dedup pick IDs across all four collections, fetch closing lines once.
  const idSet = new Set<string>()
  for (const lst of [newlySettled, pick7d, pick30d, pickAll]) {
    for (const p of lst) idSet.add(p.id)
  }
  const closingLines = await getClosingLinesForPicks(input.supabase, [...idSet])

  const metrics7d = aggregateMetrics({ picks: pick7d, closingLines })
  const metrics30d = aggregateMetrics({ picks: pick30d, closingLines })
  const metricsAll = aggregateMetrics({ picks: pickAll, closingLines })

  const html = renderRecapHtml({
    newlySettled,
    metrics7d,
    metrics30d,
    metricsAll,
    asOf: nowDate,
  })
  const subject = buildRecapSubject({
    settledCount: newlySettled.length,
    units7d: metrics7d.units,
  })

  const sendResult = await send({
    apiKey: input.resendApiKey,
    from: input.emailFrom,
    to: input.emailTo,
    subject,
    html,
  })

  return {
    sent: true,
    settledCount: newlySettled.length,
    metrics7d,
    metrics30d,
    metricsAll,
    resendId: sendResult.id,
  }
}

// Re-export for ergonomic single import in cli.ts
export type { GradedPickRow }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/commands/recap.test.ts`
Expected: all 4 tests pass.

If the third test (`does NOT count picks graded before the 24h cutoff`) is flaky on rounding/date math, sanity check `cutoffIso` against the fixed `FIXED_NOW`: `2026-04-08T09:30:00Z - 24h = 2026-04-07T09:30:00Z`. The "outside" pick has `graded_at: 2026-04-05T05:00:00Z`, which is well before. The "inside" pick has `2026-04-08T05:00:00Z`, which is well after.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/commands/recap.ts tests/commands/recap.test.ts
git commit -m "$(cat <<'EOF'
feat(commands): add runRecap orchestrator for the recap email

Queries newly graded picks (last 24h), computes 7d/30d/all-time metrics
via the existing aggregator with deduped closing-line lookups, renders
the HTML, and sends via the optional-CSV sendReportEmail. Early-exits
without sending when no picks are graded in the last 24h. sendEmail is
injectable for tests.

EOF
)"
```

---

## Task 5: Wire `recap` into the CLI

**Why:** Adds the `edge recap` subcommand so the GitHub Actions workflow has something to invoke.

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Add the subcommand registration**

In `src/cli.ts`, after the existing `program.command('record')` block (somewhere before the final `program.parse(process.argv)` call), append:

```ts
program
  .command('recap')
  .description('Email a recap of recently settled picks and rolling 7d/30d/all-time totals')
  .action(async () => {
    try {
      const env = loadEnv()
      const supabase = createSupabase(env)
      const resendApiKey = process.env.RESEND_API_KEY
      const emailTo = process.env.REPORT_EMAIL_TO
      const emailFrom = process.env.REPORT_EMAIL_FROM
      if (!resendApiKey || !emailTo || !emailFrom) {
        throw new Error(
          'RESEND_API_KEY, REPORT_EMAIL_TO, and REPORT_EMAIL_FROM are required for `edge recap`'
        )
      }
      const { runRecap } = await import('./commands/recap.js')
      const result = await runRecap({
        supabase,
        resendApiKey,
        emailFrom,
        emailTo,
      })
      if (result.sent) {
        process.stdout.write(
          `Sent recap (${result.settledCount} settled, ${result.metrics7d.units >= 0 ? '+' : ''}${result.metrics7d.units.toFixed(2)}u 7d). Resend id: ${result.resendId}\n`
        )
      } else {
        process.stdout.write(`recap: ${result.reason}, skipping email\n`)
      }
    } catch (err) {
      process.stderr.write(`error: ${(err as Error).message}\n`)
      process.exit(1)
    }
  })
```

Note: this passes through `loadEnv()` which validates `ODDS_API_KEY` even though `recap` doesn't need it. This is intentional and matches the existing CLI pattern. The workflow file (Task 6) compensates by passing `ODDS_API_KEY` as a secret.

- [ ] **Step 2: Type-check and run tests**

Run: `npm test`
Expected: all green. (No new tests for the CLI wiring itself — the orchestrator tests cover the logic, and the CLI is a thin wrapper.)

Then run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Smoke-test the help output**

Run: `npx tsx src/cli.ts recap --help`
Expected output includes:

```
Usage: edge recap [options]

Email a recap of recently settled picks and rolling 7d/30d/all-time totals
```

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "$(cat <<'EOF'
feat(cli): register edge recap subcommand

Wires runRecap into the CLI. Validates the three email-related env vars
up front and surfaces a clear error if any are missing. Logs whether
the email was sent or skipped (empty 24h window).

EOF
)"
```

---

## Task 6: Add the GitHub Actions workflow

**Why:** Daily automation. Mirrors the existing `edge-resolve-grade.yml` structure with a 30-min offset to give the grade job time to finish.

**Files:**
- Create: `.github/workflows/edge-recap.yml`

- [ ] **Step 1: Create the workflow file**

```yaml
name: edge recap

on:
  schedule:
    # 09:30 UTC = 30 min after edge-resolve-grade (09:00 UTC).
    # Buffer lets the grade job finish writing edge_pick_grades rows
    # before we read them for the recap email.
    - cron: '30 9 * * *'
  workflow_dispatch:

jobs:
  recap:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci

      - name: Run edge recap
        run: npx tsx src/cli.ts recap
        env:
          # ODDS_API_KEY: not needed by `recap`, but loadEnv() requires it
          # eagerly. Passed defensively to match the close/grade workflows.
          ODDS_API_KEY: ${{ secrets.ODDS_API_KEY }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
          REPORT_EMAIL_TO: ${{ secrets.REPORT_EMAIL_TO }}
          REPORT_EMAIL_FROM: ${{ secrets.REPORT_EMAIL_FROM }}
          EDGE_HOME: ${{ github.workspace }}
```

- [ ] **Step 2: Validate YAML locally (best-effort)**

Run: `npx --yes js-yaml .github/workflows/edge-recap.yml > /dev/null`
Expected: no output, exit 0. (If `js-yaml` isn't available without network, skip — GitHub will validate on push.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/edge-recap.yml
git commit -m "$(cat <<'EOF'
ci(recap): add daily edge recap workflow

Runs at 09:30 UTC, 30 min after edge-resolve-grade, so the grade job
has time to write edge_pick_grades rows before we query them. Passes
ODDS_API_KEY defensively (loadEnv() requires it eagerly) plus the
existing Resend / Supabase secrets.

EOF
)"
```

---

## Task 7: End-to-end smoke verification

**Why:** Final check that all the pieces talk to each other and that no test broke along the way.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 2: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify the recap command boots without sending (empty path)**

Run (locally, with real `.env` populated):

```bash
npx tsx src/cli.ts recap
```

Expected: either
- `recap: no picks settled in last 24h, skipping email` (if Supabase has no recent grades), or
- `Sent recap (N settled, …) Resend id: …` (if there are recent grades — your inbox should receive an email)

If you don't want to actually send during local testing, you can run with a stub by temporarily setting `REPORT_EMAIL_TO=` to an inbox you control, or just let the empty-path log tell you the wiring is correct.

- [ ] **Step 4: Push and trigger the workflow on GitHub**

```bash
git push
gh workflow run edge-recap.yml --ref main
```

Then watch:

```bash
gh run list --workflow=edge-recap.yml --limit 1
gh run view --log
```

Expected: green run, with one of the two log lines from Step 3 in the "Run edge recap" step.

---

## Done

All seven tasks complete. The recap email will now go out daily at 09:30 UTC, 30 minutes after the grade job finishes writing fresh outcomes.
