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

/** Mean district score for one year, default-methodology view. */
const districtMean = (year) => {
  const scores = preferred
    .filter((r) => r.year === year)
    .filter((r) => byId.get(r.id)?.level === 'district')
    .map((r) => r.score)
  return mean(scores)
}

// This site now excludes charter districts and campuses from every table it
// publishes (build.js:excludeCharters) — a deliberate editorial decision, not
// a data gap. The design's original §8 findings compared traditional ISDs
// against charters; that comparison no longer has a second group to compare
// against in build/*.ndjson, so those specific assertions are gone. What
// survives is every claim that was, and still is, about traditional districts
// on their own — the numbers below are unchanged from the original design
// because districtMean was always computed on the traditional-only filter.
describe('design §8 — unweighted district means', () => {
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

  // Smaller than the design's original threshold: that count included charter
  // campuses, which build.js now excludes before this table is even built.
  it('has a sane matched cohort (both years plus a numeric ecoDisPct)', () => {
    const n = deciles.reduce((sum, d) => sum + d.length, 0)
    expect(n).toBeGreaterThan(7000)
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
  // TEA publishes 1,199 districts and 9,031 campuses; this site excludes
  // charters (build.js:excludeCharters), which is 1,020 traditional districts
  // and 8,066 traditional campuses of that total.
  it('has 1,020 districts and 8,066 campuses', () => {
    expect(districts).toHaveLength(1020)
    expect(entities.filter((e) => e.level === 'campus')).toHaveLength(8066)
  })

  it('excludes every charter district and campus from the build', () => {
    expect(entities.filter((e) => e.isCharter)).toHaveLength(0)
  })

  it('keeps 2021-22 under both methodologies', () => {
    const y = ratings.filter((r) => r.year === '2021-22')
    expect(new Set(y.map((r) => r.method))).toEqual(new Set(['original', 'what_if']))
  })

  it('never emits a numeric id', () => {
    expect(entities.every((e) => typeof e.id === 'string')).toBe(true)
  })
})
