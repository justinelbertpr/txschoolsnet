import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { mean } from '../../src/lib/stats.js'
import { preferredRatings } from '../../src/normalize/ratings.js'

const read = async (t) => {
  let text
  try {
    text = await readFile(`build/${t}.ndjson`, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(
        `build/${t}.ndjson is missing — run \`npm run build\` first to generate the build/ output.`
      )
    }
    throw err
  }
  return text
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l))
}

let entities, ratings, profile, districts, byId, preferred

beforeAll(async () => {
  ;[entities, ratings, profile] = await Promise.all([read('entities'), read('ratings'), read('profile')])
  districts = entities.filter((e) => e.level === 'district')
  byId = new Map(entities.map((e) => [e.id, e]))
  preferred = preferredRatings(ratings)
})

/** Mean district-level score for one year, within one governance sector. */
const districtMean = (year, isCharter = false) => {
  const scores = preferred
    .filter((r) => r.year === year)
    .filter((r) => {
      const entity = byId.get(r.id)
      return entity?.level === 'district' && !!entity.isCharter === isCharter
    })
    .map((r) => r.score)
  return mean(scores)
}

// Both governance sectors are published. The editorial thesis below is about
// geographic districts, so the helper filters that sector explicitly instead
// of silently pooling charter school systems into the mean.
describe('design §8 — unweighted geographic-district means', () => {
  it.each([
    ['2021-22', 80.6],
    ['2023-24', 78.7],
    ['2025-26', 81.7],
  ])('%s: %f', (year, expected) => {
    expect(districtMean(year)).toBeCloseTo(expected, 1)
  })

  it('shows recovery from the pandemic-era trough', () => {
    expect(districtMean('2025-26')).toBeGreaterThan(districtMean('2023-24'))
  })

  it('keeps the charter-system series separate and complete', () => {
    expect(districtMean('2021-22', true)).toBeCloseTo(82.3, 1)
    expect(districtMean('2023-24', true)).toBeCloseTo(78.0, 1)
    expect(districtMean('2025-26', true)).toBeCloseTo(79.7, 1)
  })
})

describe('design §8 — the steepest gains are in the highest-poverty schools', () => {
  // The site's central editorial thesis (§1, §8): "the steepest gains are
  // in the highest-poverty schools." Computed the same way the design
  // computed it — matched campuses sorted by ecoDisPct into ten equal
  // groups — so a future TEA release that weakens or inverts this gets
  // caught here instead of shipping unnoticed.
  const gain = (c) => c.s2 - c.s1
  let deciles

  beforeAll(() => {
    const campuses = entities.filter((e) => e.level === 'campus')
    const ecoDis = new Map(profile.map((p) => [p.id, p.ecoDisPct]))

    const scoreByYear = (year) => {
      const m = new Map()
      for (const r of preferred) if (r.year === year) m.set(r.id, r.score)
      return m
    }
    const trough = scoreByYear('2023-24')
    const current = scoreByYear('2025-26')

    const matched = campuses
      .map((c) => ({ ecoDisPct: ecoDis.get(c.id), s1: trough.get(c.id), s2: current.get(c.id) }))
      .filter((c) => typeof c.ecoDisPct === 'number' && typeof c.s1 === 'number' && typeof c.s2 === 'number')
      .sort((a, b) => a.ecoDisPct - b.ecoDisPct)

    const n = matched.length
    deciles = Array.from({ length: 10 }, (_, i) =>
      matched.slice(Math.floor((i * n) / 10), Math.floor(((i + 1) * n) / 10)))
  })

  // This statewide claim intentionally covers both sectors. Sector-specific
  // comparisons elsewhere remain separate; the data-shape assertions below
  // prevent either governance label from being lost or crossed.
  it('has a sane matched cohort (both years plus a numeric ecoDisPct)', () => {
    const n = deciles.reduce((sum, d) => sum + d.length, 0)
    expect(n).toBeGreaterThan(8000)
    expect(deciles.every((d) => d.length > 0)).toBe(true)
  })

  it('bottom (highest-poverty) decile gains more than the top (lowest-poverty) decile', () => {
    // Ascending by ecoDisPct: deciles[0] is the lowest-poverty (wealthiest)
    // tenth, deciles[9] the highest-poverty (poorest, "bottom") tenth.
    const bottomGain = mean(deciles[9].map(gain))
    const topGain = mean(deciles[0].map(gain))
    expect(bottomGain).toBeGreaterThan(4.0)
    expect(topGain).toBeLessThan(1.5)
    expect(bottomGain - topGain).toBeGreaterThanOrEqual(3)
  })
})

describe('data shape', () => {
  it('publishes all 10,230 entities with exact level and sector totals', () => {
    const count = (level, isCharter) =>
      entities.filter((entity) => entity.level === level && !!entity.isCharter === isCharter).length

    expect(entities).toHaveLength(10230)
    expect(districts).toHaveLength(1199)
    expect(count('district', false)).toBe(1020)
    expect(count('district', true)).toBe(179)
    expect(entities.filter((entity) => entity.level === 'campus')).toHaveLength(9031)
    expect(count('campus', false)).toBe(8066)
    expect(count('campus', true)).toBe(965)
  })

  it('keeps every campus in the same sector as its district-level system', () => {
    const systems = new Map(districts.map((district) => [district.id, district]))
    const campuses = entities.filter((entity) => entity.level === 'campus')

    for (const campus of campuses) {
      const system = systems.get(campus.districtId)
      expect(system, `${campus.id} references unpublished system ${campus.districtId}`).toBeDefined()
      expect(
        !!campus.isCharter,
        `${campus.id} and system ${campus.districtId} cross governance sectors`
      ).toBe(!!system.isCharter)
    }
  })

  it('keeps 2021-22 under both methodologies', () => {
    const y = ratings.filter((r) => r.year === '2021-22')
    expect(new Set(y.map((r) => r.method))).toEqual(new Set(['original', 'what_if']))
  })

  it('never emits a numeric id', () => {
    expect(entities.every((e) => typeof e.id === 'string')).toBe(true)
  })
})
