import { describe, expect, it } from 'vitest'
import { buildHighlights, isHighlightMetric } from '../../src/render/highlights.js'

const spec = (key, label, fmt = 'pct', dir = 'higher') => ({ key, label, fmt, dir })
const SPECS = [
  spec('score', 'Overall score', 'points'),
  spec('domain:achievement', 'Student Achievement', 'points'),
  spec('domain:progress', 'School Progress', 'points'),
  spec('domain:gaps', 'Closing the Gaps', 'points'),
  spec('staar:Math:1', 'Math — Meets'),
  spec('staar:Math:2', 'Math — Masters'),
  spec('ccmr:3', 'Met criterion score on AP/IB exam(s)'),
  spec('grad:3', 'Dropout Rate', 'pct', 'lower'),
  spec('attendance', 'Attendance'),
  spec('absenteeism', 'Chronically absent', 'pct', 'lower'),
  spec('ecoDis', 'Economically disadvantaged'),
  spec('avgSalary', 'Average teacher salary', 'usd'),
  spec('spend', 'Per-student spending', 'usd'),
]

const years = { latestYear: '2025-26', previousYear: '2024-25' }
const cohort = (key, n, metrics = {}, metricN = {}) => ({
  key,
  label: key === 'state' ? 'Texas average' : 'Similar economic-disadvantage rate',
  n,
  metrics,
  metricN,
})
const rank = (over = {}) => ({
  metric: 'score',
  label: 'Overall score',
  fmt: 'points',
  cohort: 'state',
  cohortLabel: 'Texas average',
  rank: 1,
  of: 100,
  tied: 0,
  value: 80,
  lowerIsBetter: false,
  ...over,
})

describe('isHighlightMetric', () => {
  it('allows academic outcomes and rejects context, staffing and spending', () => {
    expect(SPECS.filter((item) => isHighlightMetric(item.key)).map((item) => item.key)).toEqual([
      'score',
      'domain:achievement',
      'domain:progress',
      'domain:gaps',
      'staar:Math:1',
      'staar:Math:2',
      'ccmr:3',
      'grad:3',
      'attendance',
      'absenteeism',
    ])
  })

  it('does not allow STAAR Approaches as a highlight metric', () => {
    expect(isHighlightMetric('staar:Math:0')).toBe(false)
  })
})

describe('buildHighlights', () => {
  it('builds the four evidence-backed Spring-style signals and merges evidence for Closing the Gaps', () => {
    const own = {
      score: 76,
      'domain:gaps': 77,
      'staar:Math:1': 35,
      'staar:Math:2': 13,
      'ccmr:3': 13.7,
    }
    const state = cohort('state', 1_019, {
      score: 81.7,
      'domain:gaps': 79.1,
      'staar:Math:1': 43.3,
      'staar:Math:2': 16.2,
      'ccmr:3': 8,
    }, {
      score: 1_019,
      'domain:gaps': 1_019,
      'staar:Math:1': 1_000,
      'staar:Math:2': 1_000,
      'ccmr:3': 981,
    })
    const peer = cohort('peer', 217, {
      score: 77.2,
      'domain:gaps': 74.7,
      'staar:Math:1': 33.8,
      'staar:Math:2': 11.5,
      'ccmr:3': 6.6,
    }, Object.fromEntries(Object.keys(own).map((key) => [key, 217])))

    const out = buildHighlights({
      history: [
        { year: '2025-26', method: 'current', score: 76 },
        { year: '2024-25', method: 'current', score: 65 },
        { year: '2021-22', method: 'original', score: 81 },
      ],
      domainHistory: [
        { domain: 'gaps', year: '2025-26', score: 77 },
        { domain: 'gaps', year: '2024-25', score: 69 },
        { domain: 'achievement', year: '2025-26', score: 72 },
        { domain: 'achievement', year: '2024-25', score: 68 },
      ],
      own,
      cohorts: [peer, state],
      specs: SPECS,
      ranks: [rank({ metric: 'domain:gaps', label: 'Closing the Gaps', cohort: 'peer', cohortLabel: peer.label, rank: 3, of: 217 })],
      recentChangeRanks: [rank({ metric: 'domain:gaps', label: 'Closing the Gaps', cohort: 'state', rank: 2, of: 1_019 })],
      ...years,
    })

    expect(out.map((card) => card.id)).toEqual([
      'gain:score',
      'gain:domain:gaps',
      'subject:math:peer',
      'benchmark:ccmr:3',
    ])

    const score = out[0]
    expect(score.evidence).toEqual([
      expect.objectContaining({ kind: 'change', fromValue: 65, toValue: 76, delta: 11, previousYear: '2024-25', latestYear: '2025-26' }),
    ])

    const gaps = out[1]
    expect(gaps.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'change', fromValue: 69, toValue: 77, delta: 8 }),
      expect.objectContaining({ kind: 'benchmark', cohort: 'peer', value: 77, benchmark: 74.7, advantage: 2.3, metricN: 217 }),
      expect.objectContaining({ kind: 'rank', period: 'current', cohort: 'peer', rank: 3, of: 217 }),
      expect.objectContaining({ kind: 'rank', period: 'change', cohort: 'state', rank: 2, of: 1_019 }),
    ]))

    expect(out[2].evidence.filter((item) => item.kind === 'benchmark')).toEqual([
      expect.objectContaining({ metric: 'staar:Math:1', cohort: 'peer', value: 35, benchmark: 33.8, advantage: 1.2 }),
      expect.objectContaining({ metric: 'staar:Math:2', cohort: 'peer', value: 13, benchmark: 11.5, advantage: 1.5 }),
    ])
    expect(out[3].evidence).toEqual([
      expect.objectContaining({ kind: 'benchmark', metric: 'ccmr:3', cohort: 'state', value: 13.7, benchmark: 8, advantage: 5.7 }),
    ])
  })

  it('uses only the adjacent named years and never reaches back for a gain', () => {
    const base = {
      history: [
        { year: '2025-26', score: 76 },
        { year: '2024-25', score: 76 },
        { year: '2023-24', score: 60 },
      ],
      specs: SPECS,
      ...years,
    }
    expect(buildHighlights(base)).toEqual([])
    expect(buildHighlights({ ...base, previousYear: '2023-24' })).toEqual([])
  })

  it('takes only the strongest qualifying domain gain and breaks ties deterministically', () => {
    const out = buildHighlights({
      history: [],
      domainHistory: [
        { domain: 'achievement', year: '2024-25', score: 70 },
        { domain: 'achievement', year: '2025-26', score: 74 },
        { domain: 'progress', year: '2024-25', score: 71 },
        { domain: 'progress', year: '2025-26', score: 78 },
        { domain: 'gaps', year: '2024-25', score: 68 },
        { domain: 'gaps', year: '2025-26', score: 75 },
      ],
      specs: SPECS,
      ...years,
    })
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual(expect.objectContaining({ metric: 'domain:gaps', previousYear: '2024-25', latestYear: '2025-26' }))
  })

  it('requires the benchmark margin, reporting floor and 80% coverage', () => {
    const own = { 'domain:gaps': 80, attendance: 95 }
    const state = cohort('state', 100, { 'domain:gaps': 78.1, attendance: 94.1 }, { 'domain:gaps': 79, attendance: 90 })
    const peer = cohort('peer', 25, { 'domain:gaps': 78, attendance: 94.1 }, { 'domain:gaps': 19, attendance: 20 })
    // Gaps misses the 2-point margin against state and reporting floor against
    // peer. Attendance misses its 1-point percentage margin against state.
    expect(buildHighlights({ own, cohorts: [state, peer], specs: SPECS, ...years })).toEqual([])
  })

  it('handles lower-is-better percentages using the improvement direction', () => {
    const out = buildHighlights({
      own: { 'grad:3': 1.2, absenteeism: 8 },
      cohorts: [cohort('state', 100, { 'grad:3': 2.5, absenteeism: 11 }, { 'grad:3': 90, absenteeism: 100 })],
      specs: SPECS,
      ...years,
    })
    expect(out.map((card) => card.metric)).toEqual(['grad:3', 'absenteeism'])
    expect(out[0].evidence[0]).toEqual(expect.objectContaining({ advantage: 1.3, lowerIsBetter: true }))
    expect(out[1].evidence[0]).toEqual(expect.objectContaining({ advantage: 3, lowerIsBetter: true }))
  })

  it('allows only a distinct current top-three placement and reports its tie', () => {
    const out = buildHighlights({
      specs: SPECS,
      ranks: [
        rank({ metric: 'attendance', label: 'Attendance', rank: 3, of: 100, tied: 2 }),
        rank({ metric: 'ccmr:3', label: 'AP/IB', rank: 1, of: 100, tied: 3 }),
        rank({ metric: 'domain:gaps', label: 'Closing the Gaps', rank: 4, of: 100, tied: 0 }),
      ],
      ...years,
    })
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual(expect.objectContaining({ kind: 'rank', metric: 'attendance' }))
    expect(out[0].evidence[0]).toEqual(expect.objectContaining({ rank: 3, tied: 2 }))
  })

  it('uses a change rank to strengthen a gain card, not to create repetitive rank-only cards', () => {
    const out = buildHighlights({
      history: [
        { year: '2025-26', score: 76 },
        { year: '2024-25', score: 65 },
      ],
      domainHistory: [
        { domain: 'gaps', year: '2025-26', score: 77 },
        { domain: 'gaps', year: '2024-25', score: 63 },
      ],
      specs: SPECS,
      recentChangeRanks: [
        rank({ metric: 'score', cohort: 'region', rank: 1, of: 46, value: 11 }),
        rank({ metric: 'domain:gaps', cohort: 'region', rank: 1, of: 46, value: 14 }),
        rank({ metric: 'domain:progress', cohort: 'region', rank: 1, of: 46, value: 9 }),
      ],
      ...years,
    })
    expect(out.map((card) => card.id)).toEqual(['gain:score', 'gain:domain:gaps'])
    expect(out.every((card) => card.evidence.some((evidence) => evidence.kind === 'rank'))).toBe(true)
  })

  it('prefers a qualifying state benchmark over peer evidence for the same metric', () => {
    const out = buildHighlights({
      own: { 'ccmr:3': 20 },
      cohorts: [
        cohort('peer', 100, { 'ccmr:3': 5 }, { 'ccmr:3': 100 }),
        cohort('state', 1_000, { 'ccmr:3': 10 }, { 'ccmr:3': 900 }),
      ],
      specs: SPECS,
      ...years,
    })
    expect(out[0].evidence[0]).toEqual(expect.objectContaining({ cohort: 'state', benchmark: 10 }))
  })

  it('requires both Meets and Masters before calling a STAAR subject above average', () => {
    const state = cohort('state', 100, {
      'staar:Math:1': 40,
      'staar:Math:2': 20,
      'staar:Reading:1': 40,
      'staar:Reading:2': 20,
    }, {
      'staar:Math:1': 100,
      'staar:Math:2': 100,
      'staar:Reading:1': 100,
      'staar:Reading:2': 100,
    })
    const specs = [
      spec('staar:Math:1', 'Math — Meets'),
      spec('staar:Math:2', 'Math — Masters'),
      spec('staar:Reading:1', 'Reading — Meets'),
      spec('staar:Reading:2', 'Reading — Masters'),
    ]
    const out = buildHighlights({
      own: {
        'staar:Math:1': 42,
        'staar:Math:2': 22,
        'staar:Reading:1': 42,
        'staar:Reading:2': 20.5,
      },
      cohorts: [state],
      specs,
      ...years,
    })
    expect(out.map((card) => card.id)).toEqual(['subject:math:state'])
    expect(out[0].metrics).toEqual(['staar:Math:1', 'staar:Math:2'])
  })

  it('never emits an unsupported fallback and caps output at four', () => {
    expect(buildHighlights({ specs: SPECS, ...years })).toEqual([])

    const manySpecs = Array.from({ length: 8 }, (_, i) => spec(`ccmr:${i}`, `CCMR ${i}`))
    const own = Object.fromEntries(manySpecs.map((item) => [item.key, 50]))
    const metrics = Object.fromEntries(manySpecs.map((item) => [item.key, 40]))
    const metricN = Object.fromEntries(manySpecs.map((item) => [item.key, 100]))
    const out = buildHighlights({ own, cohorts: [cohort('state', 100, metrics, metricN)], specs: manySpecs, limit: 99, ...years })
    expect(out).toHaveLength(4)
  })

  it('rejects non-academic rank rows even when they are first', () => {
    const out = buildHighlights({
      specs: SPECS,
      ranks: [
        rank({ metric: 'ecoDis', label: 'Economically disadvantaged' }),
        rank({ metric: 'avgSalary', label: 'Average teacher salary' }),
        rank({ metric: 'spend', label: 'Per-student spending' }),
      ],
      ...years,
    })
    expect(out).toEqual([])
  })
})
