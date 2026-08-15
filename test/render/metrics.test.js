// test/render/metrics.test.js
//
// The comparison engine. Every number the site publishes is ranked here, so the
// integrity properties live here too: a rank is only published with a
// denominator, ties are counted rather than hidden, and a shared ceiling never
// sorts ahead of a sole placement.
//
// Fixtures are hand-built and tiny on purpose — these must run offline and fast.

import { describe, it, expect } from 'vitest'
import { metricSpecs, sourceBundles, cohortMetrics, buildCohorts, rankAll, standouts } from '../../src/render/metrics.js'
import { DOMAIN_LABELS } from '../../src/normalize/domains.js'

const keys = (specs) => specs.map((s) => s.key)
const spec = (specs, key) => specs.find((s) => s.key === key)

/* ------------------------------------------------------------ metricSpecs -- */

describe('metricSpecs', () => {
  it('declares one spec per domain, using the domain labels rather than raw keys', () => {
    const specs = metricSpecs()
    for (const d of ['achievement', 'progress', 'gaps', 'progress_growth', 'progress_relative']) {
      const s = spec(specs, `domain:${d}`)
      expect(s, `missing spec for domain:${d}`).toBeDefined()
      expect(s.label).toBe(DOMAIN_LABELS[d])
    }
  })

  it('declares three levels for every STAAR subject reported', () => {
    const specs = metricSpecs({ subjects: ['Reading', 'Mathematics'] })
    expect(keys(specs)).toEqual(
      expect.arrayContaining([
        'staar:Reading:0', 'staar:Reading:1', 'staar:Reading:2',
        'staar:Mathematics:0', 'staar:Mathematics:1', 'staar:Mathematics:2',
      ])
    )
  })

  it('declares no STAAR specs for an entity that reports no subjects', () => {
    expect(keys(metricSpecs()).filter((k) => k.startsWith('staar:'))).toHaveLength(0)
  })

  it('declares one spec per CCMR criterion', () => {
    const ccmr = keys(metricSpecs()).filter((k) => k.startsWith('ccmr:'))
    expect(ccmr).toHaveLength(12)
    expect(ccmr[0]).toBe('ccmr:0')
    expect(ccmr[11]).toBe('ccmr:11')
  })

  it('labels every spec in prose a reader can understand, never the raw key', () => {
    const specs = metricSpecs({ subjects: ['Reading'] })
    for (const s of specs) {
      expect(typeof s.label, `spec ${s.key} has a non-string label`).toBe('string')
      expect(s.label.length, `spec ${s.key} has an empty label`).toBeGreaterThan(0)
      expect(s.label, `spec ${s.key} publishes its own key as a label`).not.toBe(s.key)
      expect(s.label).not.toMatch(/^(domain|staar|grad|ccmr):/)
    }
  })

  it('reads the STAAR level names in prose rather than as level indexes', () => {
    const specs = metricSpecs({ subjects: ['Reading'] })
    expect(spec(specs, 'staar:Reading:0').label).toBe('Reading — Approaches')
    expect(spec(specs, 'staar:Reading:1').label).toBe('Reading — Meets')
    expect(spec(specs, 'staar:Reading:2').label).toBe('Reading — Masters')
  })

  it('labels the first CCMR row as readiness rather than as a credit total', () => {
    expect(spec(metricSpecs(), 'ccmr:0').label).toBe('College, career or military ready')
  })

  it('swaps graduation labels for completion labels on an alternative-education entity', () => {
    expect(spec(metricSpecs(), 'grad:0').label).toBe('Four-Year Graduation Rate')
    expect(spec(metricSpecs({ isAlt: true }), 'grad:0').label).toBe('Four-Year Completion Rate')
    // Dropout is dropout under either standard.
    expect(spec(metricSpecs({ isAlt: true }), 'grad:3').label).toBe('Dropout Rate')
  })

  it('aligns a STAAR extractor on subject name, so Reading is never read off Science', () => {
    const specs = metricSpecs({ subjects: ['Reading', 'Science'] })
    // The bundle lists the same two subjects in the OPPOSITE order.
    const b = { subjects: ['Science', 'Reading'], staar: [[10, 70], [5, 40], [1, 20]] }
    expect(spec(specs, 'staar:Reading:0').get(b)).toBe(70)
    expect(spec(specs, 'staar:Science:0').get(b)).toBe(10)
    expect(spec(specs, 'staar:Reading:2').get(b)).toBe(20)
  })

  it('yields null for a subject the entity does not report', () => {
    const specs = metricSpecs({ subjects: ['Reading'] })
    expect(spec(specs, 'staar:Reading:0').get({ subjects: ['Science'], staar: [[10], [5], [1]] })).toBeNull()
    expect(spec(specs, 'staar:Reading:0').get({})).toBeNull()
  })

  it('declares no spec that would resolve to undefined for every entity', () => {
    // Students-per-staff is deliberately absent: toProfile does not carry it.
    expect(keys(metricSpecs())).not.toContain('stuPerStaff')
  })

  it('carries a delta format on every spec so a dollar never reads as a point', () => {
    const specs = metricSpecs({ subjects: ['Reading'] })
    for (const s of specs) expect(['points', 'pct', 'usd', 'ratio']).toContain(s.fmt)
    expect(spec(specs, 'avgSalary').fmt).toBe('usd')
    expect(spec(specs, 'spend').fmt).toBe('usd')
    expect(spec(specs, 'score').fmt).toBe('points')
    expect(spec(specs, 'ecoDis').fmt).toBe('pct')
  })
})

/* --------------------------------------------------------- sourceBundles -- */

const LATEST = '2025-26'

const universe = (over = {}) => ({
  entities: [
    { id: 'd1', level: 'district', regionId: '10' },
    { id: 'd2', level: 'district', regionId: '10' },
  ],
  ratings: [],
  domains: [],
  profile: [],
  finance: [],
  achievement: [],
  latestYear: LATEST,
  ...over,
})

describe('sourceBundles', () => {
  it('builds one bundle per entity, carrying level and region', () => {
    const b = sourceBundles(universe())
    expect([...b.keys()].sort()).toEqual(['d1', 'd2'])
    expect(b.get('d1')).toMatchObject({ id: 'd1', level: 'district', regionId: '10' })
  })

  it('takes the score from the latest year and ignores earlier ones', () => {
    const b = sourceBundles(
      universe({
        ratings: [
          { id: 'd1', year: '2023-24', score: 60 },
          { id: 'd1', year: LATEST, score: 88 },
          { id: 'd1', year: '2024-25', score: 70 },
        ],
      })
    )
    expect(b.get('d1').score).toBe(88)
  })

  it('takes domain scores from the latest year only', () => {
    const b = sourceBundles(
      universe({
        domains: [
          { id: 'd1', year: '2024-25', domain: 'achievement', score: 50 },
          { id: 'd1', year: LATEST, domain: 'achievement', score: 91 },
          { id: 'd1', year: LATEST, domain: 'gaps', score: 77 },
        ],
      })
    )
    expect(b.get('d1').domains).toEqual({ achievement: 91, gaps: 77 })
  })

  it('ignores a domain row for an id that is not an entity', () => {
    const b = sourceBundles(universe({ domains: [{ id: 'ghost', year: LATEST, domain: 'gaps', score: 5 }] }))
    expect(b.has('ghost')).toBe(false)
  })

  it('picks the LATEST finance year, not the first row it sees', () => {
    const rows = [
      { id: 'd1', year: '2021-22', spendEntity: 10_000 },
      { id: 'd1', year: '2024-25', spendEntity: 14_000 },
      { id: 'd1', year: '2022-23', spendEntity: 11_000 },
    ]
    expect(sourceBundles(universe({ finance: rows })).get('d1').spend).toBe(14_000)
    // ...and the same answer when the newest row happens to arrive first.
    expect(sourceBundles(universe({ finance: [...rows].reverse() })).get('d1').spend).toBe(14_000)
  })

  it('reports no spending when the latest finance year has none, rather than reaching back', () => {
    const b = sourceBundles(
      universe({
        finance: [
          { id: 'd1', year: '2021-22', spendEntity: 10_000 },
          { id: 'd1', year: '2024-25', spendEntity: null },
        ],
      })
    )
    expect(b.get('d1').spend).toBeNull()
  })

  it('parses percentage strings off the achievement tab into numbers', () => {
    const b = sourceBundles(
      universe({
        achievement: [
          {
            id: 'd1',
            subject: ['Reading', 'Mathematics'],
            approach: ['80%', '75%'],
            meet: ['55%', '50%'],
            master: ['30%', '25%'],
            grad_rate_col2: ['94.1%', '95%', '96%', '1.2%'],
            ccmr_col2: ['61%', '40%', '12%', '0.0%'],
          },
        ],
      })
    )
    const cur = b.get('d1')
    expect(cur.subjects).toEqual(['Reading', 'Mathematics'])
    expect(cur.staar).toEqual([[80, 75], [55, 50], [30, 25]])
    expect(cur.grad).toEqual([94.1, 95, 96, 1.2])
    expect(cur.ccmr).toEqual([61, 40, 12, 0])
  })

  it("nulls TEA's suppression markers rather than reading them as figures", () => {
    // 'No Data' and '-' are the markers actually present in the snapshot;
    // '(  1.0%)' is TEA's small-cohort masking, which must not become 1.0.
    const b = sourceBundles(
      universe({
        achievement: [
          {
            id: 'd1',
            subject: ['Reading'],
            approach: ['No Data'],
            meet: ['-'],
            master: ['(    1.0%)'],
            grad_rate_col2: ['No Data', '-', '94%', '(    2.0%)'],
          },
        ],
      })
    )
    expect(b.get('d1').staar).toEqual([[null], [null], [null]])
    expect(b.get('d1').grad).toEqual([null, null, 94, null])
  })

  it('BUG (reported, not fixed): a blank or null cell becomes 0 instead of null', () => {
    // numPct does `Number(String(v ?? ''))`, and Number('') is 0 — so a blank
    // dropout cell would publish a real 0.0% and rank the entity first for the
    // lowest dropout rate. No blank cells exist in the 2026-08 snapshot, so this
    // is latent rather than live. Locked down here so a fix is a visible change.
    const b = sourceBundles(
      universe({ achievement: [{ id: 'd1', subject: ['Reading'], approach: [''], meet: [null], master: ['30%'] }] })
    )
    expect(b.get('d1').staar).toEqual([[0], [0], [30]]) // should be [[null], [null], [30]]
  })

  it('ignores a single-element CCMR array, which carries no criteria', () => {
    const b = sourceBundles(universe({ achievement: [{ id: 'd1', ccmr_col2: ['61%'] }] }))
    expect(b.get('d1').ccmr).toBeUndefined()
  })

  it('leaves absent sources undefined rather than filling them with zero', () => {
    const b = sourceBundles(universe())
    const cur = b.get('d1')
    expect(cur.score).toBeUndefined()
    expect(cur.spend).toBeUndefined()
    expect(cur.staar).toBeUndefined()
    expect(cur.domains).toBeUndefined()
  })
})

/* --------------------------------------------------------- cohortMetrics -- */

const scoreSpec = [{ key: 'score', label: 'Overall score', fmt: 'points', get: (s) => s.score }]

const bundleMap = (rows) => new Map(rows.map((r) => [r.id, r]))

describe('cohortMetrics', () => {
  it('averages the finite values in the cohort', () => {
    const b = bundleMap([{ id: 'a', score: 80 }, { id: 'b', score: 90 }])
    expect(cohortMetrics(scoreSpec, b, ['a', 'b'])).toEqual({ score: 85 })
  })

  it('rounds to one decimal place', () => {
    const b = bundleMap([{ id: 'a', score: 1 }, { id: 'b', score: 2 }, { id: 'c', score: 2 }])
    expect(cohortMetrics(scoreSpec, b, ['a', 'b', 'c']).score).toBe(1.7)
  })

  it('averages only finite numbers, skipping nulls, strings and NaN', () => {
    const b = bundleMap([
      { id: 'a', score: 80 },
      { id: 'b', score: null },
      { id: 'c', score: undefined },
      { id: 'd', score: '90' },
      { id: 'e', score: NaN },
      { id: 'f', score: Infinity },
      { id: 'g', score: 100 },
    ])
    // Only 80 and 100 count. A string that looks numeric is NOT quietly coerced.
    expect(cohortMetrics(scoreSpec, b, ['a', 'b', 'c', 'd', 'e', 'f', 'g']).score).toBe(90)
  })

  it('emits no key at all when every value in the cohort is null', () => {
    const b = bundleMap([{ id: 'a', score: null }, { id: 'b', score: null }])
    const out = cohortMetrics(scoreSpec, b, ['a', 'b'])
    expect('score' in out).toBe(false)
    expect(out.score).not.toBe(0)
    expect(out).toEqual({})
  })

  it('emits no key for an empty cohort', () => {
    expect(cohortMetrics(scoreSpec, bundleMap([]), [])).toEqual({})
  })

  it('ignores ids with no bundle rather than counting them as zero', () => {
    const b = bundleMap([{ id: 'a', score: 80 }])
    expect(cohortMetrics(scoreSpec, b, ['a', 'ghost']).score).toBe(80)
  })
})

/* ----------------------------------------------------------- buildCohorts -- */

describe('buildCohorts', () => {
  const entities = Array.from({ length: 6 }, (_, i) => ({
    id: `d${i}`,
    level: 'district',
    regionId: i < 4 ? '10' : '11',
    countyId: i < 2 ? '057' : '113',
  }))
  const bundles = bundleMap(entities.map((e, i) => ({ id: e.id, score: 70 + i })))
  const args = {
    entity: entities[0],
    entities,
    bundles,
    specs: scoreSpec,
    band: { n: 3, ids: new Set(['d0', 'd1', 'd2']) },
    regionName: 'Region 10',
    countyName: 'Dallas',
  }

  it('states an n for every cohort it publishes', () => {
    const { cohorts } = buildCohorts(args)
    for (const c of cohorts) expect(c.n).toBeGreaterThan(0)
    expect(cohorts.map((c) => c.key)).toEqual(['peer', 'region', 'county', 'state'])
    expect(cohorts.find((c) => c.key === 'region').n).toBe(4)
    expect(cohorts.find((c) => c.key === 'county').n).toBe(2)
    expect(cohorts.find((c) => c.key === 'state').n).toBe(6)
  })

  it('always offers the state cohort, even with no peer band', () => {
    const { cohorts } = buildCohorts({ ...args, band: { n: 0, ids: new Set() } })
    expect(cohorts.map((c) => c.key)).not.toContain('peer')
    expect(cohorts.map((c) => c.key)).toContain('state')
  })

  it('drops a cohort of one, which compares an entity against itself', () => {
    const lonely = { ...entities[0], regionId: '99', countyId: '99' }
    const { cohorts } = buildCohorts({ ...args, entity: lonely, entities: [...entities, lonely] })
    expect(cohorts.map((c) => c.key)).not.toContain('region')
    expect(cohorts.map((c) => c.key)).not.toContain('county')
  })

  it('never compares a district against a campus', () => {
    const mixed = [...entities, { id: 'c1', level: 'campus', regionId: '10', countyId: '057' }]
    const { ids } = buildCohorts({ ...args, entities: mixed })
    expect(ids.state).not.toContain('c1')
    expect(ids.region).not.toContain('c1')
  })

  it('returns cohort ids separately and keeps them off the published cohort objects', () => {
    const { cohorts, ids } = buildCohorts(args)
    expect(ids.peer).toEqual(['d0', 'd1', 'd2'])
    for (const c of cohorts) expect(c.ids).toBeUndefined()
  })
})

/* -------------------------------------------------------------- rankAll -- */

const cohortOf = (key, label = 'Texas average') => ({ key, label, short: key, n: 0, metrics: {} })

/** n entities where `id` holds `mine` and the rest hold `others`. */
const ranked = ({ key = 'score', mine, others, entityId = 'me' }) => {
  const s = [{ key, label: 'Overall score', fmt: 'points', get: (b) => b.v }]
  const rows = [{ id: entityId, v: mine }, ...others.map((v, i) => ({ id: `o${i}`, v }))]
  return rankAll({
    entity: { id: entityId },
    cohorts: [cohortOf('state')],
    bundles: bundleMap(rows),
    specs: s,
    cohortIds: { state: rows.map((r) => r.id) },
  })
}

describe('rankAll', () => {
  it('counts strictly better values, so a rank is the number ahead plus one', () => {
    const [r] = ranked({ mine: 90, others: [95, 96, 97, 80, 81, 82, 83, 84, 85, 86, 87] })
    expect(r.rank).toBe(4)
    expect(r.of).toBe(12)
    expect(r.value).toBe(90)
  })

  it('ranks the top value first and the bottom value last', () => {
    const others = Array.from({ length: 11 }, (_, i) => 50 + i)
    expect(ranked({ mine: 100, others })[0].rank).toBe(1)
    expect(ranked({ mine: 1, others })[0].rank).toBe(12)
  })

  it('publishes a denominator alongside every rank', () => {
    for (const r of ranked({ mine: 90, others: Array.from({ length: 20 }, (_, i) => i) })) {
      expect(r.of).toBe(21)
      expect(Number.isInteger(r.of)).toBe(true)
    }
  })

  it('ranks absenteeism ascending, so 1st means the lowest', () => {
    const others = Array.from({ length: 11 }, (_, i) => 10 + i)
    const [low] = ranked({ key: 'absenteeism', mine: 2, others })
    expect(low.rank).toBe(1)
    expect(low.lowerIsBetter).toBe(true)

    const [high] = ranked({ key: 'absenteeism', mine: 99, others })
    expect(high.rank).toBe(12)
  })

  it('ranks the dropout rate ascending too', () => {
    const others = Array.from({ length: 11 }, (_, i) => 5 + i)
    const [r] = ranked({ key: 'grad:3', mine: 1, others })
    expect(r.rank).toBe(1)
    expect(r.lowerIsBetter).toBe(true)
  })

  it('ranks an ordinary metric descending, so the same numbers invert', () => {
    const others = Array.from({ length: 11 }, (_, i) => 10 + i)
    const [r] = ranked({ key: 'attendance', mine: 2, others })
    expect(r.rank).toBe(12)
    expect(r.lowerIsBetter).toBe(false)
  })

  it('skips a cohort smaller than ten, because a rank out of nine is not worth publishing', () => {
    expect(ranked({ mine: 90, others: [1, 2, 3, 4, 5, 6, 7, 8] })).toHaveLength(0) // 9 values
    expect(ranked({ mine: 90, others: [1, 2, 3, 4, 5, 6, 7, 8, 9] })).toHaveLength(1) // 10 values
  })

  it('counts only entities with a value toward the ten, not empty ones', () => {
    // 12 ids, but only 9 carry a finite value: below the floor, so nothing publishes.
    const nulls = Array.from({ length: 3 }, () => null)
    expect(ranked({ mine: 90, others: [...Array.from({ length: 8 }, (_, i) => i), ...nulls] })).toHaveLength(0)
  })

  it('counts the other entities sharing the exact value as ties', () => {
    const [r] = ranked({ mine: 100, others: [100, 100, 100, 90, 80, 70, 60, 50, 40, 30, 20] })
    expect(r.rank).toBe(1)
    expect(r.tied).toBe(3) // three OTHERS at 100, not four
    expect(r.of).toBe(12)
  })

  it('reports zero ties when the value is unique', () => {
    const [r] = ranked({ mine: 100, others: Array.from({ length: 11 }, (_, i) => i) })
    expect(r.tied).toBe(0)
  })

  it('publishes nothing for a metric the entity itself does not report', () => {
    expect(ranked({ mine: null, others: Array.from({ length: 15 }, (_, i) => i) })).toHaveLength(0)
    expect(ranked({ mine: undefined, others: Array.from({ length: 15 }, (_, i) => i) })).toHaveLength(0)
  })

  it('gives a top placement the highest percentile and a bottom placement the lowest', () => {
    const others = Array.from({ length: 19 }, (_, i) => i)
    expect(ranked({ mine: 1000, others })[0].pctile).toBe(100)
    expect(ranked({ mine: -1, others })[0].pctile).toBe(5)
  })

  it('carries the cohort identity onto every row so a claim can name its group', () => {
    const rows = ranked({ mine: 90, others: Array.from({ length: 11 }, (_, i) => i) })
    for (const r of rows) {
      expect(r.cohort).toBe('state')
      expect(r.cohortLabel).toBe('Texas average')
      expect(r.cohortShort).toBe('state')
      expect(r.label).toBe('Overall score')
    }
  })

  it('ranks the entity once per cohort per metric', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `o${i}`)
    const bundles = bundleMap([{ id: 'me', v: 90 }, ...ids.map((id, i) => ({ id, v: i }))])
    const out = rankAll({
      entity: { id: 'me' },
      cohorts: [cohortOf('state'), cohortOf('region', 'Region 10')],
      bundles,
      specs: [{ key: 'score', label: 'Overall score', fmt: 'points', get: (b) => b.v }],
      cohortIds: { state: ['me', ...ids], region: ['me', ...ids.slice(0, 11)] },
    })
    expect(out).toHaveLength(2)
    expect(out.map((r) => r.cohort)).toEqual(['state', 'region'])
    expect(out.map((r) => r.of)).toEqual([13, 12])
  })
})

/* ------------------------------------------------------------ standouts -- */

const rank = (over = {}) => ({
  metric: 'score', label: 'Overall score', fmt: 'points',
  cohort: 'state', cohortLabel: 'Texas average', cohortShort: 'state',
  rank: 1, of: 100, pctile: 100, value: 100, tied: 0, lowerIsBetter: false,
  ...over,
})

describe('standouts', () => {
  it('sorts a sole placement ahead of a heavily-tied one, even a tied FIRST place', () => {
    const sole = rank({ metric: 'sole', rank: 3, of: 50, tied: 0 })
    const shared = rank({ metric: 'shared', rank: 1, of: 1084, tied: 213 })
    const out = standouts([shared, sole])
    expect(out.map((r) => r.metric)).toEqual(['sole', 'shared'])
  })

  it('never lets a shared ceiling lead the list', () => {
    // 213 districts share a 100% graduation rate. That is not a sole first place.
    const shared = rank({ metric: 'grad:0', label: 'Four-Year Graduation Rate', rank: 1, of: 1084, tied: 213 })
    const modest = rank({ metric: 'score', rank: 9, of: 1084, tied: 0, pctile: 99 })
    expect(standouts([shared, modest])[0].metric).toBe('score')
  })

  it('treats a tie within two percent of the cohort as still distinct', () => {
    const ok = rank({ metric: 'ok', rank: 2, of: 100, tied: 2 })
    const demoted = rank({ metric: 'demoted', rank: 1, of: 100, tied: 3 })
    expect(standouts([demoted, ok]).map((r) => r.metric)).toEqual(['ok', 'demoted'])
  })

  it('allows up to two ties in a small cohort, where two percent rounds to nothing', () => {
    const ok = rank({ metric: 'ok', rank: 4, of: 20, tied: 2 })
    const demoted = rank({ metric: 'demoted', rank: 1, of: 20, tied: 3 })
    expect(standouts([demoted, ok]).map((r) => r.metric)).toEqual(['ok', 'demoted'])
  })

  it('keeps the demoted placement rather than deleting it, so nothing is hidden', () => {
    const shared = rank({ metric: 'shared', rank: 1, of: 500, tied: 200 })
    expect(standouts([shared])).toHaveLength(1)
    expect(standouts([shared])[0].tied).toBe(200)
  })

  it('includes a top-ten rank and a 95th-percentile rank, and nothing else', () => {
    const top = rank({ metric: 'top', rank: 10, of: 1000, pctile: 99 })
    const pct95 = rank({ metric: 'pct', rank: 40, of: 1000, pctile: 96 })
    const nope = rank({ metric: 'nope', rank: 11, of: 1000, pctile: 94 })
    expect(standouts([top, pct95, nope]).map((r) => r.metric).sort()).toEqual(['pct', 'top'])
  })

  it('prefers the larger cohort when two placements share a rank', () => {
    const small = rank({ metric: 'small', rank: 2, of: 30 })
    const big = rank({ metric: 'big', rank: 2, of: 1000 })
    expect(standouts([small, big]).map((r) => r.metric)).toEqual(['big', 'small'])
  })

  it('caps the list, and the cap is configurable', () => {
    const many = Array.from({ length: 40 }, (_, i) => rank({ metric: `m${i}`, rank: (i % 10) + 1 }))
    expect(standouts(many)).toHaveLength(12)
    expect(standouts(many, { limit: 3 })).toHaveLength(3)
  })

  it('returns nothing when there is nothing to boast about', () => {
    expect(standouts([])).toEqual([])
    expect(standouts([rank({ rank: 500, of: 1000, pctile: 50 })])).toEqual([])
  })
})
