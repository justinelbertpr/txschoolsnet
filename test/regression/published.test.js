import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'

// Everything else in this suite tests build/*.ndjson — the intermediate
// tidy tables. Nothing asserted against the artifacts actually shipped to
// visitors: site/data/payload-<hash>.json (the dashboard) and
// site/district/*.html + site/campus/*.html (the prerendered pages). A bug
// introduced between the build tables and either of those two outputs
// would sail through 108 green tests. This file closes that gap.
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

let payload, html

beforeAll(async () => {
  const file = (await readOrGuide('build/payload-name.txt')).trim()
  payload = JSON.parse(await readOrGuide(`site/data/${file}`))
  html = await readOrGuide(`site/district/${CAYUGA_ID}.html`)
})

describe('published payload (site/data/<payload>.json)', () => {
  it('lists exactly the five academic years, newest first', () => {
    expect(payload.years).toEqual(['2025-26', '2024-25', '2023-24', '2022-23', '2021-22'])
    expect(payload.years).toHaveLength(5)
  })

  it('keeps every entity column and every score/grade row at 10,230', () => {
    for (const col of Object.values(payload.entities)) expect(col).toHaveLength(10230)
    expect(payload.scores).toHaveLength(10230)
    expect(payload.grades).toHaveLength(10230)
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

describe('published page (site/district/001902.html)', () => {
  const tbody = () => html.match(/<tbody>([\s\S]*?)<\/tbody>/)[1]

  it('shows the current rating and score', () => {
    expect(html).toContain('Current rating <strong>B</strong> (89)')
  })

  it('has exactly 5 rows in the history table body', () => {
    expect(tbody().match(/<tr>/g)).toHaveLength(5)
  })

  it('shows the What If re-scored 2021-22 row (87)', () => {
    expect(tbody()).toMatch(/<tr><td>2021-22<\/td><td>B<\/td><td>87<\/td><\/tr>/)
  })

  it('never shows the pre-refresh score (94) in the table body', () => {
    expect(tbody()).not.toContain('94')
  })
})

describe('page and payload agree on every history row', () => {
  it("Cayuga ISD's rendered rows match the payload's scores/grades for the same years", () => {
    const i = payload.entities.id.indexOf(CAYUGA_ID)
    const tbody = html.match(/<tbody>([\s\S]*?)<\/tbody>/)[1]
    const rows = [...tbody.matchAll(/<tr><td>([^<]+)<\/td><td>([^<]+)<\/td><td>([^<]+)<\/td><\/tr>/g)]
      .map(([, year, rating, score]) => ({ year, rating, score }))

    expect(rows).toHaveLength(5)
    for (const row of rows) {
      const j = payload.years.indexOf(row.year)
      expect(j).toBeGreaterThanOrEqual(0)
      expect(payload.grades[i][j]).toBe(row.rating)
      expect(String(payload.scores[i][j])).toBe(row.score)
    }
  })
})
