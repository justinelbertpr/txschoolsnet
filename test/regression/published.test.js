import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { entitySlug } from '../../src/render/view-model.js'

// Everything else in this suite tests build/*.ndjson — the intermediate
// tidy tables. Nothing asserted against the artifacts actually shipped to
// visitors: site/data/payload-<hash>.json (the dashboard) and
// site/district/*.html + site/campus/*.html (the prerendered pages). A bug
// introduced between the build tables and either of those two outputs
// would sail through the rest of the green tests. This file closes that gap.
//
// The three corruptions it was written to catch, all of which a code review
// proved could pass the entire suite without it:
//
//   1. a wrong score on every page (a shifted column, a stale cache, a
//      formatter that rounds the wrong figure),
//   2. an empty history table (the section renders, the rows do not),
//   3. an empty payload (right filename, right shape, no data in it).
//
// Each is checked against the shipped bytes, not against the renderer — so
// the assertions are on markup, and they are deliberately exact. When the
// markup changes on purpose, re-derive them from the new output; do not
// loosen them until they stop failing. A regex that matches anything catches
// nothing.

const readOrGuide = async (path) => {
  try {
    return await readFile(path, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(
        `${path} is missing — run \`npm run site\` first to generate the site/ and build/ output.`
      )
    }
    throw err
  }
}

const CAYUGA_ID = '001902'
const YEARS = ['2025-26', '2024-25', '2023-24', '2022-23', '2021-22']
const ENTITY_COUNT = 9086

/* ---------------------------------------------------------------- parsing -- */

/** The rating-history section. Every entity page has one; nothing else on the
 *  page carries the year-by-year scores. */
const trajectory = (html) => html.match(/<section id="trajectory">([\s\S]*?)<\/section>/)?.[1] ?? null

/**
 * The rendered history rows, as the reader sees them with JavaScript off.
 * Null scores print as an em dash and unrated years as "Not Rated", so these
 * are compared against the payload verbatim rather than coerced — a page that
 * printed 0 where TEA published nothing would be a real defect.
 */
const historyRows = (html) => {
  const sec = trajectory(html)
  if (sec === null) return null
  const bodies = sec.match(/<tbody>([\s\S]*?)<\/tbody>/g) ?? []
  if (bodies.length !== 1) throw new Error(`expected one history table body, found ${bodies.length}`)
  const tbody = bodies[0]
  return [...tbody.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(([, row]) => ({
    year: row.match(/<th scope="row">([^<]*)<\/th>/)?.[1] ?? null,
    rating: row.match(/class="grade-letter">([^<]*)</)?.[1] ?? null,
    score: [...row.matchAll(/<td class="num">([^<]*)<\/td>/g)].map((m) => m[1])[0] ?? null,
  }))
}

/** The headline grade in the hero, which is what a reader takes away. */
const hero = (html) => {
  const block = html.match(/<div class="verdict">([\s\S]*?)<\/div>/)?.[1] ?? ''
  return {
    rating: block.match(/class="grade-letter">([^<]*)</)?.[1] ?? null,
    score: block.match(/class="grade-score">([^<]*)</)?.[1] ?? null,
  }
}

/** How the payload's cells are written into the page (src/render/shell.js). */
const asCell = (score) => (score === null ? '—' : String(score))
const asGrade = (g) => g ?? 'NR'

let payload, cayuga, sample

beforeAll(async () => {
  const file = (await readOrGuide('build/payload-name.txt')).trim()
  payload = JSON.parse(await readOrGuide(`site/data/${file}`))

  const pageFor = async (i) => {
    const e = {
      id: payload.entities.id[i],
      level: payload.entities.level[i],
      name: payload.entities.name[i],
    }
    // The URL scheme is slug-then-id and lives in one place. Deriving the path
    // here rather than hardcoding it means a rename of an entity does not turn
    // this suite red for the wrong reason — and a change to the scheme itself
    // is still caught, because the file has to exist under the name it returns.
    return { i, ...e, html: await readOrGuide(`site/${e.level}/${entitySlug(e)}.html`) }
  }

  const cayugaIndex = payload.entities.id.indexOf(CAYUGA_ID)
  cayuga = await pageFor(cayugaIndex)

  // A spread of the whole entity list, districts and campuses, rated and not.
  // One page proves the renderer can be right; a corruption applied to every
  // page is only visible across many.
  const indices = [...new Set(
    Array.from({ length: 24 }, (_, k) => Math.floor((k * payload.entities.id.length) / 24))
      .concat(cayugaIndex)
  )]
  sample = await Promise.all(indices.map(pageFor))
})

/* ---------------------------------------------------------------- payload -- */

describe('published payload (site/data/<payload>.json)', () => {
  it('lists exactly the five academic years, newest first', () => {
    expect(payload.years).toEqual(YEARS)
    expect(payload.years).toHaveLength(5)
  })

  it('keeps every entity column and every score/grade row at 9,086', () => {
    for (const col of Object.values(payload.entities)) expect(col).toHaveLength(ENTITY_COUNT)
    expect(payload.scores).toHaveLength(ENTITY_COUNT)
    expect(payload.grades).toHaveLength(ENTITY_COUNT)
  })

  it('gives every entity one cell per year', () => {
    expect(payload.scores.every((row) => row.length === payload.years.length)).toBe(true)
    expect(payload.grades.every((row) => row.length === payload.years.length)).toBe(true)
  })

  // Right filename, right shape, no data in it: the corruption that the length
  // assertions above cannot see, because an array of 9,086 nulls is 9,086
  // long. TEA rates the overwhelming majority of entities every year.
  it('is not an empty shell — most cells carry a real score and grade', () => {
    const cells = payload.scores.flat()
    const grades = payload.grades.flat()
    expect(cells.filter((s) => typeof s === 'number').length / cells.length).toBeGreaterThan(0.85)
    expect(grades.filter((g) => typeof g === 'string' && g !== '').length / grades.length).toBeGreaterThan(0.9)

    // Exact, not a proportion: a score TEA published always comes with the
    // grade that goes with it. A cell holding one without the other means the
    // two arrays were built from different rows.
    expect(cells.filter((s, k) => typeof s === 'number' && typeof grades[k] !== 'string')).toHaveLength(0)

    expect(payload.entities.name.filter((n) => typeof n === 'string' && n !== '')).toHaveLength(ENTITY_COUNT)
    expect(new Set(payload.entities.id).size).toBe(ENTITY_COUNT)
  })

  it("Cayuga ISD's current (2025-26) score and grade", () => {
    const i = payload.entities.id.indexOf(CAYUGA_ID)
    expect(i).toBeGreaterThanOrEqual(0)
    const j = payload.years.indexOf('2025-26')
    expect(payload.scores[i][j]).toBe(89)
    expect(payload.grades[i][j]).toBe('B')
  })

  it("Cayuga ISD's 2021-22 score/grade is the What If re-scoring, not the original", () => {
    const i = payload.entities.id.indexOf(CAYUGA_ID)
    const j = payload.years.indexOf('2021-22')
    expect(payload.scores[i][j]).toBe(87)
    expect(payload.grades[i][j]).toBe('B')
  })

  it("Cayuga ISD's original (pre-refresh) 2021-22 score is 94", () => {
    const i = payload.entities.id.indexOf(CAYUGA_ID)
    expect(payload.original['2021-22'][i]).toBe(94)
  })
})

/* ------------------------------------------------------------- the page --- */

describe('published page (site/district/cayuga-isd-001902.html)', () => {
  it('is served under the slug-and-id URL the canonical tag declares', () => {
    expect(entitySlug(cayuga)).toBe('cayuga-isd-001902')
    expect(cayuga.html).toContain('<link rel="canonical" href="https://txschools.net/district/cayuga-isd-001902">')
  })

  it('shows the current rating and score in the hero', () => {
    expect(hero(cayuga.html)).toEqual({ rating: 'B', score: '89' })
    // The verdict rewrite (2026-08) replaced the old subjectless "Scores
    // <strong>89</strong>" with a sentence that names the district and states
    // the scale: see src/render/sections.js:verdictSummary.
    expect(cayuga.html).toContain('Cayuga ISD is rated <strong>B</strong> by TEA, scoring <strong>89 out of 100</strong> for 2025-26')
  })

  it('has exactly 5 rows in the history table body', () => {
    expect(historyRows(cayuga.html)).toHaveLength(5)
  })

  it('lists the five years newest first', () => {
    expect(historyRows(cayuga.html).map((r) => r.year)).toEqual(YEARS)
  })

  it('shows the What If re-scored 2021-22 row (87), not the original', () => {
    const row = historyRows(cayuga.html).find((r) => r.year === '2021-22')
    expect(row).toEqual({ year: '2021-22', rating: 'B', score: '87' })
  })

  it('never shows the pre-refresh score (94) in the history table', () => {
    for (const row of historyRows(cayuga.html)) expect(row.score).not.toBe('94')
    expect(trajectory(cayuga.html).match(/<tbody>[\s\S]*?<\/tbody>/)[0]).not.toContain('94')
  })

  it('shows 94 in the trajectory footnote AND the verdict, nowhere else', () => {
    const note = trajectory(cayuga.html).match(/<p class="note">([\s\S]*?)<\/p>/)?.[1]
    expect(note).toContain('original scoring')
    expect(note).toContain('<strong>94</strong>')

    // The verdict rewrite (2026-08) folded the same fact into the hero
    // sentence, deliberately: "up 2 points since 2021-22" used to sit 200px
    // above a footnote saying the district scored 94 that year, with nothing
    // joining the two true-but-apparently-contradictory numbers. The verdict
    // now states the pre-refresh score itself, in the same clause that makes
    // the "up" claim, so the two never again read as disagreeing.
    const verdict = cayuga.html.match(/<p class="summary">([\s\S]*?)<\/p>/)?.[1]
    expect(verdict).toContain("under the rules in force back then it scored <strong>94</strong>")

    // Nowhere else on the page is it presented as this district's score —
    // exactly these two places, not the history table (checked above) and not
    // a third repetition.
    expect(cayuga.html.match(/<strong>94<\/strong>/g)).toHaveLength(2)
  })

  it('reads without JavaScript: the rows are in the HTML, not fetched', () => {
    // The rail names the payload once, in data-pin-source, so the district pinner
    // can LAZY-load it on first use. That is the one legitimate reference; the
    // assertion's point is that the page's own figures are not fetched, so strip
    // that single tag and require the payload to appear nowhere else.
    const withoutPinSource = cayuga.html.replace(
      /<script type="application\/json" data-pin-source>[\s\S]*?<\/script>/,
      ''
    )
    expect(withoutPinSource).not.toMatch(/payload-[a-f0-9]{8}\.json/)
    expect(cayuga.html).toContain('<td class="num">89</td>')
  })

  it('states that the site is not affiliated with TEA', () => {
    expect(cayuga.html).toContain('not affiliated with the Texas Education Agency')
  })
})

/* ------------------------------------------------- page agrees with payload */

describe('page and payload agree on every history row', () => {
  it("Cayuga ISD's rendered rows match the payload's scores/grades for the same years", () => {
    const rows = historyRows(cayuga.html)
    expect(rows).toHaveLength(payload.years.length)
    for (const row of rows) {
      const j = payload.years.indexOf(row.year)
      expect(j).toBeGreaterThanOrEqual(0)
      expect(row.rating).toBe(asGrade(payload.grades[cayuga.i][j]))
      expect(row.score).toBe(asCell(payload.scores[cayuga.i][j]))
    }
  })

  // The corruption this exists for is a wrong score on EVERY page, which one
  // entity cannot reveal. Every sampled page is checked cell by cell against
  // the payload the dashboard reads, so the two published artifacts can never
  // drift apart silently.
  it('every sampled page across the entity list matches the payload, cell for cell', () => {
    expect(sample.length).toBeGreaterThanOrEqual(20)
    let checked = 0

    for (const page of sample) {
      const rows = historyRows(page.html)
      const where = `${page.level}/${entitySlug(page)}`
      expect(rows, `${where} has no rating-history section`).not.toBeNull()

      const rendered = new Map(rows.map((r) => [r.year, r]))
      for (const [j, year] of payload.years.entries()) {
        const score = payload.scores[page.i][j]
        const row = rendered.get(year)
        // A year TEA never rated this entity may be absent from the table;
        // a year it scored may not be.
        if (row === undefined) {
          expect(score, `${where} omits ${year}, which has a score`).toBeNull()
          continue
        }
        expect(row.score, `${where} ${year} score`).toBe(asCell(score))
        expect(row.rating, `${where} ${year} grade`).toBe(asGrade(payload.grades[page.i][j]))
        checked += 1
      }
    }

    // Guards the guard: an empty table body, or a parser that silently matched
    // nothing, would leave this at zero while every assertion above vacuously
    // passed.
    expect(checked).toBeGreaterThanOrEqual(sample.length * payload.years.length * 0.9)
  })

  it('every sampled page leads with the score the payload gives it for the current year', () => {
    const j = payload.years.indexOf('2025-26')
    for (const page of sample) {
      const score = payload.scores[page.i][j]
      const { rating, score: shown } = hero(page.html)
      expect(rating, `${page.level}/${entitySlug(page)} hero grade`).toBe(asGrade(payload.grades[page.i][j]))
      // A null score prints no number at all rather than a zero.
      expect(shown, `${page.level}/${entitySlug(page)} hero score`).toBe(score === null ? null : String(score))
    }
  })
})
