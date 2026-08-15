// Unit tests for src/prerender.js — the pure, exported pieces of the site
// builder: the URL scheme, the sitemap, the redirect rule that keeps campus
// data links resolving, the hub plan, and the two small normalisers
// (cleanAchievement, humanDate) that stand between ragged TEA rows and the
// renderer. prerender() itself is not called here: it spawns worker threads and
// writes 12,940 files. The shipped output of that run is asserted in
// test/regression/published.test.js instead.
//
// renderEntity moved to src/render/page.js and now takes a view model rather
// than (entity, history); it is imported from there. The escapeHtml that used
// to live in prerender.js is gone — src/render/shell.js's esc() is the one
// escaping function now, so the escaping assertion below goes through the real
// renderer rather than calling an escape helper directly.

import { describe, it, expect } from 'vitest'
import {
  SITE_ORIGIN,
  entityPath,
  renderSitemap,
  ALPHABET,
  humanDate,
  cleanAchievement,
  hubPlan,
} from '../src/prerender.js'
import { renderEntity } from '../src/render/page.js'
import { entitySlug } from '../src/render/view-model.js'

const entity = {
  id: '001902', level: 'district', name: 'Cayuga ISD', county: 'Anderson',
  regionId: '07', isCharter: false, isAlt: false, enrollment: 574, rating: 'B', score: 89,
}

/** The shape src/render/page.js consumes: buildViewModel's output, minus the
 *  sections that vanish when their data is absent. */
const vm = (over = {}) => ({
  id: entity.id,
  level: 'district',
  name: 'Cayuga ISD',
  slug: entitySlug({ name: 'Cayuga ISD', id: '001902' }),
  county: 'Anderson',
  countySlug: 'anderson',
  regionId: '07',
  regionName: 'Region 07: Kilgore',
  isCharter: false,
  isAlt: false,
  enrollment: 574,
  history: [
    { year: '2025-26', rating: 'B', score: 89 },
    { year: '2024-25', rating: 'B', score: 88 },
  ],
  ...over,
})

describe('entityPath', () => {
  it('names the file slug-then-id, because names are not unique', () => {
    expect(entityPath(entity)).toBe('district/cayuga-isd-001902.html')
  })

  it('routes districts and campuses into separate directories', () => {
    expect(entityPath({ ...entity, level: 'campus' })).toBe('campus/cayuga-isd-001902.html')
  })

  it('agrees with the slug the renderer puts in the canonical URL', () => {
    expect(entityPath(entity)).toBe(`district/${entitySlug(entity)}.html`)
    expect(renderEntity(vm())).toContain(`href="${SITE_ORIGIN}/district/${entitySlug(entity)}"`)
  })
})

describe('renderSitemap', () => {
  it('emits one url element per path, extension stripped', () => {
    const xml = renderSitemap([entityPath(entity)])
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/district/cayuga-isd-001902</loc>`)
    expect(xml.match(/<url>/g)).toHaveLength(1)
  })

  it('keeps one entry per path when given many', () => {
    const xml = renderSitemap(['', 'about.html', 'district/cayuga-isd-001902.html'])
    expect(xml.match(/<url>/g)).toHaveLength(3)
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/</loc>`)
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/about</loc>`)
  })
})

describe('ALPHABET', () => {
  it('is the full a-z the letter hubs and the URL scheme assume', () => {
    expect(ALPHABET).toHaveLength(26)
    expect(ALPHABET[0]).toBe('a')
    expect(ALPHABET.at(-1)).toBe('z')
  })
})

describe('humanDate', () => {
  it('renders the snapshot timestamp the way every page words it', () => {
    expect(humanDate('2026-08-15T16:19:29.181Z')).toBe('15 August 2026')
  })

  it('reads the timestamp as UTC, not as the machine running the build', () => {
    // 23:30Z is the previous day in every US timezone; a local-time render
    // would date the snapshot a day early for half the year.
    expect(humanDate('2026-08-15T23:30:00.000Z')).toBe('15 August 2026')
  })
})

describe('cleanAchievement', () => {
  // student_achievement_tab publishes '' rather than [] for a campus with no
  // STAAR results. buildViewModel hands those straight to metricSpecs, where
  // ''.flatMap throws and the page never renders.
  it("coerces TEA's empty-string arrays to real empty arrays", () => {
    const [row] = cleanAchievement([{ id: '1', subject: '', approach: '', meet: [0.5] }])
    expect(row.subject).toEqual([])
    expect(row.approach).toEqual([])
    expect(row.meet).toEqual([0.5])
  })

  it('leaves a clean row untouched, by identity', () => {
    const clean = { id: '1', subject: ['Reading'], approach: [0.8] }
    const [row] = cleanAchievement([clean])
    expect(row).toBe(clean)
  })

  it("patches a copy rather than mutating the caller's row", () => {
    const dirty = { id: '1', subject: '' }
    const [row] = cleanAchievement([dirty])
    expect(dirty.subject).toBe('')
    expect(row.subject).toEqual([])
  })

  it('treats a missing table as empty rather than throwing', () => {
    expect(cleanAchievement(undefined)).toEqual([])
    expect(cleanAchievement(null)).toEqual([])
  })
})

describe('hubPlan', () => {
  const entities = [
    { id: '001902', level: 'district', name: 'Cayuga ISD', county: 'Anderson', regionId: '7', score: 89 },
    { id: '001903', level: 'district', name: 'Elkhart ISD', county: 'Anderson', regionId: '7', score: 79 },
    { id: '057905', level: 'district', name: 'Dallas ISD', county: 'Dallas', regionId: '10', score: 71 },
    { id: '057905001', level: 'campus', name: 'Bryan Adams HS', county: 'Dallas', regionId: '10', score: 65 },
  ]
  const regionNames = new Map([['07', 'Region 07: Kilgore'], ['10', 'Region 10: Richardson']])
  const plan = hubPlan(entities, regionNames)

  it('builds one region page per region that has entities, zero-padded', () => {
    expect(plan.regions.map((r) => r.id)).toEqual(['07', '10'])
    expect(plan.regions[0].name).toBe('Region 07: Kilgore')
  })

  it('counts districts per region without counting campuses', () => {
    expect(plan.regions.find((r) => r.id === '07').districtCount).toBe(2)
    expect(plan.regions.find((r) => r.id === '10').districtCount).toBe(1)
    expect(plan.regions.find((r) => r.id === '10').rows).toHaveLength(2)
  })

  it('builds a county page for every county a breadcrumb can point at, campuses included', () => {
    expect(plan.counties.map((c) => c.slug)).toEqual(['anderson', 'dallas'])
    expect(plan.counties.find((c) => c.slug === 'dallas').rows).toHaveLength(2)
    expect(plan.counties.find((c) => c.slug === 'anderson').regionId).toBe('07')
  })

  it('lists only districts in districts, each with the slug its link needs', () => {
    expect(plan.districts).toHaveLength(3)
    expect(plan.districts.every((d) => d.level === 'district')).toBe(true)
    expect(plan.districts[0].slug).toBe('cayuga-isd-001902')
  })

  it('averages district scores only, and states the denominator', () => {
    expect(plan.state).toEqual({ avg: 79.7, n: 3 })
  })

  it('excludes entities with no score from the average rather than counting them as zero', () => {
    const { state } = hubPlan(
      [...entities, { id: '001904', level: 'district', name: 'Neches ISD', county: 'Anderson', regionId: '7', score: null }],
      regionNames
    )
    expect(state.n).toBe(3)
    expect(state.avg).toBe(79.7)
  })
})

describe('renderEntity (src/render/page.js)', () => {
  const html = renderEntity(vm())

  it('puts the name in the title', () => {
    expect(html).toMatch(/<title>Cayuga ISD/)
  })

  it('inlines the history rather than linking a data file', () => {
    expect(html).toContain('2024-25')
    // The rail's district pinner is the one place a page may name the payload:
    // it is the source the client lazy-loads to search 1,199 districts, and
    // inlining that list would cost more than the page it sits on. Nothing the
    // reader reads comes from it, which is what this assertion protects — so
    // remove that one script tag and the payload must appear nowhere else.
    const withoutPinSource = html.replace(
      /<script type="application\/json" data-pin-source>[\s\S]*?<\/script>/,
      ''
    )
    expect(withoutPinSource).not.toMatch(/payload-[a-f0-9]{8}\.json/)
  })

  it('declares a canonical URL on the slug-and-id scheme', () => {
    expect(html).toMatch(/<link rel="canonical" href="https:\/\/[^"]+\/district\/cayuga-isd-001902">/)
  })

  it('sets lang and viewport for mobile and screen readers', () => {
    expect(html).toMatch(/<html lang="en">/)
    expect(html).toMatch(/name="viewport"/)
  })

  it('names the site as unaffiliated with TEA on every page', () => {
    expect(html).toContain('not affiliated with the Texas Education Agency')
  })

  it('labels the sector', () => {
    expect(renderEntity(vm({ isCharter: true }))).toContain('Charter')
    expect(html).toContain('Traditional')
  })

  it('labels alternative-education campuses so their bar is not mistaken for a comprehensive one', () => {
    expect(renderEntity(vm({ isAlt: true }))).toContain('Alternative Education Accountability')
  })

  it('does not label a non-AEA entity', () => {
    expect(html).not.toContain('Alternative Education Accountability')
  })

  it('escapes HTML in names', () => {
    expect(renderEntity(vm({ name: 'A & B <script>' }))).toContain('A &amp; B &lt;script&gt;')
  })

  it('states the history count in the description, matching the number of rows passed in', () => {
    expect(html).toContain('2 years of ratings')
  })
})

describe('renderEntity — description year count', () => {
  // A hardcoded count would pass at most one of these, since each uses a
  // different history length.
  it('reflects a longer history', () => {
    const history = ['2025-26', '2024-25', '2023-24', '2022-23', '2021-22'].map((year) => ({
      year, rating: 'B', score: 87,
    }))
    expect(renderEntity(vm({ history }))).toContain('5 years of ratings')
  })

  it('counts a single year as one', () => {
    const html = renderEntity(vm({ history: [{ year: '2025-26', rating: 'B', score: 89 }] }))
    // The count is what is under test. src/render/page.js hardcodes the plural,
    // so this currently reads "1 years of ratings" — a wording defect reported
    // separately, not something this test should freeze in place.
    expect(html).toMatch(/\b1 years? of ratings\b/)
    expect(html).not.toMatch(/\b[02-9]\d* years of ratings\b/)
  })

  it('renders an entity with no history at all rather than throwing', () => {
    const html = renderEntity(vm({ history: [] }))
    expect(html).toContain('0 years of ratings')
    expect(html).toContain('<h1>Cayuga ISD</h1>')
    expect(html).toContain('not rated')
  })
})
