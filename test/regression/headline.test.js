import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { mean, weightedMean, median } from '../../src/lib/stats.js'
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

/** Mean score across districts of one sector for one year, default-methodology view. */
const districtMean = (year, isCharter) => {
  const scores = preferred
    .filter((r) => r.year === year)
    .filter((r) => byId.get(r.id)?.level === 'district' && byId.get(r.id)?.isCharter === isCharter)
    .map((r) => r.score)
  return mean(scores)
}

describe('design §8 — unweighted district means', () => {
  it.each([
    ['2021-22', 80.6, 82.3],
    ['2023-24', 78.7, 78.0],
    ['2025-26', 81.7, 79.7],
  ])('%s: traditional %f, charter %f', (year, trad, charter) => {
    expect(districtMean(year, false)).toBeCloseTo(trad, 1)
    expect(districtMean(year, true)).toBeCloseTo(charter, 1)
  })

  it('shows traditional districts overtaking charters', () => {
    const gap = (y) => districtMean(y, false) - districtMean(y, true)
    expect(gap('2021-22')).toBeLessThan(0)
    expect(gap('2025-26')).toBeGreaterThan(0)
  })
})

describe('design §8 — enrollment weighting reverses the ordering', () => {
  const weighted = (year, isCharter) =>
    weightedMean(
      preferred
        .filter((r) => r.year === year)
        .filter((r) => byId.get(r.id)?.level === 'district' && byId.get(r.id)?.isCharter === isCharter)
        .map((r) => ({ v: r.score, w: byId.get(r.id).enrollment }))
    )

  it('puts charters ahead by student in 2025-26', () => {
    expect(weighted('2025-26', false)).toBeCloseTo(82.4, 1)
    expect(weighted('2025-26', true)).toBeCloseTo(82.9, 1)
    expect(weighted('2025-26', true)).toBeGreaterThan(weighted('2025-26', false))
  })
})

describe('design §8 — charters serve higher-poverty populations', () => {
  const medianEcoDis = (isCharter) => {
    const p = new Map(profile.map((r) => [r.id, r.ecoDisPct]))
    return median(districts.filter((d) => d.isCharter === isCharter).map((d) => p.get(d.id) ?? null))
  }

  it('reports the medians the design states', () => {
    expect(medianEcoDis(false)).toBeCloseTo(59.35, 1)
    expect(medianEcoDis(true)).toBeCloseTo(77.4, 1)
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
      .map((c) => ({ isCharter: c.isCharter, ecoDisPct: ecoDis.get(c.id), s1: trough.get(c.id), s2: current.get(c.id) }))
      .filter((c) => typeof c.ecoDisPct === 'number' && typeof c.s1 === 'number' && typeof c.s2 === 'number')
      .sort((a, b) => a.ecoDisPct - b.ecoDisPct)

    const n = matched.length
    deciles = Array.from({ length: 10 }, (_, i) =>
      matched.slice(Math.floor((i * n) / 10), Math.floor(((i + 1) * n) / 10)))
  })

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

  it('traditional campuses lead charter campuses in at least 6 of the 10 deciles', () => {
    const leads = deciles.filter((d) => {
      const trad = mean(d.filter((c) => !c.isCharter).map(gain))
      const charter = mean(d.filter((c) => c.isCharter).map(gain))
      return trad !== null && charter !== null && trad > charter
    }).length
    expect(leads).toBeGreaterThanOrEqual(6)
  })
})

describe('data shape', () => {
  it('has 1,199 districts and 9,031 campuses', () => {
    expect(districts).toHaveLength(1199)
    expect(entities.filter((e) => e.level === 'campus')).toHaveLength(9031)
  })

  it('classifies 179 charter districts by entity_type', () => {
    expect(districts.filter((d) => d.isCharter)).toHaveLength(179)
  })

  it('keeps 2021-22 under both methodologies', () => {
    const y = ratings.filter((r) => r.year === '2021-22')
    expect(new Set(y.map((r) => r.method))).toEqual(new Set(['original', 'what_if']))
  })

  it('never emits a numeric id', () => {
    expect(entities.every((e) => typeof e.id === 'string')).toBe(true)
  })
})
