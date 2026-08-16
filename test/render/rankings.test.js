// test/render/rankings.test.js
//
// The ranked-list layer. Four properties are load-bearing and each has its own
// block below, because breaking any one of them publishes a false claim rather
// than an ugly page:
//
//   ties       an entity sharing a figure must share the rank, and the number
//              sharing it must be published with it
//   direction  a metric where less is better must rank ascending, and the
//              "improved most" list must not be the "declined most" list
//   window     a change ranking must name the years it spans, and must read the
//              re-scored 2021-22 series rather than the original
//   n          a rank out of fewer than MIN_POPULATION must not be published
//
// The tie/direction block additionally re-implements metrics.js:rankAll's inner
// loop by hand and asserts the sorted `place` agrees with it on random data, so
// the fast path cannot drift from the semantics the entity pages already use.
//
// Fixtures are hand-built and tiny: these must run offline and fast.

import { describe, it, expect } from 'vitest'
import {
  RANKABLE, RANKABLE_BY_KEY, RANKABLE_BY_SLUG, CHANGE_METRICS, STAAR_SUBJECTS, rankable,
  SCOPES, SCOPE_KINDS, PEER_BANDS, SECTORS, AEA_MODES, LEVELS,
  MIN_POPULATION, WINDOW_COVERAGE, METHOD_BREAK_YEAR, METHOD_BREAK_NOTE,
  rankingBundles, rankBy, changeMetrics, availableYears, rankEverywhere,
  place, parseScope, scopeKey, resolveMetric, isRankable, windowLabel,
  HIGHER, LOWER,
} from '../../src/render/rankings.js'
import { rankAll, buildCohorts, metricSpecs, isContextMetric } from '../../src/render/metrics.js'

/* ---------------------------------------------------------------- fixtures -- */

const LATEST = '2025-26'

/**
 * n districts with controllable scores. `spec` entries override anything.
 * Everything not overridden gets sane defaults so a test can name only the one
 * field it is about.
 */
const districts = (specs) =>
  specs.map((s, i) => ({
    id: s.id ?? `d${String(i).padStart(3, '0')}`,
    level: s.level ?? 'district',
    name: s.name ?? `District ${i}`,
    regionId: s.regionId ?? '01',
    countyId: s.countyId ?? '001',
    county: s.county ?? 'Anderson',
    districtId: null,
    districtName: null,
    isCharter: s.isCharter ?? false,
    isAlt: s.isAlt ?? false,
    enrollment: s.enrollment ?? 500,
    rating: s.rating ?? 'B',
    score: s.score ?? null,
  }))

/** ratings rows for the latest year, plus any history the spec asks for. */
const ratingsFor = (entities, specs) =>
  entities.flatMap((e, i) => {
    const s = specs[i]
    const rows = []
    if (s.score != null) rows.push({ id: e.id, year: LATEST, method: 'current', rating: 'B', score: s.score })
    for (const [year, score] of Object.entries(s.history ?? {})) {
      rows.push({ id: e.id, year, method: year < '2022-23' ? 'what_if' : 'current', rating: 'B', score })
    }
    return rows
  })

const profileFor = (entities, specs) =>
  entities.map((e, i) => ({
    id: e.id,
    total: 500,
    ecoDisPct: specs[i].ecoDis ?? 50,
    specEdPct: 12,
    engLrnPct: 20,
    // `?? 94` would swallow a deliberate null, which is exactly what the
    // "reported no value" tests need to be able to express.
    attendance: specs[i].attendance === undefined ? 94 : specs[i].attendance,
    absenteeism: specs[i].absenteeism === undefined ? null : specs[i].absenteeism,
    avgSalary: 55000,
    schoolYear: LATEST,
  }))

/** Builds entities + bundles from one spec list. */
const fixture = (specs, extra = {}) => {
  const entities = districts(specs)
  const bundles = rankingBundles({
    entities,
    ratings: ratingsFor(entities, specs),
    profile: profileFor(entities, specs),
    domains: extra.domains ?? [],
    finance: extra.finance ?? [],
    achievement: extra.achievement ?? [],
    latestYear: LATEST,
    ...extra.bundleArgs,
  })
  return { entities, bundles }
}

/** n identical, rated districts — the cheap way to clear MIN_POPULATION. */
const filler = (n, score = 70, over = {}) => Array.from({ length: n }, () => ({ score, ...over }))

/* -------------------------------------------------------------- RANKABLE -- */

describe('RANKABLE', () => {
  it('gives every metric a stable slug, a label, a unit and a direction', () => {
    for (const m of RANKABLE) {
      expect(m.key, 'key').toBeTruthy()
      expect(m.slug, `${m.key} slug`).toMatch(/^[a-z0-9-]+$/)
      expect(m.label, `${m.key} label`).toBeTruthy()
      expect(m.title, `${m.key} title`).toBeTruthy()
      expect(['points', 'percent', 'dollars'], `${m.key} unit`).toContain(m.unit)
      expect([HIGHER, LOWER], `${m.key} dir`).toContain(m.dir)
      expect(m.lowerIsBetter).toBe(m.dir === LOWER)
      expect(typeof m.get).toBe('function')
    }
  })

  it('has unique keys and unique slugs', () => {
    expect(RANKABLE_BY_KEY.size).toBe(RANKABLE.length)
    expect(RANKABLE_BY_SLUG.size).toBe(RANKABLE.length)
  })

  it('ranks no context metric — demographics are compared, never placed', () => {
    for (const m of RANKABLE) expect(isContextMetric(m.specKey), `${m.key} is a demographic share`).toBe(false)
    for (const key of ['ecoDis', 'engLrn', 'specEd']) {
      expect(isRankable(key)).toBe(false)
      expect(() => resolveMetric(key)).toThrow(/not rankable|unknown metric/)
    }
  })

  it('offers no rank for enrollment either — size has no good end', () => {
    expect(isRankable('enrollment')).toBe(false)
  })

  it('marks exactly the seven metrics that genuinely have history as change-capable', () => {
    expect(CHANGE_METRICS.map((m) => m.key).sort()).toEqual(
      [
        'domain:achievement',
        'domain:gaps',
        'domain:progress',
        'domain:progress_growth',
        'domain:progress_relative',
        'score',
        'spend',
      ].sort()
    )
  })

  it('marks the single-year measures as not change-capable, so growth cannot be faked', () => {
    for (const key of ['grad:0', 'grad:3', 'ccmr:0', 'attendance', 'absenteeism', 'avgSalary', 'staar:Reading:1']) {
      expect(RANKABLE_BY_KEY.get(key)?.change, `${key} must not claim history`).toBeFalsy()
    }
  })

  it('takes its direction from metrics.js rather than declaring its own', () => {
    expect(RANKABLE_BY_KEY.get('absenteeism').dir).toBe(LOWER)
    expect(RANKABLE_BY_KEY.get('grad:3').dir).toBe(LOWER)
    expect(RANKABLE_BY_KEY.get('score').dir).toBe(HIGHER)
    expect(RANKABLE_BY_KEY.get('grad:0').dir).toBe(HIGHER)
  })

  it('splits population-confined measures into standard and alternative-education lists', () => {
    const std = RANKABLE_BY_KEY.get('grad:0')
    const aea = RANKABLE_BY_KEY.get('grad:0@aea')
    expect(std.population).toBe('standard')
    expect(aea.population).toBe('aea')
    // TEA relabels the same array; the two lists must not share a heading.
    expect(std.label).toMatch(/Graduation/)
    expect(aea.label).toMatch(/Completion/)
    expect(std.slug).not.toBe(aea.slug)
  })

  it('rebuilds identically for the snapshot subject set', () => {
    expect(rankable({ subjects: STAAR_SUBJECTS }).map((m) => m.key)).toEqual(RANKABLE.map((m) => m.key))
  })

  it('follows a different subject set without touching the core metrics', () => {
    const custom = rankable({ subjects: ['Reading'] })
    expect(custom.filter((m) => m.group === 'staar').map((m) => m.key)).toEqual([
      'staar:Reading:0',
      'staar:Reading:1',
      'staar:Reading:2',
    ])
    expect(custom.find((m) => m.key === 'score')).toBeDefined()
  })

  it('uses the extractor metrics.js declares, so a ranked value cannot drift from the entity page', () => {
    // metricSpecs builds fresh closures per call, so identity proves nothing;
    // what must hold is that both read the same field out of the same bundle.
    const specs = new Map(metricSpecs({ subjects: STAAR_SUBJECTS }).map((s) => [s.key, s]))
    const bundle = {
      id: 'x',
      isAlt: false,
      score: 88,
      domains: { achievement: 81, progress: 82, gaps: 83, progress_growth: 84, progress_relative: 85 },
      subjects: STAAR_SUBJECTS,
      staar: [STAAR_SUBJECTS.map((_, i) => 60 + i), STAAR_SUBJECTS.map((_, i) => 40 + i), STAAR_SUBJECTS.map((_, i) => 20 + i)],
      grad: [95, 96, 97, 2],
      ccmr: Array.from({ length: 12 }, (_, i) => 50 + i),
      profile: { ecoDisPct: 61, engLrnPct: 20, specEdPct: 12, attendance: 94, absenteeism: 18, avgSalary: 55000 },
      spend: 12345,
    }
    for (const m of RANKABLE) {
      if (m.population === 'aea') continue // the AEA table's extractor, by design
      expect(m.get(bundle), `${m.key}`).toBe(specs.get(m.specKey).get(bundle))
      expect(m.get(bundle), `${m.key} reads nothing`).not.toBeNull()
    }
  })
})

/* ------------------------------------------------------------------ place -- */

/** metrics.js:rankAll's inner loop, transcribed. The reference implementation. */
const bruteForce = (values, mine, lower) => {
  const better = values.filter((v) => (lower ? v < mine : v > mine)).length
  const rank = better + 1
  return {
    rank,
    of: values.length,
    tied: values.filter((v) => v === mine).length - 1,
    pctile: Math.round((1 - (rank - 1) / values.length) * 100),
  }
}

describe('place', () => {
  it('agrees with rankAll’s arithmetic on random data, in both directions', () => {
    let seed = 12345
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    for (let trial = 0; trial < 200; trial += 1) {
      const n = 1 + Math.floor(rnd() * 40)
      // A small value space on purpose: ties are the interesting case.
      const rows = Array.from({ length: n }, (_, i) => ({ id: `e${i}`, name: `E${i}`, value: Math.floor(rnd() * 6) }))
      const values = rows.map((r) => r.value)
      for (const lower of [false, true]) {
        for (const r of place(rows.map((x) => ({ ...x })), lower)) {
          expect(r, `${lower ? 'lower' : 'higher'} n=${n} v=${r.value}`).toMatchObject(bruteForce(values, r.value, lower))
        }
      }
    }
  })

  it('gives every member of a tie group the same rank and a count of the others', () => {
    const rows = place(
      [
        { id: 'a', name: 'A', value: 90 },
        { id: 'b', name: 'B', value: 80 },
        { id: 'c', name: 'C', value: 80 },
        { id: 'd', name: 'D', value: 80 },
        { id: 'e', name: 'E', value: 70 },
      ],
      false
    )
    expect(rows.map((r) => [r.name, r.rank, r.tied])).toEqual([
      ['A', 1, 0],
      ['B', 2, 2],
      ['C', 2, 2],
      ['D', 2, 2],
      ['E', 5, 0],
    ])
  })

  it('skips the ranks a tie consumes rather than renumbering 1,2,3', () => {
    const rows = place(
      [
        { id: 'a', name: 'A', value: 5 },
        { id: 'b', name: 'B', value: 5 },
        { id: 'c', name: 'C', value: 1 },
      ],
      false
    )
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 3])
  })

  it('orders tied rows alphabetically, not by input order, so a build is deterministic', () => {
    const forwards = place(
      [
        { id: 'z', name: 'Zavalla ISD', value: 80 },
        { id: 'a', name: 'Abbott ISD', value: 80 },
      ],
      false
    ).map((r) => r.name)
    const backwards = place(
      [
        { id: 'a', name: 'Abbott ISD', value: 80 },
        { id: 'z', name: 'Zavalla ISD', value: 80 },
      ],
      false
    ).map((r) => r.name)
    expect(forwards).toEqual(['Abbott ISD', 'Zavalla ISD'])
    expect(forwards).toEqual(backwards)
  })

  it('ranks ascending when less is better', () => {
    const rows = place(
      [
        { id: 'a', name: 'A', value: 12 },
        { id: 'b', name: 'B', value: 3 },
        { id: 'c', name: 'C', value: 7 },
      ],
      true
    )
    expect(rows.map((r) => r.name)).toEqual(['B', 'C', 'A'])
    expect(rows[0].value).toBe(3)
  })
})

/* ----------------------------------------------------------------- rankBy -- */

describe('rankBy', () => {
  it('ranks a population and reports its n and denominator on every row', () => {
    const specs = [{ score: 95, name: 'Alpha ISD' }, { score: 90, name: 'Beta ISD' }, ...filler(10, 60)]
    const { entities, bundles } = fixture(specs)
    const r = rankBy({ entities, bundles, metric: 'score' })

    expect(r.published).toBe(true)
    expect(r.population.n).toBe(12)
    expect(r.rows).toHaveLength(12)
    expect(r.rows[0]).toMatchObject({ name: 'Alpha ISD', rank: 1, of: 12, tied: 0, value: 95 })
    expect(r.rows[1]).toMatchObject({ name: 'Beta ISD', rank: 2, of: 12 })
    expect(r.rows[2]).toMatchObject({ rank: 3, tied: 9 })
  })

  it('accepts a metric by key, by slug or by object', () => {
    const { entities, bundles } = fixture(filler(12, 70))
    const a = rankBy({ entities, bundles, metric: 'score' })
    const b = rankBy({ entities, bundles, metric: 'overall-score' })
    const c = rankBy({ entities, bundles, metric: RANKABLE_BY_KEY.get('score') })
    expect(a.population.n).toBe(b.population.n)
    expect(b.population.n).toBe(c.population.n)
  })

  it('refuses a demographic share outright rather than returning an empty table', () => {
    const { entities, bundles } = fixture(filler(12, 70))
    expect(() => rankBy({ entities, bundles, metric: 'ecoDis' })).toThrow(/not rankable/)
  })

  it('refuses an unknown metric, level, sector or aea mode', () => {
    const { entities, bundles } = fixture(filler(12, 70))
    expect(() => rankBy({ entities, bundles, metric: 'nope' })).toThrow(/unknown metric/)
    expect(() => rankBy({ entities, bundles, metric: 'score', level: 'school' })).toThrow(/level must be/)
    expect(() => rankBy({ entities, bundles, metric: 'score', filters: { sector: 'private' } })).toThrow(/sector must be/)
    expect(() => rankBy({ entities, bundles, metric: 'score', filters: { aea: 'maybe' } })).toThrow(/aea must be/)
  })

  it('ranks a lower-is-better metric from the bottom up', () => {
    const specs = [
      { absenteeism: 3, name: 'Low ISD' },
      { absenteeism: 40, name: 'High ISD' },
      ...filler(10, 70, { absenteeism: 20 }),
    ].map((s) => ({ score: 70, ...s }))
    const { entities, bundles } = fixture(specs)
    const r = rankBy({ entities, bundles, metric: 'absenteeism' })
    expect(r.metric.lowerIsBetter).toBe(true)
    expect(r.metric.topLabel).toBe('Lowest')
    expect(r.rows[0].name).toBe('Low ISD')
    expect(r.rows.at(-1).name).toBe('High ISD')
  })
})

/* ---------------------------------------------------- population reporting -- */

describe('population reporting', () => {
  it('publishes nothing below the minimum population, and says why', () => {
    const { entities, bundles } = fixture(filler(MIN_POPULATION - 1, 70))
    const r = rankBy({ entities, bundles, metric: 'score' })
    expect(r.population.n).toBe(MIN_POPULATION - 1)
    expect(r.published).toBe(false)
    expect(r.suppressed).toBe('population')
    expect(r.population.minimum).toBe(MIN_POPULATION)
  })

  it('publishes at exactly the minimum', () => {
    const { entities, bundles } = fixture(filler(MIN_POPULATION, 70))
    expect(rankBy({ entities, bundles, metric: 'score' }).published).toBe(true)
  })

  it('uses the same floor metrics.js:rankAll uses', () => {
    // rankAll drops a cohort of 9 and keeps one of 10; MIN_POPULATION must agree,
    // or the same entity gets a rank on its own page and none in the table.
    const specs = filler(9, 70)
    const entities = districts(specs)
    const bundles = rankingBundles({
      entities,
      ratings: ratingsFor(entities, specs),
      profile: profileFor(entities, specs),
      latestYear: LATEST,
    })
    const mSpecs = metricSpecs()
    const { cohorts, ids } = buildCohorts({
      entity: entities[0],
      entities,
      bundles,
      specs: mSpecs,
      band: { ids: new Set(), n: 0 },
      regionName: 'Region 01',
      countyName: 'Anderson',
    })
    expect(rankAll({ entity: entities[0], cohorts, bundles, specs: mSpecs, cohortIds: ids })).toHaveLength(0)
    expect(rankBy({ entities, bundles, metric: 'score' }).published).toBe(false)
  })

  it('counts every filter’s exclusions separately', () => {
    const specs = [
      ...filler(10, 70),
      { score: 80, isCharter: true },
      { score: 80, isAlt: true },
      { score: null }, // rated nowhere: no latest-year score
    ]
    const { entities, bundles } = fixture(specs)

    const all = rankBy({ entities, bundles, metric: 'score' })
    expect(all.population.n).toBe(12)
    expect(all.population.excluded.notRated).toBe(1)
    expect(all.population.excluded.sector).toBe(0)

    const trad = rankBy({ entities, bundles, metric: 'score', filters: { sector: 'traditional' } })
    expect(trad.population.excluded.sector).toBe(1)
    expect(trad.population.n).toBe(11)

    const noAea = rankBy({ entities, bundles, metric: 'score', filters: { aea: 'exclude' } })
    expect(noAea.population.excluded.aea).toBe(1)
    expect(noAea.population.n).toBe(11)
  })

  it('counts entities that reported no value for the metric', () => {
    const specs = [...filler(10, 70, { attendance: 95 }), { score: 70, attendance: null }]
    const { entities, bundles } = fixture(specs)
    const r = rankBy({ entities, bundles, metric: 'attendance' })
    expect(r.population.excluded.noValue).toBe(1)
    expect(r.population.n).toBe(10)
  })

  it('excludes entities TEA did not rate this year, matching the site’s one cohort rule', () => {
    const specs = [...filler(10, 70), { score: null }, { score: null }]
    const { entities, bundles } = fixture(specs)
    const r = rankBy({ entities, bundles, metric: 'score' })
    expect(r.population.excluded.notRated).toBe(2)
    expect(r.population.n).toBe(10)
  })

  it('states the population, the n and the exclusions in one printable sentence', () => {
    const specs = [...filler(10, 70), { score: null }, { score: 80, isCharter: true }]
    const { entities, bundles } = fixture(specs)
    const s = rankBy({ entities, bundles, metric: 'score', filters: { sector: 'traditional' } }).population.sentence
    expect(s).toContain('10 districts ranked in Texas')
    expect(s).toContain('Excluded')
    expect(s).toContain('1 TEA did not rate in 2025-26')
    expect(s).toContain('1 removed by the sector filter')
    expect(s).toContain('traditional districts only, charters excluded')
    expect(s).toContain('share a rank')
  })

  it('says so explicitly when nothing was excluded', () => {
    const { entities, bundles } = fixture(filler(12, 70))
    expect(rankBy({ entities, bundles, metric: 'score' }).population.sentence).toContain('Nothing was excluded')
  })

  it('confines a population-split metric and counts the other population separately', () => {
    const specs = [
      ...filler(10, 70, { isAlt: false }),
      { score: 70, isAlt: true },
      { score: 70, isAlt: true },
    ]
    const entities = districts(specs)
    const bundles = rankingBundles({
      entities,
      ratings: ratingsFor(entities, specs),
      profile: profileFor(entities, specs),
      achievement: entities.map((e) => ({ id: e.id, subject: [], grad_rate_col2: ['90', '91', '92', '5'] })),
      latestYear: LATEST,
    })
    const std = rankBy({ entities, bundles, metric: 'grad:0' })
    expect(std.population.n).toBe(10)
    expect(std.population.excluded.population).toBe(2)
    expect(std.metric.label).toMatch(/Graduation/)

    const aea = rankBy({ entities, bundles, metric: 'grad:0@aea' })
    expect(aea.population.excluded.population).toBe(10)
    expect(aea.metric.label).toMatch(/Completion/)
  })
})

/* ------------------------------------------------------------------ scopes -- */

describe('scopes', () => {
  it('names four scope kinds', () => {
    expect(SCOPE_KINDS).toEqual(['state', 'region', 'county', 'band'])
    expect(SCOPES).toHaveLength(4)
  })

  it('parses a scope from a string, an object or a bare kind, and round-trips it', () => {
    expect(parseScope('state')).toEqual({ kind: 'state', id: null })
    expect(parseScope('region:07')).toEqual({ kind: 'region', id: '07' })
    expect(parseScope('region:7')).toEqual({ kind: 'region', id: '07' })
    expect(parseScope({ kind: 'county', id: '001' })).toEqual({ kind: 'county', id: '001' })
    expect(scopeKey({ kind: 'band', id: '80-100' })).toBe('band:80-100')
    expect(scopeKey('region:7')).toBe('region:07')
  })

  it('refuses an unknown kind or a scope missing its id', () => {
    expect(() => parseScope('district:7')).toThrow(/unknown scope kind/)
    expect(() => parseScope('region')).toThrow(/needs an id/)
  })

  it('narrows to one region and reports what the scope removed', () => {
    const specs = [...filler(10, 70, { regionId: '01' }), ...filler(4, 90, { regionId: '02' })]
    const { entities, bundles } = fixture(specs)
    const r = rankBy({ entities, bundles, metric: 'score', scope: 'region:01' })
    expect(r.population.n).toBe(10)
    expect(r.population.excluded.scope).toBe(4)
    expect(r.scope).toMatchObject({ kind: 'region', id: '01' })
  })

  it('labels a county with the name its members carry', () => {
    const specs = filler(10, 70, { countyId: '057', county: 'Dallas' })
    const { entities, bundles } = fixture(specs)
    const r = rankBy({ entities, bundles, metric: 'score', scope: 'county:057' })
    expect(r.scope.label).toBe('Dallas County')
    expect(r.population.sentence).toContain('in Dallas County')
  })

  it('partitions the poverty bands with fixed edges, unlike the sliding peer band', () => {
    expect(PEER_BANDS.map((b) => b.id)).toEqual(['0-20', '20-40', '40-60', '60-80', '80-100'])
    const specs = [...filler(10, 70, { ecoDis: 85 }), ...filler(10, 90, { ecoDis: 15 })]
    const { entities, bundles } = fixture(specs)
    const high = rankBy({ entities, bundles, metric: 'score', scope: 'band:80-100' })
    const low = rankBy({ entities, bundles, metric: 'score', scope: 'band:0-20' })
    expect(high.population.n).toBe(10)
    expect(low.population.n).toBe(10)
    // The band is the POPULATION, never the thing ranked.
    expect(high.metric.key).toBe('score')
    expect(high.scope.label).toMatch(/economically disadvantaged/)
  })

  it('puts a 100% eco-dis entity in the top band rather than nowhere', () => {
    const { entities, bundles } = fixture(filler(10, 70, { ecoDis: 100 }))
    expect(rankBy({ entities, bundles, metric: 'score', scope: 'band:80-100' }).population.n).toBe(10)
  })

  it('carries the demographic shares as row context, never as the ranking', () => {
    const { entities, bundles } = fixture(filler(10, 70, { ecoDis: 61 }))
    const row = rankBy({ entities, bundles, metric: 'score' }).rows[0]
    expect(row.context).toMatchObject({ ecoDisPct: 61, engLrnPct: 20, specEdPct: 12, enrollment: 500 })
    expect(row.value).toBe(70)
  })
})

/* ------------------------------------------------------------------ change -- */

const historyFixture = () => {
  const specs = [
    { score: 90, name: 'Climber ISD', history: { '2021-22': 60, '2023-24': 75, '2025-26': 90 } },
    { score: 92, name: 'Steady ISD', history: { '2021-22': 90, '2023-24': 91, '2025-26': 92 } },
    { score: 50, name: 'Slider ISD', history: { '2021-22': 80, '2023-24': 65, '2025-26': 50 } },
    { score: 71, name: 'Newcomer ISD', history: { '2025-26': 71 } },
    ...Array.from({ length: 9 }, (_, i) => ({
      score: 70 + i,
      name: `Filler ${i} ISD`,
      history: { '2021-22': 68 + i, '2023-24': 69 + i, '2025-26': 70 + i },
    })),
  ]
  return { specs, ...fixture(specs) }
}

describe('changeMetrics', () => {
  it('ranks by improvement across a window it derives from the data', () => {
    const { entities, bundles } = historyFixture()
    const r = changeMetrics({ entities, bundles, metric: 'score' })
    expect(r.kind).toBe('change')
    expect(r.window.from).toBe('2021-22')
    expect(r.window.to).toBe('2025-26')
    expect(r.window.label).toBe('2021-22 to 2025-26')
    expect(r.rows[0]).toMatchObject({ name: 'Climber ISD', value: 30, from: 60, to: 90, rank: 1 })
    expect(r.rows.at(-1)).toMatchObject({ name: 'Slider ISD', value: -30 })
  })

  it('states the window on every result, because "improved most" means nothing without one', () => {
    const { entities, bundles } = historyFixture()
    const r = changeMetrics({ entities, bundles, metric: 'score' })
    expect(windowLabel(r.window.from, r.window.to)).toBe(r.window.label)
    expect(r.window.yearKind).toBe('academic')
    expect(r.window.note).toBeTruthy()
  })

  it('honours an explicit window and orders its endpoints', () => {
    const { entities, bundles } = historyFixture()
    const a = changeMetrics({ entities, bundles, metric: 'score', from: '2023-24', to: '2025-26' })
    expect(a.window.label).toBe('2023-24 to 2025-26')
    expect(a.rows.find((x) => x.name === 'Climber ISD').value).toBe(15)
    const flipped = changeMetrics({ entities, bundles, metric: 'score', from: '2025-26', to: '2023-24' })
    expect(flipped.window.label).toBe('2023-24 to 2025-26')
  })

  it('excludes entities missing an endpoint and counts them, rather than treating absence as zero', () => {
    const { entities, bundles } = historyFixture()
    const r = changeMetrics({ entities, bundles, metric: 'score' })
    expect(r.population.excluded.noStart).toBe(1) // Newcomer ISD
    expect(r.rows.some((x) => x.name === 'Newcomer ISD')).toBe(false)
    expect(r.population.sentence).toContain('without a figure at both ends of the window')
  })

  it('prints the window inside the population sentence, not only in the metadata', () => {
    const { entities, bundles } = historyFixture()
    const r = changeMetrics({ entities, bundles, metric: 'score' })
    expect(r.population.sentence).toContain('by change from 2021-22 to 2025-26')
    // …and a level ranking says no such thing, because it spans no window.
    expect(rankBy({ entities, bundles, metric: 'score' }).population.sentence).not.toContain('by change from')
  })

  it('reads the re-scored 2021-22 series, not the original', () => {
    // Both rows exist for the same entity-year, as they do in TEA's export.
    const specs = filler(10, 90)
    const entities = districts(specs)
    const raw = entities.flatMap((e) => [
      { id: e.id, year: LATEST, method: 'current', rating: 'A', score: 90 },
      { id: e.id, year: '2021-22', method: 'original', rating: 'C', score: 30 },
      { id: e.id, year: '2021-22', method: 'what_if', rating: 'B', score: 85 },
    ])
    const bundles = rankingBundles({ entities, ratings: raw, profile: profileFor(entities, specs), latestYear: LATEST })
    const r = changeMetrics({ entities, bundles, metric: 'score' })
    // 90 - 85 = 5 under the comparable series; 90 - 30 = 60 across the break.
    expect(r.rows[0].from).toBe(85)
    expect(r.rows[0].value).toBe(5)
  })

  it('attaches the methodology note when the window reaches back to the break year', () => {
    const { entities, bundles } = historyFixture()
    const spanning = changeMetrics({ entities, bundles, metric: 'score' })
    expect(spanning.window.from).toBe(METHOD_BREAK_YEAR)
    expect(spanning.window.methodology).toMatchObject({ year: METHOD_BREAK_YEAR, comparable: true })
    expect(spanning.window.methodology.note).toBe(METHOD_BREAK_NOTE)

    const inside = changeMetrics({ entities, bundles, metric: 'score', from: '2023-24', to: '2025-26' })
    expect(inside.window.methodology).toBeNull()
  })

  it('refuses to compute change for a metric with one year of data', () => {
    const { entities, bundles } = historyFixture()
    for (const key of ['attendance', 'ccmr:0', 'grad:0', 'staar:Reading:1', 'avgSalary']) {
      expect(() => changeMetrics({ entities, bundles, metric: key })).toThrow(/change over time cannot be computed/)
    }
  })

  it('ties on identical deltas, and rounds away the floating-point noise that would hide them', () => {
    const specs = [
      { score: 86.1, name: 'A ISD', history: { '2023-24': 84.3, '2025-26': 86.1 } },
      { score: 90.5, name: 'B ISD', history: { '2023-24': 88.7, '2025-26': 90.5 } },
      ...Array.from({ length: 10 }, (_, i) => ({
        score: 50 + i,
        name: `F${i} ISD`,
        history: { '2023-24': 50 + i, '2025-26': 50 + i },
      })),
    ]
    const { entities, bundles } = fixture(specs)
    const r = changeMetrics({ entities, bundles, metric: 'score', from: '2023-24', to: '2025-26' })
    // 86.1 - 84.3 and 90.5 - 88.7 are both 1.8, and both are 1.7999999999999972.
    const top = r.rows.filter((x) => x.rank === 1)
    expect(top).toHaveLength(2)
    expect(top[0].value).toBe(1.8)
    expect(top[0].tied).toBe(1)
  })

  it('ranks a lower-is-better change by the largest reduction', () => {
    // No lower-is-better metric has history in this snapshot, so the property is
    // asserted on `place` directly — the branch changeMetrics would take.
    const rows = place(
      [
        { id: 'a', name: 'Down', value: -8 },
        { id: 'b', name: 'Up', value: 3 },
      ],
      true
    )
    expect(rows[0].name).toBe('Down')
  })

  it('offers a relative basis, and drops entities with no base to compare against', () => {
    const specs = [
      { score: 70, name: 'Small ISD' },
      { score: 70, name: 'Big ISD' },
      { score: 70, name: 'Zero ISD' },
      ...filler(9, 70),
    ]
    const { entities } = fixture(specs)
    const finance = [
      { id: entities[0].id, year: '2018', spendEntity: 10000 },
      { id: entities[0].id, year: '2025', spendEntity: 12000 },
      { id: entities[1].id, year: '2018', spendEntity: 30000 },
      { id: entities[1].id, year: '2025', spendEntity: 33000 },
      { id: entities[2].id, year: '2018', spendEntity: 0 },
      { id: entities[2].id, year: '2025', spendEntity: 1000 },
      ...entities.slice(3).flatMap((e) => [
        { id: e.id, year: '2018', spendEntity: 20000 },
        { id: e.id, year: '2025', spendEntity: 21000 },
      ]),
    ]
    const bundles = rankingBundles({
      entities,
      ratings: ratingsFor(entities, specs),
      profile: profileFor(entities, specs),
      finance,
      latestYear: LATEST,
    })

    const abs = changeMetrics({ entities, bundles, metric: 'spend' })
    expect(abs.window.label).toBe('2018 to 2025')
    expect(abs.window.yearKind).toBe('fiscal')
    expect(abs.rows[0].name).toBe('Big ISD') // +3,000 dollars
    expect(abs.rows[0].value).toBe(3000)

    const rel = changeMetrics({ entities, bundles, metric: 'spend', basis: 'relative' })
    expect(rel.basis).toBe('relative')
    expect(rel.rows[0].name).toBe('Small ISD') // +20%
    expect(rel.rows[0].value).toBe(20)
    expect(rel.rows.find((x) => x.name === 'Zero ISD')).toBeUndefined()
    expect(rel.population.excluded.noStart).toBeGreaterThan(0)
    // The absolute delta rides along even on a relative ranking.
    expect(rel.rows[0].delta).toBe(2000)
  })

  it('refuses a basis it does not understand', () => {
    const { entities, bundles } = historyFixture()
    expect(() => changeMetrics({ entities, bundles, metric: 'score', basis: 'log' })).toThrow(/basis must be/)
  })

  it('returns a labelled empty result when no window exists, rather than a table of zeroes', () => {
    const specs = filler(12, 70) // latest year only, no history
    const { entities, bundles } = fixture(specs)
    const r = changeMetrics({ entities, bundles, metric: 'score' })
    expect(r.rows).toHaveLength(0)
    expect(r.published).toBe(false)
    expect(r.window).toBeNull()
    expect(r.population.eligible).toBe(12)
  })
})

/* ---------------------------------------------------------- availableYears -- */

describe('availableYears', () => {
  it('reports every year with its coverage, ascending', () => {
    const { entities, bundles } = historyFixture()
    const years = availableYears({ entities, bundles, metric: 'score' })
    expect(years.map((y) => y.year)).toEqual(['2021-22', '2023-24', '2025-26'])
    expect(years.at(-1).share).toBe(1)
    expect(years.every((y) => y.n > 0)).toBe(true)
  })

  it('marks a thinly-reported year ineligible so it cannot become a default window', () => {
    const specs = [
      { score: 70, history: { '2014': 1, '2021-22': 60, '2025-26': 70 } },
      ...Array.from({ length: 11 }, () => ({ score: 70, history: { '2021-22': 60, '2025-26': 70 } })),
    ]
    const { entities, bundles } = fixture(specs)
    const years = availableYears({ entities, bundles, metric: 'score' })
    const stray = years.find((y) => y.year === '2014')
    expect(stray.eligible).toBe(false)
    expect(stray.share).toBeLessThan(WINDOW_COVERAGE)
    // and the default window ignores it
    expect(changeMetrics({ entities, bundles, metric: 'score' }).window.from).toBe('2021-22')
  })

  it('is empty for a metric with no history', () => {
    const { entities, bundles } = historyFixture()
    expect(availableYears({ entities, bundles, metric: 'attendance' })).toEqual([])
  })
})

/* ------------------------------------------------------------ rankEverywhere -- */

describe('rankEverywhere', () => {
  it('returns one result per group, ordered by group id', () => {
    const specs = [
      ...filler(10, 70, { regionId: '02' }),
      ...filler(10, 80, { regionId: '01' }),
      ...filler(3, 90, { regionId: '03' }),
    ]
    const { entities, bundles } = fixture(specs)
    const out = rankEverywhere({ entities, bundles, metric: 'score', kind: 'region' })
    expect([...out.keys()]).toEqual(['01', '02', '03'])
    expect(out.get('01').population.n).toBe(10)
    expect(out.get('01').scope).toMatchObject({ kind: 'region', id: '01' })
  })

  it('keeps thin groups but marks them unpublished, so a caller can count what it skipped', () => {
    const specs = [...filler(10, 70, { regionId: '01' }), ...filler(3, 90, { regionId: '03' })]
    const { entities, bundles } = fixture(specs)
    const out = rankEverywhere({ entities, bundles, metric: 'score', kind: 'region' })
    expect(out.get('03').published).toBe(false)
    expect(out.get('03').suppressed).toBe('population')
    expect([...out.values()].filter((r) => r.published)).toHaveLength(1)
  })

  it('matches rankBy group for group', () => {
    const specs = [...filler(10, 70, { regionId: '01' }), ...filler(11, 80, { regionId: '02' })]
    const { entities, bundles } = fixture(specs)
    const out = rankEverywhere({ entities, bundles, metric: 'score', kind: 'region' })
    for (const id of ['01', '02']) {
      const direct = rankBy({ entities, bundles, metric: 'score', scope: `region:${id}` })
      expect(out.get(id).rows.map((r) => [r.id, r.rank])).toEqual(direct.rows.map((r) => [r.id, r.rank]))
    }
  })

  it('runs change rankings in batch too', () => {
    const { entities, bundles } = historyFixture()
    const out = rankEverywhere({ entities, bundles, metric: 'score', kind: 'region', change: true })
    expect(out.get('01').kind).toBe('change')
    expect(out.get('01').window.label).toBe('2021-22 to 2025-26')
  })

  it('refuses an unknown scope kind', () => {
    const { entities, bundles } = historyFixture()
    expect(() => rankEverywhere({ entities, bundles, metric: 'score', kind: 'zip' })).toThrow(/unknown scope kind/)
  })
})

/* ------------------------------------------------------------------ limit -- */

describe('limit', () => {
  it('trims the rows but never the reported n', () => {
    const { entities, bundles } = fixture(filler(30, 70).map((s, i) => ({ ...s, score: 50 + i })))
    const r = rankBy({ entities, bundles, metric: 'score', limit: 20 })
    expect(r.rows).toHaveLength(20)
    expect(r.population.n).toBe(30)
    expect(r.rows[0].of).toBe(30)
    expect(r.truncated).toBe(true)
  })

  it('reports truncated false when the limit does not bite', () => {
    const { entities, bundles } = fixture(filler(12, 70))
    expect(rankBy({ entities, bundles, metric: 'score', limit: 50 }).truncated).toBe(false)
  })
})

/* --------------------------------------------------------------- contract -- */

describe('exported contract', () => {
  it('names its filter and level vocabularies', () => {
    expect(SECTORS).toEqual(['all', 'traditional', 'charter'])
    expect(AEA_MODES).toEqual(['include', 'exclude', 'only'])
    expect(LEVELS).toEqual(['district', 'campus'])
  })

  it('rows carry everything a linked table needs without a second lookup', () => {
    const { entities, bundles } = fixture(filler(12, 70))
    const row = rankBy({ entities, bundles, metric: 'score' }).rows[0]
    for (const field of ['id', 'name', 'slug', 'level', 'rank', 'of', 'tied', 'pctile', 'value', 'context']) {
      expect(row, field).toHaveProperty(field)
    }
    expect(row.slug).toMatch(/-d\d{3}$/)
  })

  it('the envelope carries the metric, scope, level, filters and population every page must print', () => {
    const { entities, bundles } = fixture(filler(12, 70))
    const r = rankBy({ entities, bundles, metric: 'score', scope: 'state', level: 'district' })
    expect(r.metric).toMatchObject({ key: 'score', slug: 'overall-score', lowerIsBetter: false })
    expect(r.scope).toMatchObject({ kind: 'state', label: 'Texas' })
    expect(r.level).toBe('district')
    expect(r.filters).toEqual({ sector: 'all', aea: 'include' })
    expect(r.population).toHaveProperty('sentence')
    expect(r.population).toHaveProperty('excluded')
  })

  it('carries the latest year on the bundles so a caller need not thread it', () => {
    const { bundles } = fixture(filler(12, 70))
    expect(bundles.latestYear).toBe(LATEST)
  })
})
