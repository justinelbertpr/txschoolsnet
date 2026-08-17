// test/render/rankings-page.test.js
import { describe, it, expect } from 'vitest'
import vm from 'node:vm'
import {
  renderRankingPage,
  renderRankingsIndexPage,
  rankingCatalogue,
  relatedFor,
  rankingPath,
  rankingHref,
  rankingFile,
  rankingCsvHref,
  rankingCsv,
  rankingHeadline,
  populationLabel,
  excludedLines,
  withRanks,
  topSlice,
  fmtValue,
  scopeSlug,
  endSlug,
  isChangeMetric,
  isHeadlineMetric,
  DEFAULT_PLAN,
  MAX_RANKING_PAGES,
  TOP_N,
  PAGE_ROWS,
  LEAD_MAX,
  boardPages,
  pageCountFor,
  pagerItems,
  rankingPagePath,
  boardPageHref,
} from '../../src/render/rankings-page.js'
import { MIN_POPULATION, METHOD_BREAK_YEAR, METHOD_BREAK_NOTE } from '../../src/render/rankings.js'

/* ------------------------------------------------------------- fixtures -- */

const SCORE = { key: 'score', label: 'Overall score', noun: 'overall score', fmt: 'points' }
const CHANGE = {
  key: 'change:score:5y',
  label: 'Change since 2021-22',
  noun: 'rating',
  fmt: 'points',
  change: true,
  window: 'since 2021-22',
}
const ABSENT = { key: 'absenteeism', label: 'Chronically absent', noun: 'chronic absence', fmt: 'pct', dir: 'lower' }

// Title Case at the source, exactly as rankings.js:rankable() declares them —
// domain and graduation-family labels TEA's own bundle ships already capitalized
// on every word, unlike SCORE/ABSENT above which are sentence case.
const ACHIEVEMENT = { key: 'domain:achievement', label: 'Student Achievement', fmt: 'points' }
const GRAD4 = { key: 'grad:0', label: 'Four-Year Graduation Rate', fmt: 'pct' }
const STAAR_READING = { key: 'staar:Reading:0', label: 'Reading — Approaches', fmt: 'pct' }

// The dropout-rate pair: identical label, one metric confined to each
// accountability population — rankings.js:rankable's `grad:3` / `grad:3@aea`.
const DROPOUT = { key: 'grad:3', label: 'Dropout Rate', fmt: 'pct', dir: 'lower' }
const DROPOUT_AEA = {
  key: 'grad:3@aea',
  label: 'Dropout Rate',
  fmt: 'pct',
  dir: 'lower',
  population: 'aea',
  populationLabel: 'alternative-education accountability only',
}

const CHANGE_METHOD = {
  key: 'change:score',
  label: 'Change in overall score',
  noun: 'overall score',
  fmt: 'points',
  change: true,
}
const methodology = () => ({ year: METHOD_BREAK_YEAR, comparable: true, note: METHOD_BREAK_NOTE })

const TEXAS = { kind: 'state', level: 'district', label: 'Texas' }
const REGION10 = { kind: 'region', id: '10', level: 'district', label: 'Region 10', href: '/region/10' }
const CAMPUSES = { kind: 'state', level: 'campus', label: 'Texas' }

const row = (over = {}) => ({
  id: '057905',
  name: 'Dallas ISD',
  slug: 'dallas-isd-057905',
  level: 'district',
  county: 'Dallas',
  rating: 'B',
  value: 85,
  ...over,
})

/** n rows with descending, distinct values, so ranks are 1..n. */
const rows = (n, over = () => ({})) =>
  Array.from({ length: n }, (_, i) => row({ id: `0000${i}`, name: `District ${i}`, slug: `district-${i}`, value: 100 - i, ...over(i) }))

const page = (over = {}) =>
  renderRankingPage({
    metric: SCORE,
    scope: TEXAS,
    rows: rows(40),
    meta: { eligible: 45, excluded: [{ n: 5, reason: 'were not rated by TEA' }] },
    snapshotDate: '15 August 2026',
    ...over,
  })

/* ---------------------------------------------------------------- shell -- */

describe('the page frame', () => {
  it('returns a document with a title, description and canonical URL', () => {
    const html = page()
    expect(typeof html).toBe('string')
    expect(html).toMatch(/<title>[^<]{10,}<\/title>/)
    expect(html).toMatch(/<meta name="description" content="[^"]{40,}">/)
    expect(html).toContain('<link rel="canonical" href="https://txschools.net/rankings/texas-districts/score-highest">')
  })

  it('carries the shell non-affiliation line and never claims to be TEA', () => {
    const html = page()
    expect(html).toContain('not operated by, endorsed by, or connected to TEA')
    expect(html).toContain('TEA publishes the ratings; it does not publish this ordering.')
  })

  it('states the claim as the h1', () => {
    expect(page()).toContain('<h1>Texas school districts with the highest overall score</h1>')
  })

  it('sits under a /rankings breadcrumb', () => {
    const html = page()
    expect(html).toContain('<li><a href="/">Texas schools</a></li>')
    expect(html).toContain('<li><a href="/rankings">Rankings</a></li>')
  })

  it('climbs through its scope when the scope has a page of its own', () => {
    const html = page({ scope: REGION10, rows: rows(30) })
    expect(html).toContain('<li><a href="/region/10">Region 10</a></li>')
  })

  it('needs no JavaScript: the table is in the markup, and the page adds no script of its own', () => {
    const html = page()
    // 1st carries .rk-podium too — a weight/rule treatment for the top 3
    // placements, never a colour (see site/style.css .rk-podium).
    expect(html).toContain('<td class="num rk-podium">1st</td>')
    // Only the shell's own scripts: search + app (external) and the two
    // inline before-paint snippets, THEME_INIT_SCRIPT (sets [data-theme] if
    // a reader has stored a preference) and TRUSTED_TYPES_INIT_SCRIPT
    // (installs the Trusted Types policy site/_headers' CSP requires) — both
    // no-ops with nothing to restore or policy-check here, never a source of
    // rendered content. None of the four are this page's own. This count is
    // the guard on site/_headers' hash list: it must move in lockstep.
    expect(html.match(/<script/g).length).toBe(html.match(/src="\/(search|app)\.js"/g).length + 2)
  })
})

/* ----------------------------------------------------------- provenance -- */

describe('the provenance claim is one a reader can actually check', () => {
  it('never claims a checksum chain this build does not ship', () => {
    const html = page()
    expect(html).not.toContain('checksum')
  })

  it('points to the snapshot date and /about instead', () => {
    const html = page()
    expect(html).toContain('fetched 15 August 2026')
    expect(html).toContain('<a href="/about">How this site works</a>')
    expect(html).toContain('href="/about"')
  })
})

/* ---------------------------------------------- population, n, exclusions -- */

describe('every ranking states its population, its n and what it excluded', () => {
  it('prints the denominator sentence', () => {
    const html = renderRankingPage({
      metric: SCORE,
      scope: TEXAS,
      rows: rows(1184),
      meta: { eligible: 1199, excluded: [{ n: 15, reason: 'were not rated by TEA' }] },
    })
    expect(html).toContain('1,184 districts of 1,199 districts are ranked here.')
    expect(html).toContain('15 were not rated by TEA and are not ranked.')
  })

  it('names the population and the n in the lede', () => {
    const html = page()
    expect(html).toContain('Measured across Texas school districts, of which 40 districts are ranked below.')
  })

  it('says so when the exclusions do not account for the whole gap', () => {
    const html = renderRankingPage({ metric: SCORE, scope: TEXAS, rows: rows(40), meta: { eligible: 45 } })
    expect(html).toContain('5 more are not ranked, and this snapshot does not record why.')
  })

  it('refuses to reconcile a denominator that does not add up, in public', () => {
    const html = renderRankingPage({
      metric: SCORE,
      scope: TEXAS,
      rows: rows(40),
      meta: { eligible: 42, excluded: [{ n: 10, reason: 'were not rated by TEA' }] },
    })
    expect(html).toContain('do not reconcile')
    expect(html).toContain('Treat the denominator as unverified.')
  })

  it('excludes rows carrying no figure, and counts them as an exclusion', () => {
    const html = renderRankingPage({
      metric: SCORE,
      scope: TEXAS,
      rows: [...rows(12), row({ id: '9', name: 'Unrated ISD', slug: 'unrated-9', value: null })],
      meta: { eligible: 13 },
    })
    expect(html).toContain('12 districts of 13 districts are ranked here.')
    expect(html).toContain('1 published no figure for this measure and is not ranked.')
    expect(html).not.toContain('Unrated ISD')
  })

  it('does not double-count an exclusion the caller both filtered and declared', () => {
    const html = renderRankingPage({
      metric: SCORE,
      scope: TEXAS,
      rows: [...rows(12), row({ id: '9', name: 'Unrated ISD', slug: 'unrated-9', value: null })],
      meta: { eligible: 13, excluded: [{ n: 1, reason: 'was not rated by TEA' }] },
    })
    expect(html).toContain('1 was not rated by TEA and is not ranked.')
    expect(html).not.toContain('published no figure')
    expect(html).not.toContain('do not reconcile')
  })

  it('excludedLines states an n even with no population given', () => {
    expect(excludedLines({ level: 'campus', ranked: 300 })).toEqual(['300 campuses are ranked here.'])
  })

  it('says plainly when a population is too small to be a contest', () => {
    const html = renderRankingPage({ metric: SCORE, scope: REGION10, rows: rows(6), meta: { eligible: 6 } })
    expect(html).toContain('Only 6 districts carry this measure')
  })

  it('states the poverty-context caveat in "What this ranking counts", reusing the About page\'s words', () => {
    const html = page()
    const countedAt = html.indexOf('id="counted"')
    const nextSectionAt = html.indexOf('<section', countedAt + 1)
    const counted = html.slice(countedAt, nextSectionAt === -1 ? html.length : nextSectionAt)
    expect(counted).toContain(
      "a comparison against the state average measures the composition of a school's intake at least as much as anything the school did"
    )
    expect(counted).toContain('<a href="/about#peer-cohort">How the peer group is chosen</a>')
  })
})

/* ------------------------------------------------------------------ ties -- */

describe('ties are shown as ties', () => {
  const tied = [
    row({ id: 'a', name: 'A ISD', slug: 'a-isd', value: 95 }),
    row({ id: 'b', name: 'B ISD', slug: 'b-isd', value: 90 }),
    row({ id: 'c', name: 'C ISD', slug: 'c-isd', value: 88 }),
    row({ id: 'd', name: 'D ISD', slug: 'd-isd', value: 88 }),
    row({ id: 'e', name: 'E ISD', slug: 'e-isd', value: 70 }),
  ]

  it('gives both entities on the same value the same placement, and skips the next', () => {
    const ranked = withRanks(tied)
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3, 3, 5])
    expect(ranked.map((r) => r.tied)).toEqual([0, 0, 1, 1, 0])
  })

  it('prints 3rd twice and never 4th', () => {
    const html = renderRankingPage({ metric: SCORE, scope: TEXAS, rows: tied, meta: { eligible: 5 } })
    expect(html.match(/>3rd/g).length).toBe(2)
    expect(html).not.toContain('>4th')
    expect(html).toContain('>5th')
  })

  it('marks a tied row and says in words how ties are placed', () => {
    const html = renderRankingPage({ metric: SCORE, scope: TEXAS, rows: tied, meta: { eligible: 5 } })
    expect(html).toContain('<span class="chip-n">tied</span>')
    expect(html).toContain('2 of the ranked districts share a placement with at least one other.')
    expect(html).toContain('sharing 3rd are both 3rd and the one behind them is 5th')
  })

  it('says so when nothing is tied', () => {
    expect(page()).toContain('No two districts in this list share a placement.')
  })

  it('keeps a provided rank rather than recomputing it against a smaller list', () => {
    const ranked = withRanks([row({ value: 50, rank: 812, tied: 3 })])
    expect(ranked[0].rank).toBe(812)
    expect(ranked[0].tied).toBe(3)
  })

  it('ranks a bottom-end list from the smallest value', () => {
    expect(withRanks(tied.slice().reverse(), { end: 'bottom' }).map((r) => r.rank)).toEqual([1, 2, 2, 4, 5])
  })
})

/* --------------------------------------------------------- top 20 vs full -- */

describe('the top slice and the full list', () => {
  it('shows a top table and the full list beneath it when the list is long', () => {
    const html = page({ rows: rows(200), meta: { eligible: 200 } })
    expect(html).toContain(`<h2>The top ${TOP_N}</h2>`)
    expect(html).toContain('<h2>The full list: all 200 districts</h2>')
    expect(html.match(/<table/g).length).toBe(2)
  })

  it('prints one table when the whole list is short', () => {
    const html = page({ rows: rows(12), meta: { eligible: 12 } })
    expect(html).toContain('<h2>All 12 districts</h2>')
    expect(html.match(/<table/g).length).toBe(1)
    expect(html).not.toContain('The top 20')
  })

  it('runs past 20 rather than cutting a tie in half, and says why', () => {
    const many = [
      ...rows(19),
      row({ id: 't1', name: 'Tied One', slug: 'tied-one', value: 10 }),
      row({ id: 't2', name: 'Tied Two', slug: 'tied-two', value: 10 }),
      row({ id: 't3', name: 'Tied Three', slug: 'tied-three', value: 10 }),
      ...rows(40).map((r, i) => ({ ...r, id: `z${i}`, slug: `z-${i}`, value: 5 - i })),
    ]
    const html = page({ rows: many, meta: { eligible: many.length } })
    expect(html).toContain('<h2>The top 22</h2>')
    expect(html).toContain('3 districts share 20th place')
  })

  it('topSlice keeps a whole placement', () => {
    const ranked = withRanks([...rows(19), row({ value: 10 }), row({ value: 10 }), row({ value: 1 })])
    expect(topSlice(ranked).length).toBe(21)
  })

  it('splits a long ordering into pages instead of truncating it', () => {
    const html = page({ rows: rows(60), meta: { eligible: 60, pageRows: 30 } })
    expect(html).toContain('<h2>The full list: rows 1\u201330 of 60</h2>')
    expect(html).toContain('Page 1 of 2, rows 1\u201330 of 60.')
    // The old behaviour printed 30 of 60 and sent the reader to /download for
    // the other 30. Nothing is withheld now, so nothing claims to be.
    expect(html).not.toContain('This page prints the first')
    expect(html).not.toContain('all 60')
  })

  it('carries the rest of the ordering on real pages, each linked from the last', () => {
    const args = { rows: rows(60), meta: { eligible: 60, pageRows: 30 } }
    const pages = boardPages({ metric: SCORE, scope: TEXAS, ...args })
    expect(pages.map((p) => p.file)).toEqual([
      'rankings/texas-districts/score-highest.html',
      'rankings/texas-districts/score-highest-page-2.html',
    ])
    expect(pages[1].html).toContain('<h2>The full list: rows 31\u201360 of 60</h2>')
    expect(pages[1].html).toContain('This is the end of the ordering')
    // Page 1 links forward, page 2 links back, and each is its own canonical.
    expect(pages[0].html).toContain('<link rel="next" href="https://txschools.net/rankings/texas-districts/score-highest-page-2">')
    expect(pages[1].html).toContain('<link rel="prev" href="https://txschools.net/rankings/texas-districts/score-highest">')
    expect(pages[1].html).toContain('<link rel="canonical" href="https://txschools.net/rankings/texas-districts/score-highest-page-2">')
    // The lead table belongs to page 1 alone; repeating it would print the
    // same rows twice there and out of context everywhere else.
    expect(pages[0].html).toContain('<h2>The top 20</h2>')
    expect(pages[1].html).not.toContain('<h2>The top 20</h2>')
  })

  it('renders the nearest real page rather than an empty table for a page past the end', () => {
    const html = page({ rows: rows(60), meta: { eligible: 60, pageRows: 30 }, page: 99 })
    expect(html).toContain('<h2>The full list: rows 31\u201360 of 60</h2>')
  })

  it('drops the lead table, rather than a tie, when the tie makes it the whole page', () => {
    // 40 districts share 1st. topSlice keeps a placement whole, so a lead
    // table here would be 40 rows against a LEAD_MAX of 4 in this call \u2014 the
    // same rows the full list opens with, printed twice.
    const tied = withRanks(rows(40).map((r, i) => ({ ...r, id: `t${i}`, slug: `t-${i}`, value: 10 })))
    const html = page({ rows: tied, meta: { eligible: 40, leadMax: 4 } })
    expect(html).not.toContain('<h2>The top')
    expect(html).toContain('40 districts share 1st place')
    expect(html).toContain('the same rows this list opens with')
    // The tie itself is intact in the list below.
    expect(html).toContain('<h2>The full list: all 40 districts</h2>')
  })

  it('pageCountFor never returns zero, so a board with nothing to rank still has a page', () => {
    expect(pageCountFor(0)).toBe(1)
    expect(pageCountFor(null)).toBe(1)
    expect(pageCountFor(PAGE_ROWS)).toBe(1)
    expect(pageCountFor(PAGE_ROWS + 1)).toBe(2)
    expect(pageCountFor(7_283)).toBe(Math.ceil(7_283 / PAGE_ROWS))
  })

  it('boardPages yields exactly one page for an ordering with nothing in it', () => {
    const pages = boardPages({ metric: SCORE, scope: TEXAS, rows: [], meta: { eligible: 0 } })
    expect(pages).toHaveLength(1)
    expect(pages[0].file).toBe('rankings/texas-districts/score-highest.html')
    expect(pages[0].html).toContain('there is no ranking to publish')
  })

  it('keeps page 1 on the board\u2019s own path, so no existing URL moves', () => {
    expect(rankingPagePath({ scope: TEXAS, metric: SCORE })).toBe('rankings/texas-districts/score-highest')
    expect(rankingPagePath({ scope: TEXAS, metric: SCORE, page: 1 })).toBe('rankings/texas-districts/score-highest')
    expect(rankingPagePath({ scope: TEXAS, metric: SCORE, page: 4 })).toBe('rankings/texas-districts/score-highest-page-4')
    expect(boardPageHref('/rankings/texas-districts/score-highest', 1)).toBe('/rankings/texas-districts/score-highest')
    expect(boardPageHref('/rankings/texas-districts/score-highest', 4)).toBe('/rankings/texas-districts/score-highest-page-4')
  })

  it('no board path can be mistaken for a page suffix', () => {
    // Every board path ends in one of endSlug\u2019s four words, so the sibling
    // -page-<n> scheme cannot collide with a board of its own name.
    const paths = rankingCatalogue({
      metrics: [SCORE, CHANGE],
      scopes: [TEXAS, CAMPUSES, REGION10],
      plan: DEFAULT_PLAN,
    }).map((e) => e.path)
    expect(paths.length).toBeGreaterThan(0)
    for (const path of paths) expect(path).not.toMatch(/-page-\d+$/)
  })

  it('pagerItems keeps the ends, the neighbours, and marks the gap', () => {
    expect(pagerItems(1, 1)).toEqual([1])
    expect(pagerItems(1, 3)).toEqual([1, 2, 3])
    expect(pagerItems(1, 15)).toEqual([1, 2, 3, '\u2026', 15])
    expect(pagerItems(8, 15)).toEqual([1, '\u2026', 6, 7, 8, 9, 10, '\u2026', 15])
    expect(pagerItems(15, 15)).toEqual([1, '\u2026', 13, 14, 15])
    // A marker standing in for exactly one page is longer than the number it
    // would hide, so that page is printed instead.
    expect(pagerItems(4, 15)).toEqual([1, 2, 3, 4, 5, 6, '\u2026', 15])
  })

  it('the pager is plain links, reachable with no JavaScript', () => {
    const html = page({ rows: rows(60), meta: { eligible: 60, pageRows: 30 } })
    expect(html).toMatch(/<nav class="pager"[^>]*aria-label="[^"]+"/)
    expect(html).toContain('rel="next"')
    expect(html).toContain('<span aria-current="page">1</span>')
    // Previous on page 1 is inert text, not a link back to nowhere.
    expect(html).toContain('<span class="pager-off">Previous</span>')
    const pagerHtml = html.slice(html.indexOf('<nav class="pager"'))
    expect(pagerHtml.slice(0, pagerHtml.indexOf('</nav>'))).not.toContain('<script')
  })

  it('states the emptiness instead of rendering an empty table', () => {
    const html = renderRankingPage({ metric: SCORE, scope: TEXAS, rows: [], meta: { eligible: 0 } })
    expect(html).not.toContain('<table')
    expect(html).toContain('there is no ranking to publish')
  })
})

/* ----------------------------------------------------------------- rows -- */

describe('rows', () => {
  it('links every entity to its page', () => {
    expect(page()).toContain('href="/district/district-0"')
  })

  it('links a campus row to a campus page and names its district', () => {
    const html = renderRankingPage({
      metric: SCORE,
      scope: CAMPUSES,
      rows: rows(12).map((r) => ({ ...r, level: 'campus', county: null, districtName: 'Dallas ISD', districtSlug: 'dallas-isd-057905' })),
      meta: { eligible: 12 },
    })
    expect(html).toContain('href="/campus/district-0"')
    expect(html).toContain('href="/district/dallas-isd-057905"')
    expect(html).toContain('<th>District</th>')
  })

  it('links a county when the rows carry one', () => {
    expect(page()).toContain('href="/county/dallas"')
  })

  it('formats a change with its sign and shows the endpoints only when both are labelled', () => {
    const changed = rows(12).map((r, i) => ({ ...r, value: 6 - i, from: 70, to: 76 - i }))
    const bare = renderRankingPage({ metric: CHANGE, scope: TEXAS, rows: changed, meta: { eligible: 12 } })
    expect(bare).toContain('<td class="num">+6.0</td>')
    expect(bare).not.toContain('<th class="num">2021-22</th>')

    const labelled = renderRankingPage({
      metric: CHANGE,
      scope: TEXAS,
      rows: changed,
      meta: { eligible: 12, fromLabel: '2021-22', toLabel: '2025-26' },
    })
    expect(labelled).toContain('<th class="num">2021-22</th>')
    expect(labelled).toContain('<th class="num">2025-26</th>')
    // The endpoints are levels, never re-signed as changes.
    expect(labelled).toContain('<td class="num">70</td>')
  })

  it('formats by the metric fmt', () => {
    expect(fmtValue(52.34, { fmt: 'pct' })).toBe('52.3%')
    expect(fmtValue(12345.6, { fmt: 'usd' })).toBe('$12,346')
    expect(fmtValue(-2, { fmt: 'points', change: true })).toBe('−2.0')
    expect(fmtValue(null, SCORE)).toBe('—')
  })

  it('escapes a hostile name rather than injecting it', () => {
    const html = page({ rows: [...rows(11), row({ id: 'x', name: '<script>x</script>', slug: 'x', value: 1 })], meta: { eligible: 12 } })
    expect(html).not.toContain('<script>x</script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

/* -------------------------------------------------------------- the csv -- */

describe('every board can be downloaded', () => {
  it('links its own CSV sibling with a bare relative href beside its own slug', () => {
    const html = page()
    expect(html).toContain('<a href="score-highest.csv">Download this table (CSV)</a>')
  })

  it('computes the csv href from the same slug the html file uses', () => {
    expect(rankingCsvHref({ scope: TEXAS, metric: SCORE, end: 'top' })).toBe('score-highest.csv')
    expect(rankingCsvHref({ scope: TEXAS, metric: SCORE, end: 'bottom' })).toBe('score-lowest.csv')
    expect(rankingCsvHref({ scope: REGION10, metric: CHANGE, end: 'bottom' })).toBe('change-score-5y-declines.csv')
  })

  it('mirrors downloads.js\'s own provenance header, byte for byte', () => {
    const csv = rankingCsv({ metric: SCORE, scope: TEXAS, rows: rows(12), meta: { eligible: 12 }, snapshotDate: '15 August 2026' })
    expect(csv).toContain('# txschools.net — unofficial. Not operated by, endorsed by, or affiliated with the Texas Education Agency.')
    expect(csv).toContain('# source: Texas Education Agency, published publicly at https://txschools.gov')
    expect(csv).toContain('# snapshot: 15 August 2026 — the date this site fetched TEA\'s data. TEA may have revised it since.')
    expect(csv).toContain('# empty cell = TEA did not publish that figure. It does not mean zero.')
    expect(csv).toContain('# numbers are unformatted: no thousands separators, no currency symbols, no percent signs.')
    expect(csv).toContain("# lines starting with # are comments — pandas: read_csv(path, comment='#')")
  })

  it('writes raw unformatted numbers, never the page\'s locale-formatted ones', () => {
    const csv = rankingCsv({ metric: SCORE, scope: TEXAS, rows: [row({ value: 85.4 })], meta: { eligible: 1 } })
    const dataLine = csv.split('\n').find((l) => l.startsWith('1,'))
    expect(dataLine).toContain(',85.4,')
    expect(csv).not.toContain('85.4%')
    expect(csv).not.toContain('1,184') // no thousands separators anywhere a count might appear
  })

  it('states the identical population the page states, from the same reconciliation', () => {
    const csv = rankingCsv({
      metric: SCORE,
      scope: TEXAS,
      rows: rows(12),
      meta: { eligible: 13, excluded: [{ n: 1, reason: 'was not rated by TEA' }] },
    })
    expect(csv).toContain('# population: 12 districts of 13 districts are ranked here.')
    expect(csv).toContain('# population: 1 was not rated by TEA and is not ranked.')
  })

  it('carries the What-If substitution note when the caller supplies methodology', () => {
    const changed = rows(12).map((r, i) => ({ ...r, value: 25 - i, from: 51, to: 76 - i }))
    const csv = rankingCsv({
      metric: CHANGE_METHOD,
      scope: TEXAS,
      rows: changed,
      meta: { eligible: 12, fromLabel: '2021-22', toLabel: '2025-26', methodology: methodology() },
    })
    expect(csv).toContain('# methodology: ' + METHOD_BREAK_NOTE)
  })

  it('refuses a context metric, matching the page it sits beside', () => {
    expect(() =>
      rankingCsv({ metric: { key: 'ecoDis', label: 'Economically disadvantaged', fmt: 'pct' }, scope: TEXAS, rows: rows(12) })
    ).toThrow(/context metric/)
  })

  it('every rank carries its denominator: rank_of and tied are columns', () => {
    const tied = [
      row({ id: 'a', name: 'A ISD', slug: 'a-isd', value: 95 }),
      row({ id: 'b', name: 'B ISD', slug: 'b-isd', value: 90 }),
      row({ id: 'c', name: 'C ISD', slug: 'c-isd', value: 88 }),
      row({ id: 'd', name: 'D ISD', slug: 'd-isd', value: 88 }),
    ]
    const csv = rankingCsv({ metric: SCORE, scope: TEXAS, rows: tied, meta: { eligible: 4 } })
    const header = csv.split('\n').find((l) => l.startsWith('rank,'))
    expect(header.split(',')).toEqual(expect.arrayContaining(['rank', 'rank_of', 'tied']))
    expect(csv).toContain('3,4,1,') // C ISD: rank 3, rank_of 4, tied with 1 other
  })
})

/* ------------------------------------------------------------ direction -- */

describe('what end the list counts from', () => {
  it('says which way a level list is ordered', () => {
    expect(page()).toContain('Ordered from the highest figure downward.')
    expect(page({ end: 'bottom' })).toContain('Ordered from the lowest figure upward.')
  })

  it('warns that 1st is the largest share where a lower figure is better', () => {
    const html = renderRankingPage({ metric: ABSENT, scope: TEXAS, rows: rows(30), meta: { eligible: 30 } })
    expect(html).toContain('1st here is the largest share, not the best result')
  })

  it('reads a change list as a rise or a fall', () => {
    const html = renderRankingPage({ metric: CHANGE, scope: TEXAS, rows: rows(30), meta: { eligible: 30 } })
    expect(html).toContain('Ordered by the largest rise first.')
    expect(html).toContain('<h1>Texas school districts with the largest rating gains since 2021-22</h1>')

    const down = renderRankingPage({ metric: CHANGE, scope: TEXAS, rows: rows(30), meta: { eligible: 30 }, end: 'bottom' })
    expect(down).toContain('<h1>Texas school districts with the largest rating declines since 2021-22</h1>')
  })

  it('never describes a computed change as a figure TEA published', () => {
    const html = renderRankingPage({
      metric: CHANGE,
      scope: TEXAS,
      rows: rows(30),
      meta: { eligible: 30, fromLabel: '2021-22', toLabel: '2025-26' },
    })
    expect(html).toContain(
      'The change in rating since 2021-22, from the figure TEA published for 2021-22 to the figure it published for 2025-26.'
    )
    expect(html).not.toContain('Rating, as TEA published it')
  })

  it('lets a caller state the claim in its own words', () => {
    const html = page({ meta: { eligible: 40, headline: 'Texas districts that gained the most since the pandemic' } })
    expect(html).toContain('<h1>Texas districts that gained the most since the pandemic</h1>')
  })
})

/* --------------------------------------------------- the 2021-22 rescoring -- */

describe('a window that reaches 2021-22 discloses the "What If" rescoring', () => {
  it('never claims TEA published the re-scored 2021-22 figure, and says so in words', () => {
    const changed = rows(12).map((r, i) => ({ ...r, value: 25 - i, from: 51, to: 76 - i }))
    const html = renderRankingPage({
      metric: CHANGE_METHOD,
      scope: TEXAS,
      rows: changed,
      meta: { eligible: 12, fromLabel: '2021-22', toLabel: '2025-26', methodology: methodology() },
    })
    expect(html).not.toContain('from the figure TEA published for 2021-22')
    expect(html).toContain('from TEA&#39;s re-scored &quot;2021-22 What If&quot; figure to the figure it published for 2025-26')
    expect(html).toContain('What If')
    // The methodology note itself made it into the lede (escaped, like the rest of the sentence around it).
    expect(html).toContain('TEA re-scored 2021-22 under the rules it adopted for 2022-23')
  })

  it('marks the 2021-22 column header, not the other endpoint', () => {
    const changed = rows(12).map((r, i) => ({ ...r, value: 25 - i, from: 51, to: 76 - i }))
    const html = renderRankingPage({
      metric: CHANGE_METHOD,
      scope: TEXAS,
      rows: changed,
      meta: { eligible: 12, fromLabel: '2021-22', toLabel: '2025-26', methodology: methodology() },
    })
    expect(html).toContain('<th class="num">2021-22 &quot;What If&quot;</th>')
    expect(html).toContain('<th class="num">2025-26</th>')
  })

  it('leaves the wording alone when the caller states no methodology break', () => {
    // Regression: a window that happens to start in 2021-22 but was not
    // flagged by rankings.js (e.g. a change metric with no re-scoring, or no
    // methodology object at all) must not be second-guessed by re-deriving
    // the year here — only meta.methodology triggers the correction.
    const changed = rows(12).map((r, i) => ({ ...r, value: 25 - i, from: 51, to: 76 - i }))
    const html = renderRankingPage({
      metric: CHANGE_METHOD,
      scope: TEXAS,
      rows: changed,
      meta: { eligible: 12, fromLabel: '2021-22', toLabel: '2025-26' },
    })
    expect(html).toContain('from the figure TEA published for 2021-22 to the figure it published for 2025-26')
    expect(html).toContain('<th class="num">2021-22</th>')
    expect(html).not.toContain('What If')
  })

  it('carries the same disclosure into the board’s CSV', () => {
    const changed = rows(12).map((r, i) => ({ ...r, value: 25 - i, from: 51, to: 76 - i }))
    const csv = rankingCsv({
      metric: CHANGE_METHOD,
      scope: TEXAS,
      rows: changed,
      meta: { eligible: 12, fromLabel: '2021-22', toLabel: '2025-26', methodology: methodology() },
    })
    expect(csv).toContain('What If')
    expect(csv).toContain(METHOD_BREAK_NOTE)
  })
})

/* ------------------------------------------------- only the flattering end -- */

describe('only the flattering end of an ordering is published (Rule 3)', () => {
  it('still links a caller-supplied inverse rather than hiding a page that genuinely exists', () => {
    // renderRankingPage itself stays capable of this — see relatedFor's own
    // comment on why `inverse` is not hard-coded to null — even though
    // rankingCatalogue() never hands one over in the ordinary build.
    const html = page({
      related: { inverse: { href: '/rankings/texas-districts/score-lowest', label: 'The lowest-scoring districts' } },
    })
    expect(html).toContain('href="/rankings/texas-districts/score-lowest"')
    expect(html).toContain('The lowest-scoring districts')
  })

  it('states the policy rather than reading like a gap this build happened to leave', () => {
    const html = page()
    expect(html).toContain('This site does not publish the other end of this ordering.')
    expect(html).toContain('txschools.net does not compile one')
    expect(html).not.toContain('is not published in this build')
  })

  it('never assembles a "-lowest" or "-declines" page or link for a higher-is-better metric', () => {
    const cat = rankingCatalogue({ metrics: [SCORE, CHANGE], scopes: [TEXAS] })
    expect(cat.every((e) => e.end === 'top')).toBe(true)
    expect(cat.some((e) => e.href.endsWith('-lowest'))).toBe(false)
    expect(cat.some((e) => e.href.endsWith('-declines'))).toBe(false)
    const html = renderRankingsIndexPage({ pages: cat })
    expect(html).not.toContain('-lowest')
    expect(html).not.toContain('-declines')
  })

  it('publishes the "-lowest" end, never "-highest", for a lower-is-better metric — the flattering end is the low one', () => {
    // Chronic absenteeism: LOWEST is best (least absent). Publishing
    // "-highest" here would be exactly the worst-performers leaderboard
    // Rule 3 exists to drop, so goodEnd must resolve to 'bottom' for it.
    const cat = rankingCatalogue({
      metrics: [ABSENT],
      scopes: [TEXAS],
      plan: [{ kind: 'state', level: 'district', select: () => true }],
    })
    expect(cat).toHaveLength(1)
    expect(cat[0].end).toBe('bottom')
    expect(cat[0].href).toBe('/rankings/texas-districts/absenteeism-lowest')
  })

  it('cross-links other metrics at this scope and this metric at other scopes', () => {
    const html = page({
      related: {
        metrics: [{ href: '/rankings/texas-districts/attendance-highest', label: 'Attendance' }],
        scopes: [{ href: '/rankings/region-10-districts/score-highest', label: 'Region 10 school districts' }],
      },
    })
    expect(html).toContain('Other rankings of Texas school districts')
    expect(html).toContain('href="/rankings/texas-districts/attendance-highest"')
    expect(html).toContain('Overall score ranked elsewhere')
    expect(html).toContain('href="/rankings/region-10-districts/score-highest"')
  })
})

/* ------------------------------------------------- demographics are not it -- */

describe('demographics are never ranked', () => {
  for (const key of ['ecoDis', 'engLrn', 'specEd']) {
    it(`refuses to render a ranking of ${key}`, () => {
      expect(() =>
        renderRankingPage({ metric: { key, label: 'Economically disadvantaged', fmt: 'pct' }, scope: TEXAS, rows: rows(30) })
      ).toThrow(/context metric/)
    })
  }

  it('drops them from the catalogue too, even under a plan that takes everything', () => {
    const cat = rankingCatalogue({
      metrics: [SCORE, { key: 'ecoDis', label: 'Economically disadvantaged' }],
      scopes: [TEXAS],
      plan: [{ kind: 'state', level: 'district', select: () => true }],
    })
    expect(cat.map((e) => e.metric.key)).toEqual(['score'])
  })
})

/* ------------------------------------------------------------ paths -- */

describe('paths', () => {
  it('is two segments under /rankings, scope then metric and end', () => {
    expect(rankingPath({ scope: TEXAS, metric: SCORE, end: 'top' })).toBe('rankings/texas-districts/score-highest')
    expect(rankingHref({ scope: TEXAS, metric: SCORE, end: 'bottom' })).toBe('/rankings/texas-districts/score-lowest')
    expect(rankingFile({ scope: REGION10, metric: SCORE, end: 'top' })).toBe(
      'rankings/region-10-districts/score-highest.html'
    )
  })

  it('names the ends of a change as gains and declines', () => {
    expect(endSlug(CHANGE, 'top')).toBe('gains')
    expect(endSlug(CHANGE, 'bottom')).toBe('declines')
    expect(rankingPath({ scope: TEXAS, metric: CHANGE, end: 'top' })).toBe(
      'rankings/texas-districts/change-score-5y-gains'
    )
  })

  it('slugs a campus scope apart from a district scope', () => {
    expect(scopeSlug(TEXAS)).toBe('texas-districts')
    expect(scopeSlug(CAMPUSES)).toBe('texas-campuses')
    expect(scopeSlug(REGION10)).toBe('region-10-districts')
  })

  it('detects a change metric however it was declared', () => {
    expect(isChangeMetric({ key: 'change:score' })).toBe(true)
    expect(isChangeMetric({ key: 'x', fmt: 'delta' })).toBe(true)
    expect(isChangeMetric({ key: 'x', kind: 'change' })).toBe(true)
    expect(isChangeMetric(SCORE)).toBe(false)
  })
})

/* -------------------------------------------------------------- headline -- */

describe('the claim', () => {
  it('names the population', () => {
    expect(populationLabel(TEXAS)).toBe('Texas school districts')
    expect(populationLabel(CAMPUSES)).toBe('Texas campuses')
    expect(populationLabel(REGION10)).toBe('Region 10 school districts')
  })

  it('reads as a sentence a newsroom could quote', () => {
    expect(rankingHeadline({ metric: SCORE, scope: REGION10, end: 'top' })).toBe(
      'Region 10 school districts with the highest overall score'
    )
    expect(rankingHeadline({ metric: CHANGE, scope: TEXAS, end: 'bottom' })).toBe(
      'Texas school districts with the largest rating declines since 2021-22'
    )
  })
})

/* ------------------------------------------------------------ title case -- */

describe('a Title Case label survives the headline intact', () => {
  it('does not strand a capital on the word after the first ("student Achievement")', () => {
    const headline = rankingHeadline({ metric: ACHIEVEMENT, scope: TEXAS, end: 'top' })
    expect(headline).toContain('Student Achievement')
    expect(headline).not.toMatch(/student Achievement/)
  })

  it('keeps a hyphenated word capitalized on both sides ("four-Year Graduation Rate")', () => {
    const headline = rankingHeadline({ metric: GRAD4, scope: TEXAS, end: 'top' })
    expect(headline).toContain('Four-Year Graduation Rate')
    expect(headline).not.toMatch(/four-Year Graduation Rate/)
  })

  it('keeps an em-dash-joined STAAR label intact', () => {
    const headline = rankingHeadline({ metric: STAAR_READING, scope: TEXAS, end: 'top' })
    expect(headline).toContain('Reading — Approaches')
    expect(headline).not.toMatch(/reading — Approaches/)
  })

  it('still sentence-cases an ordinary label, unchanged from before', () => {
    expect(rankingHeadline({ metric: SCORE, scope: TEXAS, end: 'top' })).toContain('overall score')
    const labelOnly = { key: 'absenteeism', label: 'Chronically absent', fmt: 'pct', dir: 'lower' }
    expect(rankingHeadline({ metric: labelOnly, scope: TEXAS, end: 'top' })).toContain('chronically absent')
  })

  it('renders correctly everywhere the label appears: title, h1, lede, and the index link label', () => {
    const html = renderRankingPage({ metric: ACHIEVEMENT, scope: TEXAS, rows: rows(30), meta: { eligible: 30 } })
    expect(html).toContain('<title>Texas school districts with the highest Student Achievement — txschools.net</title>')
    expect(html).toContain('<h1>Texas school districts with the highest Student Achievement</h1>')
    expect(html).toContain('Student Achievement, as TEA published it.')
    expect(html).not.toMatch(/student Achievement/)

    const cat = rankingCatalogue({ metrics: [ACHIEVEMENT], scopes: [TEXAS] })
    const html2 = renderRankingsIndexPage({ pages: cat })
    expect(html2).toContain('Student Achievement')
    expect(html2).not.toMatch(/student Achievement/)
  })
})

/* -------------------------------------------------------- AEA qualifier -- */

describe('an alternative-education board never shares a title with its standard sibling', () => {
  it('gives the AEA headline a distinguishing qualifier the standard one does not carry', () => {
    const std = rankingHeadline({ metric: DROPOUT, scope: TEXAS, end: 'top' })
    const aea = rankingHeadline({ metric: DROPOUT_AEA, scope: TEXAS, end: 'top' })
    expect(std).not.toBe(aea)
    expect(aea).toContain('— alternative education')
    expect(std).not.toContain('alternative education')
  })

  it('differs in <title>, <h1> and the lede between the two population boards', () => {
    const stdHtml = renderRankingPage({ metric: DROPOUT, scope: TEXAS, rows: rows(30), meta: { eligible: 30 } })
    const aeaHtml = renderRankingPage({ metric: DROPOUT_AEA, scope: TEXAS, rows: rows(30), meta: { eligible: 30 } })
    expect(stdHtml.match(/<title>[^<]+<\/title>/)[0]).not.toBe(aeaHtml.match(/<title>[^<]+<\/title>/)[0])
    expect(stdHtml.match(/<h1>[^<]+<\/h1>/)[0]).not.toBe(aeaHtml.match(/<h1>[^<]+<\/h1>/)[0])
    expect(aeaHtml).toContain('alternative education')
    expect(stdHtml).not.toContain('alternative education')
  })

  it('gives the two boards different link labels on the /rankings index', () => {
    const cat = rankingCatalogue({
      metrics: [DROPOUT, DROPOUT_AEA],
      scopes: [TEXAS],
      plan: [{ kind: 'state', level: 'district', select: () => true }],
    })
    // Dropout rate is lower-is-better, so its one published end is 'bottom'
    // (the lowest-dropout-first list) — see goodEnd in rankings-page.js.
    const std = cat.find((e) => e.metric.key === 'grad:3')
    const aea = cat.find((e) => e.metric.key === 'grad:3@aea')
    expect(std.end).toBe('bottom')
    expect(aea.end).toBe('bottom')
    expect(std.title).not.toBe(aea.title)
    expect(aea.title).toContain('alternative education')
  })
})

/* ------------------------------------------------------------ catalogue -- */

describe('the catalogue and the file budget', () => {
  const metrics = [
    SCORE,
    CHANGE,
    ABSENT,
    { key: 'domain:achievement', label: 'Student Achievement', fmt: 'points' },
    { key: 'domain:progress', label: 'School Progress', fmt: 'points' },
    { key: 'domain:gaps', label: 'Closing the Gaps', fmt: 'points' },
    { key: 'attendance', label: 'Attendance', fmt: 'pct' },
    { key: 'avgSalary', label: 'Average teacher salary', fmt: 'usd' },
    { key: 'spend', label: 'Per-student spending', fmt: 'usd' },
  ]
  const regions = Array.from({ length: 20 }, (_, i) => ({
    kind: 'region',
    id: String(i + 1).padStart(2, '0'),
    level: 'district',
    label: `Region ${String(i + 1).padStart(2, '0')}`,
    href: `/region/${String(i + 1).padStart(2, '0')}`,
  }))
  const scopes = [TEXAS, CAMPUSES, ...regions]

  it('generates metric x scope, one end each — the flattering one — and nothing else', () => {
    const cat = rankingCatalogue({ metrics, scopes })
    // 9 district metrics statewide x1 end = 9; 7 campus metrics x1 = 7;
    // 2 headline metrics x 20 regions x1 = 40. Half of what publishing both
    // ends would have cost (112), give or take: it is exact here because
    // every one of these 9 metrics has a real 'top' or 'bottom' page — see
    // the "only the flattering end" tests above for the lower-is-better case.
    expect(cat.filter((e) => e.scope === TEXAS).length).toBe(9)
    expect(cat.filter((e) => e.scope === CAMPUSES).length).toBe(7)
    expect(cat.filter((e) => e.scope.kind === 'region').length).toBe(40)
    expect(cat.length).toBe(56)
  })

  it('gives every page a unique path and a title', () => {
    const cat = rankingCatalogue({ metrics, scopes })
    expect(new Set(cat.map((e) => e.path)).size).toBe(cat.length)
    expect(cat.every((e) => e.title.length > 10 && e.file.endsWith('.html'))).toBe(true)
  })

  it('fails loudly rather than quietly spending the file budget', () => {
    // One end per metric now, so it takes more than MAX_RANKING_PAGES metrics
    // (not half that many) to trip the guard at a single scope.
    const many = Array.from({ length: 450 }, (_, i) => ({ key: `m${i}`, label: `Metric ${i}` }))
    expect(() => rankingCatalogue({ metrics: many, scopes: [TEXAS] })).toThrow(/exceeds the 400-page budget/)
    expect(MAX_RANKING_PAGES).toBe(400)
  })

  it('publishes no county rankings: too many pages, too few rated districts each', () => {
    expect(DEFAULT_PLAN.some((p) => p.kind === 'county')).toBe(false)
    const cat = rankingCatalogue({
      metrics,
      scopes: [...scopes, { kind: 'county', id: 'dallas', level: 'district', label: 'Dallas County' }],
    })
    expect(cat.some((e) => e.scope.kind === 'county')).toBe(false)
  })

  it('caps how many metrics a repeated scope takes, because 20 regions multiply', () => {
    const cat = rankingCatalogue({
      metrics: [SCORE, CHANGE, { key: 'change:score:1y', label: 'Change since last year', change: true }],
      scopes: regions,
    })
    // Three metrics match the headline selector; the region plan takes two.
    // One end each x 20 regions = 40.
    expect(cat.length).toBe(40)
    expect(new Set(cat.map((e) => e.metric.key))).toEqual(new Set(['score', 'change:score:5y']))
  })

  it('honours a metric that declares which levels it exists at', () => {
    const cat = rankingCatalogue({
      metrics: [{ ...SCORE, levels: ['district'] }],
      scopes: [TEXAS, CAMPUSES],
    })
    expect(cat.every((e) => e.scope.level === 'district')).toBe(true)
  })

  it('treats the overall score and its change as the headline pair', () => {
    expect(isHeadlineMetric(SCORE)).toBe(true)
    expect(isHeadlineMetric(CHANGE)).toBe(true)
    expect(isHeadlineMetric(ABSENT)).toBe(false)
  })

  it('builds cross-links that only ever point at pages it generated, and never finds an inverse', () => {
    const cat = rankingCatalogue({ metrics, scopes })
    const entry = cat.find((e) => e.scope === TEXAS && e.metric.key === 'score' && e.end === 'top')
    const rel = relatedFor(cat, entry)
    const paths = new Set(cat.map((e) => e.href))

    // No two entries ever share a scope AND a metric key with different ends
    // now — each metric contributes exactly one — so there is never a real
    // inverse in a catalogue rankingCatalogue() produced.
    expect(rel.inverse).toBeNull()
    // 8 other metrics at the Texas-districts scope, regardless of THEIR own
    // end: chronic absenteeism's only entry is 'bottom' while score's is
    // 'top', and it still belongs in "other rankings of Texas school
    // districts" — see relatedFor's own comment on why `end` is not part of
    // this filter.
    expect(rel.metrics.length).toBe(8)
    expect(rel.scopes.length).toBe(21)
    for (const l of [...rel.metrics, ...rel.scopes]) expect(paths.has(l.href)).toBe(true)
  })

  it('cross-links a lower-is-better metric\'s "-lowest" board alongside a higher-is-better one\'s "-highest"', () => {
    // Regression for the relatedFor fix: before it stopped filtering by
    // `end`, chronic absenteeism (end: 'bottom') was silently missing from
    // the "other rankings" list on the score (end: 'top') page.
    const cat = rankingCatalogue({ metrics, scopes })
    const entry = cat.find((e) => e.scope === TEXAS && e.metric.key === 'score')
    const rel = relatedFor(cat, entry)
    expect(rel.metrics.some((m) => m.href === '/rankings/texas-districts/absenteeism-lowest')).toBe(true)
  })

  it('renders a change-metric page that never links a "-declines" page, because none was built', () => {
    const cat = rankingCatalogue({ metrics, scopes })
    const entry = cat.find((e) => e.scope === TEXAS && e.metric.key === 'change:score:5y')
    expect(entry.end).toBe('top')
    expect(entry.href).toBe('/rankings/texas-districts/change-score-5y-gains')

    const html = renderRankingPage({
      ...entry,
      rows: rows(30),
      meta: { eligible: 30 },
      related: relatedFor(cat, entry),
    })
    expect(html).not.toContain('change-score-5y-declines')
    expect(html).toContain('largest rating gains since 2021-22')
    expect(html).toContain('This site does not publish the other end of this ordering.')
  })
})

/* ------------------------------------------------------------ the index -- */

describe('the rankings index', () => {
  const cat = rankingCatalogue({ metrics: [SCORE, CHANGE], scopes: [TEXAS, REGION10] })

  it('is a document with a canonical URL of its own', () => {
    const html = renderRankingsIndexPage({ pages: cat, snapshotDate: '15 August 2026' })
    expect(html).toContain('<link rel="canonical" href="https://txschools.net/rankings">')
    expect(html).toContain('<h1>Texas school rankings</h1>')
    expect(html).toMatch(/<meta name="description" content="[^"]{40,}">/)
  })

  it('groups every list by the population it ranks', () => {
    const html = renderRankingsIndexPage({ pages: cat })
    expect(html).toContain('Texas school districts')
    // One entry per metric now (score, change:score:5y) — 2 lists per scope,
    // not 4.
    expect(html).toContain('2 ranked lists')
    expect(html).toContain('Region 10 school districts')
    expect(html).toContain('href="/rankings/texas-districts/score-highest"')
    expect(html).toContain('href="/rankings/region-10-districts/change-score-5y-gains"')
    expect(html).not.toContain('change-score-5y-declines')
  })

  it('states the rules the lists follow, including the one about demographics', () => {
    const html = renderRankingsIndexPage({ pages: cat })
    expect(html).toContain('A placement without a denominator is a boast.')
    expect(html).toContain('never ranked')
    expect(html).toContain('TEA publishes most measures for the current year only.')
  })

  it('says so rather than rendering an empty hub', () => {
    const html = renderRankingsIndexPage({ pages: [] })
    expect(html).toContain('No ranked lists were built for this snapshot.')
  })

  it('says nothing about counties when no county board was built', () => {
    const html = renderRankingsIndexPage({ pages: cat })
    expect(html).not.toContain('rated districts')
  })

  it('states the poverty-context caveat, reusing the About page\'s own words, linked to it', () => {
    const html = renderRankingsIndexPage({ pages: cat })
    expect(html).toContain(
      "a comparison against the state average measures the composition of a school's intake at least as much as anything the school did"
    )
    expect(html).toContain('<a href="/about#peer-cohort">How the peer group is chosen</a>')
  })
})

/* ---------------------------------------------------- grouped accordions -- */

describe('the index groups its ~44 population lists into real accordions', () => {
  const cat = rankingCatalogue({ metrics: [SCORE, CHANGE], scopes: [TEXAS, CAMPUSES, REGION10] })
  const DALLAS_COUNTY = { kind: 'county', id: '113', level: 'district', label: 'Dallas County' }
  const catWithCounty = rankingCatalogue({
    metrics: [SCORE],
    scopes: [TEXAS, DALLAS_COUNTY],
    plan: [
      { kind: 'state', level: 'district', select: () => true },
      { kind: 'county', level: 'district', select: () => true },
    ],
  })

  it('wraps every scope in a native <details>, not a JS-built collapse', () => {
    const html = renderRankingsIndexPage({ pages: cat })
    expect(html.match(/<details class="rk-group"/g).length).toBe(3) // Texas districts, Texas campuses, Region 10
    expect(html).toContain('<summary>')
  })

  it('opens the statewide groups by default and leaves region and county groups closed', () => {
    const html = renderRankingsIndexPage({ pages: cat })
    const stateBlock = html.slice(html.indexOf('data-name="Texas school districts"') - 40, html.indexOf('data-name="Texas school districts"') + 40)
    expect(stateBlock).toContain('<details class="rk-group" data-name="Texas school districts" open>')

    const regionBlock = html.slice(html.indexOf('data-name="Region 10 school districts"') - 40, html.indexOf('data-name="Region 10 school districts"') + 40)
    expect(regionBlock).toContain('<details class="rk-group" data-name="Region 10 school districts">')
    expect(regionBlock).not.toContain('open>')
  })

  it('gives a county group the same closed treatment as a region group', () => {
    const html = renderRankingsIndexPage({ pages: catWithCounty })
    expect(html).toContain('<details class="rk-group" data-name="Dallas County school districts">')
  })

  it('headlines the three population kinds separately', () => {
    const html = renderRankingsIndexPage({ pages: cat })
    expect(html).toMatch(/Statewide: \d+ ranked population/)
    expect(html).toMatch(/By region: \d+ ranked population/)
  })

  it('carries a client-side name filter that starts hidden, above the groups', () => {
    const html = renderRankingsIndexPage({ pages: cat })
    const filterAt = html.indexOf('id="rk-filter-wrap"')
    const firstGroupAt = html.indexOf('<details class="rk-group"')
    expect(filterAt).toBeGreaterThan(-1)
    expect(filterAt).toBeLessThan(firstGroupAt)
    expect(html).toContain('<div class="rk-filter" id="rk-filter-wrap" hidden>')
    expect(html).toContain('<input type="text" id="rk-filter-input"')
    expect(html).toContain("document.getElementById('rk-filter-wrap')")
  })

  it('defers its DOM query past parse time, so it still finds the groups that render after it in the document', () => {
    // The filter's <script> is a plain classic script (no defer/module), so a
    // real browser executes it the instant the parser reaches it — before the
    // .rk-group markup later in this same document has been parsed. This
    // stubs just enough of `document` to run the emitted script exactly as a
    // browser would and prove it no longer queries for groups at that
    // mid-parse moment, only after the document (DOMContentLoaded) is done.
    const html = renderRankingsIndexPage({ pages: cat })
    const scriptOpen = html.indexOf('<script>', html.indexOf('id="rk-filter-wrap"'))
    const scriptClose = html.indexOf('</script>', scriptOpen)
    const js = html.slice(scriptOpen + '<script>'.length, scriptClose)

    let wrapHidden = true
    let listenerAdded = false
    let domReady = false // flips true only once the "rest of the document" has parsed
    let domContentLoadedHandler = null
    const wrapEl = {
      get hidden() { return wrapHidden },
      set hidden(v) { wrapHidden = v },
    }
    const inputEl = { value: '', addEventListener: (type) => { if (type === 'input') listenerAdded = true } }
    const emptyEl = { hidden: true }
    const document = {
      readyState: 'loading',
      getElementById: (id) =>
        id === 'rk-filter-wrap' ? wrapEl : id === 'rk-filter-input' ? inputEl : id === 'rk-filter-empty' ? emptyEl : null,
      // Only "present" once domReady flips — mirrors the .rk-group <details>
      // elements not existing yet at the moment this script tag runs.
      querySelectorAll: (sel) => (sel === '.rk-group' && domReady ? [{ hasAttribute: () => false }] : []),
      addEventListener: (type, handler) => { if (type === 'DOMContentLoaded') domContentLoadedHandler = handler },
    }

    vm.runInNewContext(js, { document })

    // At the instant the parser reaches this script (readyState still
    // 'loading', groups not yet in the DOM), the filter must stay hidden and
    // unwired rather than give up because groups.length was 0.
    expect(wrapHidden).toBe(true)
    expect(listenerAdded).toBe(false)
    expect(typeof domContentLoadedHandler).toBe('function')

    // Once the document (and the groups below this script) has finished
    // parsing, the deferred run must find them and do its job.
    domReady = true
    domContentLoadedHandler()
    expect(wrapHidden).toBe(false)
    expect(listenerAdded).toBe(true)
  })

  it('renders no filter and no groups when the hub has nothing to show', () => {
    const html = renderRankingsIndexPage({ pages: [] })
    expect(html).not.toContain('rk-filter-wrap')
    expect(html).not.toContain('rk-group')
  })

  it('announces the zero-match filter message as a live region, like the site\'s other dynamic status lines', () => {
    const html = renderRankingsIndexPage({ pages: cat })
    expect(html).toContain(
      '<p class="rk-filter-empty" id="rk-filter-empty" role="status" aria-live="polite" hidden>No groups match that filter. Clear it to see them all.</p>'
    )
  })
})

/* --------------------------------------------------- county selection rule -- */

describe('the index states which counties get a board of their own, and why', () => {
  const DALLAS_COUNTY = { kind: 'county', id: '113', level: 'district', label: 'Dallas County' }
  const catWithCounty = rankingCatalogue({
    metrics: [SCORE],
    scopes: [TEXAS, DALLAS_COUNTY],
    plan: [
      { kind: 'state', level: 'district', select: () => true },
      { kind: 'county', level: 'district', select: () => true },
    ],
  })

  it('states the MIN_POPULATION floor and how many counties clear it', () => {
    const html = renderRankingsIndexPage({ pages: catWithCounty })
    expect(html).toContain(`at least ${MIN_POPULATION} rated districts`)
    expect(html).toContain('1 county has')
  })

  it('states how many counties were excluded by the floor, when told the total', () => {
    const html = renderRankingsIndexPage({ pages: catWithCounty, countiesTotal: 253 })
    expect(html).toContain('The other 252 of Texas\'s 253 counties fall short of that floor')
  })

  it('does not invent an excluded count it was never given', () => {
    const html = renderRankingsIndexPage({ pages: catWithCounty })
    expect(html).not.toMatch(/The other \d+ of Texas/)
    expect(html).toContain('Counties short of that floor keep their county hub page')
  })
})

/* ------------------------------------------------------- the interactive tool -- */

describe('the interactive tool boots from the /rankings index', () => {
  const cat = rankingCatalogue({ metrics: [SCORE], scopes: [TEXAS] })
  const tool = {
    payloadHref: '/data/payload-abc12345.json',
    snapshot: '2026-08',
    defaults: { metric: 'score.latest', level: 'district', scope: 'state', aea: 'include', order: 'top', n: '50' },
    lookups: { regions: { '01': 'Region 01: Edinburg' }, counties: { '001': 'Anderson' } },
    metric: SCORE,
    scope: TEXAS,
    end: 'top',
    rows: rows(30),
    meta: { eligible: 30 },
  }

  it('emits the exact DOM contract site/rankings.js documents at its own top of file', () => {
    const html = renderRankingsIndexPage({ pages: cat, tool })
    expect(html).toContain('<section data-rankings data-payload="/data/payload-abc12345.json" data-snapshot="2026-08"')
    expect(html).toMatch(/data-defaults='\{&quot;metric&quot;:&quot;score\.latest&quot;.*\}'/)
    expect(html).toContain('<div data-rankings-controls></div>')
    expect(html).toContain('<p data-rankings-status role="status" aria-live="polite" class="rankings-status"></p>')
    expect(html).toContain('<div data-rankings-output>')
    expect(html).toContain('<script type="application/json" data-rankings-lookups>')
    expect(html).toContain('<script type="module" src="/rankings.js"></script>')
  })

  it('puts the status line outside the output div, exactly as documented', () => {
    const html = renderRankingsIndexPage({ pages: cat, tool })
    const statusAt = html.indexOf('data-rankings-status')
    const outputAt = html.indexOf('data-rankings-output')
    const controlsAt = html.indexOf('data-rankings-controls')
    expect(controlsAt).toBeGreaterThan(-1)
    expect(controlsAt).toBeLessThan(statusAt)
    expect(statusAt).toBeLessThan(outputAt)
  })

  it('fills data-rankings-output with one real, complete ranking — not a placeholder', () => {
    const html = renderRankingsIndexPage({ pages: cat, tool })
    const outputAt = html.indexOf('<div data-rankings-output>')
    const output = html.slice(outputAt, html.indexOf('</section>', outputAt))
    expect(output).toContain('<table')
    expect(output).toContain('href="/district/district-0"')
    expect(output).toMatch(/ranked here/)
  })

  it('names every region and county the lookups script carries', () => {
    const html = renderRankingsIndexPage({ pages: cat, tool })
    const script = html.slice(html.indexOf('data-rankings-lookups>') + 'data-rankings-lookups>'.length)
    const json = script.slice(0, script.indexOf('</script>'))
    const parsed = JSON.parse(json)
    expect(parsed.regions['01']).toBe('Region 01: Edinburg')
    expect(parsed.counties['001']).toBe('Anderson')
  })

  it('falls back to top-level lookups over tool.lookups, matching what prerender.js already sends', () => {
    const html = renderRankingsIndexPage({
      pages: cat,
      lookups: { regions: { '02': 'Region 02: Corpus Christi' }, counties: {} },
      tool: { ...tool, lookups: { regions: { '01': 'Region 01: Edinburg' }, counties: {} } },
    })
    expect(html).toContain('Region 02: Corpus Christi')
    expect(html).not.toContain('Region 01: Edinburg')
  })

  it('omits the tool entirely without a payload, rather than booting a broken one', () => {
    const html = renderRankingsIndexPage({ pages: cat })
    expect(html).not.toContain('data-rankings')
    expect(html).not.toContain('/rankings.js')
  })

  it('omits the tool when the caller has no defaults to state, rather than guessing a selection', () => {
    const html = renderRankingsIndexPage({ pages: cat, tool: { ...tool, defaults: null } })
    expect(html).not.toContain('data-rankings')
  })
})
