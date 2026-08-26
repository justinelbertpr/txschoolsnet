// test/render/view-model.test.js
//
// The view model is the only place that touches raw tables, so the URL identity
// of every page and the composition of every comparison group are decided here.
// Fixtures are hand-built: no snapshot reads, no I/O.

import { describe, it, expect } from 'vitest'
import {
  CLASS_SIZE_CATEGORIES,
  buildViewModel,
  peerBand,
  entitySlug,
  slugify,
} from '../../src/render/view-model.js'

/* ---------------------------------------------------------------- slugify -- */

describe('slugify', () => {
  it('lowercases and joins words with dashes', () => {
    expect(slugify('Dallas ISD')).toBe('dallas-isd')
  })

  it('collapses punctuation into a single dash', () => {
    expect(slugify("St. John's H.S.")).toBe('st-john-s-h-s')
    expect(slugify('A -- B')).toBe('a-b')
    expect(slugify('A   B')).toBe('a-b')
    expect(slugify('A/B & C')).toBe('a-b-c')
  })

  it('strips leading and trailing dashes', () => {
    expect(slugify('  Cayuga H S  ')).toBe('cayuga-h-s')
    expect(slugify('#1 Academy!')).toBe('1-academy')
    expect(slugify('---x---')).toBe('x')
  })

  it('keeps digits, which carry meaning in campus names', () => {
    expect(slugify('P S 123 Elementary')).toBe('p-s-123-elementary')
  })

  it('produces an empty slug for a name with nothing sluggable, rather than throwing', () => {
    expect(slugify('!!!')).toBe('')
    expect(slugify('')).toBe('')
  })

  it('drops non-ASCII letters rather than mangling them', () => {
    // Documented behaviour: the id suffix is what makes the URL unique anyway.
    expect(slugify('Ysleta ISD')).toBe('ysleta-isd')
    expect(slugify('Peña Blanca')).toBe('pe-a-blanca')
  })
})

/* ------------------------------------------------------------- entitySlug -- */

describe('entitySlug', () => {
  it('appends the id, because names are not unique', () => {
    expect(entitySlug({ name: 'Dallas ISD', id: '057905' })).toBe('dallas-isd-057905')
    expect(entitySlug({ name: 'Cayuga H S', id: '001902001' })).toBe('cayuga-h-s-001902001')
  })

  it('distinguishes two entities that share a name', () => {
    const a = entitySlug({ name: 'Highland Park ISD', id: '057911' })
    const b = entitySlug({ name: 'Highland Park ISD', id: '227901' })
    expect(a).not.toBe(b)
    expect(a.endsWith('-057911')).toBe(true)
  })

  it('preserves the leading zero of a TEA id', () => {
    expect(entitySlug({ name: 'X', id: '001902' })).toBe('x-001902')
  })
})

/* --------------------------------------------------------------- peerBand -- */

const ent = (id, level = 'district') => ({ id, level })

describe('peerBand', () => {
  const entities = [
    ent('d0'), ent('d1'), ent('d2'), ent('d3'),
    ent('c0', 'campus'), ent('c1', 'campus'),
  ]
  const ecoDis = new Map([
    ['d0', 50], // the entity itself
    ['d1', 60], // exactly +10: inside
    ['d2', 40], // exactly -10: inside
    ['d3', 61], // +11: outside
    ['c0', 50], // same eco-dis, wrong level
    ['c1', 51],
  ])

  it('selects entities within ten points of the eco-dis share, inclusive', () => {
    const band = peerBand({ entity: ent('d0'), entities, ecoDis })
    expect([...band.ids].sort()).toEqual(['d0', 'd1', 'd2'])
    expect(band.n).toBe(3)
  })

  it('excludes an entity more than ten points away', () => {
    expect(peerBand({ entity: ent('d0'), entities, ecoDis }).ids.has('d3')).toBe(false)
  })

  it('excludes other levels, so a district is never banded with a campus', () => {
    const band = peerBand({ entity: ent('d0'), entities, ecoDis })
    expect(band.ids.has('c0')).toBe(false)
    expect(band.ids.has('c1')).toBe(false)
  })

  it('bands a campus only against campuses', () => {
    const band = peerBand({ entity: ent('c0', 'campus'), entities, ecoDis })
    expect([...band.ids].sort()).toEqual(['c0', 'c1'])
  })

  it('includes the entity itself, so the band is never empty for a reported entity', () => {
    expect(peerBand({ entity: ent('d0'), entities, ecoDis }).ids.has('d0')).toBe(true)
  })

  it('excludes entities with no eco-dis figure rather than treating them as zero', () => {
    const sparse = new Map([['d0', 50], ['d1', 52]])
    const band = peerBand({ entity: ent('d0'), entities, ecoDis: sparse })
    expect([...band.ids].sort()).toEqual(['d0', 'd1'])
  })

  it('yields no band at all when the entity itself has no eco-dis figure', () => {
    const band = peerBand({ entity: ent('dX'), entities, ecoDis })
    expect(band.n).toBe(0)
    expect(band.ids.size).toBe(0)
  })
})

/* --------------------------------------------------------- buildViewModel -- */

const LATEST = '2025-26'
const YEARS = ['2023-24', '2024-25', LATEST]

/** Twelve districts, so cohorts clear rankAll's floor of ten. */
const makeUniverse = () => {
  const entities = Array.from({ length: 12 }, (_, i) => ({
    id: String(100 + i),
    level: 'district',
    districtId: null,
    districtName: null,
    name: `District ${i} ISD`,
    regionId: '10',
    countyId: '057',
    county: 'Dallas',
    entityType: 'Traditional',
    isCharter: false,
    isAlt: false,
    campusType: null,
    enrollment: 1000 + i * 10,
    rating: 'B',
    score: 70 + i,
    multYear: 0,
  }))

  const ratings = entities.flatMap((e, i) =>
    YEARS.map((year, y) => ({ id: e.id, year, method: 'current', rating: 'B', score: 60 + i + y * 2 }))
  )

  const domains = entities.flatMap((e, i) => [
    { id: e.id, year: LATEST, domain: 'achievement', score: 70 + i, grade: 'B', toNextGrade: 3 },
    { id: e.id, year: '2024-25', domain: 'achievement', score: 40, grade: 'F', toNextGrade: 20 },
    { id: e.id, year: LATEST, domain: 'gaps', score: 65 + i, grade: 'C', toNextGrade: 1 },
  ])

  const profile = entities.map((e, i) => ({
    id: e.id,
    total: 1000 + i,
    ecoDisPct: 50 + i * 0.5, // all within the ±10 band of each other
    specEdPct: 10,
    engLrnPct: 20,
    attendance: 94,
    absenteeism: 12 - i * 0.1,
    avgSalary: 58_000 + i * 100,
    schoolYear: LATEST,
  }))

  const finance = entities.flatMap((e, i) => [
    { id: e.id, year: '2022-23', spendEntity: 10_000, spendPeer: 10_500, spendState: 11_000 },
    { id: e.id, year: '2023-24', spendEntity: 12_000 + i * 50, spendPeer: 12_500, spendState: 13_000 },
  ])

  const achievement = entities.map((e, i) => ({
    id: e.id,
    subject: ['Reading', 'Mathematics'],
    approach: [`${70 + i}%`, `${65 + i}%`],
    meet: ['50%', '45%'],
    master: ['25%', '20%'],
    grad_rate_col2: ['94%', '95%', '96%', `${2 + i * 0.1}%`],
    ccmr_col2: Array.from({ length: 12 }, (_, k) => `${k * 5}%`),
    ccmr_col3: Array.from({ length: 12 }, (_, k) => `${k * 4}%`),
  }))

  return { entities, ratings, domains, profile, finance, achievement }
}

const build = (over = {}) => {
  const u = makeUniverse()
  const entity = over.entity ?? u.entities[0]
  return buildViewModel({
    entity,
    entities: u.entities,
    ratings: u.ratings,
    allRatings: u.ratings,
    domains: u.domains,
    finance: u.finance,
    profile: u.profile,
    achievement: u.achievement,
    raw: { region: 'Region 10', Enrollment: [10, 40, 45, 1, 3, 0, 1], Staff_Years: [5, 30, 25, 20, 15, 5] },
    snapshotDate: '15 August 2026',
    latestYear: LATEST,
    previousYear: '2024-25',
    ...over,
  })
}

describe('buildViewModel', () => {
  it('carries the URL identity of the page', () => {
    const vm = build()
    expect(vm.slug).toBe('district-0-isd-100')
    expect(vm.countySlug).toBe('dallas')
    expect(vm.regionName).toBe('Region 10')
  })

  it('falls back to a numbered region name when the raw record has none', () => {
    expect(build({ raw: {} }).regionName).toBe('Region 10')
  })

  it('orders history newest first', () => {
    const vm = build()
    expect(vm.history.map((h) => h.year)).toEqual([LATEST, '2024-25', '2023-24'])
  })

  it('filters enrollment history to this entity and orders valid school years oldest first', () => {
    const vm = build({
      enrollmentHistory: [
        { id: '100', level: 'district', year: '2025-26', enrollment: 1_120 },
        { id: '101', level: 'district', year: '2024-25', enrollment: 99_999 },
        { id: '100', level: 'campus', year: '2024-25', enrollment: 88_888 },
        { id: '100', level: 'district', year: '2023-24', enrollment: 1_000 },
        { id: '100', level: 'district', year: '2024-25', enrollment: 1_100 },
        { id: '100', level: 'district', year: 'not-a-year', enrollment: 7 },
        { id: '100', level: 'district', year: '2022-23', enrollment: null },
      ],
    })
    expect(vm.enrollmentHistory.map(({ year, enrollment }) => ({ year, enrollment }))).toEqual([
      { year: '2023-24', enrollment: 1_000 },
      { year: '2024-25', enrollment: 1_100 },
      { year: '2025-26', enrollment: 1_120 },
    ])
    expect(vm.enrollmentReported).toEqual([
      { year: '2022-23', enrollment: null },
      { year: '2023-24', enrollment: 1_000 },
      { year: '2024-25', enrollment: 1_100 },
      { year: '2025-26', enrollment: 1_120 },
    ])
  })

  it('calculates adjacent-year and full contiguous enrollment changes without judging them', () => {
    const vm = build({
      enrollmentHistory: [
        { id: '100', level: 'district', year: '2023-24', enrollment: 1_000 },
        { id: '100', level: 'district', year: '2024-25', enrollment: 1_200 },
        { id: '100', level: 'district', year: '2025-26', enrollment: 1_100 },
      ],
    })
    expect(vm.enrollmentTrend.latest).toMatchObject({ year: '2025-26', enrollment: 1_100 })
    expect(vm.enrollmentTrend.yoy).toMatchObject({
      fromYear: '2024-25', toYear: '2025-26', from: 1_200, to: 1_100, delta: -100,
    })
    expect(vm.enrollmentTrend.yoy.pct).toBeCloseTo(-8.333, 3)
    expect(vm.enrollmentTrend.sinceFirst).toMatchObject({ fromYear: '2023-24', delta: 100, pct: 10 })
    expect(vm.enrollmentTrend.contiguous).toBe(true)
  })

  it('keeps a missing school year as a gap rather than comparing non-adjacent counts', () => {
    const vm = build({
      enrollmentHistory: [
        { id: '100', level: 'district', year: '2023-24', enrollment: 1_000 },
        { id: '100', level: 'district', year: '2025-26', enrollment: 1_500 },
      ],
    })
    expect(vm.enrollmentTrend.yoy).toBeNull()
    expect(vm.enrollmentTrend.sinceFirst).toBeNull()
    expect(vm.enrollmentTrend.contiguous).toBe(false)
    expect(vm.enrollmentHistory[1].change).toBeNull()
  })

  it('does not create a trend section from a lone enrollment count', () => {
    const vm = build({ enrollmentHistory: [{ id: '100', level: 'district', year: '2025-26', enrollment: 1_100 }] })
    expect(vm.enrollmentHistory).toHaveLength(1)
    expect(vm.enrollmentTrend).toBeNull()
  })

  it('keeps the absolute change but omits a percentage when the prior count is zero', () => {
    const vm = build({
      enrollmentHistory: [
        { id: '100', level: 'district', year: '2024-25', enrollment: 0 },
        { id: '100', level: 'district', year: '2025-26', enrollment: 25 },
      ],
    })
    expect(vm.enrollmentTrend.yoy).toMatchObject({ delta: 25, pct: null })
  })

  it('selects only fixed latest-year gains for the early evidence summary', () => {
    const vm = build()
    expect(vm.highlights.map((card) => card.id).slice(0, 2)).toEqual([
      'gain:score',
      'gain:domain:achievement',
    ])
    expect(vm.highlights[0].evidence[0]).toMatchObject({
      kind: 'change',
      fromValue: 62,
      toValue: 64,
      previousYear: '2024-25',
      latestYear: LATEST,
    })
    expect(vm.highlights[1].evidence[0]).toMatchObject({
      kind: 'change',
      fromValue: 40,
      toValue: 70,
    })
  })

  it('merges a precomputed recent-change placement into the matching gain', () => {
    const vm = build({
      recentChangeRanks: [{
        metric: 'score', label: 'Overall score', fmt: 'points', cohort: 'region',
        cohortLabel: 'Region 10', rank: 1, of: 12, tied: 0, value: 2,
        fromYear: '2024-25', toYear: LATEST,
      }],
    })
    expect(vm.highlights.find((card) => card.metric === 'score').evidence).toContainEqual(
      expect.objectContaining({ kind: 'rank', period: 'change', rank: 1, of: 12, cohortLabel: 'Region 10' })
    )
  })

  it('publishes a denominator with every rank it states', () => {
    const vm = build()
    expect(vm.rankOf).toBe(12)
    expect(vm.regionRankOf).toBe(12)
    expect(vm.rank).toBeGreaterThanOrEqual(1)
    expect(vm.rank).toBeLessThanOrEqual(vm.rankOf)
  })

  it('ranks the lowest-scoring district last', () => {
    // District 0 has the lowest latest score in the fixture.
    expect(build().rank).toBe(12)
    expect(build({ entity: makeUniverse().entities[11] }).rank).toBe(1)
  })

  it('states an n for every comparison line it offers', () => {
    const vm = build()
    expect(vm.comparisons.length).toBeGreaterThan(1)
    for (const c of vm.comparisons) {
      expect(c.n).toBeGreaterThan(0)
      expect(Object.keys(c.byYear).length).toBeGreaterThan(0)
      expect(Object.keys(c.reportingNByYear).length).toBeGreaterThan(0)
      for (const year of Object.keys(c.byYear)) {
        expect(c.reportingNByYear[year]).toBeGreaterThan(0)
        expect(c.reportingNByYear[year]).toBeLessThanOrEqual(c.n)
      }
    }
    expect(vm.comparisons.map((c) => c.key)).toContain('state')
  })

  it('states an n and a note on the peer band', () => {
    const vm = build()
    const peer = vm.comparisons.find((c) => c.key === 'peer')
    expect(peer.n).toBe(vm.peerN)
    expect(peer.note).toMatch(/economically disadvantaged/)
  })

  it('takes domain rows from the latest year only, in published order', () => {
    const vm = build()
    expect(vm.domains.map((d) => d.domain)).toEqual(['achievement', 'gaps'])
    expect(vm.domains.every((d) => d.year === LATEST)).toBe(true)
    expect(vm.domains[0].label).toBe('Student Achievement')
  })

  it('computes finance against the newest year of the series', () => {
    const vm = build()
    expect(vm.finance.years).toEqual(['2022-23', '2023-24'])
    expect(vm.finance.vsPeer).toBe(12_000 - 12_500)
    expect(vm.finance.vsState).toBe(12_000 - 13_000)
  })

  it('nulls finance entirely for an entity with no rows, rather than emitting zeroes', () => {
    expect(build({ finance: [] }).finance).toBeNull()
  })

  it('computes a rank for every metric against every cohort', () => {
    const vm = build()
    expect(vm.cohorts.map((c) => c.key)).toEqual(['peer', 'region', 'county', 'size', 'state'])
    expect(vm.ranks.length).toBeGreaterThan(0)
    for (const r of vm.ranks) {
      expect(r.of).toBeGreaterThanOrEqual(10)
      expect(r.cohortLabel).toBeTruthy()
    }
  })

  it('publishes cohort-specific placements and strengths for synchronous switching', () => {
    const vm = build()
    expect(Object.keys(vm.highlightsByCohort)).toEqual(vm.cohorts.map((c) => c.key))
    expect(vm).not.toHaveProperty('standoutsByCohort')
    for (const cohort of vm.cohorts) {
      expect(cohort.placements.score).toMatchObject({ cohort: cohort.key, metric: 'score' })
      expect(Array.isArray(vm.highlightsByCohort[cohort.key])).toBe(true)
    }
  })

  it('publishes one stable best placement per qualifying metric across all cohorts', () => {
    const vm = build()
    expect(new Set(vm.standouts.map((row) => row.metric)).size).toBe(vm.standouts.length)
    for (const row of vm.standouts) {
      expect(vm.ranks).toContainEqual(row)
      expect(row.rank <= 10 || row.pctile >= 95).toBe(true)
    }
  })

  it('exposes its own metric values alongside the cohort averages', () => {
    const vm = build()
    expect(vm.own.score).toBe(64) // latest year only
    expect(vm.own['domain:achievement']).toBe(70)
    expect(vm.own.ecoDis).toBe(50)
    // Latest-year scores run 64..75, so the state average is their midpoint.
    expect(vm.cohorts.find((c) => c.key === 'state').metrics.score).toBeCloseTo(69.5, 5)
  })

  it('flags a Not Rated entity without dropping its published scores', () => {
    const u = makeUniverse()
    const entity = { ...u.entities[0], rating: 'Not Rated' }
    const vm = build({ entity })
    expect(vm.notRated).toBe(true)
    expect(vm.history[0].score).toBe(64)
  })

  it('lists a district\'s campuses, slugged, best score first', () => {
    const u = makeUniverse()
    const district = u.entities[0]
    const campuses = [
      { ...u.entities[1], id: '100001', level: 'campus', districtId: district.id, name: 'Low Campus', score: 40 },
      { ...u.entities[2], id: '100002', level: 'campus', districtId: district.id, name: 'High Campus', score: 90 },
    ]
    const vm = build({ entities: [...u.entities, ...campuses] })
    expect(vm.campuses.map((c) => c.name)).toEqual(['High Campus', 'Low Campus'])
    expect(vm.campuses[0].slug).toBe('high-campus-100002')
  })

  it('gives a campus no campus list, and links it back to its district', () => {
    const u = makeUniverse()
    const campus = {
      ...u.entities[0],
      id: '100001',
      level: 'campus',
      districtId: '100',
      districtName: 'District 0 ISD',
      name: 'A Campus',
    }
    // Twelve campuses so its own cohorts still resolve.
    const peers = Array.from({ length: 11 }, (_, i) => ({ ...campus, id: `10000${i + 2}`, name: `Peer ${i}` }))
    const vm = build({ entity: campus, entities: [...u.entities, campus, ...peers] })
    expect(vm.campuses).toBeNull()
    expect(vm.districtSlug).toBe('district-0-isd-100')
  })

  it('gives a district no district link', () => {
    expect(build().districtSlug).toBeNull()
  })

  it('nulls the profile rather than fabricating one when the entity has no row', () => {
    expect(build({ profile: [] }).profile).toBeNull()
    expect(build({ profile: [] }).peerN).toBe(0)
  })

  it('nulls STAAR, graduation and CCMR when the achievement tab has no row', () => {
    const vm = build({ achievement: [] })
    expect(vm.staar).toBeNull()
    expect(vm.graduation).toBeNull()
    expect(vm.ccmr).toBeNull()
  })

  it('labels graduation as completion for an alternative-education entity', () => {
    const u = makeUniverse()
    const vm = build({ entity: { ...u.entities[0], isAlt: true } })
    expect(vm.graduation[0].label).toBe('Four-Year Completion Rate')
    expect(build().graduation[0].label).toBe('Four-Year Graduation Rate')
  })

  it('never exposes out-of-range achievement percentages as real results', () => {
    const u = makeUniverse()
    u.achievement[0] = {
      ...u.achievement[0],
      approach: [-1, '101%'],
      meet: [0, 100],
      grad_rate_col2: [-1, '101%', 100, 0],
      ccmr_col2: [-1, '101%', '50%', '0%'],
      ccmr_col3: [-1, '101%', '40%', '0%'],
    }
    const vm = build({ achievement: u.achievement })
    expect(vm.staar.levels[0]).toEqual([null, null])
    expect(vm.staar.levels[1]).toEqual([0, 100])
    expect(vm.graduation.map((g) => g.value)).toEqual([100, 0])
    expect(vm.graduation.map((g) => g.key)).toEqual(['grad:2', 'grad:3'])
    expect(vm.ccmr.map((c) => c.value)).toEqual(['50%', '0%'])
    expect(vm.ccmr.map((c) => c.key)).toEqual(['ccmr:2', 'ccmr:3'])
    expect(vm.ccmr.map((c) => c.compare)).toEqual(['40%', '0%'])
  })

  it('publishes district teacher-turnover history without inventing campus class size', () => {
    const vm = build({
      educatorLatestYear: '2024-25',
      educatorHistory: [
        { id: '100', level: 'district', year: '2024-25', teacherTurnoverRate: 16.2 },
        { id: '100', level: 'district', year: '2022-23', teacherTurnoverRate: null },
        { id: '100', level: 'district', year: '2023-24', teacherTurnoverRate: 14.7 },
        { id: '101', level: 'district', year: '2024-25', teacherTurnoverRate: 99 },
      ],
    })
    expect(vm.teacherTurnover).toEqual({
      unit: 'percent',
      history: [
        { year: '2022-23', ratePct: null },
        { year: '2023-24', ratePct: 14.7 },
        { year: '2024-25', ratePct: 16.2 },
      ],
      latest: { year: '2024-25', ratePct: 16.2 },
    })
    expect(vm.classSize).toBeNull()
  })

  it('publishes the latest twelve campus class-size categories with no synthetic average', () => {
    const u = makeUniverse()
    const campus = {
      ...u.entities[0],
      id: '100001',
      level: 'campus',
      districtId: '100',
      districtName: 'District 0 ISD',
      name: 'A Campus',
    }
    const peers = Array.from({ length: 11 }, (_, i) => ({
      ...campus,
      id: `10000${i + 2}`,
      name: `Peer ${i}`,
    }))
    const currentValues = Object.fromEntries(
      CLASS_SIZE_CATEGORIES.map(({ key }, index) => [key, index === 4 ? null : 15 + index / 10])
    )
    const vm = build({
      entity: campus,
      entities: [...u.entities, campus, ...peers],
      educatorLatestYear: '2024-25',
      educatorHistory: [
        {
          id: campus.id,
          level: 'campus',
          year: '2023-24',
          classSize: Object.fromEntries(CLASS_SIZE_CATEGORIES.map(({ key }) => [key, 99])),
        },
        { id: campus.id, level: 'campus', year: '2024-25', classSize: currentValues },
      ],
    })
    expect(vm.teacherTurnover).toBeNull()
    expect(vm.classSize.year).toBe('2024-25')
    expect(vm.classSize.categories).toHaveLength(12)
    expect(vm.classSize.categories[0]).toEqual({
      key: 'kindergarten',
      label: 'Kindergarten',
      studentsPerClass: 15,
    })
    expect(vm.classSize.categories.find((item) => item.key === 'grade4').studentsPerClass).toBeNull()
    expect(vm.classSize.reported).toBe(11)
    expect(vm.classSize).not.toHaveProperty('average')
    expect(vm.classSize).not.toHaveProperty('averageClassSize')
  })

  it('does not present an older campus class-size row as current', () => {
    const u = makeUniverse()
    const campus = {
      ...u.entities[0],
      id: '100001',
      level: 'campus',
      districtId: '100',
      districtName: 'District 0 ISD',
      name: 'A Campus',
    }
    expect(
      build({
        entity: campus,
        entities: [...u.entities, campus],
        educatorLatestYear: '2024-25',
        educatorHistory: [
          { id: campus.id, level: 'campus', year: '2023-24', classSize: { kindergarten: 18 } },
        ],
      }).classSize
    ).toBeNull()
  })

  it('keeps discipline students, actions, rates, and caveats explicitly separate', () => {
    const reported = (count, rateName, rate) => ({
      count,
      status: 'reported',
      mask: null,
      [rateName]: rate,
    })
    const unavailableStudent = { count: null, status: 'not-reported', mask: null, ratePct: null }
    const unavailableAction = { count: null, status: 'not-reported', mask: null, ratePer100: null }
    const vm = build({
      disciplineSummary: {
        id: '100',
        level: 'district',
        history: [{
          year: '2023-24',
          cumulativeEnrollment: { count: 1_000, status: 'reported', mask: null },
          students: reported(50, 'ratePct', 5),
          actions: reported(80, 'ratePer100', 8),
        }],
        latest: {
          year: '2024-25',
          cumulativeEnrollment: { count: 1_100, status: 'reported', mask: null },
          categories: {
            allDiscipline: {
              students: reported(55, 'ratePct', 5),
              actions: reported(99, 'ratePer100', 9),
            },
          },
        },
      },
      publicDataMeta: {
        discipline: {
          overlapCaveat: 'Do not add overlapping categories.',
          pandemicCaveat: 'Use 2020-21 cautiously.',
          sourceCaveat: 'Stable headings only.',
        },
      },
    })
    expect(vm.discipline.history[0]).toEqual({
      year: '2023-24',
      cumulativeEnrollment: { count: 1_000, status: 'reported', mask: null },
      students: reported(50, 'ratePct', 5),
      actions: reported(80, 'ratePer100', 8),
    })
    expect(vm.discipline.current.categories).toHaveLength(12)
    expect(vm.discipline.current.categories[0]).toMatchObject({
      key: 'allDiscipline',
      heading: 'ALL DISCIPLINE',
      label: 'All discipline',
      students: reported(55, 'ratePct', 5),
      actions: reported(99, 'ratePer100', 9),
    })
    expect(vm.discipline.current.categories[1].students).toEqual(unavailableStudent)
    expect(vm.discipline.current.categories[1].actions).toEqual(unavailableAction)
    expect(vm.discipline.caveats).toEqual({
      overlap: 'Do not add overlapping categories.',
      pandemic2020_21: 'Use 2020-21 cautiously.',
      source: 'Stable headings only.',
    })
  })

  it('keeps discipline absent when the entity has no official summary row', () => {
    expect(build().discipline).toBeNull()
  })

  it('passes official district transfer totals and neutral context through unchanged', () => {
    const history = [
      { year: '2024-25', transfersIn: 120, transfersOut: 300, net: -180 },
      { year: '2025-26', transfersIn: 106, transfersOut: 350, net: -244 },
    ]
    const current = {
      ...history[1],
      coverage: {
        officialTotals: { in: 'reported', out: 'reported' },
        origins: { published: 4, reported: 3, masked: 1 },
        destinations: { published: 5, reported: 3, masked: 2 },
      },
      topOrigins: [{ id: '101', name: 'District 1 ISD', transfers: 27 }],
      topDestinations: [{ id: '102', name: 'District 2 ISD', transfers: 40 }],
    }
    const changeSinceFirst = {
      fromYear: '2024-25',
      toYear: '2025-26',
      transfersInChange: -14,
      transfersOutChange: 50,
      netChange: -64,
    }
    const vm = build({
      transferSummary: {
        id: '100',
        level: 'district',
        netLabel: 'Transfers in minus transfers out (arithmetic context only; not a quality measure)',
        history,
        current,
        changeSinceFirst,
      },
      publicDataMeta: {
        transfers: {
          caveats: { meaning: 'A transfer does not identify why a student attends elsewhere.' },
          scope: 'District only.',
        },
      },
    })
    expect(vm.transferContext).toEqual({
      netLabel: 'Transfers in minus transfers out (arithmetic context only; not a quality measure)',
      history,
      current,
      changeSinceFirst,
      caveats: { meaning: 'A transfer does not identify why a student attends elsewhere.' },
      scope: 'District only.',
    })
  })

  it('never exposes a district transfer summary as a campus total', () => {
    const u = makeUniverse()
    const campus = {
      ...u.entities[0],
      id: '100001',
      level: 'campus',
      districtId: '100',
      districtName: 'District 0 ISD',
      name: 'A Campus',
    }
    const vm = build({
      entity: campus,
      entities: [...u.entities, campus],
      transferSummary: {
        id: campus.id,
        level: 'district',
        history: [{ year: '2025-26', transfersIn: 10, transfersOut: 5, net: 5 }],
        current: { year: '2025-26', transfersIn: 10, transfersOut: 5, net: 5 },
      },
    })
    expect(vm.transferContext).toBeNull()
  })
})
