import { existsSync, readFileSync } from 'node:fs'

import { cohortSwitch, esc, grade, num, shell, SITE_ORIGIN } from './shell.js'
import { SECTIONS } from './sections.js'

/* -------------------------------------------------------------- the index -- */

/**
 * The rail's section index, derived from the sections that actually rendered.
 *
 * A hardcoded list would be wrong on most pages: a section returns null when TEA
 * published nothing for it, so a campus with no finance file and no campus list
 * would carry rail links to #spending and #campuses — anchors that scroll
 * nowhere and a scroll-spy that never lights them. So the sections are rendered
 * first and the index read back off the markup they produced.
 *
 * Each entry's label is the section's <h2>, or the data-rail-label it declares
 * where it has no <h2> (the hero, whose heading is the entity name). Both are
 * lifted out of already-escaped HTML and put straight back into HTML, so they
 * are not escaped a second time — that would publish "Who this district serves"
 * with a literal &amp; in it the day a section heading contains an ampersand.
 */
export function sectionIndex(rendered) {
  const attr = (attrs, name) => attrs.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null

  return (rendered ?? [])
    .filter(Boolean)
    .map((html) => {
      const attrs = html.match(/<section\b([^>]*)>/)?.[1] ?? ''
      const id = attr(attrs, 'id')
      if (!id) return null
      const label = attr(attrs, 'data-rail-label') ?? html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)?.[1]?.trim()
      return label ? { id, label } : null
    })
    .filter(Boolean)
}

/* --------------------------------------------------------- the rail blocks -- */

const railSections = (index) =>
  !index.length
    ? ''
    : `  <nav class="rail-block rail-sections" aria-label="On this page">
    <h2 class="rail-title">On this page</h2>
    <ol class="rail-index">
${index.map((s) => `      <li><a class="rail-link" href="#${esc(s.id)}" data-spy="${esc(s.id)}">${s.label}</a></li>`).join('\n')}
    </ol>
  </nav>`

/**
 * Mobile-only section jump. The rail carries the same index, but below
 * 1024px it prints AFTER every section (site/style.css, "the rail unstacks
 * and prints after the article") — correct for the rail as a whole, since
 * most of it (compare, pinner) only makes sense once a reader has seen the
 * chart it acts on, but wrong for the index specifically: a reader who wants
 * "Spending" on a page ten screens tall has to scroll past all ten screens
 * to find the one list of links that would have taken them straight there.
 *
 * This is that same index, printed a second time, immediately after the
 * hero, in a <details> so it costs a phone screen nothing until opened.
 * `hidden` at 1024px and up, where the rail's own copy is already on
 * screen — never both. A native <details>, not a JS-built one: exactly the
 * markup site/style.css's own "RAIL, STICKY BAR, PINNER" comment asked for.
 */
const jumpSheet = (index) =>
  index.length < 2
    ? ''
    : `<details class="rail-sheet">
  <summary>Jump to a section</summary>
  <ol class="rail-index">
${index.map((s) => `    <li><a class="rail-link" href="#${esc(s.id)}">${s.label}</a></li>`).join('\n')}
  </ol>
</details>`

/**
 * The rail follows the article below 1024px, which once put the page-wide
 * comparison control tens of screens after the figures it changes. This second
 * set of buttons sits immediately after the hero on narrow layouts. It carries
 * no duplicate JSON; the rail remains the one data source, and site/app.js
 * already synchronises every .chip-cohort with the same data-cohort key.
 */
const mobileCompare = (vm) =>
  !vm.cohorts?.length
    ? ''
    : `<section class="mobile-compare" aria-labelledby="mobile-compare-title">
  <div>
    <p class="eyebrow">Put the numbers in context</p>
    <h2 id="mobile-compare-title">Compare with</h2>
  </div>
  <div class="mobile-cohort-scroll" role="group" aria-label="Compare every figure against">
    ${vm.cohorts.map((c, i) => `<button type="button" class="chip chip-cohort" data-cohort="${esc(c.key)}" aria-pressed="${i === 0}"${c.note ? ` title="${esc(c.note)}"` : ''}>${esc(c.label)}<span class="chip-n"><span class="sr-only"> cohort members: </span>${num(c.n)}</span></button>`).join('\n    ')}
  </div>
</section>`

/** The cohort switch, moved out of the hero. Same markup, new home. */
const railCompare = (vm) =>
  !vm.cohorts?.length
    ? ''
    : `  <div class="rail-block rail-compare">
    <h2 class="rail-title">Compare against</h2>
    ${cohortSwitch(vm)}
  </div>`

/**
 * The entity pinner. The list of schools and districts to search is NOT
 * inlined: it is the dashboard payload, ~230 KB gzipped, and putting it on
 * 10,230 pages would cost more than every page's own content put together.
 * The block names the file and the client fetches it the first time someone
 * types.
 *
 * Both levels are searchable from either kind of page — a campus and a
 * district both publish the same 0-100 accountability score, so comparing an
 * elementary school against another elementary school from a district page is
 * a real use of this box, not a mistake. The wording below says so already;
 * site/app.js used to have to correct it at runtime because the template said
 * "district" while the payload it had just downloaded held all 9,031
 * campuses too, and it still carries that correction as a guard for any
 * caller that regresses to the old wording — but it detects a template that
 * already mentions schools and leaves it alone, which is what this one does.
 *
 * Rendered only where there is a chart to pin a line onto, and only where the
 * payload's name is known — an input that can search nothing is worse than no
 * input.
 */
const railPins = (payload) =>
  !payload
    ? ''
    : `  <div class="rail-block rail-pins">
    <h2 class="rail-title">Pin to the chart</h2>
    <p class="rail-hint">Add up to five schools or districts to the trajectory chart.</p>
    <input class="pin-search" type="search" placeholder="Search schools and districts" aria-label="Search schools and districts to add to the chart" autocomplete="off">
    <ul class="pin-results" hidden></ul>
    <ul class="pin-list" aria-label="Pinned on the chart"></ul>
    <script type="application/json" data-pin-source>${JSON.stringify({ payload }).replace(/</g, '\\u003c')}</script>
  </div>`

/**
 * The payload is content-hashed, so its name is only knowable at build time.
 * `npm run export` writes it to build/payload-name.txt and src/prerender.js
 * reads it from there to link it on /download; this reads the same file rather
 * than inventing a second source of truth. It is read once per process, not once
 * per page — a prerender shard renders ~1,100 pages.
 *
 * renderEntity also takes `payload` as an option, so src/prerender.js can pass
 * the name it has already read and this file never touches the disk. That is the
 * intended end state; the default keeps the renderer usable on its own
 * (scripts/prototype.mjs, the tests) without prerender.js changing first.
 */
let cachedPayload
export function payloadPath() {
  if (cachedPayload === undefined) {
    const name = existsSync('build/payload-name.txt')
      ? readFileSync('build/payload-name.txt', 'utf8').trim()
      : ''
    cachedPayload = name ? `/data/${name}` : null
  }
  return cachedPayload
}

/** Everything in the left rail, in reading order.
 *
 * Compare leads, ahead of the section index. "How does this compare" is the
 * second question a reader asks, right after the score itself (the first is
 * answered on the page, before the rail is ever reached) — it used to sit
 * under the full section index, which on a long entity page runs 8-12 links
 * deep and buried the one control most readers actually want under a wall
 * of anchors. */
export function railFor(vm, index, { payload = null } = {}) {
  const hasChart = index.some((s) => s.id === 'trajectory')
  return [railCompare(vm), railSections(index), railPins(hasChart ? payload : null)]
    .filter(Boolean)
    .join('\n')
}

/**
 * The sticky header, which the client reveals once the hero has scrolled past.
 * It repeats what the hero already said — name, grade, score, active comparison
 * — so it carries no information that would be lost with JavaScript off. The
 * cohort name is the server-rendered default; the client re-labels
 * [data-sb-cohort] when the reader switches cohorts.
 */
export function stickyFor(vm) {
  const latest = vm.history?.[0]
  const cohort = vm.cohorts?.[0]
  return [
    `<span class="sb-name">${esc(vm.name)}</span>`,
    `<span class="sb-grade">${grade(latest?.rating, latest?.score)}</span>`,
    cohort ? `<span class="sb-cohort">vs <span data-sb-cohort>${esc(cohort.label)}</span></span>` : '',
  ]
    .filter(Boolean)
    .join('')
}

/* ------------------------------------------------------- the meta sentence -- */

/**
 * The one sentence that represents this page where the page itself is not: a
 * search result, a link preview, a message thread. It is read by someone who has
 * not arrived yet, so it has to stand alone.
 *
 * It carried the same defects the hero verdict did. "rated not rated", wherever
 * TEA declined to rate an entity. A score with no scale — 85 out of what? A
 * dangling "for " with no year when an entity had no history at all. And a peer
 * comparison with no denominator: "above districts serving similar students"
 * begs the question above how many, which is the boast this site exists not to
 * make.
 *
 * Four branches, longest first: rated, scored but unrated, no score, no history.
 * Every one names the entity first, and every one ends by saying the site is
 * unofficial, because a snippet is exactly where a reader could mistake it for
 * TEA's own.
 */
export function metaDescription(vm) {
  const latest = vm.history?.[0]
  const units = vm.level === 'district' ? 'districts' : 'schools'
  const rated = latest?.rating && latest.rating !== 'Not Rated'

  const head =
    latest?.score != null && rated
      ? `${vm.name} is rated ${latest.rating} by TEA — ${latest.score} out of 100 for ${latest.year}`
      : latest?.score != null
        ? `${vm.name} scored ${latest.score} out of 100 for ${latest.year}`
        : latest?.year
          ? `${vm.name}: TEA issued no overall rating for ${latest.year}`
          : `${vm.name}: Texas school ratings, student outcomes and spending`

  // Said after the score rather than instead of it: TEA published the number and
  // withheld the letter, and both halves of that are the news.
  const withheld = latest?.score != null && !rated ? ' TEA issued no overall rating.' : ''

  // The peer average carries its n or it does not appear. A one-entity band is
  // the entity compared with itself, which is why peerN must exceed one. Half a
  // point is "level with": a tenth of a point above an average is not "above" it.
  const compare =
    latest?.score != null && vm.peerAvg != null && vm.peerN > 1
      ? `, ${
          Math.abs(latest.score - vm.peerAvg) < 0.5 ? 'level with' : latest.score > vm.peerAvg ? 'above' : 'below'
        } the average of the ${num(vm.peerN)} ${units} serving a similar share of economically disadvantaged students`
      : ''

  // The abbreviation above is expanded here, where it also does the disclaimer's
  // work: a snippet is exactly where a reader could mistake this for TEA's site.
  const n = vm.history?.length ?? 0
  const tail = `${
    n ? ` ${n} ${n === 1 ? 'year' : 'years'} of ratings, domain scores, STAAR and spending.` : ''
  } Unofficial — not the Texas Education Agency's own site.`

  return `${head}${compare}.${withheld}${tail}`
}

/* -------------------------------------------------------------- the page --- */

/** Compose the shell with whatever sections have data. Nothing else decides layout. */
export function renderEntity(vm, { payload = payloadPath() } = {}) {
  const crumbs = [
    { href: '/', label: 'Texas schools' },
    { href: `/region/${vm.regionId}`, label: vm.regionName },
    { href: `/county/${vm.countySlug}`, label: `${vm.county} County` },
    vm.level === 'campus' ? { href: `/district/${vm.districtSlug}`, label: vm.districtName } : null,
  ].filter(Boolean)
  crumbs.at(-1).current = vm.name

  // Sections first, then the rail that indexes them: the index cannot be built
  // before the thing it indexes exists.
  const sections = SECTIONS.map((s) => s(vm))
  const index = sectionIndex(sections)
  // The mobile jump sheet is spliced in AFTER the index is built from the
  // real sections, and is not itself a <section id="…">, so it can never
  // end up indexing itself.
  const sectionsWithJump = [sections[0], mobileCompare(vm), jumpSheet(index), ...sections.slice(1)]

  return shell({
    title: `${vm.name} — ratings, student outcomes and spending`,
    description: metaDescription(vm),
    canonical: `${SITE_ORIGIN}/${vm.level}/${vm.slug}`,
    crumbs,
    sections: sectionsWithJump,
    rail: railFor(vm, index, { payload }),
    sticky: stickyFor(vm),
  })
}
