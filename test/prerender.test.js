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
  countyRankingScopes,
  rankingIndex,
  rankingLinksFor,
  rankingBoardsFor,
  rankingCsvFile,
  rankingRows,
  rankingMeta,
  rankingMetrics,
  rankingScopes,
  RANKING_PLAN,
  recentChangeRankIndex,
} from '../src/prerender.js'
import { rankingCatalogue } from '../src/render/rankings-page.js'
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

const RECENT_FROM = '2024-25'
const RECENT_TO = '2025-26'
const RECENT_METRICS = [
  'score',
  'domain:achievement',
  'domain:progress',
  'domain:gaps',
  'domain:progress_growth',
  'domain:progress_relative',
]

const recentChangeFixture = () => {
  const entities = []
  const bundles = new Map()
  const add = ({ id, level, regionId, regionName, changes = {} }) => {
    const series = {}
    for (const metric of RECENT_METRICS) {
      const delta = changes[metric] ?? 0
      series[metric] = { [RECENT_FROM]: 50, [RECENT_TO]: 50 + delta }
    }
    // A large spending gain proves that the index only considers the six
    // accountability measures, even though spending is change-capable too.
    series.spend = { [RECENT_FROM]: 10_000, [RECENT_TO]: 20_000 }

    entities.push({ id, level })
    bundles.set(id, {
      id,
      name: id,
      level,
      regionId,
      regionName,
      isAlt: false,
      score: series.score[RECENT_TO],
      series,
    })
  }

  // Thirty districts make third place exactly the edge of the top decile.
  // Each non-score metric isolates one rule: a sub-two-point gain, a broad
  // tie, an allowed two-way tie, and a fourth-place result.
  for (let i = 0; i < 30; i += 1) {
    add({
      id: `d${String(i).padStart(2, '0')}`,
      level: 'district',
      regionId: '01',
      regionName: 'Region 01: Edinburg',
      changes: {
        score: 30 - i,
        'domain:achievement': i === 0 ? 1 : 0,
        'domain:progress': i < 4 ? 8 : 0,
        'domain:gaps': i === 0 ? 14 : 0,
        'domain:progress_growth': i < 3 ? 7 : 0,
        'domain:progress_relative': i < 4 ? 10 - i : 0,
      },
    })
  }

  // This region is too small to publish, but its best districts can still earn
  // a statewide placement in the 35-district population.
  for (let i = 0; i < 5; i += 1) {
    add({
      id: `thin${i}`,
      level: 'district',
      regionId: '02',
      regionName: 'Region 02: Corpus Christi',
      changes: { score: 40 - i },
    })
  }

  // With twenty campuses, second place is top-decile and third is not.
  for (let i = 0; i < 20; i += 1) {
    add({
      id: `c${String(i).padStart(2, '0')}`,
      level: 'campus',
      regionId: '03',
      regionName: 'Region 03: Victoria',
      changes: { score: 20 - i },
    })
  }

  return { entities, bundles }
}

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

describe('recentChangeRankIndex', () => {
  const { entities, bundles } = recentChangeFixture()
  const index = recentChangeRankIndex({
    entities,
    bundles,
    latestYear: RECENT_TO,
    previousYear: RECENT_FROM,
  })

  it('keeps a compact, fully-labelled placement from the explicit one-year window', () => {
    const placement = index.d00.find((row) => row.metric === 'score' && row.cohort === 'region')
    expect(placement).toEqual({
      metric: 'score',
      label: 'Overall score',
      fmt: 'points',
      cohort: 'region',
      cohortLabel: 'Region 01: Edinburg',
      rank: 1,
      of: 30,
      tied: 0,
      value: 30,
      delta: 30,
      from: 50,
      to: 80,
      fromYear: RECENT_FROM,
      toYear: RECENT_TO,
    })
  })

  it('requires a two-point gain, a top-three top-decile rank, and a distinct tie', () => {
    expect(index.d00.some((row) => row.metric === 'domain:achievement')).toBe(false) // only +1
    expect(index.d00.some((row) => row.metric === 'domain:progress')).toBe(false) // tied with three

    const allowedTie = index.d00.find((row) => row.metric === 'domain:progress_growth' && row.cohort === 'region')
    expect(allowedTie).toMatchObject({ rank: 1, of: 30, tied: 2, delta: 7 })

    // d03 is fourth for both score and Relative Performance and has no other
    // qualifying result, so it never gets an index entry.
    expect(index.d03).toBeUndefined()
    expect(Object.values(index).flat().some((row) => row.metric === 'spend')).toBe(false)
  })

  it('covers campuses and both published scopes, while suppressing a thin region', () => {
    const statewide = index.thin0.filter((row) => row.metric === 'score')
    expect(statewide).toHaveLength(1)
    expect(statewide[0]).toMatchObject({ cohort: 'state', cohortLabel: 'Texas', rank: 1, of: 35 })

    const campusScopes = index.c01
      .filter((row) => row.metric === 'score')
      .map((row) => row.cohort)
      .sort()
    expect(campusScopes).toEqual(['region', 'state'])

    // Third of 20 clears the top-three rule but is 15% down the ordering, not
    // top-decile; rounded percentile arithmetic must not let it through.
    expect(index.c02).toBeUndefined()
  })

  it('returns an empty plain object when there is no explicit two-year window', () => {
    expect(recentChangeRankIndex({ entities, bundles, latestYear: RECENT_TO })).toEqual({})
    expect(recentChangeRankIndex({ entities, bundles, latestYear: RECENT_TO, previousYear: RECENT_TO })).toEqual({})
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

  it('labels every entity Traditional — this site excludes charters entirely', () => {
    expect(html).toContain('Traditional')
    // Even a view model someone constructs with isCharter: true must not
    // relabel the page: charters never reach this renderer once excluded at
    // the build step, and the eyebrow no longer reads that field at all.
    expect(renderEntity(vm({ isCharter: true }))).toContain('Traditional')
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
    // The description no longer counts years when there are none. "0 years of
    // ratings" was a true sentence nobody should ever read; the page now simply
    // does not make a claim about history it does not have.
    expect(html).not.toMatch(/\b0 years? of ratings\b/)
    expect(html).toContain('<h1>Cayuga ISD</h1>')
    expect(html).toContain('not rated')
  })
})

/* ---------------------------------------------------------------- rankings */
//
// The ranking pages are written by src/render/rankings-page.js and their rows
// computed by src/render/rankings.js. What is asserted here is only the wiring
// this step owns: which populations are offered a ranking at all, and the link
// index that lets an entity page point at a ranking without ever constructing a
// URL for it. The index is the load-bearing piece — it is what makes a link to a
// page that was not built impossible rather than merely unlikely.

describe('countyRankingScopes', () => {
  const county = (name, rated, unrated = 0) => ({
    name,
    slug: name.toLowerCase(),
    rows: [
      ...Array.from({ length: rated }, (_, i) => ({ level: 'district', id: `${name}${i}`, score: 80, countyId: '057' })),
      ...Array.from({ length: unrated }, () => ({ level: 'district', score: null, countyId: '057' })),
      { level: 'campus', score: 90, countyId: '057' },
    ],
  })

  it('offers a ranking only where there are enough rated districts to rank', () => {
    const scopes = countyRankingScopes([county('Harris', 55), county('Loving', 1)])
    expect(scopes.map((s) => s.label)).toEqual(['Harris County'])
  })

  it('counts rated districts, not campuses and not unrated districts', () => {
    // 9 rated districts, plus one unrated and one campus, is 9 — below the bar.
    expect(countyRankingScopes([county('Borderline', 9, 4)])).toEqual([])
    expect(countyRankingScopes([county('Borderline', 10, 4)])).toHaveLength(1)
  })

  it('keys the scope on countyId but spells the URL like the county hub', () => {
    const [s] = countyRankingScopes([county('Dallas', 40)])
    expect(s.id).toBe('057')
    expect(s.countySlug).toBe('dallas')
    expect(s.href).toBe('/county/dallas')
  })
})

describe('rankingIndex', () => {
  // `title` matters as much as `href` now: sections.js:rankedBoard uses it to
  // label a link with the board's own heading rather than composing a
  // completeness claim ("Every ... ranked by ...") that a truncated board
  // cannot back — see the fix for defect #1 below.
  const board = (over = {}) => ({
    end: 'top',
    level: 'district',
    metric: { key: 'score' },
    scope: { kind: 'state' },
    href: '/rankings/texas-districts/overall-score-highest',
    title: 'Texas school districts with the highest overall score',
    ...over,
  })

  const region = board({
    scope: { kind: 'region', id: '10' },
    href: '/rankings/region-10-districts/overall-score-highest',
    title: 'Region 10 school districts with the highest overall score',
  })
  const county = board({
    scope: { kind: 'county', id: '057', countySlug: 'dallas' },
    href: '/rankings/dallas-county-districts/overall-score-highest',
    title: 'Dallas County school districts with the highest overall score',
  })

  it('indexes by level, then scope, then metric key, carrying the href and the title', () => {
    const idx = rankingIndex([board(), region, county])
    expect(idx.district.state.score.top.href).toBe('/rankings/texas-districts/overall-score-highest')
    expect(idx.district.state.score.top.title).toBe('Texas school districts with the highest overall score')
    expect(idx.district['region:10'].score.top.href).toBe('/rankings/region-10-districts/overall-score-highest')
    expect(idx.district['county:dallas'].score.top.href).toBe('/rankings/dallas-county-districts/overall-score-highest')
  })

  // Was: "points a placement at the end of the list that starts at 1st" —
  // the index kept only the 'top' href, on the theory that a reader always
  // wants the list starting at 1st. That is the exact defect a verified audit
  // found: rankings-page.js prints only the first LIST_LIMIT rows of a long
  // board, so an entity ranked past that slice does not appear on the 'top'
  // page at all, and the site was linking every entity there regardless.
  // sections.js:rankedBoard needs BOTH hrefs to pick the one that actually
  // contains a given entity, so the index now keeps both rather than
  // discarding 'bottom' before any caller can choose.
  it('indexes both ends of an ordering, not only the one that starts at 1st', () => {
    const idx = rankingIndex([
      board(),
      board({
        end: 'bottom',
        href: '/rankings/texas-districts/overall-score-lowest',
        title: 'Texas school districts with the lowest overall score',
      }),
    ])
    expect(idx.district.state.score.top.href).toBe('/rankings/texas-districts/overall-score-highest')
    expect(idx.district.state.score.bottom.href).toBe('/rankings/texas-districts/overall-score-lowest')
  })

  it('keys a county on the slug its hub uses, not on the id the ranking partitions by', () => {
    // /county/dallas and the ranking of Dallas County have to agree on one
    // spelling, or every county link on every entity page silently misses.
    expect(Object.keys(rankingIndex([county]).district)).toEqual(['county:dallas'])
  })

  it('separates the levels, so a campus never links a ranking of districts', () => {
    const idx = rankingIndex([
      board(),
      board({
        level: 'campus',
        href: '/rankings/texas-campuses/overall-score-highest',
        title: 'Texas campuses with the highest overall score',
      }),
    ])
    expect(idx.campus.state.score.top.href).toBe('/rankings/texas-campuses/overall-score-highest')
    expect(idx.district.state.score.top.href).not.toBe(idx.campus.state.score.top.href)
  })
})

describe('rankingLinksFor', () => {
  const end = (href, title = 'title') => ({ href, title })
  const idx = {
    district: {
      state: { score: { top: end('/rankings/texas-districts/overall-score-highest') } },
      'region:10': { score: { top: end('/rankings/region-10-districts/overall-score-highest') } },
      'county:dallas': { score: { top: end('/rankings/dallas-county-districts/overall-score-highest') } },
    },
  }
  const dallas = { level: 'district', regionId: '10', county: 'Dallas' }

  it('hands over the three cohorts a static page can exist for', () => {
    const links = rankingLinksFor(idx, dallas)
    expect(links.state.score.top.href).toBe('/rankings/texas-districts/overall-score-highest')
    expect(links.region.score.top.href).toBe('/rankings/region-10-districts/overall-score-highest')
    expect(links.county.score.top.href).toBe('/rankings/dallas-county-districts/overall-score-highest')
  })

  it('never carries a peer band, because no static page can exist for one', () => {
    // "Districts within 10 points of this district's eco-dis share" is a
    // different population for every district; there is nothing to link.
    expect(rankingLinksFor(idx, dallas).peer).toBeUndefined()
  })

  it('zero-pads a region id the way the URL scheme does', () => {
    const padded = { district: { 'region:07': { score: { top: end('/rankings/region-07-districts/overall-score-highest') } } } }
    expect(rankingLinksFor(padded, { level: 'district', regionId: 7 }).region.score.top.href).toContain('region-07')
  })

  it('leaves out the scopes that got no ranking, rather than guessing one', () => {
    const links = rankingLinksFor(idx, { level: 'district', regionId: '99', county: 'Loving' })
    expect(links.region).toBeNull()
    expect(links.county).toBeNull()
    expect(links.state.score.top.href).toBeTruthy()
  })

  it('returns null when nothing applies, so the page renders exactly as it did before', () => {
    expect(rankingLinksFor(idx, { level: 'campus', regionId: '10', county: 'Dallas' })).toBeNull()
    expect(rankingLinksFor({}, dallas)).toBeNull()
    expect(rankingLinksFor(null, dallas)).toBeNull()
  })
})

describe('rankingBoardsFor', () => {
  // A hub used to be handed only the 'top'/'gains' half of every board it
  // covers — "only the good ones are shown", the same complaint this whole
  // feature exists to answer, reproduced one layer up on /region/10 and the
  // front page. Fixed by no longer dropping 'bottom' before the hub sees it.
  const kept = [
    {
      end: 'top', level: 'district', n: 110, title: 'Region 10 districts with the highest overall score',
      href: '/rankings/region-10-districts/overall-score-highest',
      metric: { key: 'score' }, scope: { kind: 'region', id: '10' },
    },
    {
      end: 'bottom', level: 'district', n: 110, title: 'Region 10 districts with the lowest overall score',
      href: '/rankings/region-10-districts/overall-score-lowest',
      metric: { key: 'score' }, scope: { kind: 'region', id: '10' },
    },
    {
      end: 'top', level: 'district', n: 40, title: 'Texas districts with the highest overall score',
      href: '/rankings/texas-districts/overall-score-highest',
      metric: { key: 'score' }, scope: { kind: 'state' },
    },
  ]

  it('carries both ends of a board covering its scope, not just the flattering one', () => {
    const items = rankingBoardsFor(kept, 'region:10')
    expect(items.map((i) => i.href)).toEqual([
      '/rankings/region-10-districts/overall-score-highest',
      '/rankings/region-10-districts/overall-score-lowest',
    ])
  })

  it('still filters to the scope asked for', () => {
    expect(rankingBoardsFor(kept, 'region:10').every((i) => i.href.includes('region-10'))).toBe(true)
    expect(rankingBoardsFor(kept, 'state')).toHaveLength(1)
  })

  it('states the population beside every board it links, both ends alike', () => {
    for (const item of rankingBoardsFor(kept, 'region:10')) expect(item.meta).toBe('110 districts')
  })
})

describe('rankingCsvFile', () => {
  it('swaps the html extension for csv, same path otherwise', () => {
    expect(rankingCsvFile('rankings/texas-districts/overall-score-highest.html')).toBe(
      'rankings/texas-districts/overall-score-highest.csv'
    )
  })

  it('does not touch a path with no .html extension', () => {
    expect(rankingCsvFile('rankings/texas-districts/overall-score-highest')).toBe(
      'rankings/texas-districts/overall-score-highest'
    )
  })
})

describe('rankingRows', () => {
  const rows = [
    { id: 'a', name: 'A', value: 90, rank: 1, tied: 0, context: { enrollment: 500 } },
    { id: 'b', name: 'B', value: 70, rank: 2, tied: 0, context: { enrollment: 100 } },
    { id: 'c', name: 'C', value: 80, rank: 3, tied: 0, context: { enrollment: 200 } },
  ]

  it('orders by value, highest first at the top end and lowest first at the bottom', () => {
    expect(rankingRows({ rows }, 'top').map((r) => r.value)).toEqual([90, 80, 70])
    expect(rankingRows({ rows }, 'bottom').map((r) => r.value)).toEqual([70, 80, 90])
  })

  it('drops the incoming placement, so a rank counted from the other end cannot survive', () => {
    // rankings.js ranks best-first, which is the opposite order for a metric
    // where less is better. Carrying that rank onto the "lowest" page would
    // print 1st beside the last row.
    for (const r of rankingRows({ rows }, 'bottom')) expect(r.rank).toBeUndefined()
  })

  it('lifts enrollment to the top level, where the table reads it', () => {
    expect(rankingRows({ rows }, 'top')[0].enrollment).toBe(500)
  })

  it('leaves the demographic shares in context, so a ranking can never be of them', () => {
    const ctx = [{ id: 'a', value: 90, context: { ecoDisPct: 88, enrollment: 500 } }]
    const [row] = rankingRows({ rows: ctx }, 'top')
    expect(row.ecoDisPct).toBeUndefined()
    expect(row.context.ecoDisPct).toBe(88)
  })
})

describe('rankingMeta', () => {
  const result = (excluded, n = 1_184) => ({
    rows: Array.from({ length: n }, () => ({})),
    population: { n, excluded },
    window: null,
  })

  it('states a population that reconciles: what was ranked plus what it names', () => {
    const meta = rankingMeta(result({ notRated: 15, noValue: 4, level: 9_031, scope: 400 }), '2025-26')
    const named = meta.excluded.reduce((a, x) => a + x.n, 0)
    expect(named).toBe(19)
    expect(meta.eligible).toBe(1_184 + 19)
  })

  it('never names the entities the page was not about', () => {
    const meta = rankingMeta(result({ level: 9_031, scope: 400 }), '2025-26')
    // "9,031 campuses are not ranked" under a table of districts is noise, not
    // a disclosure; the exclusions named are the ones that shrank this pool.
    expect(meta.excluded).toEqual([])
    expect(meta.eligible).toBe(1_184)
  })

  it('agrees with its own count, singular and plural', () => {
    expect(rankingMeta(result({ notRated: 1 }), '2025-26').excluded[0].reason).toContain('was not rated')
    expect(rankingMeta(result({ notRated: 2 }), '2025-26').excluded[0].reason).toContain('were not rated')
  })

  it('names the year for a level and the window for a change', () => {
    expect(rankingMeta(result({}), '2025-26').window).toBe('in 2025-26')
    const change = { ...result({}), window: { from: '2021-22', to: '2025-26' } }
    expect(rankingMeta(change, '2025-26').window).toBe('since 2021-22')
    expect(rankingMeta(change, '2025-26').fromLabel).toBe('2021-22')
  })
})

describe('the real ranking catalogue publishes only the flattering end of every ordering', () => {
  // End to end: rankingMetrics() and RANKING_PLAN are this build's actual
  // metric list and plan — the same two arguments src/prerender.js:
  // planRankings hands to rankingCatalogue — so this exercises the real
  // policy decision, not a hand-picked stand-in metric. Only the scopes are
  // synthetic, because a real region/county list needs the TEA snapshot on
  // disk; the shapes below are exactly what rankingScopes/countyRankingScopes
  // themselves produce from real data.
  const regions = [{ id: '10', name: 'Region 10: Richardson' }]
  const countyRows = Array.from({ length: 12 }, (_, i) => ({
    level: 'district',
    score: 90 - i,
    countyId: '057',
    county: 'Dallas',
  }))
  const counties = [{ name: 'Dallas', slug: 'dallas', rows: countyRows }]
  const scopes = rankingScopes({ regions, counties })
  const catalogue = rankingCatalogue({ metrics: rankingMetrics(), scopes, plan: RANKING_PLAN })

  it('never publishes a "-declines" page: every change metric this snapshot supports is higher-is-better', () => {
    expect(catalogue.some((e) => e.href.endsWith('-declines'))).toBe(false)
    const changeEntries = catalogue.filter((e) => e.metric.kind === 'change')
    expect(changeEntries.length).toBeGreaterThan(0) // the plan does offer change metrics
    expect(changeEntries.every((e) => e.end === 'top')).toBe(true)
  })

  it('publishes "-lowest" only where the lowest figure is the good one, and "-highest" everywhere else', () => {
    const lowest = catalogue.filter((e) => e.end === 'bottom')
    expect(lowest.length).toBeGreaterThan(0) // chronic absenteeism and dropout rate are in this plan
    for (const e of lowest) expect(e.metric.lowerIsBetter).toBe(true)

    const highest = catalogue.filter((e) => e.end === 'top')
    for (const e of highest) expect(e.metric.lowerIsBetter).not.toBe(true)
  })

  it('publishes chronic absenteeism and dropout rate as "-lowest" (the best-performers list), never "-highest" (the worst)', () => {
    const stateDistrict = { kind: 'state', level: 'district' }
    const isIt = (e, key) => e.metric.key === key && e.scope.kind === stateDistrict.kind && e.scope.level === stateDistrict.level
    const absenteeism = catalogue.find((e) => isIt(e, 'absenteeism'))
    const dropout = catalogue.find((e) => isIt(e, 'grad:3'))
    expect(absenteeism?.end).toBe('bottom')
    expect(absenteeism?.href.endsWith('-lowest')).toBe(true)
    expect(dropout?.end).toBe('bottom')
    expect(dropout?.href.endsWith('-lowest')).toBe(true)
  })

  it('publishes the overall score and its change as "-highest"/"-gains", never "-lowest"/"-declines"', () => {
    const score = catalogue.find((e) => e.metric.key === 'score' && e.scope.kind === 'state' && e.scope.level === 'district')
    const changeScore = catalogue.find((e) => e.metric.base?.key === 'score' && e.scope.kind === 'state' && e.scope.level === 'district')
    expect(score.end).toBe('top')
    expect(score.href.endsWith('-highest')).toBe(true)
    expect(changeScore.end).toBe('top')
    expect(changeScore.href.endsWith('-gains')).toBe(true)
  })
})

describe('rankingRows: the context column', () => {
  // rankings-page.js picks the context column by asking whether the rows carry a
  // districtName. A district's own districtName is itself, so passing it through
  // printed the same name in two adjacent columns of every district ranking.
  const row = (over) => ({ id: 'a', name: 'A ISD', value: 90, county: 'Dallas', context: {}, ...over })

  it('gives a district its county, not its own name a second time', () => {
    const [r] = rankingRows({ rows: [row({ level: 'district', districtName: 'A ISD', districtId: '057905' })] }, 'top')
    expect(r.districtName).toBeNull()
    expect(r.districtSlug).toBeNull()
    expect(r.countySlug).toBe('dallas')
  })

  it('gives a campus the district it belongs to, linked', () => {
    const [r] = rankingRows({ rows: [row({ level: 'campus', districtName: 'A ISD', districtId: '057905' })] }, 'top')
    expect(r.districtName).toBe('A ISD')
    expect(r.districtSlug).toBe('a-isd-057905')
  })
})
