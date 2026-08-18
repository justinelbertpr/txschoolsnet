import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
// test/render/page.test.js
//
// The rail is an index of the page it sits beside. The load-bearing property is
// therefore not how it looks but where it comes from: it is derived from the
// sections that actually rendered, never from a list kept in step by hand. A
// campus with no finance file and no campus list must get a rail with no
// #spending and no #campuses link, because a rail link to a section that is not
// on the page scrolls nowhere and lights no scroll-spy.
//
// The second property is that none of this is load-bearing for the reader. With
// JavaScript off the index is still a list of working anchors, the sticky bar
// stays hidden and says nothing the hero has not already said, and the pinner is
// simply an input that does nothing.

import { describe, it, expect } from 'vitest'
import { railFor, renderEntity, sectionIndex, stickyFor } from '../../src/render/page.js'
import { HERO_ID, HERO_LABEL } from '../../src/render/sections.js'
import { GTAG_INLINE, THEME_INIT_SCRIPT, TRUSTED_TYPES_INIT_SCRIPT, shell, table } from '../../src/render/shell.js'

const COHORTS = [
  { key: 'peer', label: 'Similar student population', short: 'similar', n: 294, metrics: { ecoDis: 60 } },
  { key: 'state', label: 'Texas average', short: 'state', n: 1_207, metrics: { ecoDis: 61 } },
]

/** The narrowest view model renderEntity accepts: an entity with nothing but a name. */
const vm = (over = {}) => ({
  id: '057905',
  name: 'Dallas ISD',
  level: 'district',
  slug: 'dallas-isd-057905',
  county: 'Dallas',
  countySlug: 'dallas',
  regionId: '10',
  regionName: 'Region 10',
  snapshotDate: '15 August 2026',
  isCharter: false,
  isAlt: false,
  enrollment: 138_000,
  multYear: 0,
  notRated: false,
  history: [{ year: '2025-26', rating: 'B', score: 88 }],
  stateByYear: { '2025-26': 72.4 },
  stateAvg: 72.4,
  peerByYear: { '2025-26': 70.2 },
  peerAvg: 70.2,
  peerN: 294,
  comparisons: [{ key: 'peer', label: 'Similar student population', n: 294, byYear: { '2025-26': 70.2 } }],
  rank: 0,
  rankOf: 0,
  regionRank: 0,
  regionRankOf: 0,
  domains: [],
  profile: null,
  raceShare: null,
  staffYears: null,
  staar: null,
  graduation: null,
  ccmr: null,
  finance: null,
  campuses: null,
  cohorts: COHORTS,
  own: { ecoDis: 88.4 },
  ranks: [],
  standouts: [],
  ...over,
})

const PAYLOAD = '/data/payload-deadbeef.json'

/* ------------------------------------------------------------ sectionIndex -- */

describe('sectionIndex', () => {
  it('reads the id and the heading off each section that rendered', () => {
    const index = sectionIndex([
      '<section id="trajectory">\n  <h2>5 years of ratings</h2>\n  <p>x</p>\n</section>',
      '<section id="source">\n  <h2>Where this comes from</h2>\n</section>',
    ])
    expect(index).toEqual([
      { id: 'trajectory', label: '5 years of ratings' },
      { id: 'source', label: 'Where this comes from' },
    ])
  })

  it('drops the nulls, so an absent section can never become a dead anchor', () => {
    const index = sectionIndex(['<section id="a"><h2>A</h2></section>', null, null, '<section id="b"><h2>B</h2></section>'])
    expect(index.map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('prefers a section\'s declared rail label to its heading', () => {
    const index = sectionIndex([`<section class="hero" id="${HERO_ID}" data-rail-label="${HERO_LABEL}"><h1>Dallas ISD</h1></section>`])
    expect(index).toEqual([{ id: HERO_ID, label: HERO_LABEL }])
  })

  it('skips a section with no id at all rather than emitting href="#"', () => {
    expect(sectionIndex(['<section class="hero"><h2>Nameless</h2></section>'])).toEqual([])
  })

  it('does not escape a heading twice', () => {
    const index = sectionIndex(['<section id="x"><h2>Ford &amp; Sons ISD</h2></section>'])
    expect(index[0].label).toBe('Ford &amp; Sons ISD')
    expect(index[0].label).not.toContain('&amp;amp;')
  })

  it('takes the section heading, not a subheading inside it', () => {
    const index = sectionIndex(['<section id="outcomes"><h2>Student outcomes</h2><h3>STAAR performance</h3></section>'])
    expect(index[0].label).toBe('Student outcomes')
  })
})

/* -------------------------------------------------------------- the rail --- */

describe('railFor', () => {
  const index = [
    { id: HERO_ID, label: HERO_LABEL },
    { id: 'trajectory', label: '5 years of ratings' },
    { id: 'source', label: 'Where this comes from' },
  ]

  it('links every indexed section, in page order, as a plain anchor', () => {
    const html = railFor(vm(), index, { payload: PAYLOAD })
    expect(html).toContain('<h2 class="rail-title">On this page</h2>')
    expect(html).toContain(`<a class="rail-link" href="#${HERO_ID}" data-spy="${HERO_ID}">${HERO_LABEL}</a>`)
    expect(html).toContain('<a class="rail-link" href="#trajectory" data-spy="trajectory">5 years of ratings</a>')
    expect([...html.matchAll(/href="#([a-z]+)"/g)].map((m) => m[1])).toEqual([HERO_ID, 'trajectory', 'source'])
  })

  it('links only what rendered', () => {
    const html = railFor(vm(), index, { payload: PAYLOAD })
    expect(html).not.toContain('#spending')
    expect(html).not.toContain('#campuses')
    expect(html).not.toContain('#standouts')
  })

  it('carries the cohort switch with both payload scripts, exactly as the client reads them', () => {
    const html = railFor(vm(), index, { payload: PAYLOAD })
    expect(html).toContain('rail-block rail-compare')
    expect(html).toContain('<div class="cohort-bar"')
    expect(html).toContain('class="chip chip-cohort" data-cohort="peer"')
    expect(html).toContain('<script type="application/json" data-cohorts>')
    expect(html).toContain('<script type="application/json" data-own>')
    expect(html).toContain('aria-pressed="true"') // the first cohort is the active one
  })

  it('omits the compare block for an entity with no cohorts', () => {
    const html = railFor(vm({ cohorts: [] }), index, { payload: PAYLOAD })
    expect(html).not.toContain('rail-compare')
    expect(html).toContain('rail-sections')
  })

  it('names the payload for the pinner instead of inlining 1,199 districts', () => {
    const html = railFor(vm(), index, { payload: PAYLOAD })
    expect(html).toContain(`<script type="application/json" data-pin-source>{"payload":"${PAYLOAD}"}</script>`)
    expect(html).toContain('class="pin-search"')
    expect(html).toContain('<ul class="pin-results" hidden></ul>')
    // The pinner searches schools AND districts from either kind of page (a
    // campus and a district publish the same 0-100 score) — see the comment
    // on src/render/page.js:railPins — so the served wording says so rather
    // than making the narrower claim site/app.js used to have to correct.
    expect(html).toContain('<ul class="pin-list" aria-label="Pinned schools and districts"></ul>')
    expect(html.length).toBeLessThan(4_000)
  })

  it('offers no pinner where there is no chart to pin a line onto', () => {
    const html = railFor(vm(), index.filter((s) => s.id !== 'trajectory'), { payload: PAYLOAD })
    expect(html).not.toContain('rail-pins')
    expect(html).not.toContain('pin-search')
  })

  it('offers no pinner when the payload name is unknown, rather than a search of nothing', () => {
    const html = railFor(vm(), index, { payload: null })
    expect(html).not.toContain('pin-search')
    expect(html).not.toContain('data-pin-source')
  })

  it('labels every block, so the rail is navigable by heading', () => {
    const html = railFor(vm(), index, { payload: PAYLOAD })
    // Compare leads (page.js:railFor) — "how does this compare" is the
    // second question a reader asks, right after the score, and it used to
    // sit under an 8-12-link section index on a long entity page.
    expect([...html.matchAll(/class="rail-title">([^<]+)</g)].map((m) => m[1])).toEqual([
      'Compare against',
      'On this page',
      'Pin to compare',
    ])
  })
})

/* ------------------------------------------------------------ sticky bar --- */

describe('stickyFor', () => {
  it('states the name, the grade with its score, and the active comparison', () => {
    const html = stickyFor(vm())
    expect(html).toContain('<span class="sb-name">Dallas ISD</span>')
    expect(html).toContain('class="sb-grade"')
    expect(html).toContain('>B<')
    expect(html).toContain('>88<')
    expect(html).toContain('vs <span data-sb-cohort>Similar student population</span>')
  })

  it('says NR rather than inventing a grade for an unrated entity', () => {
    expect(stickyFor(vm({ history: [], notRated: true }))).toContain('>NR<')
  })

  it('drops the comparison for an entity with no cohorts', () => {
    const html = stickyFor(vm({ cohorts: [] }))
    expect(html).not.toContain('sb-cohort')
    expect(html).toContain('sb-name')
  })

  it('escapes the entity name and the cohort label', () => {
    const html = stickyFor(vm({ name: 'A <b>B</b> ISD', cohorts: [{ ...COHORTS[0], label: 'X & Y' }] }))
    expect(html).toContain('A &lt;b&gt;B&lt;/b&gt; ISD')
    expect(html).toContain('X &amp; Y')
  })
})

/* ------------------------------------------------------------- the shell --- */

describe('shell layout', () => {
  const args = {
    title: 'T',
    description: 'D',
    canonical: 'https://txschools.net/x',
    crumbs: [{ href: '/', label: 'Texas schools', current: 'X' }],
    sections: ['<section id="a"><h2>A</h2></section>'],
  }

  it('emits no layout wrapper at all without a rail, so the hubs are untouched', () => {
    const html = shell(args)
    expect(html).not.toContain('class="layout"')
    expect(html).not.toContain('class="rail"')
    expect(html).not.toContain('class="col"')
    expect(html).not.toContain('stickybar')
  })

  it('wraps the rail and the column only when a rail is given', () => {
    const html = shell({ ...args, rail: '<div class="rail-block">R</div>', sticky: '<span class="sb-name">X</span>' })
    expect(html).toContain('<div class="layout">')
    expect(html).toContain('<aside class="rail" id="rail" aria-label="Page tools">')
    expect(html).toContain('<div class="col">')
    expect(html).toContain('<div class="stickybar" hidden><span class="sb-name">X</span></div>')
  })

  it('puts the rail before the column and the breadcrumb inside it, ahead of main', () => {
    const html = shell({ ...args, rail: '<div class="rail-block">R</div>', sticky: '<span>X</span>' })
    const at = (s) => html.indexOf(s)
    expect(at('<aside class="rail"')).toBeLessThan(at('<div class="col">'))
    expect(at('<div class="col">')).toBeLessThan(at('class="stickybar"'))
    expect(at('class="stickybar"')).toBeLessThan(at('aria-label="Breadcrumb"'))
    expect(at('aria-label="Breadcrumb"')).toBeLessThan(at('<main id="main">'))
  })

  it('keeps the skip link pointing at main, which is still there to skip to', () => {
    const html = shell({ ...args, rail: '<div class="rail-block">R</div>' })
    expect(html).toContain('<a class="skip" href="#main">Skip to content</a>')
    expect(html.indexOf('class="skip"')).toBeLessThan(html.indexOf('<aside class="rail"'))
  })

  it('renders a rail-less page byte for byte as it did before there were rails', () => {
    expect(shell({ ...args, rail: null, sticky: null })).toBe(shell(args))
  })
})

/* ------------------------------------------------------------ the page ----- */

describe('renderEntity', () => {
  it('indexes the sections it rendered, and only those', () => {
    const html = renderEntity(vm(), { payload: PAYLOAD })
    const links = [...html.matchAll(/data-spy="([^"]+)"/g)].map((m) => m[1])
    expect(links).toContain(HERO_ID)
    expect(links).toContain('trajectory')
    expect(links).toContain('source')
    expect(links).not.toContain('spending')
    for (const id of links) expect(html).toContain(`id="${id}"`)
  })

  it('grows the index when a section gains its data', () => {
    const before = renderEntity(vm(), { payload: PAYLOAD })
    const after = renderEntity(
      vm({
        campuses: [
          { slug: 'a-1', name: 'A', rating: 'B', score: 80, enrollment: 100, campusType: 'High School' },
          { slug: 'b-2', name: 'B', rating: 'C', score: 74, enrollment: 90, campusType: 'Elementary' },
        ],
      }),
      { payload: PAYLOAD }
    )
    expect(before).not.toContain('data-spy="campuses"')
    expect(after).toContain('data-spy="campuses"')
    // The label is the section's own <h2>, not a name the rail invents for it.
    expect(after).toContain('<a class="rail-link" href="#campuses" data-spy="campuses">2 schools in this district</a>')
  })

  // The point of the whole exercise: a campus is not a district with fewer rows.
  it('omits from a campus rail every section the campus does not have', () => {
    const campus = renderEntity(
      vm({
        id: '001902001',
        level: 'campus',
        name: 'Cayuga H S',
        slug: 'cayuga-h-s-001902001',
        districtSlug: 'cayuga-isd-001902',
        districtName: 'Cayuga ISD',
        campuses: null,
        finance: null,
        profile: null,
      }),
      { payload: PAYLOAD }
    )
    expect(campus).not.toContain('data-spy="campuses"')
    expect(campus).not.toContain('data-spy="spending"')
    expect(campus).not.toContain('data-spy="students"')
    expect(campus).toContain('data-spy="trajectory"')
  })

  it('reads without JavaScript: every section, its figures, and a working index', () => {
    const html = renderEntity(vm(), { payload: PAYLOAD })
    // Nothing in the rail's index is script-generated, and the sticky bar — the
    // one part that needs the client — ships hidden and repeats the hero.
    expect(html).toContain('<div class="stickybar" hidden>')
    expect(html).toContain('<h1>Dallas ISD</h1>')
    expect(html).toContain('<table')
    for (const [, id] of html.matchAll(/href="#([a-z]+)"/g)) expect(html).toContain(`id="${id}"`)
  })

  it('puts a synchronized cohort switch near the top on mobile without duplicating its data', () => {
    const html = renderEntity(vm(), { payload: PAYLOAD })
    expect(html.match(/chip-cohort/g)).toHaveLength(4) // two cohorts in the rail and the mobile copy
    expect(html.match(/data-cohorts/g)).toHaveLength(1)
    expect(html.match(/data-own/g)).toHaveLength(1)
    const rail = html.slice(html.indexOf('<aside class="rail"'), html.indexOf('</aside>'))
    const main = html.slice(html.indexOf('<main id="main">'))
    expect(rail).toContain('chip-cohort')
    expect(main).toContain('class="mobile-compare"')
    expect(main.match(/chip-cohort/g)).toHaveLength(2)
    expect(main).not.toContain('data-cohorts')
    expect(main).not.toContain('data-own')
  })

  it('renders an entity with nothing but a name, rail and all', () => {
    const html = renderEntity(
      vm({ history: [], comparisons: [], cohorts: [], stateByYear: {}, peerByYear: null }),
      { payload: PAYLOAD }
    )
    expect(html).toContain(`data-spy="${HERO_ID}"`)
    expect(html).toContain('data-spy="source"')
    expect(html).not.toContain('data-spy="trajectory"')
    expect(html).not.toContain('rail-compare')
  })
})

/* -------------------------------------------- the nav cannot go unreachable --

   Mobile now uses a native <details>: no JavaScript owns its state, and every
   destination is server-rendered in both layouts. Desktop and mobile have
   separate CSS-owned navigation shells because browsers remove the content of
   a closed <details> from layout even when a display override wins the cascade.
   That is the rotation/resize invariant — a closed phone menu has no bearing on
   the dedicated desktop navigation after the layout widens. */

describe('the primary nav cannot become unreachable', () => {
  const page = () =>
    shell({
      title: 'T',
      description: 'D',
      canonical: 'https://txschools.net/x',
      sections: ['<section id="a"><h2>A</h2></section>'],
    })

  it('ships every destination as a plain link inside a native mobile menu', () => {
    const html = page()
    const header = html.slice(html.indexOf('<header class="site">'), html.indexOf('</header>'))
    const tools = header.slice(header.indexOf('<div class="masthead-tools">'))
    expect(html).toContain('class="wordmark" href="/"')
    expect(html).toContain('<div class="desktop-nav">')
    for (const href of ['/districts/a', '/rankings', '/download', '/about']) {
      expect(tools.match(new RegExp(`<a href="${href}"`, 'g'))).toHaveLength(2)
    }
    // Search is words in the mobile menu and a compact icon on desktop, not
    // two adjacent links that both lead to the same place.
    expect(tools.match(/href="\/search"/g)).toHaveLength(2)
    expect(tools.match(/>Find schools<\/a>/g)).toHaveLength(1)
    expect(tools).toContain(
      '<a class="desktop-search" href="/search" aria-label="Search schools and districts" title="Search"'
    )
    expect(tools.match(/class="desktop-search"/g)).toHaveLength(1)
    expect(tools).toMatch(/class="desktop-search"[\s\S]*?<svg aria-hidden="true"/)
    expect(header.match(/<nav class="sitenav" aria-label="Site">/g)).toHaveLength(2)
    expect(html).toContain('<details class="nav-menu">')
    expect(html).toContain('<summary><span>Menu</span>')
    expect(html).toContain('<div class="nav-menu-panel">')
  })

  it('marks the desktop search control current throughout the search hub', () => {
    const html = shell({
      title: 'Search',
      description: 'D',
      canonical: 'https://txschools.net/search/a',
      sections: ['<section id="a"><h2>A</h2></section>'],
    })
    expect(html).toContain(
      '<a class="desktop-search" href="/search" aria-label="Search schools and districts" title="Search" aria-current="page"'
    )
  })

  it('emits no inline script inside the header', () => {
    const html = page()
    const header = html.slice(html.indexOf('<header class="site">'), html.indexOf('</header>'))
    expect(header).not.toContain('<script')
    expect(header).not.toContain('matchMedia')
  })

  it('uses CSS to swap the dedicated desktop nav and native mobile menu', async () => {
    const { readFileSync } = await import('node:fs')
    const css = readFileSync(new URL('../../site/style.css', import.meta.url), 'utf8')
    expect(css).toMatch(/@media \(min-width: 48rem\)[\s\S]*\.desktop-nav \{ display: flex;[\s\S]*\.nav-menu \{ display: none; \}/)
    expect(css).toMatch(/@media \(max-width: 47\.99rem\)[\s\S]*\.desktop-nav \{ display: none; \}[\s\S]*\.nav-menu > summary/)
    expect(css).not.toMatch(/nav-disclosure|initNavDisclosure/)
  })

  it('lets entity-page charts use the full data card width', async () => {
    const { readFileSync } = await import('node:fs')
    const css = readFileSync(new URL('../../site/style.css', import.meta.url), 'utf8')
    const redesign = css.slice(css.indexOf('2026 PRODUCT REDESIGN'))
    expect(css).toMatch(/\.chart\s*\{\s*width:\s*100%/)
    expect(redesign).toMatch(/\.layout\s*\{[^}]*--chart-max:\s*100%/)
  })

  it('has no JavaScript that decides whether the nav is visible', async () => {
    const { readFileSync } = await import('node:fs')
    const js = readFileSync(new URL('../../site/app.js', import.meta.url), 'utf8')
    expect(js).not.toMatch(/nav-disclosure|initNavDisclosure/)
    // The two surviving matchMedia calls are both READER PREFERENCE queries —
    // prefers-reduced-motion and prefers-color-scheme. Neither reads a width,
    // and that is the actual invariant: the moment JavaScript here branches on
    // viewport width, it is deciding layout the stylesheet should own, which is
    // precisely how the nav came to depend on a script agreeing with a media
    // query. Asserted as "no width query" rather than as an exact list, so
    // adding another preference query does not fail this for no reason.
    for (const call of js.match(/matchMedia\([^)]*\)/g) ?? []) {
      expect(call).toMatch(/prefers-/)
      expect(call).not.toMatch(/width/)
    }
  })
})

/* ------------------------------------------------- the CSP and the tag ---- */

// An inline script whose CSP hash has drifted does not warn — it silently
// stops running, and analytics that quietly stopped reporting is worse than
// analytics that was never added. These tie site/_headers to the exact strings
// src/render/shell.js ships.
describe('inline scripts match the CSP hashes in site/_headers', () => {
  const headers = readFileSync('site/_headers', 'utf8')
  const sha = (s) => `sha256-${createHash('sha256').update(s).digest('base64')}`

  it('carries a hash for every inline script the shell emits', () => {
    for (const [name, src] of Object.entries({
      THEME_INIT_SCRIPT,
      TRUSTED_TYPES_INIT_SCRIPT,
      GTAG_INLINE,
    })) {
      expect(headers, `${name} hash missing from _headers`).toContain(sha(src))
    }
  })

  it('allows the origins the tag actually fetches from and talks to', () => {
    const csp = headers.match(/Content-Security-Policy: (.*)/)[1]
    expect(csp).toMatch(/script-src[^;]*https:\/\/www\.googletagmanager\.com/)
    expect(csp).toMatch(/connect-src[^;]*https:\/\/www\.google-analytics\.com/)
    // GA falls back to an image beacon where fetch/sendBeacon is unavailable.
    expect(csp).toMatch(/img-src[^;]*google-analytics\.com/)
  })

  it('keeps createScript unimplemented while allowing gtag its script URL', () => {
    // The narrow allowlist is the whole point: a pass-through createScriptURL
    // would cancel the protection require-trusted-types-for exists to give.
    expect(TRUSTED_TYPES_INIT_SCRIPT).toContain('createScriptURL')
    expect(TRUSTED_TYPES_INIT_SCRIPT).toContain('googletagmanager.com')
    expect(TRUSTED_TYPES_INIT_SCRIPT).toContain('throw new TypeError')
    expect(TRUSTED_TYPES_INIT_SCRIPT).not.toContain('createScript:')
  })
})

describe('table headers', () => {
  const head = (h) => table({ caption: 'c', head: h, rows: ['<tr><td>1</td></tr>'] })

  it('gives an object head cell its second line', () => {
    expect(head([{ label: 'Difference', sub: 'percentage points' }]))
      .toContain('<th>Difference<small>percentage points</small></th>')
  })

  // 'Criterion'.sub is String.prototype.sub — a legacy HTML-wrapper method
  // still present on every string, so reading `h.sub` off a bare-string head
  // entry is truthy and stringifies to "function sub() { [native code] }".
  // It rendered that into the header of every table built from plain strings.
  it('does not mistake String.prototype.sub for a declared sub-label', () => {
    expect('Criterion'.sub).toBeTypeOf('function') // the trap still exists
    expect(head(['Criterion'])).toContain('<th>Criterion</th>')
    expect(head(['Criterion'])).not.toContain('native code')
    expect(head(['Criterion'])).not.toContain('<small>')
  })

  it('escapes a sub-label', () => {
    expect(head([{ label: 'X', sub: '<b>&' }])).toContain('<small>&lt;b&gt;&amp;</small>')
  })
})
