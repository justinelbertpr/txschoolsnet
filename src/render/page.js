import { existsSync, readFileSync } from 'node:fs'

import { cohortSwitch, esc, grade, shell, SITE_ORIGIN } from './shell.js'
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

/** The cohort switch, moved out of the hero. Same markup, new home. */
const railCompare = (vm) =>
  !vm.cohorts?.length
    ? ''
    : `  <div class="rail-block rail-compare">
    <h2 class="rail-title">Compare against</h2>
    ${cohortSwitch(vm)}
  </div>`

/**
 * The district pinner. The list of districts to search is NOT inlined: it is the
 * dashboard payload, ~230 KB gzipped, and putting it on 10,230 pages would cost
 * more than every page's own content put together. The block names the file and
 * the client fetches it the first time someone types.
 *
 * Rendered only where there is a chart to pin a line onto, and only where the
 * payload's name is known — an input that can search nothing is worse than no
 * input.
 */
const railPins = (payload) =>
  !payload
    ? ''
    : `  <div class="rail-block rail-pins">
    <h2 class="rail-title">Pin districts</h2>
    <p class="rail-hint">Add a district to the chart.</p>
    <input class="pin-search" type="search" placeholder="Search districts" aria-label="Search districts to pin" autocomplete="off">
    <ul class="pin-results" hidden></ul>
    <ul class="pin-list" aria-label="Pinned districts"></ul>
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

/** Everything in the left rail, in reading order. */
export function railFor(vm, index, { payload = null } = {}) {
  const hasChart = index.some((s) => s.id === 'trajectory')
  return [railSections(index), railCompare(vm), railPins(hasChart ? payload : null)]
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

/* -------------------------------------------------------------- the page --- */

/** Compose the shell with whatever sections have data. Nothing else decides layout. */
export function renderEntity(vm, { payload = payloadPath() } = {}) {
  const latest = vm.history?.[0]
  const kind = vm.level === 'district' ? 'district' : 'school'

  const crumbs = [
    { href: '/', label: 'Texas schools' },
    { href: `/region/${vm.regionId}`, label: vm.regionName },
    { href: `/county/${vm.countySlug}`, label: `${vm.county} County` },
    vm.level === 'campus' ? { href: `/district/${vm.districtSlug}`, label: vm.districtName } : null,
  ].filter(Boolean)
  crumbs.at(-1).current = vm.name

  const compare =
    vm.peerAvg != null && latest?.score != null
      ? ` — ${latest.score > vm.peerAvg ? 'above' : 'below'} ${kind === 'district' ? 'districts' : 'schools'} serving similar students`
      : ''

  // Sections first, then the rail that indexes them: the index cannot be built
  // before the thing it indexes exists.
  const sections = SECTIONS.map((s) => s(vm))
  const index = sectionIndex(sections)

  return shell({
    title: `${vm.name} — ratings, student outcomes and spending`,
    description:
      `${vm.name}: rated ${latest?.rating ?? 'not rated'}${latest?.score != null ? ` (${latest.score})` : ''} for ${latest?.year ?? ''}${compare}. ` +
      `${vm.history?.length ?? 0} ${vm.history?.length === 1 ? 'year' : 'years'} of ratings, domain scores, STAAR results, demographics and per-student spending compared with peer ${kind === 'district' ? 'districts' : 'schools'}.`,
    canonical: `${SITE_ORIGIN}/${vm.level}/${vm.slug}`,
    crumbs,
    sections,
    rail: railFor(vm, index, { payload }),
    sticky: stickyFor(vm),
  })
}
