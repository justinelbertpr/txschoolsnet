// Site-wide search: the one control that turns 10,230 pages into a place a
// parent can find her child's school.
//
// Three decisions are load-bearing, and all three are stated here rather than
// left in the diff.
//
// ------------------------------------------------------------ 1. NO-JS FIRST
//
// A bare <input> that needs JavaScript is a dead control, so the component is a
// real <form method="get" action="/search">. With JavaScript off, pressing
// Enter lands on /search — a page that actually lists things:
//
//     /search            the search box, an A-Z jump nav with counts, and the
//                        full alphabetical list of all 1,199 districts, each
//                        with its county.
//     /search/<letter>   every district AND campus whose name begins with that
//                        letter, each with its district and county.
//
// The `q` in the URL is not honoured without JavaScript — a static file cannot
// read a query string, and pretending otherwise would be a lie. What the reader
// gets instead is a complete, browsable index one click from any letter, which
// is the honest version of "lands somewhere real". With JavaScript on, /search
// reads `?q=` itself, fills the box and opens the results, so the same URL is
// a working search for everyone else.
//
// The alternative — one /search page carrying all 10,230 rows — was measured at
// ~1.1 MB of HTML. Splitting the campuses across 26 letter pages keeps the
// landing page at ~150 KB and costs 26 assets out of the ~5,000 the file budget
// in src/prerender.js leaves spare.
//
// ------------------------------------------------------- 2. THE INDEX IS LAZY
//
// 10,230 names are never inlined into a page. They are emitted once as
// site/data/search-index.json and fetched on the first keystroke, from a URL
// the form carries in data-search-index (so the client script is a constant and
// stays cacheable).
//
// The file is column-oriented with a county dictionary, and it does NOT store
// slugs: a slug is exactly slugify(name) + '-' + id, so the client derives it
// from the two fields it already has. Measured on this snapshot:
//
//     row-wise objects, slugs stored     1,450 KB raw    216 KB gzip
//     columnar, slugs stored               677 KB raw    176 KB gzip
//     columnar, slugs derived              386 KB raw     92 KB gzip   <- this
//
// Deriving the slug halves the download, and it cannot drift from the server's
// URLs because the client's slugify IS the server's: view-model.js's function
// is interpolated into the script by source, not reimplemented.
//
// ----------------------------------------------- 3. RESULTS MUST DISAMBIGUATE
//
// Texas has 11 duplicate district names and 464 duplicate campus names. A row
// reading "Lincoln El" alone is not an answer, so every row — in the live
// results and on the static pages alike — carries its district and its county.
// The same rule the rest of the site follows: a name without its denominator is
// not a claim, it is a guess.

import { esc, navList, num, section, shell, SITE_ORIGIN } from './shell.js'
import { entitySlug, slugify } from './view-model.js'

/** Where the lazy-loaded index lives, and where the no-JS form lands. */
export const SEARCH_INDEX_PATH = '/data/search-index.json'
export const SEARCH_PATH = '/search'
export const SEARCH_LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('')

const finite = (v) => typeof v === 'number' && Number.isFinite(v)

/** First letter of a name, lowercased; null when it is not a-z. */
export const searchLetter = (name) => {
  const c = String(name ?? '').trim().slice(0, 1).toLowerCase()
  return SEARCH_LETTERS.includes(c) ? c : null
}

const byName = (a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''))

/* --------------------------------------------------------------- the index -- */

/**
 * buildSearchIndex(entities) -> the object written to site/data/search-index.json.
 *
 * Column-oriented, with a county dictionary and district rows referenced by
 * position. Every campus row carries its own county index rather than borrowing
 * its district's: they agree in this snapshot, and an index that assumes they
 * always will would start lying the day they do not.
 *
 * Slugs are absent by design — see the note at the top of this file. Anything
 * reading this file should go through readSearchIndex() rather than unpacking
 * the columns by hand, so there is one decoder and the client matches it.
 */
export function buildSearchIndex(entities = []) {
  // Ordered by TEA id, not by name, and that is a size decision rather than a
  // taste one. A campus id begins with its district's id, so id order puts a
  // district's campuses next to each other and the district-reference column
  // becomes a run of repeats: 108 KB gzipped by name, 92 KB by id, for a file
  // whose whole job is to be downloaded on a phone. Nothing reads this order —
  // the client sorts by match quality, then by name.
  const byId = (a, b) => String(a.id).localeCompare(String(b.id))
  const list = (entities ?? []).filter((e) => e && e.id != null && e.name)
  const districts = list.filter((e) => e.level !== 'campus').sort(byId)
  const campuses = list.filter((e) => e.level === 'campus').sort(byId)

  const counties = [...new Set(list.map((e) => e.county).filter(Boolean))].sort()
  const countyIx = new Map(counties.map((c, i) => [c, i]))
  const districtIx = new Map(districts.map((d, i) => [d.id, i]))

  const county = (e) => (e.county != null && countyIx.has(e.county) ? countyIx.get(e.county) : -1)

  return {
    v: 1,
    count: list.length,
    counties,
    districts: {
      name: districts.map((d) => d.name),
      id: districts.map((d) => String(d.id)),
      county: districts.map(county),
    },
    campuses: {
      name: campuses.map((c) => c.name),
      id: campuses.map((c) => String(c.id)),
      // -1 for a campus whose district is not in this snapshot: the row still
      // appears, it simply names no district rather than naming the wrong one.
      district: campuses.map((c) => (districtIx.has(c.districtId) ? districtIx.get(c.districtId) : -1)),
      county: campuses.map(county),
    },
  }
}

/** The bytes to write. Separate from buildSearchIndex so tests can size it. */
export const searchIndexJson = (entities) => JSON.stringify(buildSearchIndex(entities))

/**
 * readSearchIndex(index) -> [{ id, name, level, district, county, slug, href }]
 *
 * The reference decoder. The browser runs the same steps in the same order (see
 * searchClientJs), so a test on this function is a test on what the reader gets.
 */
export function readSearchIndex(index) {
  const counties = index?.counties ?? []
  const d = index?.districts ?? { name: [], id: [], county: [] }
  const c = index?.campuses ?? { name: [], id: [], district: [], county: [] }

  const row = (name, id, level, district, countyIx) => {
    const slug = `${slugify(name)}-${id}`
    return {
      id,
      name,
      level,
      district,
      county: counties[countyIx] ?? null,
      slug,
      href: `/${level}/${slug}`,
    }
  }

  return [
    ...(d.name ?? []).map((n, i) => row(n, d.id[i], 'district', null, d.county[i])),
    ...(c.name ?? []).map((n, i) => row(n, c.id[i], 'campus', d.name?.[c.district[i]] ?? null, c.county[i])),
  ]
}

/* ------------------------------------------------------------- the control -- */

const hintFor = (counts) => {
  const d = finite(counts?.districts) ? counts.districts : null
  const c = finite(counts?.campuses) ? counts.campuses : null
  if (d == null || c == null) {
    return 'Type at least two letters. Every result names its district and county, because school names repeat across Texas.'
  }
  return `Type at least two letters. Searches all ${num(d + c)} — ${num(d)} districts and ${num(
    c
  )} campuses — and names the district and county of each, because Texas school names repeat.`
}

/**
 * renderSearch({ placeholder, autofocus, counts, variant, id, indexUrl, action,
 *                label, assets, scriptSrc })
 *
 * Returns a self-contained <form>. It is a GET form first and an autocomplete
 * second: with the script missing, blocked or still loading, Enter navigates to
 * /search and the reader gets the browsable index.
 *
 * `assets` (default true) appends the component's style and script. They are
 * both idempotent — the CSS is a plain rule set and the script initialises every
 * uninitialised [data-search] form on DOMContentLoaded — so a page that renders
 * two of these (the header one and the home page's) works with two copies and
 * costs a few KB. Pass `scriptSrc: '/search.js'` once src/prerender.js writes
 * searchClientJs() to that path, and the inline copy is replaced by a cached
 * external file across all 10,230 pages.
 */
export function renderSearch({
  placeholder = 'School or district name',
  autofocus = false,
  counts = null,
  variant = 'header',
  id = null,
  indexUrl = SEARCH_INDEX_PATH,
  action = SEARCH_PATH,
  label = 'Find a school or district',
  hint = null,
  assets = true,
  scriptSrc = null,
} = {}) {
  // A stable default rather than a counter: prerender renders pages across
  // worker threads, and a per-process counter would give the same control a
  // different id in every build. Two on one page — the header's and the front
  // page's — pass explicit ids, which is the only case uniqueness needs.
  const base = id || 'sitesearch'
  const hero = variant === 'hero'
  const text = hint ?? hintFor(counts)

  const form = `<form class="sitesearch sitesearch-${esc(variant)}" role="search" aria-label="${esc(label)}"
  method="get" action="${esc(action)}" data-search data-search-index="${esc(indexUrl)}">
  <label class="sitesearch-label${hero ? '' : ' sr-only'}" for="${esc(base)}">${esc(label)}</label>
  <div class="sitesearch-field">
    <div class="sitesearch-row">
      <input class="sitesearch-input" id="${esc(base)}" name="q" type="search"
        placeholder="${esc(placeholder)}" aria-describedby="${esc(base)}-hint"
        autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false"
        enterkeyhint="search"${autofocus ? ' autofocus' : ''}>
      <button class="sitesearch-go" type="submit">Search</button>
    </div>
    <div class="sitesearch-panel" hidden>
      <ul class="sitesearch-results" id="${esc(base)}-results"></ul>
      <p class="sitesearch-more" hidden></p>
    </div>
  </div>
  <p class="sitesearch-hint${hero ? '' : ' sr-only'}" id="${esc(base)}-hint">${esc(text)}${
    // The link is in the visible hint only. A focusable link inside .sr-only is
    // a tab stop that lands on nothing a sighted keyboard user can see, and the
    // header already links the same index from the site nav.
    hero ? ` <a href="${esc(action)}">Browse the whole A&ndash;Z index</a>.` : ''
  }</p>
  <p class="sr-only" data-search-status role="status" aria-live="polite"></p>
</form>`

  return assets ? `${form}\n${searchAssets({ scriptSrc })}` : form
}

/** The style and script the control needs, as one string. Safe to emit twice. */
export const searchAssets = ({ scriptSrc = null } = {}) =>
  `<style data-search-style>${SEARCH_CSS}</style>\n${
    scriptSrc ? `<script src="${esc(scriptSrc)}" defer></script>` : `<script>${searchClientJs()}</script>`
  }`

/* ------------------------------------------------------------------- pages -- */

const heroBlock = ({ eyebrow, title, place = '', lede = '', extra = '' }) => `<section class="hero">
  ${eyebrow ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ''}
  <h1>${esc(title)}</h1>
  ${place ? `<p class="place">${place}</p>` : ''}
  ${extra}
  ${lede ? `<p class="lede">${lede}</p>` : ''}
</section>`

/** One row of the static index. Never a bare name — district and county always. */
const findRow = (e) => {
  const slug = e.slug || entitySlug(e)
  const where = [
    e.level === 'campus' && e.districtName ? esc(e.districtName) : null,
    e.county ? `${esc(String(e.county).replace(/ County$/i, ''))} County` : null,
  ].filter(Boolean)
  return `<li><a href="/${esc(e.level === 'campus' ? 'campus' : 'district')}/${esc(slug)}">${esc(
    e.name
  )}</a>${where.length ? `<span class="findlist-in">${where.join(' &middot; ')}</span>` : ''}</li>`
}

const findList = (rows, emptyMessage) =>
  rows.length
    ? `<ul class="findlist">${rows.map(findRow).join('')}</ul>`
    : `<p class="note na">${esc(emptyMessage)}</p>`

/**
 * A-Z jump nav. Real navigation, so it goes through navList() rather than the
 * legend markup a chart key uses. Counts carry their unit — a bare number beside
 * a letter is the unlabelled boast this site does not print.
 */
const letterNav = (countsByLetter, current = null) =>
  navList(
    SEARCH_LETTERS.map((l) => {
      const n = countsByLetter?.get(l)
      return {
        href: `${SEARCH_PATH}/${l}`,
        label: l.toUpperCase(),
        current: current === l,
        meta: finite(n) ? `${num(n)} ${n === 1 ? 'name' : 'names'}` : null,
      }
    }),
    { label: 'Search index by first letter' }
  )

const sourceSection = (snapshotDate) =>
  section(
    'source',
    'Where this comes from',
    `<p>Every name on this page comes from data the Texas Education Agency publishes at
     <a href="https://txschools.gov" rel="nofollow">txschools.gov</a>${
       snapshotDate ? `, fetched ${esc(snapshotDate)}` : ''
     } and archived with a checksum. This site is unofficial and is not affiliated with TEA.</p>
  <p class="downloads"><a href="/download">Download the whole dataset</a> &middot;
     <a href="/about">how this site works</a></p>`
  )

const countByLetter = (rows) => {
  const m = new Map(SEARCH_LETTERS.map((l) => [l, 0]))
  for (const e of rows) {
    const l = searchLetter(e.name)
    if (l) m.set(l, m.get(l) + 1)
  }
  return m
}

/**
 * renderSearchPage({ districts, campuses, letter, snapshotDate })
 *
 * letter === null renders /search: the box, the A-Z nav over every entity, and
 * the complete district list. A letter renders /search/<letter>: every district
 * and campus whose name begins with it.
 *
 * The page filters the lists itself, so its heading is true even when the caller
 * hands it more than it asked for.
 */
export function renderSearchPage({ districts = [], campuses = [], letter = null, snapshotDate = null } = {}) {
  const ds = (districts ?? []).filter((d) => d && d.name)
  const cs = (campuses ?? []).filter((c) => c && c.name)
  const counts = { districts: ds.length, campuses: cs.length }
  const perLetter = countByLetter([...ds, ...cs])
  const l = letter ? String(letter).slice(0, 1).toLowerCase() : null

  const box = (autofocus) =>
    renderSearch({
      variant: 'hero',
      counts,
      autofocus,
      id: 'search-page-box',
      label: 'Find a school or district',
      placeholder: 'School or district name',
      // shell() now emits the header instance's assets once per page (below
      // the footer), so a second copy here would just be extra bytes.
      assets: false,
    })

  if (!l) {
    const stray = [...ds, ...cs].filter((e) => searchLetter(e.name) == null).sort(byName)
    return shell({
      title: 'Find a Texas school or district',
      description: `Search or browse every Texas public school district and campus — ${num(
        counts.districts
      )} districts and ${num(counts.campuses)} campuses — each listed with its district and county.`,
      canonical: `${SITE_ORIGIN}${SEARCH_PATH}`,
      crumbs: [{ href: '/', label: 'Texas schools', current: 'Find a school' }],
      sections: [
        heroBlock({
          eyebrow: 'Search',
          title: 'Find a school or district',
          place: `${num(counts.districts)} districts &middot; ${num(counts.campuses)} campuses`,
          extra: box(true),
          lede: `Type a name above, or browse the lists below. Every entry names its district and county,
            because Texas has 11 district names and 464 campus names that more than one school shares.`,
        }),
        section(
          'letters',
          'Every school and district, by first letter',
          letterNav(perLetter),
          'Each letter lists the districts and campuses whose name begins with it, with the district and county of each.'
        ),
        section(
          'districts',
          `All ${num(counts.districts)} districts`,
          findList([...ds].sort(byName), 'No districts appear in this snapshot.'),
          `Alphabetical. Campuses are on the letter pages above — there are ${num(
            counts.campuses
          )} of them, too many for one page.`
        ),
        stray.length
          ? section(
              'other',
              `${num(stray.length)} names beginning with a digit or symbol`,
              findList(stray, 'None.')
            )
          : null,
        sourceSection(snapshotDate),
      ],
    })
  }

  const L = l.toUpperCase()
  const mine = (rows) => rows.filter((e) => searchLetter(e.name) === l).sort(byName)
  const dl = mine(ds)
  const cl = mine(cs)

  return shell({
    title: `Texas schools and districts starting with ${L}`,
    description: `The ${num(dl.length + cl.length)} Texas public school districts and campuses whose name begins with ${L}, each listed with its district and county.`,
    canonical: `${SITE_ORIGIN}${SEARCH_PATH}/${l}`,
    crumbs: [
      { href: '/', label: 'Texas schools' },
      { href: SEARCH_PATH, label: 'Find a school', current: `Names starting with ${L}` },
    ],
    sections: [
      heroBlock({
        eyebrow: 'Search index',
        title: `Names starting with ${L}`,
        place: `${num(dl.length)} districts &middot; ${num(cl.length)} campuses`,
        extra: box(false),
      }),
      section('letters', 'Jump to another letter', letterNav(perLetter, l)),
      section(
        'districts',
        `${num(dl.length)} districts starting with ${L}`,
        findList(dl, `No district in this snapshot has a name beginning with ${L}.`)
      ),
      section(
        'campuses',
        `${num(cl.length)} campuses starting with ${L}`,
        findList(cl, `No campus in this snapshot has a name beginning with ${L}.`),
        'Each campus names the district it belongs to, so the shared names stay apart.'
      ),
      sourceSection(snapshotDate),
    ],
  })
}

/* --------------------------------------------------------------------- css -- */

/**
 * The component's own stylesheet, shipped with it because site/style.css is not
 * this module's to edit. Every rationale lives here in JavaScript rather than in
 * a CSS comment, so none of it is served to 10,230 readers.
 *
 *   TOKENS ONLY. Not one literal colour, so the control inherits both themes
 *   from site/style.css without knowing either exists. Nothing animates, so
 *   prefers-reduced-motion has nothing to suppress.
 *
 *   .sitesearch-field is the positioning anchor rather than the form, so the
 *   panel opens directly under the input. Anchored to the form it opened below
 *   the hint — four lines of gap on a 375px phone between what you typed and
 *   what matched.
 *
 *   The row never wraps. A wrapping row put the button on its own line and
 *   pushed the hint off the first screen on a phone, which is the one screen
 *   this control exists to fit. The input shrinks instead (min-width:0), and the
 *   button keeps a target over 44px tall at every width.
 *
 *   16px on the input, which is what stops iOS zooming the page on focus.
 *
 *   The panel's own z-index is not enough, and the :has() rules are why. Sections
 *   on this site carry a transform for their entrance animation, and a
 *   transformed element is a stacking context: a LATER sibling context paints
 *   over everything inside an earlier one, whatever z-index a descendant claims.
 *   Verified in the preview — the third result was painted over by the stat card
 *   below it. So the container holding an OPEN panel is lifted, and only while it
 *   is open, which needs no change to rules this module does not own.
 *
 *   The active option is marked by a left bar as well as a fill, because a
 *   background alone is a colour-only cue.
 */
const SEARCH_CSS = `
.sitesearch{display:block;margin:0}
.sitesearch-field{position:relative}
.sitesearch-row{display:flex;gap:.5rem;align-items:stretch}
.sitesearch-input{flex:1 1 auto;min-width:0;font:inherit;font-size:1rem;line-height:1.3;
 padding:.6rem .75rem;color:var(--ink);background:var(--surface);
 border:1px solid var(--line);border-radius:var(--radius)}
.sitesearch-input::placeholder{color:var(--ink-3)}
.sitesearch-go{font:inherit;font-size:1rem;padding:.6rem 1rem;cursor:pointer;
 color:var(--surface);background:var(--accent);border:1px solid var(--accent);border-radius:var(--radius)}
.sitesearch-label{display:block;font-weight:600;margin:0 0 .35rem}
.sitesearch-hint{margin:.45rem 0 0;font-size:.8125rem;color:var(--ink-3);max-width:var(--measure)}
.sitesearch-hero .sitesearch-input{font-size:1.125rem;padding:.75rem .85rem}
.sitesearch-hero .sitesearch-go{font-size:1.125rem}
.sitesearch :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.sitesearch-panel{position:absolute;z-index:60;left:0;right:0;top:calc(100% + .25rem);
 max-height:min(60vh,26rem);overflow:auto;background:var(--raised);border:1px solid var(--line);
 border-radius:var(--radius);box-shadow:var(--shadow-raised)}
.hero:has(.sitesearch-panel:not([hidden])),
header:has(.sitesearch-panel:not([hidden])),
section:has(.sitesearch-panel:not([hidden])){position:relative;z-index:70}
.sitesearch-results{list-style:none;margin:0;padding:0}
.sitesearch-results li{padding:.5rem .75rem;cursor:pointer;border-left:3px solid transparent;
 border-bottom:1px solid var(--line-2)}
.sitesearch-results li:last-child{border-bottom:0}
.sitesearch-results li[aria-selected="true"]{background:var(--ground);border-left-color:var(--accent)}
.sitesearch-name{display:block;color:var(--ink)}
.sitesearch-meta{display:block;font-size:.8125rem;color:var(--ink-3)}
.sitesearch-more{margin:0;padding:.5rem .75rem;font-size:.8125rem;color:var(--ink-3);
 border-top:1px solid var(--line)}
.findlist{list-style:none;margin:0;padding:0;columns:2;column-gap:2rem}
.findlist li{break-inside:avoid;padding:.3rem 0;border-bottom:1px solid var(--line-2)}
.findlist-in{display:block;font-size:.8125rem;color:var(--ink-3)}
@media (max-width:44rem){
 .findlist{columns:1}
 .sitesearch-go{padding:.6rem .75rem}
 .sitesearch-hero .sitesearch-input{font-size:1rem}
 .sitesearch-hero .sitesearch-go{font-size:1rem}}
`.trim()

/* ------------------------------------------------------------------ client -- */

/**
 * searchClientJs() -> the browser half, as source.
 *
 * Progressive enhancement only: it upgrades a working GET form into an
 * autocomplete. If it never runs, the form still submits and /search still
 * lists every district and links every letter.
 *
 * slugify is interpolated from src/render/view-model.js rather than rewritten,
 * so a result's href cannot drift from the file prerender actually wrote.
 */
export function searchClientJs() {
  return `(function () {
  var slugify = ${slugify.toString()}
  var MIN = 2
  var SHOW = 12
  var loaded = Object.create(null)

  function normalize(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() }

  function decode(raw) {
    var counties = raw.counties || []
    var d = raw.districts || {}, c = raw.campuses || {}
    var dn = d.name || [], cn = c.name || []
    var out = [], i
    for (i = 0; i < dn.length; i++) out.push(rec(dn[i], d.id[i], 'district', null, counties[d.county[i]]))
    for (i = 0; i < cn.length; i++) out.push(rec(cn[i], c.id[i], 'campus', dn[c.district[i]], counties[c.county[i]]))
    return out
  }

  function rec(name, id, level, district, county) {
    return {
      name: name, level: level, district: district || null, county: county || null,
      href: '/' + level + '/' + slugify(name) + '-' + id,
      key: normalize(name), dkey: normalize(district || '')
    }
  }

  function load(url) {
    if (!loaded[url]) {
      loaded[url] = fetch(url, { credentials: 'omit' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
        .then(decode)
        .catch(function (err) { loaded[url] = null; throw err })
    }
    return loaded[url]
  }

  // A token scores where it starts a word; it scores inside one only when it is
  // long enough for that to have been meant. Without the length floor, "lincoln
  // el" returned Lincoln MS in San Angelo ISD, because "el" sits inside
  // "Angelo" — a match no reader would call one.
  function tokenScore(hay, t, midWord) {
    if (!hay) return 0
    var i = hay.indexOf(t)
    if (i < 0) return 0
    if (i === 0) return hay.length === t.length ? 12 : 8
    if (hay.charAt(i - 1) === ' ') return 6
    return midWord && t.length >= 4 ? 2 : 0
  }

  // TEA writes "Austin HS", parents type "Austin High School". Without this the
  // school a reader is holding in her head is simply not findable, so a handful
  // of school-name abbreviations are treated as the same word, and the filler
  // words that only ever appear in the reader's version are allowed to miss.
  var ALT = {
    high: ['hs'], hs: ['high'], senior: ['sr'], sr: ['senior'],
    elementary: ['elem', 'el'], elem: ['elementary', 'el'], el: ['elem', 'elementary'],
    middle: ['ms'], ms: ['middle'], junior: ['jr'], jr: ['junior'],
    intermediate: ['int'], int: ['intermediate'], primary: ['pri'], academy: ['acad']
  }
  var OPTIONAL = { school: 1, schools: 1, district: 1, campus: 1 }

  function best(hay, t, midWord) {
    var s = tokenScore(hay, t, midWord)
    var alts = ALT[t]
    for (var i = 0; alts && i < alts.length; i++) {
      var a = tokenScore(hay, alts[i], midWord)
      if (a > s) s = a
    }
    return s
  }

  function score(r, q, tokens) {
    var total = 0
    var ownName = true
    for (var i = 0; i < tokens.length; i++) {
      var s = best(r.key, tokens[i], true)
      if (!s) {
        // The district name is a weaker haystack — it is context, not the thing
        // being named — so it matches on word starts only.
        var ds = best(r.dkey, tokens[i], false)
        if (!ds) {
          if (OPTIONAL[tokens[i]]) continue
          return 0
        }
        ownName = false
        s = ds / 4
      }
      total += s
    }
    if (!total) return 0
    // A school that carries every word itself beats one that borrowed half of
    // them from its district's name.
    if (ownName) total += 8
    if (r.key === q) total += 40
    else if (r.key.indexOf(q) === 0) total += 12
    else if (r.key.indexOf(q) > 0) total += 4
    if (r.level === 'district') total += 1
    return total
  }

  function rank(list, raw) {
    var q = normalize(raw)
    if (q.length < MIN) return null
    var tokens = q.split(' ')
    var hits = []
    for (var i = 0; i < list.length; i++) {
      var s = score(list[i], q, tokens)
      if (s > 0) hits.push([s, list[i]])
    }
    hits.sort(function (a, b) { return b[0] - a[0] || a[1].name.localeCompare(b[1].name) })
    return { total: hits.length, rows: hits.slice(0, SHOW).map(function (h) { return h[1] }) }
  }

  function meta(r) {
    var bits = [r.level === 'campus' ? 'Campus' : 'District']
    if (r.level === 'campus' && r.district) bits.push(r.district)
    if (r.county) bits.push(r.county.replace(/ County$/i, '') + ' County')
    return bits.join(' \\u00b7 ')
  }

  function init(form) {
    if (form.dataset.searchReady) return
    form.dataset.searchReady = '1'

    var input = form.querySelector('.sitesearch-input')
    var panel = form.querySelector('.sitesearch-panel')
    var list = form.querySelector('.sitesearch-results')
    var more = form.querySelector('.sitesearch-more')
    var status = form.querySelector('[data-search-status]')
    var url = form.getAttribute('data-search-index')
    if (!input || !panel || !list || !url) return

    var rows = null
    var options = []
    var cursor = -1

    input.setAttribute('role', 'combobox')
    input.setAttribute('aria-expanded', 'false')
    input.setAttribute('aria-autocomplete', 'list')
    input.setAttribute('aria-controls', list.id)
    list.setAttribute('role', 'listbox')
    list.setAttribute('aria-label', 'Search results')

    function say(msg) { if (status) status.textContent = msg }

    function close() {
      panel.hidden = true
      list.textContent = ''
      more.hidden = true
      options = []
      cursor = -1
      input.setAttribute('aria-expanded', 'false')
      input.removeAttribute('aria-activedescendant')
    }

    function select(i) {
      cursor = i
      var nodes = list.children
      for (var k = 0; k < nodes.length; k++) nodes[k].setAttribute('aria-selected', String(k === cursor))
      if (cursor < 0) { input.removeAttribute('aria-activedescendant'); return }
      input.setAttribute('aria-activedescendant', nodes[cursor].id)
      nodes[cursor].scrollIntoView({ block: 'nearest' })
    }

    function show(result, raw) {
      options = result.rows
      list.textContent = ''
      for (var i = 0; i < result.rows.length; i++) {
        var r = result.rows[i]
        var li = document.createElement('li')
        li.id = input.id + '-opt-' + i
        li.setAttribute('role', 'option')
        li.setAttribute('aria-selected', 'false')
        li.dataset.href = r.href
        var name = document.createElement('span')
        name.className = 'sitesearch-name'
        name.textContent = r.name
        var sub = document.createElement('span')
        sub.className = 'sitesearch-meta'
        sub.textContent = meta(r)
        li.appendChild(name)
        li.appendChild(sub)
        list.appendChild(li)
      }
      if (!result.rows.length) {
        panel.hidden = true
        input.setAttribute('aria-expanded', 'false')
        say('Nothing matches \\u201c' + raw + '\\u201d. Try fewer words, or browse the A to Z index.')
        return
      }
      panel.hidden = false
      input.setAttribute('aria-expanded', 'true')
      more.hidden = result.total <= result.rows.length
      more.textContent = result.total > result.rows.length
        ? 'Showing ' + result.rows.length + ' of ' + result.total + ' matches. Keep typing to narrow them.'
        : ''
      select(0)
      say(result.total + (result.total === 1 ? ' match' : ' matches') + ' for \\u201c' + raw +
          '\\u201d. Use the up and down arrow keys to choose one, then press Enter.')
    }

    function run() {
      var raw = input.value
      if (normalize(raw).length < MIN) { close(); return }
      load(url).then(function (data) {
        rows = data
        if (input.value !== raw) return
        var result = rank(rows, raw)
        if (result) show(result, raw.trim())
      }).catch(function () {
        say('The school list could not be loaded. Press Enter to browse the full index instead.')
      })
    }

    input.addEventListener('input', run)
    input.addEventListener('focus', function () { if (!rows) load(url).then(function (d) { rows = d }).catch(function () {}) })

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { close(); return }
      if (panel.hidden || !options.length) return
      if (e.key === 'ArrowDown') { e.preventDefault(); select((cursor + 1) % options.length) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); select((cursor - 1 + options.length) % options.length) }
      else if (e.key === 'Home') { e.preventDefault(); select(0) }
      else if (e.key === 'End') { e.preventDefault(); select(options.length - 1) }
      else if (e.key === 'Enter' && cursor >= 0) { e.preventDefault(); go(options[cursor]) }
      else if (e.key === 'Tab') close()
    })

    function go(r) { if (r) window.location.assign(r.href) }

    // mousedown, not click: blur must not close the panel before the choice lands.
    list.addEventListener('mousedown', function (e) {
      var li = e.target.closest('li[data-href]')
      if (!li) return
      e.preventDefault()
      window.location.assign(li.dataset.href)
    })

    form.addEventListener('submit', function (e) {
      if (cursor >= 0 && options[cursor]) { e.preventDefault(); go(options[cursor]) }
      // otherwise the GET runs and /search takes over, which is the point.
    })

    document.addEventListener('click', function (e) { if (!form.contains(e.target)) close() })

    // /search?q=... is a real search for anyone with this script; without it the
    // same URL is still the browsable index, which is why the form targets it.
    if (!input.value && /(^|[?&])q=/.test(window.location.search)) {
      var q = new URLSearchParams(window.location.search).get('q')
      if (q) { input.value = q; run() }
    }
  }

  function boot() {
    var forms = document.querySelectorAll('form[data-search]')
    for (var i = 0; i < forms.length; i++) init(forms[i])
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()`
}
