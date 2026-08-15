// test/render/view-model.test.js
//
// The view model is the only place that touches raw tables, so the URL identity
// of every page and the composition of every comparison group are decided here.
// Fixtures are hand-built: no snapshot reads, no I/O.

import { describe, it, expect } from 'vitest'
import { buildViewModel, peerBand, entitySlug, slugify } from '../../src/render/view-model.js'

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
    expect(vm.cohorts.map((c) => c.key)).toEqual(['peer', 'region', 'county', 'state'])
    expect(vm.ranks.length).toBeGreaterThan(0)
    for (const r of vm.ranks) {
      expect(r.of).toBeGreaterThanOrEqual(10)
      expect(r.cohortLabel).toBeTruthy()
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
})
