// Every section is (vm) => html | null. The shell composes whatever returns
// content, so a district with no finance data, or a campus TEA declined to rate,
// needs no special-case anywhere — the section simply returns null and vanishes.
//
// Order here IS the page order. Adding a section is one function plus one entry
// in SECTIONS at the bottom.

import { cmp, esc, fmtDelta, grade, legend, navList, num, ordinal, pct, section, statGrid, table, usd } from './shell.js'
import { trajectoryChart, trajectoryDomain, scoreBars, stackedShare, comparisonChart, groupedBars, cmpDomain } from './charts.js'
import { RACE, EXPERIENCE, STAAR_LEVELS, GRADUATION, COMPLETION, CCMR } from './labels.js'
import { closestCounted, countedDomains, isContextMetric } from './metrics.js'
import { publicMetric } from './public-comparisons.js'
// A page size and a URL rule — no renderer, so importing them does not pull
// this file into rankings-page.js's own layout choices. Together they are what
// turns "this entity is 6,000th" into the one board page that actually lists
// its row: see rankedBoard below.
import { PAGE_ROWS, boardPageHref } from './rankings-page.js'

/* ------------------------------------------------------------------ words -- */

// Counts reach the page as prose, so the noun has to agree with the number. One
// year is a year, one student is a student. 179 pages read "1 years of ratings"
// and 61 read "1 students" before this existed.
const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`

// The reader-facing noun for the two levels. TEA calls a school a "campus";
// a parent calls it a school, and this noun is only ever used in prose a
// parent reads (the verdict says the same thing — see verdictSummary below).
// TEA's own word stays correct where it names TEA's own methodology, on /about.
const unit = (vm) =>
  vm.level === 'district'
    ? vm.isCharter
      ? 'charter school system'
      : 'district'
    : 'school'

// Comparisons never cross the traditional/charter boundary. Their nouns must
// say so just as explicitly as their arithmetic does: a charter-system average
// is not an average of every Texas district, and a charter-campus placement is
// not a placement among every Texas school.
const comparisonUnit = (vm) =>
  vm.isCharter
    ? vm.level === 'district'
      ? 'charter school system'
      : 'charter campus'
    : vm.level === 'district'
      ? 'district'
      : 'school'

const comparisonUnits = (vm) =>
  vm.isCharter
    ? vm.level === 'district'
      ? 'charter school systems'
      : 'charter campuses'
    : vm.level === 'district'
      ? 'districts'
      : 'schools'

const stateAverageKind = (vm) =>
  vm.isCharter ? 'Texas charter average for' : 'statewide cohort average across'

const stateAverageTarget = (vm) =>
  vm.isCharter ? comparisonUnits(vm) : 'Texas'

/**
 * Turn TEA's website field into a link without guessing at anything beyond a
 * missing scheme. Most rows are bare hosts, while a handful already carry an
 * https:// prefix; blindly prepending one breaks those links. The field is
 * external data, so only ordinary web URLs survive. A malformed value or a
 * non-web scheme produces no link rather than putting an unsafe href on every
 * generated entity page.
 */
export const officialWebsiteHref = (value) => {
  if (typeof value !== 'string' || !value.trim()) return null
  const raw = value.trim()
  const candidate = raw.startsWith('//')
    ? `https:${raw}`
    : /^[a-z][a-z\d+.-]*:/i.test(raw)
      ? raw
      : `https://${raw}`

  try {
    const url = new URL(candidate)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null
    return url.href
  } catch {
    return null
  }
}

// One number, one noun. "up 1 points" is the same defect as "1 years".
const points = (n) => `${num(n)} ${n === 1 ? 'point' : 'points'}`

// Half a point is the threshold for "level with" everywhere on this site, so it
// is one function rather than three copies of the same conditional.
const versus = (mine, avg) => (Math.abs(mine - avg) < 0.5 ? 'level with' : mine > avg ? 'above' : 'below')

/* --------------------------------------------------- links to the rankings -- */

/**
 * A rank printed on this page is a claim about a population, and until now the
 * reader had no way to see that population. "Ranks 400th of 1,184 Texas
 * districts" named 1,183 other districts and linked none of them; a reporter who
 * wanted to know who was 1st had to download ratings.csv and sort it. Every rank
 * this file prints now carries a link to the list it came out of.
 *
 * ------------------------------------------------------------- WHY A LOOKUP
 *
 * These sections build no ranking URLs. `vm.rankingLinks` is a map the build step
 * hands in (src/prerender.js), keyed by cohort, then by metric key, then by
 * end ('top' | 'bottom'), holding the { href, title, pages } of a ranking board
 * that WAS ACTUALLY WRITTEN. Consequences, and all three are the point:
 *
 *   A link only exists where the page exists. An entity page can never point at
 *   a ranking that was not built — no scheme to keep in step with the renderer,
 *   no 404 when a board is dropped, and a build with no rankings at all renders
 *   exactly the markup it rendered before, byte for byte.
 *
 *   The peer band can never be linked. `vm.rankingLinks` carries state, region
 *   and county only, because those are the cohorts a static page can exist for.
 *   The peer band is defined relative to THIS entity's economically
 *   disadvantaged share — "districts within 10 points of Cayuga ISD" is a
 *   different population for every one of 1,199 districts, so there is no page
 *   to link and a standout in that cohort is left as plain text rather than
 *   linked to a statewide list it was not measured against.
 *
 *   A link only exists where the BOARD actually lists this entity, and it must
 *   point at the PAGE that lists it. A long ordering is split across pages of
 *   PAGE_ROWS rows (rankings-page.js:boardPages) rather than cut off at one,
 *   so every ranked entity is now on some page of every end that was built —
 *   but the statewide campus boards run to sixteen of those pages, and a
 *   link to page 1 for a campus ranked 6,000th lands on a table that does not
 *   contain its row. That is the same defect this lookup was written to close
 *   when the failure was truncation instead of paging: it was verified on ~82%
 *   of campus pages then, and linking page 1 unconditionally would reproduce
 *   it on exactly the same rows. rankedBoard below computes the entity's
 *   position in the end it is linking and returns that end's page for it.
 *
 *   Since rankings-page.js's Rule 3, ordinarily only ONE end of a metric is
 *   ever built at all — the flattering one, from `goodEnd`. So the no-link
 *   case has one cause left: an entity whose placement only exists on the
 *   unpublished, worse-performing end, which was never written and so was
 *   never in `vm.rankingLinks` to begin with. A district with the state's
 *   worst chronic-absenteeism figure simply prints no ranking link on its own
 *   page — not a link to a "highest chronic absenteeism" leaderboard — which
 *   is the intended effect of Rule 3, not a bug in this lookup.
 */
const finite = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * Where this entity's row sits in each end of an ordering: 1-based position in
 * 'top' (sorted by VALUE, highest first) and in 'bottom' (by value, lowest
 * first). Returns null when the rank or population is not usable.
 *
 * `rank` here is the GOODNESS rank metrics.js:rankAll computes — 1st is
 * always the best result, whichever direction "best" runs. The two published
 * boards are not goodness-ordered, though (rankings-page.js's own rule —
 * "highest"/"lowest" name the number, never the result, which is why chronic
 * absence has a "highest" page that is its worst end). For a higher-is-better
 * metric the two agree, so goodness rank IS value-descending position. For a
 * lower-is-better one (chronic absence, dropout) the best row — rank 1 — has
 * the SMALLEST value, so it sits at the very end of the 'top' ordering and at
 * position 1 of the 'bottom' one; the formulas below swap accordingly rather
 * than assuming every metric reads the way score does.
 *
 * Both ends now contain every ranked row — paging replaced truncation — so
 * this returns positions rather than picking a winner. Which end is linked is
 * decided by which end was BUILT, which only rankedBoard can see.
 */
export const rankingPositions = (rank, of, lowerIsBetter = false) => {
  if (!finite(rank) || !finite(of) || of <= 0 || rank < 1 || rank > of) return null
  return {
    top: lowerIsBetter ? of - rank + 1 : rank,
    bottom: lowerIsBetter ? rank : of - rank + 1,
  }
}

/**
 * Which page of a board holds the row at 1-based position `pos`, clamped to the
 * page count the build actually wrote for that board. The clamp is the whole
 * point: `pos` comes from the entity's own cohort population and `pages` from
 * the board's, and if those two ever disagree this returns a page that exists
 * rather than a 404 in the middle of an entity page.
 */
export const boardPageOf = (pos, pages) => {
  const wanted = Math.max(1, Math.ceil((finite(pos) && pos > 0 ? pos : 1) / PAGE_ROWS))
  return finite(pages) && pages > 0 ? Math.min(wanted, pages) : wanted
}

/**
 * The one board — of at most two that could exist for a metric+cohort, and
 * ordinarily just one since Rule 3 (rankings-page.js) — whose printed rows
 * actually contain this entity, or null when none does — see the note above.
 * `{ href, title, end, page }`, where `title` is the board's own heading
 * ("Texas school districts with the highest overall score"), read off the
 * index rather than composed here, so a caller can label a link with a claim
 * the linked page actually makes rather than inventing its own.
 *
 * `href` is the page carrying THIS entity's row, not the board's front page —
 * see the note above on why that distinction is the reason this function
 * exists. `page` is that page's number, for a caller that wants to say it.
 */
export const rankedBoard = (vm, metric, cohort, rank, of, lowerIsBetter = false) => {
  const pos = rankingPositions(rank, of, lowerIsBetter)
  if (!pos) return null
  const ends = vm?.rankingLinks?.[cohort]?.[metric]
  // Rule 3 means at most one of these is ever populated; 'top' first is the
  // historical preference for the vanishingly rare board set that has both.
  const end = ends?.top?.href ? 'top' : ends?.bottom?.href ? 'bottom' : null
  const board = end && ends[end]
  if (!board || typeof board.href !== 'string' || !board.href) return null
  const page = boardPageOf(pos[end], board.pages)
  return { ...board, end, page, href: boardPageHref(board.href, page) }
}

/** The href alone, for a caller that only wants to know whether to link. */
export const rankingHref = (vm, metric, cohort, rank, of, lowerIsBetter = false) =>
  rankedBoard(vm, metric, cohort, rank, of, lowerIsBetter)?.href ?? null

/** Wraps text in a link when there is one, and returns it untouched when not. */
const linked = (href, html, label = null) =>
  href ? `<a href="${esc(href)}"${label ? ` aria-label="${esc(label)}"` : ''}>${html}</a>` : html

/* ------------------------------------------------------- context, not good -- */

/**
 * The comparison chip for a metric that has no good direction.
 *
 * shell.js:cmp paints a delta green when it is "up" — and the share of a
 * school's students who are economically disadvantaged being 1.0 points above
 * its cohort is not up. It is not down either. Serving more disadvantaged
 * students, more English learners or more students in special education is the
 * fact the rest of the page has to be read against, not a result to congratulate
 * or commiserate. So the same delta is rendered without a direction: same
 * arithmetic, same denominator, same "vs similar" scope, a neutral class.
 *
 * `.cmp-neutral` needs a rule in site/style.css (a file this module does not
 * own): the same size and weight as .cmp-up/.cmp-down in the neutral ink used by
 * .cmp-level, so it reads as a measurement rather than a verdict.
 *
 * `data-neutral` is for site/app.js, which re-renders every .cmp when the reader
 * switches cohorts and currently reassigns className unconditionally — it must
 * keep cmp-neutral where the attribute is present, or a cohort switch will paint
 * the chip green again.
 */
const contextCmp = (vm, key, { fmt = 'pct' } = {}) => {
  const mine = vm.own?.[key]
  if (mine == null || !vm.cohorts?.length) return ''
  const active = vm.cohorts[0]
  const other = active.metrics[key]
  const attrs = `data-metric="${esc(key)}" data-fmt="${esc(fmt)}" data-neutral="1"`
  if (other == null) {
    if (!vm.cohorts.some((cohort) => cohort?.metrics?.[key] != null)) return ''
    return `<span class="cmp cmp-neutral" ${attrs} hidden style="display:none"><span class="cmp-vs"></span></span>`
  }
  return `<span class="cmp cmp-neutral" data-metric="${esc(key)}" data-fmt="${esc(fmt)}" data-neutral="1">${fmtDelta(
    mine - other,
    fmt
  )} <span class="cmp-vs">vs ${esc(active.short)}</span></span>`
}

/** Format one server-published cohort average for a supplemental data section. */
const comparisonValue = (value, format = 'decimal') => {
  if (!finite(value)) return '—'
  if (format === 'usd') return usd(value)
  if (format === 'pct') return pct(value)
  if (format === 'count') return num(value, Number.isInteger(value) ? 0 : 1)
  if (format === 'rate') return num(value, 2)
  if (format === 'signed-count') {
    const rounded = Math.round(value)
    return `${rounded > 0 ? '+' : rounded < 0 ? '−' : '±'}${num(Math.abs(rounded))}`
  }
  return num(value, 1)
}

/** A grammatical noun phrase for “average for …” comparison copy. */
const comparisonAverageTarget = (vm, cohort) => {
  const units = comparisonUnits(vm)
  if (cohort?.key === 'peer') return `${units} with a similar economic-disadvantage rate`
  if (cohort?.key === 'size') return `similarly sized ${units}`
  return cohort?.label ?? 'the selected group'
}

/**
 * A selected-cohort value with an explicit reporting denominator. The browser
 * updates these hooks from the same data-cohorts payload as the rating charts;
 * no supplemental section gets to keep a private/default benchmark.
 */
const comparisonReadout = (
  vm,
  key,
  {
    format = 'decimal',
    label = 'Selected comparison',
    neutral = true,
    invert = false,
    showDelta = true,
    entityDisplay = null,
  } = {}
) => {
  const active = vm.cohorts?.[0]
  const entityValue = vm.own?.[key]
  const value = active?.metrics?.[key]
  const reporting = active?.metricN?.[key]
  if (!active || !vm.cohorts.some((cohort) => finite(cohort?.metrics?.[key]))) return ''
  const available = finite(value)
  const delta = !available || !showDelta
    ? ''
    : neutral
      ? contextCmp(vm, key, { fmt: format === 'usd' ? 'usd' : format === 'pct' ? 'pct' : 'ratio' })
      : cmp(vm, key, {
          fmt: format === 'usd' ? 'usd' : format === 'pct' ? 'pct' : 'ratio',
          invert,
        })
  const statewide = active.key === 'state'
  const averageTarget = comparisonAverageTarget(vm, active)
  const reportingUnits = comparisonUnits(vm)
  const renderedEntityValue = entityDisplay ?? (finite(entityValue) ? comparisonValue(entityValue, format) : 'Not reported')
  return `<article class="comparison-readout" data-comparison-readout data-metric="${esc(key)}" data-format="${esc(format)}"${available ? '' : ' hidden style="display:none"'}>
    <h3 class="comparison-readout-label">${esc(label)}</h3>
    <dl class="comparison-readout-values">
      <div>
        <dt>This ${unit(vm)}</dt>
        <dd><strong data-entity-value>${esc(renderedEntityValue)}</strong></dd>
      </div>
      <div>
        <dt>Selected comparison</dt>
        <dd><strong data-compare-value>${available ? comparisonValue(value, format) : '—'}</strong></dd>
      </div>
    </dl>
    <p class="comparison-readout-meta"><span data-compare-kind>${statewide ? stateAverageKind(vm) : 'average for'}</span> <span data-compare-label>${statewide ? stateAverageTarget(vm) : esc(averageTarget)}</span>${finite(reporting) ? ` &middot; <span data-compare-n>${num(reporting)}</span> rated ${reportingUnits} reporting` : ''}</p>
    ${delta}
  </article>`
}

/**
 * Metric-specific coverage for an average already printed in an adjacent
 * table/stat. It deliberately uses the generic readout hook without a value
 * node: the browser will still replace its cohort name and reporting n, but it
 * cannot duplicate the average or turn a one-entity pin into an "average."
 */
const comparisonCoverage = (vm, key) => {
  const active = vm.cohorts?.[0]
  const value = active?.metrics?.[key]
  const reporting = active?.metricN?.[key]
  if (!active || !vm.cohorts.some((cohort) => finite(cohort?.metrics?.[key]))) return ''
  const available = finite(value)
  const statewide = active.key === 'state'
  const averageTarget = comparisonAverageTarget(vm, active)
  const reportingUnits = comparisonUnits(vm)
  return ` <small class="comparison-coverage" data-comparison-readout data-metric="${esc(key)}" data-format="pct"${available ? '' : ' hidden style="display:none"'}><span><span data-compare-kind>${statewide ? stateAverageKind(vm) : 'average for'}</span> <span data-compare-label>${statewide ? stateAverageTarget(vm) : esc(averageTarget)}</span>${finite(reporting) ? ` &middot; <span data-compare-n>${num(reporting)}</span> rated ${reportingUnits} reporting` : ''}</span></small>`
}

const comparisonCell = (vm, key, format = 'decimal') => {
  const active = vm.cohorts?.[0]
  const value = active?.metrics?.[key]
  return `<td class="num comparison-cell" data-comparison-cell data-metric="${esc(key)}" data-format="${esc(format)}">${
    finite(value) ? comparisonValue(value, format) : '<span class="na">—</span>'
  }</td>`
}

/** A full selected-cohort composition chart, precomputed for every cohort. */
const comparisonStackedShares = (vm, prefix, labels, heading) => {
  const groups = (vm.cohorts ?? []).map((cohort, cohortIndex) => {
    const rows = labels
      .map((label, i) => ({
        label,
        value: cohort.metrics?.[`${prefix}:${i}`],
        reporting: cohort.metricN?.[`${prefix}:${i}`],
      }))
      .filter((row) => finite(row.value) && row.value > 0)
    if (!rows.length) return ''
    const statewide = cohort.key === 'state'
    const groupUnits = `Texas ${comparisonUnits(vm)}`
    const averageTarget = comparisonAverageTarget(vm, cohort)
    const reportingCounts = [...new Set(rows.map((row) => row.reporting).filter(finite))].sort((a, b) => a - b)
    const reportingText = !reportingCounts.length
      ? 'Reporting count unavailable'
      : reportingCounts.length === 1
        ? `${num(reportingCounts[0])} reporting for every category shown`
        : `${num(reportingCounts[0])}&ndash;${num(reportingCounts.at(-1))} reporting, depending on category`
    return `<div class="comparison-composition" data-comparison-cohort="${esc(cohort.key)}"${cohortIndex ? ' hidden' : ''}>
      <p class="comparison-composition-title"><strong>${esc(statewide && vm.isCharter ? 'Texas charter average' : statewide ? 'Statewide average' : heading)}</strong> <span>${statewide ? `${reportingText} &middot; ${num(cohort.n)} ${groupUnits} in full cohort` : `For ${esc(averageTarget)} &middot; ${reportingText} &middot; ${num(cohort.n)} in full cohort`}</span></p>
      ${stackedShare(rows)}
      ${legend(rows.map((row, i) => ({ key: String(i % 7), label: `${row.label} ${num(row.value, 1)}%` })))}
    </div>`
  }).filter(Boolean)
  return groups.length
    ? `<div class="comparison-composition-groups">${groups.join('')}<p class="note na" data-comparison-pin-unavailable hidden style="display:none">A precomputed composition average is not available for <span data-comparison-pin-label>this pinned entity</span>. The pin's individual numeric comparisons elsewhere on the page still update.</p></div>`
    : ''
}

/* ---------------------------------------------------------------- verdict -- */

/**
 * The hero is a section like any other, so the rail's index has to be able to
 * name it. It is the one section with no <h2> — its heading is the <h1>, which
 * is the entity's name and would read as a strange first entry in a list titled
 * "On this page". So it declares the label it wants instead. src/render/page.js
 * reads data-rail-label where a section offers one and the <h2> otherwise; that
 * keeps the index derived from what rendered rather than from a list kept in
 * step by hand.
 */
export const HERO_ID = 'overview'
export const HERO_LABEL = 'Overview'

/**
 * The most-read sentence on the site, and the one four auditors stopped at.
 *
 * In the order a reader needs it: name the entity, say the grade in words, say
 * the score AND what it is out of, then put that score beside a group whose
 * size is stated. Then the trend, in a sentence that finishes.
 */
const scorePlacement = (vm, cohort) =>
  cohort?.placements?.score ?? vm.ranks?.find((row) => row.metric === 'score' && row.cohort === cohort?.key) ?? null

const comparisonPopulation = (vm, cohort, reporting = null) => {
  const units = comparisonUnits(vm)
  const n = finite(reporting) ? reporting : cohort?.n
  if (!cohort || !finite(n)) return cohort?.label ?? 'selected comparison'
  if (cohort.key === 'state') return `${num(n)} rated Texas ${units}`
  if (cohort.key === 'peer') return `${num(n)} rated ${units} serving a similar economic context`
  if (cohort.key === 'size') return `${num(n)} similarly sized rated ${units}`
  return `${num(n)} rated ${units} in ${esc(cohort.label)}`
}

const scoreContext = (vm, cohort) => {
  const mine = vm.own?.score ?? vm.history?.[0]?.score
  const average = cohort?.metrics?.score
  if (!finite(mine) || !finite(average)) return null
  const population = comparisonPopulation(vm, cohort, cohort.metricN?.score)
  return `The current score is ${versus(mine, average)} the <strong>${num(average, 1)}</strong> average for ${population}.`
}

function verdictSummary(vm, { reconcileRescore = true, cohort = vm.cohorts?.[0] ?? null } = {}) {
  const latest = vm.history?.[0]
  // Reader-facing nouns. TEA calls them campuses; a parent calls them schools,
  // and this is the sentence a parent reads.
  const units = comparisonUnits(vm)
  const one = comparisonUnit(vm)

  // No score means there is no verdict to give. Say who withheld it and what is
  // on the page instead, rather than opening with a blank.
  if (latest?.score == null) {
    return {
      summary:
        (latest?.year
          ? `TEA did not issue an overall rating for ${esc(vm.name)} for ${esc(latest.year)}.`
          : `TEA has not rated ${esc(vm.name)}.`) +
        ` Everything TEA did publish for this ${one} is below.`,
      rank: null,
    }
  }

  /* --- one: who it is, what grade, what score out of what, against whom --- */

  // A withheld letter grade is NOT restated here: the hero already carries the
  // `vm.notRated` paragraph saying TEA issued no rating, and saying it twice in
  // two adjacent paragraphs is how the old summary got to five sentences.
  const rated = latest.rating && latest.rating !== 'Not Rated'
  const head = rated
    ? `${esc(vm.name)} is rated <strong>${esc(latest.rating)}</strong> by TEA, scoring <strong>${latest.score} out of 100</strong> for ${esc(latest.year)}`
    : `${esc(vm.name)} scored <strong>${latest.score} out of 100</strong> for ${esc(latest.year)}`

  const average = cohort?.metrics?.score
  const peer = !cohort && vm.peerAvg != null && vm.peerN > 1
    ? `${versus(latest.score, vm.peerAvg)} the ${vm.peerAvg.toFixed(1)} average of the ${num(vm.peerN)} ${units} serving a similar share of economically disadvantaged students`
    : null
  const state = !cohort && vm.stateAvg != null
    ? `${versus(latest.score, vm.stateAvg)} the ${vm.isCharter ? 'Texas charter' : 'statewide'} average of ${vm.stateAvg.toFixed(1)}`
    : null
  const against = finite(average)
    ? ` — ${versus(latest.score, average)} the ${num(average, 1)} average for ${comparisonPopulation(
        vm,
        cohort,
        cohort.metricN?.score
      )}.`
    : peer && state
      ? ` — ${peer}, and ${state}.`
      : peer
        ? ` — ${peer}.`
        : state
          ? ` — ${state}.`
          : '.'

  /* --- two: the trend, with the 2023 rule change reconciled in the clause --- */

  const scored = vm.history.filter((h) => h.score != null)
  const earliest = scored.at(-1)
  let trend

  if (scored.length < 2) {
    trend = `TEA has published ${plural(scored.length, 'year')} of scores for this ${one}, so there is no trend to read yet.`
  } else {
    const d = latest.score - earliest.score
    const move =
      d === 0
        ? `is unchanged since ${esc(earliest.year)}`
        : `is <strong>${d > 0 ? 'up' : 'down'} ${points(Math.abs(d))}</strong> since ${esc(earliest.year)}`
    // The clause that stops the page contradicting its own footnote. It used to
    // say "up 9 points since 2021-22" while a note 200px below said the same
    // district scored 86 that year. Both were true; nothing joined them.
    const rescored =
      reconcileRescore && earliest.year === '2021-22' && vm.originalScore != null
        ? ` — both years scored under TEA's current rules, since TEA rewrote them in 2023; under the rules in force back then it scored <strong>${vm.originalScore}</strong>`
        : ''
    trend = `It ${move}${rescored}.`
  }

  /* --- the rank, which is a denominator claim rather than a verdict --- */

  // Both placements link to the list they came out of, where one was built —
  // specifically to the page of it holding this entity's own row (rankedBoard;
  // see the note above rankingPositions). The link text is the whole claim —
  // "400th of 1,184 Texas districts" — rather than a bare "see the ranking"
  // tacked on the end, so the destination is described by the thing the reader
  // is already looking at. The aria-label is the linked board's OWN heading,
  // read off the index rather than composed here — it used to say "Every Texas
  // school ranked by overall score", which was false while a board was a slice
  // of its population; a board's own title never claims more than it shows.
  // Built inside the branch, not above it: ordinal() has no answer for a null
  // rank and throws, and an entity TEA did not rate has no placement at all.
  const share = (n) => (n > 0 ? ` (tied with ${plural(n, 'other')})` : '')
  const placement = scorePlacement(vm, cohort)
  let rank = null
  if (placement && cohort) {
    const board = rankedBoard(vm, 'score', cohort.key, placement.rank, placement.of)
    rank = `Ranks ${linked(
      board?.href ?? null,
      `${ordinal(placement.rank)} of ${comparisonPopulation(vm, cohort, placement.of)}`,
      board?.title ?? null
    )}${share(placement.tied)}.`
  } else if (!cohort && vm.rank && vm.rankOf) {
    const stateBoard = rankedBoard(vm, 'score', 'state', vm.rank, vm.rankOf)
    const regionBoard = rankedBoard(vm, 'score', 'region', vm.regionRank, vm.regionRankOf)
    const stateClaim = linked(
      stateBoard?.href ?? null,
      `${ordinal(vm.rank)} of ${num(vm.rankOf)} Texas ${units}`,
      stateBoard?.title ?? null
    ) + share(vm.rankTied)
    const regionClaim = vm.regionRank && vm.regionRankOf
      ? `, and ${linked(
          regionBoard?.href ?? null,
          `${ordinal(vm.regionRank)} of ${num(vm.regionRankOf)} in ${esc(vm.regionName)}`,
          regionBoard?.title ?? null
        )}${share(vm.regionRankTied)}`
      : ''
    rank = `Ranks ${stateClaim}${regionClaim}.`
  }

  return { summary: `${head}${against} ${trend}`, rank }
}

export function verdict(vm) {
  const latest = vm.history[0]
  const kind = vm.isCharter
    ? vm.level === 'district'
      ? 'Charter school system'
      : 'Open-enrollment charter campus'
    : vm.level === 'district'
      ? 'Geographic public school district'
      : 'Traditional public school campus'
  const one = unit(vm)
  const scored = (vm.history ?? []).filter((h) => finite(h.score))
  const earliest = scored.at(-1)
  const change = latest && earliest && latest !== earliest ? latest.score - earliest.score : null
  const facts = [
    finite(latest?.score)
      ? ['Current score', `${latest.score}<small>/100</small>`, latest.year]
      : null,
    finite(change)
      ? ['Change', `${change > 0 ? '+' : change < 0 ? '−' : '±'}${Math.abs(change)}<small> pts</small>`, `since ${earliest.year}`]
      : null,
    // "Comparable districts: +13.0 pts" named the comparison but never the
    // measure or the basis, leaving the reader to infer both. The label now
    // says which number moved, and the note says it is an average of a stated
    // number of districts rather than some unnamed benchmark.
  ].filter(Boolean)

  if (!(vm.cohorts ?? []).length) {
    const peerGap = finite(latest?.score) && finite(vm.peerAvg) && vm.peerN > 1 ? latest.score - vm.peerAvg : null
    if (finite(peerGap)) {
      facts.push([
        `Score vs similar ${one}s`,
        `${peerGap > 0 ? '+' : peerGap < 0 ? '−' : '±'}${Math.abs(peerGap).toFixed(1)}<small> pts</small>`,
        `vs the average of ${num(vm.peerN)} with a similar economic-disadvantage rate`,
      ])
    }
    if (vm.regionRank && vm.regionRankOf) {
      facts.push(['Regional placement', `${num(vm.regionRank)}<small> of ${num(vm.regionRankOf)}</small>`, vm.regionName])
    } else if (vm.rank && vm.rankOf) {
      facts.push(['Texas placement', `${num(vm.rank)}<small> of ${num(vm.rankOf)}</small>`, `among rated ${one}s`])
    }
  }

  const comparisonFacts = (vm.cohorts ?? []).map((cohort, i) => {
    const average = cohort.metrics?.score
    const gap = finite(latest?.score) && finite(average) ? latest.score - average : null
    const placement = scorePlacement(vm, cohort)
    const hidden = i ? ' hidden' : ''
    const gapFact = !finite(gap)
      ? ''
      : `<div data-comparison-cohort="${esc(cohort.key)}"${hidden}><dt>Score vs ${esc(cohort.short ?? cohort.label)}</dt><dd><strong>${gap > 0 ? '+' : gap < 0 ? '−' : '±'}${Math.abs(gap).toFixed(1)}<small> pts</small></strong><span>vs ${num(average, 1)} average &middot; ${comparisonPopulation(vm, cohort, cohort.metricN?.score)}</span></dd></div>`
    const placeFact = !placement
      ? ''
      : `<div data-comparison-cohort="${esc(cohort.key)}"${hidden}><dt>${esc(cohort.key === 'state' ? vm.isCharter ? 'Texas charter placement' : 'Texas placement' : `${cohort.label} placement`)}</dt><dd><strong>${num(placement.rank)}<small> of ${num(placement.of)}</small></strong><span>${placement.tied > 0 ? `tied with ${plural(placement.tied, 'other')}` : `among reporting ${comparisonUnits(vm)}`}</span></dd></div>`
    return gapFact + placeFact
  }).join('')

  const factGrid = facts.length || comparisonFacts
    ? `<dl class="hero-facts">${facts.map(([label, value, note]) => `<div><dt>${esc(label)}</dt><dd><strong>${value}</strong><span>${esc(note)}</span></dd></div>`).join('')}${comparisonFacts}</dl>`
    : ''

  const alert =
    vm.multYear > 0
      ? `<p class="alert"><strong>${vm.multYear} consecutive ${vm.multYear === 1 ? 'year' : 'years'}</strong> rated unacceptable.${
          vm.multYear >= 3 ? ' At three or more years, Texas law provides for state intervention.' : ''
        }</p>`
      : ''

  // The compact summary below owns the historical-rescoring clarification.
  // Repeating the same old score inside the adjacent disclosure would publish
  // it three times once the trajectory footnote is counted.
  const detailGroups = (vm.cohorts ?? []).map((cohort, i) => {
    const result = verdictSummary(vm, { reconcileRescore: false, cohort })
    return `<div data-comparison-cohort="${esc(cohort.key)}"${i ? ' hidden' : ''}><p>${result.summary}</p>${result.rank ? `<p class="summary-rank">${result.rank}</p>` : ''}</div>`
  }).join('')
  const fallbackDetail = verdictSummary(vm, { reconcileRescore: false })
  const directionRead = !finite(change) ? null : change > 0 ? 'moving up' : change < 0 ? 'moving down' : 'flat'
  const direction = !directionRead
    ? null
    : earliest?.year === '2021-22' && finite(vm.originalScore)
      ? `Under TEA&rsquo;s current rules, the available rating history is ${directionRead}; under the rules in force back then it scored <strong>${vm.originalScore}</strong> in ${esc(earliest.year)}.`
      : `The available rating history is ${directionRead}.`
  const contexts = (vm.cohorts ?? []).map((cohort, i) => {
    const text = scoreContext(vm, cohort)
    return text ? `<span data-comparison-cohort="${esc(cohort.key)}"${i ? ' hidden' : ''}>${text}</span>` : ''
  }).join('')
  const legacyContext = !(vm.cohorts ?? []).length && finite(latest?.score) && finite(vm.peerAvg)
    ? Math.abs(latest.score - vm.peerAvg) < 0.5
      ? `The current score is level with comparable ${one}s in a similar economic context.`
      : `The current score is ${latest.score > vm.peerAvg ? 'above' : 'below'} comparable ${one}s in a similar economic context.`
    : null
  const plainSummary = latest?.score == null
    ? fallbackDetail.summary
    : [direction, contexts || legacyContext].filter(Boolean).join(' ') || 'Use the sections below to read the trend, score components and student outcomes.'
  const officialHref = officialWebsiteHref(vm.website)
  const officialLink = !officialHref
    ? ''
    : vm.level === 'district'
      ? `<p class="enroll"><a href="${esc(officialHref)}" rel="external nofollow"><span class="enroll-copy"><strong>Official ${
          vm.isCharter ? 'charter system' : 'district'
        } website</strong><span>Enrollment, registration and eligibility</span></span><span class="enroll-arrow" aria-hidden="true">&nearr;</span></a></p>`
      : `<p class="enroll enroll-school"><a href="${esc(officialHref)}" rel="external nofollow"><span class="enroll-copy"><strong>Official school website</strong><span>School information and family resources</span></span><span class="enroll-arrow" aria-hidden="true">&nearr;</span></a></p>`
  const positiveSignals = highlights(vm)
  const placeContext = vm.isOnline && vm.level === 'campus'
    ? vm.districtName
    : vm.isCharter
      ? vm.level === 'campus'
        ? [vm.districtName, vm.city].filter(Boolean).map(esc).join(' &middot; ')
        : vm.city
          ? `Administrative office: ${esc(vm.city)}`
          : ''
      : `${esc(vm.county)} County &middot; ${esc(vm.regionName)}`
  const place = [
    placeContext,
    vm.enrollment ? plural(vm.enrollment, 'student') : null,
  ].filter(Boolean).join(' &middot; ')

  return `<section class="hero hero-entity" id="${HERO_ID}" data-rail-label="${esc(HERO_LABEL)}">
  <div class="entity-intro">
    <p class="eyebrow">${kind}${vm.isOnline ? ' &middot; Online school' : ''}${vm.isAlt ? ' &middot; Alternative Education Accountability' : ''}</p>
    <h1>${esc(vm.name)}</h1>
    ${place ? `<p class="place">${place}</p>` : ''}
    ${officialLink}
  </div>
  ${factGrid}
  <div class="verdict">
    ${grade(latest?.rating, latest?.score, 'lg')}
    <div class="verdict-copy"><p class="verdict-label">At a glance</p><p class="summary">${plainSummary}</p></div>
  </div>
  ${positiveSignals ?? ''}
  <details class="verdict-detail"><summary>Read the full rating context and placement</summary>${detailGroups || `<p>${fallbackDetail.summary}</p>${fallbackDetail.rank ? `<p class="summary-rank">${fallbackDetail.rank}</p>` : ''}`}</details>
  ${alert}
  ${vm.notRated ? `<p class="note">TEA did not issue an overall rating for this ${unit(vm)}. Scores below are the figures TEA published; the letter grades are the state's where it issued them.</p>` : ''}
</section>`
}

/* ------------------------------------------------ positive signals at top -- */

const highlightValue = (value, fmt) => {
  if (!finite(value)) return '—'
  if (fmt === 'pct') return `${num(value, 1)}%`
  if (fmt === 'usd') return usd(value)
  return num(value, 1)
}

const highlightAnchor = (metric) => {
  if (metric === 'score') return 'trajectory'
  if (metric?.startsWith('domain:')) return 'domains'
  if (metric?.startsWith('staar:') || metric?.startsWith('grad:') || metric?.startsWith('ccmr:')) return 'outcomes'
  if (metric === 'attendance' || metric === 'absenteeism') return 'students'
  return null
}

const benchmarkScope = (vm, evidence) => {
  const units = comparisonUnits(vm)
  const n = num(evidence.metricN)
  const population = evidence.populationLabel ? ` (${esc(evidence.populationLabel)})` : ''
  const scope = evidence.cohort === 'state'
    ? `${n} Texas ${units} reporting this measure`
    : evidence.cohort === 'peer'
      ? `${n} ${units} with a similar economic-disadvantage rate reporting this measure`
      : evidence.cohort === 'size'
        ? `${n} similarly sized ${units} reporting this measure`
        : `${n} ${units} in ${esc(evidence.cohortLabel)} reporting this measure`
  return scope + population
}

const benchmarkSentence = (vm, evidence) => {
  const unitLabel = evidence.fmt === 'pct' ? 'percentage points' : 'points'
  const direction = evidence.lowerIsBetter ? 'lower than' : 'above'
  return `<strong>${highlightValue(evidence.value, evidence.fmt)}</strong> is ${num(evidence.advantage, 1)} ${unitLabel} ${direction}
    the ${highlightValue(evidence.benchmark, evidence.fmt)} average among ${benchmarkScope(vm, evidence)}.`
}

const rankScope = (vm, evidence, reporting) => {
  const units = comparisonUnits(vm)
  const suffix = reporting ? ` ${reporting}` : ''
  const population = evidence.populationLabel ? ` (${esc(evidence.populationLabel)})` : ''
  if (evidence.cohort === 'state') return `${num(evidence.of)} Texas ${units}${suffix}${population}`
  if (evidence.cohort === 'peer') {
    return `${num(evidence.of)} ${units} with a similar economic-disadvantage rate${suffix}${population}`
  }
  if (evidence.cohort === 'size') return `${num(evidence.of)} similarly sized ${units}${suffix}${population}`
  // Region and county rank labels already include the accountability
  // population; adding it here repeated the same qualifier twice.
  return `${num(evidence.of)} ${units} in ${esc(evidence.cohortLabel)}${suffix}`
}

const rankSentence = (vm, evidence) => {
  const units = comparisonUnits(vm)
  const tied = evidence.tied > 0
    ? `; ${num(evidence.tied + 1)} ${units} share that ${evidence.period === 'change' ? 'change' : 'value'}`
    : ''
  if (evidence.period === 'change') {
    return `${evidence.tied > 0 ? 'Tied for ' : ''}${ordinal(evidence.rank)} of ${rankScope(vm, evidence, 'reporting both years')} for one-year gain${tied}.`
  }
  const direction = evidence.lowerIsBetter ? '-lowest' : ''
  return `${evidence.tied > 0 ? 'Tied for ' : ''}${ordinal(evidence.rank)}${direction} of ${rankScope(vm, evidence, 'reporting this measure')}${tied}.`
}

const subjectLevel = (metric) => (String(metric).endsWith(':1') ? 'Meets' : 'Masters')

const highlightCard = (vm, card) => {
  const change = card.evidence.find((e) => e.kind === 'change')
  const benchmarks = card.evidence.filter((e) => e.kind === 'benchmark')
  const ranks = card.evidence.filter((e) => e.kind === 'rank')
  const primaryBenchmark = benchmarks[0]
  const anchor = highlightAnchor(card.metric ?? card.metrics?.[0])
  let kicker = 'Current strength'
  let title = card.label
  let primary = ''

  if (change) {
    kicker = card.metric === 'score' ? 'Recent movement' : 'Recent domain gain'
    title = `${card.label} rose ${points(change.delta)}`
    primary = `<p class="strength-change"><strong>${highlightValue(change.fromValue, change.fmt)} to ${highlightValue(change.toValue, change.fmt)}</strong> <span>${esc(change.previousYear)} to ${esc(change.latestYear)}</span></p>`
  } else if (card.kind === 'subject-benchmark' && primaryBenchmark) {
    const subject = card.label.replace(/\s*[—-]\s*Meets and Masters$/, '')
    const scope = primaryBenchmark.cohort === 'state'
      ? vm.isCharter ? 'Texas charter averages' : 'Texas averages'
      : primaryBenchmark.cohort === 'peer'
        ? 'similar-context averages'
        : primaryBenchmark.cohort === 'size'
          ? 'similar-size averages'
          : `${primaryBenchmark.cohortLabel} averages`
    kicker = 'STAAR result'
    title = `${subject} above ${scope} at Meets and Masters`
    const reporting = [...new Set(benchmarks.map((e) => e.metricN))]
    const reportingScope = reporting.length === 1
      ? `Among ${benchmarkScope(vm, primaryBenchmark)}.`
      : `The comparison includes ${num(benchmarks[0].metricN)} ${comparisonUnits(vm)} reporting Meets and ${num(benchmarks[1].metricN)} reporting Masters.`
    primary = `<dl class="strength-pair">${benchmarks.map((e) => `<div><dt>${subjectLevel(e.metric)}</dt><dd><strong>${highlightValue(e.value, e.fmt)}</strong><span>vs ${highlightValue(e.benchmark, e.fmt)} avg &middot; +${num(e.advantage, 1)} pts</span></dd></div>`).join('')}</dl>
      <p class="strength-scope">${reportingScope}</p>`
  } else if (primaryBenchmark) {
    const scope = primaryBenchmark.cohort === 'state'
      ? vm.isCharter ? 'Texas charter average' : 'Texas average'
      : primaryBenchmark.cohort === 'peer'
        ? 'similar-context average'
        : primaryBenchmark.cohort === 'size'
          ? 'similar-size average'
          : `${primaryBenchmark.cohortLabel} average`
    title = `${card.label} ${primaryBenchmark.lowerIsBetter ? 'lower than' : 'above'} the ${scope}`
    primary = `<p class="strength-current"><strong>${highlightValue(primaryBenchmark.value, primaryBenchmark.fmt)}</strong> <span>${primaryBenchmark.lowerIsBetter ? '−' : '+'}${num(primaryBenchmark.advantage, 1)} pts vs ${highlightValue(primaryBenchmark.benchmark, primaryBenchmark.fmt)}</span></p>`
  } else if (ranks[0]) {
    kicker = 'Top placement'
    title = card.label
    const placement = `${ranks[0].tied > 0 ? 'Tied for ' : ''}${ordinal(ranks[0].rank)}${ranks[0].lowerIsBetter ? '-lowest' : ''}`
    primary = `<p class="strength-current"><strong>${highlightValue(ranks[0].value, ranks[0].fmt)}</strong> <span>${placement} of ${rankScope(vm, ranks[0], 'reporting this measure')} &middot; ${esc(card.latestYear)}${ranks[0].tied > 0 ? ` &middot; ${num(ranks[0].tied + 1)} share this value` : ''}</span></p>`
  }

  // A benchmark already unpacked in the paired STAAR block is not repeated as
  // prose. Other cards keep every extra fact as a sentence, so a recent gain's
  // comparison and rank travel with it instead of becoming separate boasts.
  const evidence = [
    ...(card.kind === 'subject-benchmark' ? [] : benchmarks.map((e) => benchmarkSentence(vm, e))),
    ...(!change && !primaryBenchmark ? ranks.slice(1) : ranks).map((e) => rankSentence(vm, e)),
  ]
  const detail = evidence.length ? `<ul class="strength-evidence">${evidence.map((line) => `<li>${line}</li>`).join('')}</ul>` : ''
  const link = anchor ? `<a class="strength-link" href="#${anchor}" aria-label="See the full ${esc(card.label)} measure">See the full measure <span aria-hidden="true">&darr;</span></a>` : ''

  return `<article class="strength-card">
    <p class="strength-kicker">${esc(kicker)}</p>
    <h3>${esc(title)}</h3>
    ${primary}
    ${detail}
    ${link}
  </article>`
}

/** Compact evidence immediately after the overall rating, rebuilt per cohort. */
export function highlights(vm) {
  const cohorts = vm.cohorts ?? []
  const precomputedByCohort = Boolean(vm.highlightsByCohort && cohorts.length)
  const sets = precomputedByCohort
    ? cohorts.map((cohort) => ({ cohort, cards: (vm.highlightsByCohort[cohort.key] ?? []).slice(0, 3) }))
    : [{ cohort: null, cards: (vm.highlights ?? []).slice(0, 3) }]
  if (!sets.some((set) => set.cards.length)) return null
  const one = unit(vm)
  const groups = sets.map(({ cohort, cards }, i) => {
    const attrs = cohort ? ` data-comparison-cohort="${esc(cohort.key)}"${i ? ' hidden' : ''}` : ''
    return `<div class="strengths-grid"${attrs}>${
      cards.length
        ? cards.map((card) => highlightCard(vm, card)).join('')
        : `<p class="note na">No academic result met this site&rsquo;s published threshold for a selected positive signal against ${cohort?.key === 'size' ? `similarly sized ${comparisonUnits(vm)}` : esc(cohort?.label ?? 'this comparison')}.</p>`
    }</div>`
  }).join('')
  return `<div class="strengths" aria-labelledby="strengths-title">
    <div class="strengths-heading">
      <p class="verdict-label">Evidence worth noticing</p>
      <h2 id="strengths-title">Strengths and momentum</h2>
    </div>
    ${groups}
    ${precomputedByCohort ? '<p class="note na" data-comparison-pin-unavailable hidden style="display:none">A precomputed strengths set is not available for <span data-comparison-pin-label>this pinned entity</span>. The page&rsquo;s direct numeric comparisons still update to that pin.</p>' : ''}
    <p class="strengths-note"><strong>Selected positive signals, not a summary of performance.</strong> The same rules choose them on every page: only the latest one-year gain, results meaningfully better than the currently selected comparison with broad reporting, and distinctive top-three placements. Demographics, staffing and spending cannot become academic &ldquo;wins.&rdquo; The overall rating and the full results below remain the complete picture for this ${one}.</p>
  </div>`
}

/* ------------------------------------------------------------- trajectory -- */

export function trajectory(vm) {
  if (!vm.history?.length) return null
  const years = [...vm.history].reverse().map((h) => h.year)
  const mine = [...vm.history].reverse().map((h) => h.score)

  // The rescoring footnote explains one row. Entities whose history starts after
  // 2021-22 have no such row, and 657 pages carried the explanation anyway —
  // annotating a year that is not on the page.
  const has2122 = vm.history.some((h) => h.year === '2021-22')
  const note = !has2122
    ? ''
    : `2021-22 is shown under the refreshed methodology TEA adopted in 2023, so it is comparable with later years.${
        vm.originalScore != null
          ? ` Under the original scoring it was rated <strong>${esc(vm.originalRating ?? '')}</strong> with <strong>${vm.originalScore}</strong> that year.`
          : ''
      }`

  // A chip whose series is empty invites the reader to switch to a cohort that
  // draws nothing. Offer only cohorts that have at least one value in the years
  // this page actually shows — and default only to those that survive.
  const comparisons = (vm.comparisons ?? []).filter((c) => years.some((y) => c.byYear?.[y] != null))
  // A comparison switch must not make the entity's unchanged score line jump.
  // Fix one grade-band domain from the entity plus every built-in cohort, even
  // though only the selected cohort and state are initially drawn.
  const stableDomain = trajectoryDomain([
    ...mine,
    ...comparisons.flatMap((comparison) => years.map((year) => comparison.byYear?.[year] ?? null)),
  ])

  // The first cohort is the page-wide selected comparison. Start both the SVG
  // and its accessible table with that exact series rather than privately
  // defaulting this one section to the economic-context peer band. Fixtures and
  // older callers without cohorts retain the historical peer-first fallback.
  const activeKey = vm.cohorts?.[0]?.key ?? null
  const selectedComparison = comparisons.find((c) => c.key === activeKey)
    ?? comparisons.find((c) => c.key === 'peer')
    ?? comparisons[0]
    ?? null
  const stateComparison = comparisons.find((c) => c.key === 'state') ?? null
  const fixedState = stateComparison && selectedComparison?.key !== 'state' ? stateComparison : null
  const selectedValues = selectedComparison
    ? years.map((year) => selectedComparison.byYear?.[year] ?? null)
    : null
  const stateValues = fixedState ? years.map((year) => fixedState.byYear?.[year] ?? null) : null
  const trajectoryCell = (comparison, year) => {
    const value = comparison?.byYear?.[year]
    if (value == null) return '—'
    const reporting = comparison?.reportingNByYear?.[year]
    return `${value.toFixed(1)}${finite(reporting) ? ` <small class="trajectory-reporting">${num(reporting)} reporting</small>` : ''}`
  }
  const rows = vm.history.map((h) => {
    return `<tr><th scope="row">${esc(h.year)}</th><td>${grade(h.rating)}</td><td class="num">${h.score ?? '—'}</td>${selectedComparison ? `<td class="num">${trajectoryCell(selectedComparison, h.year)}</td>` : ''}${fixedState ? `<td class="num">${trajectoryCell(fixedState, h.year)}</td>` : ''}</tr>`
  })

  // The selected cohort and the statewide context (when different) are on by
  // default so the no-JavaScript chart and the page-wide control agree.
  const defaults = [selectedComparison?.key, fixedState?.key].filter(Boolean)
  const picker = comparisons.length
    ? `<div class="picker" role="group" aria-label="Choose comparisons">
    <span class="picker-label">Compare against</span>
    ${comparisons
      .map(
        (c) =>
          `<button type="button" class="chip" data-cmp="${esc(c.key)}" aria-pressed="${defaults.includes(c.key)}"${
            c.note ? ` title="${esc(c.note)}"` : ''
          }><span class="chip-dot chip-dot-${esc(c.key)}"></span>${esc(c.label)}<span class="chip-n"><span class="sr-only"> cohort members: </span>${num(c.n)}</span></button>`
      )
      .join('\n    ')}
  </div>`
    : ''

  const payload = comparisons.length
    ? `<script type="application/json" data-trajectory>${JSON.stringify({
        years,
        entity: { label: vm.name, values: mine },
        comparisons: comparisons.map((c) => ({
          key: c.key,
          label: c.label,
          n: c.n,
          values: years.map((y) => c.byYear[y] ?? null),
          reportingNs: years.map((y) => c.reportingNByYear?.[y] ?? null),
        })),
        defaults,
      }).replace(/</g, '\\u003c')}</script>`
    : ''

  return section(
    'trajectory',
    `${plural(vm.history.length, 'year')} of ratings`,
    `<p class="chart-takeaway">Follow the solid line to see how this ${unit(vm)} has changed. Turn comparison lines on or off to add context.</p>
  ${picker}
  ${trajectoryChart({ years, series: [
      { key: 'entity', values: mine, label: vm.name },
      selectedComparison ? { key: selectedComparison.key, values: selectedValues, label: selectedComparison.label } : null,
      fixedState ? { key: 'state', values: stateValues, label: fixedState.label } : null,
    ].filter(Boolean), domain: stableDomain })}
  ${payload}
  ${note ? `<p class="note">${note}</p>` : ''}
  ${comparisons.some((comparison) => comparison.reportingNByYear) ? '<p class="note">Comparison lines follow the current rated cohort backward through time. The table gives the number in that fixed cohort that reported a score each year; it can be smaller than cohort membership.</p>' : ''}
  <details class="data-details"><summary>View the yearly scores and comparisons</summary>
  ${table({
      caption: 'Rating history with comparisons',
      head: [
        'Year',
        'Rating',
        { label: 'Score', num: true },
        ...(selectedComparison ? [{ label: 'Selected comparison', sub: selectedComparison.label, num: true }] : []),
        ...(fixedState ? [{ label: 'State', sub: fixedState.label, num: true }] : []),
      ],
      rows,
    })}</details>`
  )
}

/* ------------------------------------------------------- change rankings -- */

/**
 * Boards that rank CHANGE over time — "the largest gains", "the largest
 * declines" — rather than where an entity stands today. Until this existed, 0
 * of 10,230 entity pages linked one of these, even though rankingIndex has
 * carried them all along for the 7 metrics with real multi-year history: the
 * overall score, the five score domains, and per-student spending (metric
 * keys prefixed `change:`, built by src/prerender.js:rankingMetrics). That
 * was the core gap: a page above can already say "you're 400th of 1,184
 * today" but had nowhere to send a reader asking "and is that getting
 * better?"
 *
 * There is no rank NUMBER to state here — metrics.js:rankAll, which computes
 * vm.rank/vm.standouts, ranks each metric's current LEVEL only; it computes
 * no placement on a metric's CHANGE, so this page cannot yet say "you're #1
 * in Texas for improvement" even where that happens to be true. What it CAN
 * do honestly is point at the board, exactly like every other ranking link on
 * this page: only through vm.rankingLinks, so a board that was never built
 * cannot be linked, and the lede below says plainly that a placement on these
 * specific lists is not something this page knows yet — the "state what the
 * site does not know" rule applied to a gap in the page's OWN data, not just
 * TEA's.
 */
const CHANGE_PREFIX = 'change:'

const changeBoardItems = (metrics) => {
  const items = []
  for (const [key, ends] of Object.entries(metrics ?? {})) {
    if (!key.startsWith(CHANGE_PREFIX)) continue
    if (ends?.top?.href) items.push({ href: ends.top.href, label: ends.top.title ?? key })
    if (ends?.bottom?.href) items.push({ href: ends.bottom.href, label: ends.bottom.title ?? key })
  }
  return items
}

export function changeRankings(vm) {
  const groups = [
    { label: `Texas ${comparisonUnits(vm)}`, items: changeBoardItems(vm.rankingLinks?.state) },
    { label: vm.regionName ?? null, items: changeBoardItems(vm.rankingLinks?.region) },
    { label: vm.county ? `${vm.county} County` : null, items: changeBoardItems(vm.rankingLinks?.county) },
  ].filter((g) => g.label && g.items.length)

  if (!groups.length) return null

  const one = vm.level === 'district' ? 'district' : 'school'
  const body = groups
    .map((g) => `<h3>${esc(g.label)}</h3>\n  ${navList(g.items, `${g.label} ranked by change over time`)}`)
    .join('\n  ')

  return section(
    'change-rankings',
    `How this ${one}'s change over time is ranked`,
    body,
    `TEA publishes most measures for one year only, so a change ranking exists just where the same
     figure is published across years — the overall score, the five score domains, and per-student
     spending. This page does not yet state where ${esc(vm.name)} itself places on these lists, only
     that the lists exist; open one to find this ${esc(one)}'s own row.`
  )
}

/* ---------------------------------------------------------------- domains -- */

export function domains(vm) {
  if (!vm.domains?.length) return null

  // src/normalize/domains.js derives the letter from the score using TEA's own
  // bands, and says in terms that a consumer holding entity metadata must not
  // publish that letter for a Not Rated entity: the state withheld it as an
  // administrative decision (mostly alternative-education campuses) that the
  // score alone cannot see. The score below is TEA's. The letter would be ours,
  // so it is not shown, and neither is anything that reads as one — "points to
  // next grade" has no referent without a current grade.
  const derivedGrades = !vm.notRated

  const rows = vm.domains.map(
    (d) =>
      `<tr><th scope="row">${esc(d.label)}</th><td class="num">${d.score ?? '—'}</td><td>${
        derivedGrades && d.grade ? grade(d.grade) : '<span class="na">Not rated</span>'
      }</td><td class="num">${!derivedGrades || d.toNextGrade == null ? '—' : `${d.toNextGrade}`}</td></tr>`
  )
  const { counted, kept, discarded } = countedDomains(vm.domains)
  const closest = derivedGrades ? closestCounted(counted) : null

  // The weighting is stated wherever the page names a domain as a route to a
  // better rating, and the discarded measure is named outright — a reader
  // looking at a 79 sitting one point under a B is owed the reason it is not
  // the answer.
  const formula =
    !counted.length
      ? ''
      : `<p class="note">TEA does not add the domains up. The overall score is the better of Student
  Achievement and School Progress at <strong>70%</strong>, plus Closing the Gaps at <strong>30%</strong>.${
    discarded && kept
      ? ` For this ${unit(vm)} that better measure is <strong>${esc(kept.label)}</strong> (${kept.score}), so
  <strong>${esc(discarded.label)}</strong> (${discarded.score}) is published above but does not enter the overall
  score at all — gaining points there changes nothing until it passes ${kept.score}.`
      : ''
  }</p>`

  return section(
    'domains',
    'Where the score comes from',
    `${scoreBars(
      vm.domains.map((d) => ({
        key: `domain:${d.domain}`,
        label: d.label,
        score: d.score,
        grade: derivedGrades ? d.grade : null,
        // The cohort's own key (peer/region/county/state), not a slot index.
        // vm.cohorts is [peer?, region?, county?, state] with state always
        // last, so a fixed "second slot is state" reads a region or county
        // cohort's tick in --c-state teal — the colour every other page on
        // the site uses for "Texas average".
        markers: (vm.cohorts ?? []).slice(0, 1).map((c) => ({
          key: c.key,
          label: c.label,
          short: c.short,
          value: c.metrics[`domain:${d.domain}`] ?? null,
          n: c.metricN?.[`domain:${d.domain}`] ?? null,
        })),
      }))
    )}
  ${vm.cohorts?.length ? legend([{ key: 'entity', label: vm.name }, ...vm.cohorts.slice(0, 1).map((c) => ({ key: c.key, label: `${c.label} (${num(c.n)} in cohort)` }))]) : ''}
  ${table({
      caption: 'Domain scores',
      head: ['Domain', { label: 'Score', num: true }, 'Grade', { label: 'Points to next grade', num: true }],
      rows,
    })}
  ${
    closest
      ? `<p class="callout">Closest to moving up: <strong>${esc(closest.label)}</strong>, ${points(
          closest.toNextGrade
        )} below ${esc(nextLetter(closest.grade))} in that domain &mdash; the nearest of the measures that count toward the overall rating.</p>`
      : ''
  }
  ${formula}
  ${
    derivedGrades
      ? ''
      : `<p class="note">The scores above are the ones TEA published. TEA did not issue letter grades for
  this ${unit(vm)}, so none are shown: the A&ndash;F thresholds marked on the chart are the state's, but
  applying them here would produce a grade the state chose to withhold.</p>`
  }`,
    'Texas builds the overall rating from the better of Student Achievement and School Progress, weighted 70%, plus Closing the Gaps at 30%. School Progress is itself the better of Academic Growth and Relative Performance. The 60, 70, 80 and 90 rules mark the letter-grade thresholds.'
  )
}

const nextLetter = (g) => ({ F: 'D', D: 'C', C: 'B', B: 'A' }[g] ?? 'the next grade')

/* ------------------------------------------------------------- outcomes --- */

export function outcomes(vm) {
  if (!vm.staar?.subjects?.length && !vm.graduation?.length && !vm.ccmr?.length) return null

  // The tick is always vm.cohorts[0] — the reader's default comparison, not
  // necessarily the peer band. Its own key/label carries through to the mark,
  // the legend and the note, so a region or state tick is never coloured or
  // captioned as if it were the poverty-band peer group.
  const tickCohort = vm.cohorts?.[0] ?? null
  const staar = vm.staar?.subjects?.length
    ? `<h3>STAAR performance</h3>
  ${groupedBars({
        groups: vm.staar.subjects,
        series: STAAR_LEVELS.map((label, i) => ({
          key: `l${i}`,
          label,
          values: vm.staar.levels[i],
          compare: tickCohort ? vm.staar.subjects.map((subj) => tickCohort.metrics[`staar:${subj}:${i}`] ?? null) : null,
          compareN: tickCohort ? vm.staar.subjects.map((subj) => tickCohort.metricN?.[`staar:${subj}:${i}`] ?? null) : null,
        })),
        compareKey: tickCohort?.key ?? 'peer',
        compareLabel: tickCohort?.label ?? 'Similar schools',
        collapseAfterFirst: true,
      })}
  ${legend([...STAAR_LEVELS.map((label, i) => ({ key: `l${i}`, label })), tickCohort ? { key: tickCohort.key, label: `Tick: ${tickCohort.label} (${num(tickCohort.n)} in cohort)` } : null].filter(Boolean))}
  <p class="note">Percentage of tests at or above each level. Masters is a subset of Meets, which is a subset of Approaches. ${
    // "Texas average" is itself the cohort's label, so "the average for Texas
    // average" is avoided as a special case rather than as the general rule.
    tickCohort
      ? tickCohort.key === 'state'
        ? `The tick on each bar marks the ${vm.isCharter ? 'Texas charter average' : 'statewide average'}`
        : `The tick on each bar marks the average for <strong>${esc(comparisonAverageTarget(vm, tickCohort))}</strong>`
      : `The tick on each bar marks the average for ${comparisonUnits(vm)} serving a similar share of economically disadvantaged students`
  } &mdash; a comparison TEA does not publish.</p>`
    : ''

  const grad = vm.graduation?.length
    ? `<h3>${vm.isAlt ? 'Completion' : 'Graduation'}</h3>
  ${statGrid(vm.graduation.map((g, i) => {
        const key = g.key ?? `grad:${i}`
        return [
        g.label.replace(/ (Graduation|Completion) Rate/, ''),
        pct(g.value) + cmp(vm, key, { fmt: 'pct', invert: g.label === 'Dropout Rate' }) + comparisonCoverage(vm, key),
      ]}))}
  <p class="note">These measures use TEA's ${vm.isAlt ? 'alternative-education accountability' : 'standard-accountability'} population. Each comparison average includes only ${comparisonUnits(vm)} in that population that report that specific measure; its reporting count is shown beside the average. It is an unweighted average of those reported ${comparisonUnit(vm)} rates, not a pooled rate across every student in the group.</p>`
    : ''

  const ccmrCohort = vm.cohorts?.[0] ?? null
  const ccmrStatewide = ccmrCohort?.key === 'state'
  const ccmrTarget = comparisonAverageTarget(vm, ccmrCohort)

  // The 12 criteria used to sit behind <details>, which meant the page
  // published one CCMR number and hid the eleven that explain it. A district
  // at 97% on the headline can be there almost entirely on dual credit, or
  // spread across certifications, military enlistment and advanced diplomas —
  // and those are different districts to write about. The breakdown IS the
  // section; it is not an appendix to it.
  const hasCcmrCoverage = vm.ccmr?.some((row, i) =>
    vm.cohorts?.some((cohort) => finite(cohort?.metrics?.[row.key ?? `ccmr:${i}`]))
  )
  const ccmrHeadline = vm.ccmr?.find((row, i) => (row.key ?? `ccmr:${i}`) === 'ccmr:0') ?? null
  const ccmr = vm.ccmr?.length
    ? `<h3>College, career and military readiness</h3>
  ${ccmrHeadline ? statGrid([[ccmrHeadline.label, `${ccmrHeadline.value ?? '—'}${cmp(vm, 'ccmr:0', { fmt: 'pct' })}`]]) : ''}
  ${table({
        caption: 'CCMR criteria',
        className: 'data scroll ccmr-tbl',
        head: [
          'Criterion',
          { label: 'This ' + (vm.level === 'district' ? 'district' : 'school'), sub: '% of graduates', num: true },
          { label: 'Average', sub: vm.cohorts?.[0]?.short ?? 'cohort', num: true },
          { label: 'Difference', sub: 'percentage points', num: true },
          ...(hasCcmrCoverage ? [{ label: 'Reporting', sub: 'selected comparison', num: true }] : []),
        ],
        rows: vm.ccmr.map((c, i) => {
          const key = c.key ?? `ccmr:${i}`
          const other = vm.cohorts?.[0]?.metrics[key] ?? null
          const mine = vm.own?.[key] ?? null
          const gap = mine != null && other != null ? mine - other : null
          return `<tr data-metric="${esc(key)}"><th scope="row" class="wrap">${esc(c.label)}</th><td class="num">${c.value ?? '—'}</td><td class="num">${other == null ? '—' : other.toFixed(1) + '%'}</td><td class="num">${gap == null ? '—' : `<span class="${gap >= 0 ? 'cmp-up' : 'cmp-down'}">${gap >= 0 ? '+' : '−'}${Math.abs(gap).toFixed(1)}</span>`}</td>${hasCcmrCoverage ? `<td class="num comparison-coverage-cell">${comparisonCoverage(vm, key)}</td>` : ''}</tr>`
        }),
      })}
  <p class="note">Every row is a share of this ${unit(vm)}'s graduates, and every row is a way of
  meeting CCMR &mdash; so on every row, a bigger share is better. <strong>Difference</strong> is this
  ${unit(vm)} minus <span data-ccmr-comparison>${ccmrStatewide ? `the ${stateAverageKind(vm)}` : 'the average for'}</span> <strong data-ccmr-cohort>${ccmrStatewide ? stateAverageTarget(vm) : esc(ccmrTarget)}</strong>,
  counted in percentage points: <strong>+5.0</strong> would mean five more graduates in every hundred met that
  criterion here. The selected comparison is an unweighted average of the reported ${comparisonUnit(vm)} percentages, not a pooled rate across all graduates in the group. Graduates may meet several criteria, so the rows do not add up to the total.</p>`
    : ''

  const coverage = vm.cohorts?.length
    ? `<p class="note">Counts in the comparison controls describe full cohort membership, not the denominator of every average. Each average uses only ${comparisonUnits(vm)} for which TEA reported that measure; metric-specific reporting counts are shown on the STAAR, graduation and CCMR rows and may vary.</p>`
    : ''

  return section('outcomes', 'Student outcomes', `${staar}\n  ${grad}\n  ${ccmr}\n  ${coverage}`)
}

/* ------------------------------------------------------------- who it serves */

export function students(vm) {
  if (!vm.profile) return null
  const race = (vm.raceShare ?? []).map((v, i) => ({ label: RACE[i], value: v })).filter((r) => r.value > 0)
  return section(
    'students',
    `Who this ${unit(vm)} serves`,
    `${statGrid([
      ['Students', num(vm.profile.total)],
      // Three context metrics, three neutral chips: see contextCmp.
      ['Economically disadvantaged', pct(vm.profile.ecoDisPct) + contextCmp(vm, 'ecoDis')],
      ['English learners', pct(vm.profile.engLrnPct) + contextCmp(vm, 'engLrn')],
      ['Special education', pct(vm.profile.specEdPct) + contextCmp(vm, 'specEd')],
      ['Attendance', pct(vm.profile.attendance) + cmp(vm, 'attendance', { fmt: 'pct' })],
      ['Chronically absent', pct(vm.profile.absenteeism) + cmp(vm, 'absenteeism', { fmt: 'pct', invert: true })],
    ])}
  ${race.length ? `<h3>Student demographics</h3>
    <p class="comparison-composition-title"><strong>${esc(vm.name)}</strong></p>
    ${stackedShare(race)}${legend(race.map((r, i) => ({ key: String(i % 7), label: `${r.label} ${r.value}%` })))}
    ${comparisonStackedShares(vm, 'race', RACE, 'Selected comparison average')}` : ''}`,
    'Placed after the results deliberately: this is context for reading them, not an explanation of them.'
  )
}

const accountabilityMasked = (datum) => String(datum?.status ?? '').startsWith('masked')

const accountabilityDatum = (datum) => {
  if (datum?.status === 'reported' && finite(datum.value)) return num(datum.value)
  if (accountabilityMasked(datum)) {
    const kind = datum.status === 'masked-small'
      ? 'small number'
      : datum.status === 'masked-complementary'
        ? 'complementary'
        : null
    return `Masked${kind ? ` — ${kind}` : ''}${datum.raw ? ` (${esc(datum.raw)})` : ''}`
  }
  if (datum?.status === 'not-available') return `Not available${datum.raw ? ` (${esc(datum.raw)})` : ''}`
  return 'Not reported'
}

const accountabilityProgramRelevant = (program) =>
  accountabilityMasked(program?.count) ||
  (program?.count?.status === 'reported' && finite(program.count.value) && program.count.value > 0)

const accountabilityShareNote = (datum) =>
  datum?.status === 'reported' && finite(datum.value)
    ? `TEA-published share: ${num(datum.value, 1)}%`
    : accountabilityMasked(datum)
      ? `TEA-published share: Masked${datum.raw ? ` (${esc(datum.raw)})` : ''}`
      : null

const ACCOUNTABILITY_FLAG_LABELS = {
  newDistrict: 'New district compared with last year’s fall enrollment',
  newCharterDistrict: 'New charter district compared with last year’s fall enrollment',
  newCampus: 'New campus compared with last year’s fall enrollment',
  earlyEducationOnly: 'Highest grade is early education, pre-K or kindergarten',
  alternativeEducationCampus: 'Alternative education campus under AEA procedures',
  firstYearWithGrade3OrHigherAndNotNew: 'First year with grade 3 or higher and not a new campus',
  disciplinaryAlternativeEducationProgram: 'Disciplinary Alternative Education Program (DAEP)',
  juvenileJusticeAlternativeEducationProgram: 'Juvenile Justice Alternative Education Program (JJAEP)',
  ratedUnderAlternativeEducationProcedures: 'Rated under AEA procedures',
  residentialTreatmentFacility: 'Residential treatment facility under AEA or AskTED',
  adultEducationHighSchoolCharterProgram: 'Adult Education High School Charter Program',
}

/**
 * TEA's bulk accountability summary exposes the counts behind several shares.
 * They are context, not outcomes: no comparison hooks, ranks, colors, inferred
 * percentages, or quality language are attached here.
 */
export function accountabilityContext(vm) {
  const context = vm.accountabilityContext
  if (!context) return null
  const programRows = [
    ['Early College High School', context.programs?.earlyCollegeHighSchool],
    ['Pathways in Technology Early College High School (P-TECH)', context.programs?.pathwaysInTechnologyEarlyCollegeHighSchool],
  ].filter(([, program]) => accountabilityProgramRelevant(program))
  const mobility = context.mobility
  const flags = Object.entries(context.flags ?? {}).flatMap(([key, datum]) => {
    if (key === 'newDistrict' && context.flags?.newCharterDistrict?.value === true) return []
    if (key === 'alternativeEducationType') return datum?.status === 'reported' && datum.value
      ? [`Alternative education type: ${String(datum.value).replace(/-/g, ' ')}`] : []
    return datum?.status === 'reported' && datum.value === true && ACCOUNTABILITY_FLAG_LABELS[key]
      ? [ACCOUNTABILITY_FLAG_LABELS[key]] : []
  })
  const mobilityRows = mobility
    ? `<h3>Campus mobility · ${esc(schoolYear(mobility.year))}</h3>
  ${statGrid([
    ['Mobile students', accountabilityDatum(mobility.mobileStudents)],
    ['Students in TEA mobility denominator', accountabilityDatum(mobility.denominatorStudents)],
    ['TEA-published mobility rate', mobility.ratePct?.status === 'reported' && finite(mobility.ratePct.value) ? `${num(mobility.ratePct.value, 1)}%` : accountabilityDatum(mobility.ratePct)],
  ])}
  <p class="note">The mobility count and rate use TEA&rsquo;s separate ${esc(schoolYear(mobility.year))} campus denominator shown above, not current enrollment. This site does not recalculate a missing rate.</p>`
    : ''
  const meta = vm.publicDataMeta?.accountability
  return section(
    'accountability-context',
    'Student counts behind the percentages',
    `${statGrid([
      ['Students in this TEA accountability summary', accountabilityDatum(context.students?.all)],
      ['Economically disadvantaged students', accountabilityDatum(context.students?.economicallyDisadvantaged)],
      ['Emergent bilingual students', accountabilityDatum(context.students?.emergentBilingual)],
      ['Special education students', accountabilityDatum(context.students?.specialEducation)],
    ])}
  ${programRows.length ? `<h3>Early college pathways</h3>${statGrid(programRows.map(([label, program]) => [label, accountabilityDatum(program.count), accountabilityShareNote(program.sharePct)]))}` : ''}
  ${flags.length ? `<h3>TEA context labels</h3><ul class="prose-list">${flags.map((label) => `<li>${esc(label)}</li>`).join('')}</ul>` : ''}
  ${mobilityRows}
  <p class="note">The first figure is TEA&rsquo;s student count for this accountability summary. It is a separate publication from the fall PEIMS enrollment shown above and can differ; this site does not substitute one for the other. Counts come from TEA&rsquo;s ${esc(context.year)} accountability summary${meta?.fetchedAt ? `, fetched ${esc(meta.fetchedAt)}` : ''}. A reported zero is shown as 0. Small-number and complementary masks, unavailable values, and blank not-reported fields stay separate and are never estimated.${meta?.masking ? ` <a href="${esc(meta.masking)}" rel="nofollow">TEA masking definitions</a>.` : ''}</p>`,
    'Context only. These counts are not rankings, comparisons, or judgments about school quality.'
  )
}

/* ------------------------------------------------------- enrollment time -- */

const schoolYear = (year) => String(year ?? '').replace('-', '–')

const enrollmentPct = (value, { signed = false } = {}) => {
  if (!finite(value)) return null
  const absolute = Math.abs(value)
  if (absolute > 0 && absolute < 0.05) return 'less than 0.1%'
  const sign = !signed || value === 0 ? '' : value > 0 ? '+' : '−'
  return `${sign}${absolute.toFixed(1)}%`
}

const signedEnrollment = (value) =>
  value > 0 ? `+${num(value)}` : value < 0 ? `−${num(Math.abs(value))}` : '0'

const enrollmentDirection = (change, { sentence = false } = {}) => {
  if (!change) return null
  if (change.delta === 0) return sentence ? 'no change' : 'No change'
  const word = change.delta > 0 ? 'increase' : 'decrease'
  const percent = enrollmentPct(change.pct)
  return `${sentence ? `a${word === 'increase' ? 'n' : ''} ${word}` : word[0].toUpperCase() + word.slice(1)} of ${num(Math.abs(change.delta))}${
    percent ? ` (${percent})` : ''
  }`
}

const enrollmentStat = (label, change) => [
  label,
  signedEnrollment(change.delta),
  change.pct == null
    ? change.from === 0
      ? 'Percentage not calculated from a zero base'
      : null
    : change.delta === 0
      ? 'No change'
      : `${change.delta > 0 ? 'Increase' : 'Decrease'} · ${enrollmentPct(change.pct, { signed: true })}`,
]

/**
 * A count trend is context, not a performance signal. Bars share one zero
 * baseline and one neutral treatment; the exact count and signed prose remain
 * visible, so neither colour nor bar length has to carry the claim.
 */
export function enrollment(vm) {
  const trend = vm.enrollmentTrend
  if (!trend?.points?.length || trend.points.length < 2 || !trend.latest) return null

  const reported = vm.enrollmentReported?.length ? vm.enrollmentReported : trend.points
  const currentReport = reported.at(-1) ?? null
  const latestYear = schoolYear(trend.latest.year)
  const currentSuppressed = currentReport?.enrollment == null
  const takeaway = currentSuppressed
    ? `TEA did not publish an enrollment count for <strong>${esc(schoolYear(currentReport.year))}</strong> in this PEIMS report, so no current year-over-year change is calculated. The latest available PEIMS count is <strong>${num(trend.latest.enrollment)} students</strong> in <strong>${esc(latestYear)}</strong>.`
    : trend.yoy
      ? `TEA reported <strong>${num(trend.latest.enrollment)} students</strong> in <strong>${esc(latestYear)}</strong>, ${enrollmentDirection(
          trend.yoy,
          { sentence: true }
        )} from ${esc(schoolYear(trend.yoy.fromYear))}.`
      : `TEA reported <strong>${num(trend.latest.enrollment)} students</strong> in <strong>${esc(latestYear)}</strong>. The previous available count is not from the immediately preceding school year, so no year-over-year change is calculated.`

  const stats = [
    [currentSuppressed ? 'Latest available PEIMS enrollment' : 'Latest enrollment', num(trend.latest.enrollment), latestYear],
    !currentSuppressed && trend.yoy ? enrollmentStat(`Change from ${schoolYear(trend.yoy.fromYear)}`, trend.yoy) : null,
    trend.sinceFirst
      ? enrollmentStat(`Change since ${schoolYear(trend.sinceFirst.fromYear)}`, trend.sinceFirst)
      : null,
  ]

  const max = Math.max(...trend.points.map((point) => point.enrollment), 0)
  const validByYear = new Map(trend.points.map((point) => [point.year, point]))
  const rows = reported.map((report, i) => {
    const point = validByYear.get(report.year)
    if (!point) {
      return `<tr>
      <th scope="row">${esc(schoolYear(report.year))}</th>
      <td class="num enrollment-count-cell"><span class="enrollment-measure enrollment-measure-na"><span class="enrollment-na">Not reported</span></span></td>
      <td class="enrollment-change"><span class="enrollment-na">Not available</span></td>
      ${comparisonCell(vm, publicMetric.enrollment(report.year), 'count')}
    </tr>`
    }
    const width = max > 0 ? (point.enrollment / max) * 100 : 0
    const change = point.change
      ? enrollmentDirection(point.change)
      : i === 0
        ? '<span class="enrollment-na">First available year</span>'
        : '<span class="enrollment-na">No adjacent prior year</span>'
    return `<tr>
      <th scope="row">${esc(schoolYear(point.year))}</th>
      <td class="num enrollment-count-cell"><span class="enrollment-measure" style="--enrollment-width:${width.toFixed(2)}%"><span class="enrollment-bar" aria-hidden="true"${point.enrollment === 0 ? ' hidden' : ''}></span><span class="enrollment-value">${num(point.enrollment)}</span></span></td>
      <td class="enrollment-change">${change}</td>
      ${comparisonCell(vm, publicMetric.enrollment(point.year), 'count')}
    </tr>`
  })

  return section(
    'enrollment',
    'Enrollment over time',
    `<p class="enrollment-takeaway">${takeaway}</p>
  ${statGrid(stats)}
  ${comparisonReadout(vm, publicMetric.enrollment(trend.latest.year), {
    format: 'count', label: `Enrollment in ${latestYear}`, showDelta: false,
  })}
  ${table({
      caption: `Student enrollment by school year for ${vm.name}`,
      className: 'data scroll enrollment-table',
      head: [
        'School year',
        { label: 'Students enrolled', sub: vm.name, num: true },
        'Change from previous school year',
        { label: 'Average enrollment', sub: 'selected comparison', num: true },
      ],
      rows,
    })}
  <p class="note">The selected comparison column is the average enrollment among reporting ${comparisonUnits(vm)} in that group. It changes with the comparison control; this ${unit(vm)}'s own counts do not.</p>
  <p class="note">Source: <a href="${esc(vm.enrollmentSourceUrl ?? 'https://rptsvr1.tea.texas.gov/adhocrpt/adspr.html')}" rel="nofollow">TEA PEIMS Student Program and Special Populations Reports</a>${vm.enrollmentSnapshotDate ? `, fetched ${esc(vm.enrollmentSnapshotDate)}` : ''}. TEA reports these counts from its fall student snapshot; changes compare adjacent reported school years.</p>
  <p class="note">These counts show how enrollment changed, not why. Attendance-zone changes, school openings or closures, grade reconfigurations, transfers and population shifts can affect the total.</p>`,
    'TEA-reported student enrollment for each available school year. Enrollment growth or decline is not a measure of school quality.'
  )
}

/* --------------------------------------------------------- student flows -- */

const reportedCount = (value, status = null) => Number.isSafeInteger(value) && value >= 0
  ? num(value)
  : status === 'masked' || status === 'suppressed'
    ? '<span class="na">Suppressed</span>'
    : '<span class="na">Not reported</span>'

const flowList = (title, rows, coverage) => {
  if (!Array.isArray(rows) || !rows.length) return ''
  return `<div class="transfer-flow">
    <h3>${esc(title)}</h3>
    <ol class="destination-list">${rows.map((row) => `<li><span>${esc(row.name ?? `District ${row.id}`)} <small>${esc(row.id)}</small></span><strong>${num(row.transfers)}</strong></li>`).join('')}</ol>
    <p class="note">Top reported flows only. TEA published ${num(coverage?.reported ?? rows.length)} of ${num(coverage?.published ?? rows.length)} counterpart counts${coverage?.masked ? ` and masked ${num(coverage.masked)}` : ''}.</p>
  </div>`
}

export function transfers(vm) {
  const t = vm.transferContext
  if (vm.level !== 'district' || !t?.current || !Array.isArray(t.history)) return null
  const current = t.current
  const hasOfficialTotal = t.history.some((point) =>
    [point.transfersIn, point.transfersOut].some((value) => Number.isSafeInteger(value)) ||
    [point.coverage?.officialTotals?.in, point.coverage?.officialTotals?.out]
      .some((status) => status === 'reported' || status === 'masked')
  )
  if (!hasOfficialTotal) return null
  const meta = vm.publicDataMeta?.transfers ?? {}

  // A charter system is an operator, not a geographic district of residence.
  // TEA therefore publishes the resident-district origins of students entering
  // the charter, but no corresponding charter "residents" or transfers-out
  // total. Rendering the district three-column balance for a charter would turn
  // that structural blank into what looks like a performance result.
  if (vm.isCharter) {
    const rows = t.history.map((point) => `<tr>
      <th scope="row">${esc(schoolYear(point.year))}</th>
      <td class="num">${reportedCount(point.transfersIn, point.coverage?.officialTotals?.in)}</td>
      ${comparisonCell(vm, publicMetric.transfersIn(point.year), 'count')}
    </tr>`)

    return section(
      'transfers',
      'Students entering this charter system',
      `${statGrid([
        ['Transfers in', reportedCount(current.transfersIn, current.coverage?.officialTotals?.in), `Live in a geographic district; attend this charter system · ${schoolYear(current.year)}`],
      ])}
      <div class="comparison-readout-grid" aria-label="Selected comparison transfer-in average">
        ${comparisonReadout(vm, publicMetric.transfersIn(current.year), {
          format: 'count', label: `Transfers in · ${schoolYear(current.year)}`, showDelta: false,
        })}
      </div>
      ${table({
        caption: `Official transfers into ${vm.name} by school year`,
        className: 'data scroll transfer-history',
        head: [
          'School year',
          { label: 'Transfers in', sub: vm.name, num: true },
          { label: 'Transfers in', sub: 'selected charter comparison average', num: true },
        ],
        rows,
      })}
      <div class="transfer-flow-grid">
        ${flowList('Largest reported resident-district origins', current.topOrigins, current.coverage?.origins)}
      </div>
      <p class="note">TEA does not publish a transfers-out total or a resident population for this charter system. A charter system is not a geographic attendance boundary, so a net transfer balance cannot be calculated and this page does not label the system a transfer gainer or loser.</p>
      <p class="note">Selected comparison figures are average reported transfer-in counts among charter systems, not rates; system size affects them. They provide scale context and are not a performance judgment. This charter system&rsquo;s official total does not change when the comparison does.</p>
      <p class="note">Source: TEA <a href="${esc(meta.source ?? 'https://rptsvr1.tea.texas.gov/adhocrpt/Standard_Reports/Transfer_Reports/transfer_reports.html')}" rel="nofollow">Student Transfer Reports</a>${meta.fetchedAt ? `, fetched ${esc(meta.fetchedAt)}` : ''}. The total and origin rows are TEA&rsquo;s published charter-system figures; this site does not add masked detail cells. A transfer-in count does not say why a family chose the charter or whether one school is better.</p>`,
      'How many students live in a geographic school district and attend this charter system. These are movement counts, not a quality rating.'
    )
  }

  const historyRows = t.history.map((point) => `<tr>
    <th scope="row">${esc(schoolYear(point.year))}</th>
    <td class="num">${reportedCount(point.transfersIn, point.coverage?.officialTotals?.in)}</td>
    <td class="num">${reportedCount(point.transfersOut, point.coverage?.officialTotals?.out)}</td>
    <td class="num">${point.net == null ? '<span class="na">Not available</span>' : signedEnrollment(point.net)}</td>
    ${comparisonCell(vm, publicMetric.transfersIn(point.year), 'count')}
    ${comparisonCell(vm, publicMetric.transfersOut(point.year), 'count')}
    ${comparisonCell(vm, publicMetric.transferBalance(point.year), 'signed-count')}
  </tr>`)
  const net = current.net == null ? '<span class="na">Not available</span>' : signedEnrollment(current.net)

  return section(
    'transfers',
    'Students crossing district lines',
    `${statGrid([
      ['Transfers in', reportedCount(current.transfersIn, current.coverage?.officialTotals?.in), `Live in another district; attend here · ${schoolYear(current.year)}`],
      ['Transfers out', reportedCount(current.transfersOut, current.coverage?.officialTotals?.out), `Live here; attend in another public district or charter · ${schoolYear(current.year)}`],
      ['Transfers in minus transfers out', net, 'Arithmetic context only'],
    ])}
    <div class="comparison-readout-grid" aria-label="Selected comparison transfer averages">
      ${comparisonReadout(vm, publicMetric.transfersIn(current.year), {
        format: 'count', label: `Transfers in · ${schoolYear(current.year)}`, showDelta: false,
      })}
      ${comparisonReadout(vm, publicMetric.transfersOut(current.year), {
        format: 'count', label: `Transfers out · ${schoolYear(current.year)}`, showDelta: false,
      })}
      ${comparisonReadout(vm, publicMetric.transferBalance(current.year), {
        format: 'signed-count', label: `Transfers in minus out · ${schoolYear(current.year)}`, showDelta: false,
      })}
    </div>
    ${table({
      caption: `Official transfer totals by school year for ${vm.name}`,
      className: 'data scroll transfer-history',
      head: [
        'School year',
        { label: 'Transfers in', sub: vm.name, num: true },
        { label: 'Transfers out', sub: vm.name, num: true },
        { label: 'In minus out', sub: vm.name, num: true },
        { label: 'Transfers in', sub: 'selected comparison average', num: true },
        { label: 'Transfers out', sub: 'selected comparison average', num: true },
        { label: 'In minus out', sub: 'selected comparison average', num: true },
      ],
      rows: historyRows,
    })}
    <div class="transfer-flow-grid">
      ${flowList('Largest reported origins for transfers in', current.topOrigins, current.coverage?.origins)}
      ${flowList('Largest reported destinations for transfers out', current.topDestinations, current.coverage?.destinations)}
    </div>
    <p class="note">Selected comparison figures are average reported counts, not rates; group size and district enrollment affect them. They provide scale context and are not a performance judgment. This district's official totals do not change when the comparison does.</p>
    <p class="note">Source: TEA <a href="${esc(meta.source ?? 'https://rptsvr1.tea.texas.gov/adhocrpt/Standard_Reports/Transfer_Reports/transfer_reports.html')}" rel="nofollow">Student Transfer Reports</a>${meta.fetchedAt ? `, fetched ${esc(meta.fetchedAt)}` : ''}. The totals are TEA's official district rows; this site does not add masked detail cells. A transfer records a mismatch between district of residence and public district or charter of attendance. It does not say why a family transferred, whether the move was optional, or whether either school is better.</p>`,
    'How many students live in one public-school district and attend in another. These are movement counts, not a measure of family satisfaction or school quality.'
  )
}

/* ------------------------------------------------------------- discipline -- */

const disciplineCount = (datum) => datum?.count != null
  ? num(datum.count)
  : datum?.status === 'suppressed'
    ? `<span class="na"${datum.mask ? ` title="TEA suppression code ${esc(datum.mask)}"` : ''}>Suppressed</span>`
    : '<span class="na">Not reported</span>'

const disciplineRate = (datum, key) => datum?.[key] == null
  ? '<span class="na">—</span>'
  : pct(datum[key])

export function discipline(vm) {
  const d = vm.discipline
  if (!d || (!d.current && !d.history?.length)) return null
  const current = d.current
  const all = current?.categories?.find((category) => category.key === 'allDiscipline') ?? null
  const meta = vm.publicDataMeta?.discipline ?? {}
  const stats = current && all
    ? statGrid([
        ['Students in TEA’s all-discipline count', disciplineCount(all.students), all.students?.ratePct == null ? 'Rate not available' : `${pct(all.students.ratePct)} of cumulative year-end enrollment`],
        ['Disciplinary actions', disciplineCount(all.actions), all.actions?.ratePer100 == null ? 'Rate not available' : `${all.actions.ratePer100.toFixed(2)} per 100 students`],
        ['Cumulative year-end enrollment', disciplineCount(current.cumulativeEnrollment), schoolYear(current.year)],
      ])
    : ''
  const historyRows = (d.history ?? []).map((point) => `<tr>
    <th scope="row">${esc(schoolYear(point.year))}</th>
    <td class="num">${disciplineCount(point.cumulativeEnrollment)}</td>
    <td class="num">${disciplineCount(point.students)}</td>
    <td class="num">${disciplineRate(point.students, 'ratePct')}</td>
    <td class="num">${disciplineCount(point.actions)}</td>
    <td class="num">${point.actions?.ratePer100 == null ? '<span class="na">—</span>' : point.actions.ratePer100.toFixed(2)}</td>
    ${comparisonCell(vm, publicMetric.disciplineStudents(point.year), 'pct')}
    ${comparisonCell(vm, publicMetric.disciplineActions(point.year), 'rate')}
  </tr>`)
  const categoryRows = (current?.categories ?? []).map((category) => `<tr>
    <th scope="row" class="wrap">${esc(category.label)}</th>
    <td class="num">${disciplineCount(category.students)}</td>
    <td class="num">${disciplineRate(category.students, 'ratePct')}</td>
    <td class="num">${disciplineCount(category.actions)}</td>
    <td class="num">${category.actions?.ratePer100 == null ? '<span class="na">—</span>' : category.actions.ratePer100.toFixed(2)}</td>
    ${comparisonCell(vm, publicMetric.disciplineCategoryStudents(current.year, category.key), 'pct')}
    ${comparisonCell(vm, publicMetric.disciplineCategoryActions(current.year, category.key), 'rate')}
  </tr>`)

  return section(
    'discipline',
    'Discipline and removal from class',
    `${stats}
    ${current && all ? `<div class="comparison-readout-grid" aria-label="Selected comparison discipline rates">
      ${comparisonReadout(vm, publicMetric.disciplineStudents(current.year), {
        format: 'pct', label: `Share of students · ${schoolYear(current.year)}`,
      })}
      ${comparisonReadout(vm, publicMetric.disciplineActions(current.year), {
        format: 'rate', label: `Actions per 100 students · ${schoolYear(current.year)}`,
      })}
    </div>` : ''}
    ${historyRows.length ? table({
      caption: `TEA all-discipline student and action counts by school year for ${vm.name}`,
      className: 'data scroll discipline-history',
      head: [
        'School year',
        { label: 'Cumulative enrollment', num: true },
        { label: 'Students', sub: 'all discipline', num: true },
        { label: 'Students', sub: '% of enrollment', num: true },
        { label: 'Actions', sub: 'all discipline', num: true },
        { label: 'Actions', sub: 'per 100 students', num: true },
        { label: 'Students', sub: 'selected comparison average %', num: true },
        { label: 'Actions', sub: 'selected comparison average per 100', num: true },
      ],
      rows: historyRows,
    }) : ''}
    ${categoryRows.length ? `<details class="data-details"><summary>See ${esc(schoolYear(current.year))} discipline categories</summary>${table({
      caption: `TEA discipline categories for ${vm.name} in ${schoolYear(current.year)}`,
      className: 'data scroll discipline-categories',
      head: [
        'Category',
        { label: 'Students', num: true },
        { label: 'Students', sub: '% of enrollment', num: true },
        { label: 'Actions', num: true },
        { label: 'Actions', sub: 'per 100 students', num: true },
        { label: 'Students', sub: 'selected comparison average %', num: true },
        { label: 'Actions', sub: 'selected comparison average per 100', num: true },
      ],
      rows: categoryRows,
    })}</details>` : ''}
    <p class="note">Selected comparisons use rates, not raw counts, so differently sized ${comparisonUnits(vm)} can be read on the same basis. Each average uses only group members for which TEA reported that rate; this ${unit(vm)}'s own counts and rates remain fixed.</p>
    <p class="note"><strong>Students, actions and incidents are different units.</strong> One student can receive multiple actions. The categories overlap, so they must not be added together. Rates use TEA's matching cumulative year-end enrollment, not the October enrollment shown elsewhere on this page.</p>
    <p class="note">Source: TEA <a href="${esc(meta.source ?? 'https://tea.texas.gov/data-reports/student-data/discipline-data-products/discipline-reports')}" rel="nofollow">Discipline Reports</a>${meta.fetchedAt ? `, fetched ${esc(meta.fetchedAt)}` : ''}. Suppressed values stay unavailable rather than being estimated. Use 2020–21 cautiously because remote instruction during the pandemic changed students' exposure to in-person discipline. TEA consolidated its separate action-group reports into this product in 2024–25; this trend uses only the stable “All discipline” heading.</p>`,
    'TEA’s annual student and action counts, kept separate and divided only by the matching full-year enrollment. These figures describe removals from instruction, not a simple safe-or-unsafe score.'
  )
}

/* ------------------------------------------------------ official notices -- */

const improvementName = (kind) => ({
  CSI: 'Comprehensive Support and Improvement',
  TSI: 'Targeted Support and Improvement',
  ATS: 'Additional Targeted Support',
}[kind] ?? kind)

const noticeLabel = (notice) => {
  const parts = []
  if (notice.improvement) parts.push(esc(notice.improvement.kind))
  if (notice.peg) parts.push('PEG transfer list')
  return parts.join(' + ')
}

/**
 * These are dated government statuses, not another score. A missing section
 * means the campus is not in either source list; it does not become a badge
 * claiming the school is free of every state or federal intervention.
 */
export function actionNotices(vm) {
  const notices = Array.isArray(vm.actionNotices) ? vm.actionNotices : []
  if (!notices.length) return null

  const improvement = notices.filter((notice) => notice.improvement)
  const peg = notices.filter((notice) => notice.peg)
  const meta = vm.publicDataMeta?.actionFlags ?? {}
  const improvementUrl = meta.sources?.improvement ?? 'https://tea2.tea.texas.gov/school-and-district-leaders/reporting-and-accountability'
  const pegUrl = meta.sources?.pegProgram ?? 'https://tea.texas.gov/school-and-district-leaders/accountability/academic-accountability/performance-reporting/public-education-grant'

  if (vm.level === 'district') {
    const rows = notices.map((notice) => {
      const details = [
        notice.improvement
          ? `${improvementName(notice.improvement.kind)}${notice.improvement.reason ? ` · ${esc(notice.improvement.reason)}` : ''}`
          : null,
        notice.peg ? `Final ${esc(notice.peg.schoolYear)} PEG list` : null,
      ].filter(Boolean).join('<br>')
      const name = notice.href ? `<a href="${esc(notice.href)}">${esc(notice.name)}</a>` : esc(notice.name)
      return `<tr><th scope="row" class="wrap">${name}</th><td><span class="notice-tag">${noticeLabel(notice)}</span></td><td class="wrap">${details}</td></tr>`
    })
    return section(
      'official-notices',
      'Official improvement and transfer notices',
      `${statGrid([
        ['Campuses identified for federal improvement support', num(improvement.length), '2026 TEA list'],
        ['Campuses on the final PEG transfer list', num(peg.length), '2026–27 school year'],
      ])}
      <div class="comparison-readout-grid" aria-label="Selected comparison notice prevalence">
        ${comparisonReadout(vm, publicMetric.districtImprovementShare, {
          format: 'pct', label: 'Share of campuses identified for improvement',
        })}
        ${comparisonReadout(vm, publicMetric.districtPegShare, {
          format: 'pct', label: 'Share of campuses on the PEG list',
        })}
      </div>
      <details class="notice-disclosure"><summary>See the campuses and official reasons</summary>
      ${table({
        caption: `Official improvement and Public Education Grant notices for campuses in ${vm.name}`,
        className: 'data scroll notice-table',
        head: ['Campus', 'Notice', 'Official status or reason'],
        rows,
      })}</details>
      <p class="note">Selected comparison percentages describe how common each dated campus notice is across reporting ${comparisonUnits(vm)} in that group. They are neutral prevalence context; changing the comparison never changes a campus's official status.</p>
      <p class="note">Sources: TEA's <a href="${esc(improvementUrl)}" rel="nofollow">2026 Schools Identified for Improvement</a> and <a href="${esc(pegUrl)}" rel="nofollow">Public Education Grant program</a>${meta.fetchedAt ? `, fetched ${esc(meta.fetchedAt)}` : ''}. A PEG listing makes a student assigned to that campus eligible to <em>request</em> a transfer; it does not guarantee acceptance, available space or transportation.</p>`,
      `Dated TEA notices for campuses in this ${unit(vm)}. They are shown separately from the ${unit(vm)} rating because they describe specific campuses, support programs and transfer eligibility.`
    )
  }

  const cards = notices.flatMap((notice) => [
    notice.improvement
      ? `<article class="notice-card">
          <p class="eyebrow">2026 federal improvement status</p>
          <h3>${esc(improvementName(notice.improvement.kind))}</h3>
          <p><strong>Official support label:</strong> ${esc(notice.improvement.supportLabel || notice.improvement.kind)}</p>
          ${notice.improvement.reason ? `<p><strong>Identification reason:</strong> ${esc(notice.improvement.reason)}</p>` : ''}
          ${finite(notice.improvement.trackYear) ? `<p class="note">TEA track year ${num(notice.improvement.trackYear)}${notice.improvement.titleI ? ' · Title I campus' : ''}</p>` : ''}
          <p><a href="${esc(improvementUrl)}" rel="nofollow">Open the official TEA list and methodology</a></p>
        </article>`
      : null,
    notice.peg
      ? `<article class="notice-card notice-card-action">
          <p class="eyebrow">${esc(notice.peg.schoolYear)} school year</p>
          <h3>Public Education Grant transfer eligibility</h3>
          <p>Students assigned to this campus may request a transfer under the state's PEG program.</p>
          <p><strong>A request is not guaranteed.</strong> A receiving district may apply its enrollment rules, and transportation is not automatically provided.</p>
          <p><a href="${esc(pegUrl)}" rel="nofollow">Read the official PEG rules and list</a></p>
        </article>`
      : null,
  ]).filter(Boolean).join('')

  return section(
    'official-notices',
    'Official improvement and transfer notices',
    `<div class="notice-cards">${cards}</div>
     <div class="comparison-readout-grid" aria-label="Selected comparison notice prevalence">
       ${comparisonReadout(vm, publicMetric.campusImprovement, {
         format: 'pct', label: 'Schools identified for improvement', showDelta: false,
         entityDisplay: vm.own?.[publicMetric.campusImprovement] > 0 ? 'Listed' : 'Not listed',
       })}
       ${comparisonReadout(vm, publicMetric.campusPeg, {
         format: 'pct', label: 'Schools on the PEG list', showDelta: false,
         entityDisplay: vm.own?.[publicMetric.campusPeg] > 0 ? 'Listed' : 'Not listed',
       })}
     </div>
     <p class="note">Selected comparison percentages are the share of reporting schools in that group found on each dated list. They are neutral prevalence context; changing the comparison never changes this school's official status.</p>
     <p class="note">These are dated TEA statuses${meta.fetchedAt ? `, fetched ${esc(meta.fetchedAt)}` : ''}; they are not added to or subtracted from this site's rating.</p>`,
    'Official state and federal designations can carry support, reporting requirements or a family transfer option that a single A–F rating does not explain.'
  )
}

/* ----------------------------------------------------- community context -- */

export function community(vm) {
  const c = vm.communityContext
  if (vm.level !== 'district' || !c) return null
  const meta = vm.publicDataMeta?.community ?? {}
  return section(
    'community',
    'Community around the district',
    `${statGrid([
      ['People living inside the district boundary', num(c.totalPopulation), `2024 Census estimate`],
      ['Children ages 5–17', num(c.schoolAgePopulation), 'Living inside the boundary'],
      ['Children ages 5–17 in families in poverty', num(c.schoolAgePoverty), pct(c.schoolAgePovertyRate)],
      ['School-age child poverty rate', pct(c.schoolAgePovertyRate), `${num(c.schoolAgePoverty)} of ${num(c.schoolAgePopulation)}`],
    ])}
    <div class="comparison-readout-grid" aria-label="Selected comparison community averages">
      ${comparisonReadout(vm, publicMetric.communityPopulation, {
        format: 'count', label: 'Boundary population', showDelta: false,
      })}
      ${comparisonReadout(vm, publicMetric.communitySchoolAge, {
        format: 'count', label: 'School-age population', showDelta: false,
      })}
      ${comparisonReadout(vm, publicMetric.communitySchoolAgePoverty, {
        format: 'count', label: 'School-age population in poverty', showDelta: false,
      })}
      ${comparisonReadout(vm, publicMetric.communitySchoolAgePovertyRate, {
        format: 'pct', label: 'School-age child poverty rate',
      })}
    </div>
    <p class="note">Population averages provide neutral scale context and can differ sharply across a region, county or the state. The poverty-rate comparison is the like-for-like percentage; none of these Census measures is treated as school performance.</p>
    <p class="note">Source: U.S. Census Bureau <a href="${esc(meta.landing ?? 'https://www.census.gov/data/datasets/2024/demo/saipe/2024-school-districts.html')}" rel="nofollow">2024 Small Area Income and Poverty Estimates</a>${meta.fetchedAt ? `, fetched ${esc(meta.fetchedAt)}` : ''}. These are modeled estimates for residents inside the geographic district, not the students enrolled by the district. A family's poverty status is context, never a school-quality measure.</p>`,
    'A district serves a place as well as a roster. These Census estimates describe the resident community without treating its circumstances as an explanation or a verdict on students.'
  )
}

/* ------------------------------------------------- after high school data -- */

export function postsecondary(vm) {
  const p = vm.postsecondaryOutcome
  if (!p) return null
  const meta = vm.publicDataMeta?.postsecondary ?? {}
  const destinations = Array.isArray(p.destinations) && p.destinations.length
    ? `<h3>Most common named Texas public destinations</h3>
       <ol class="destination-list">${p.destinations.map((d) => `<li><span>${esc(d.institution)}</span><strong>${num(d.students)}</strong></li>`).join('')}</ol>`
    : ''
  return section(
    'postsecondary',
    'After high school: the following fall',
    `${statGrid([
      ['Graduates in the report', num(p.graduates), `Class of ${esc(schoolYear(p.graduateYear))}`],
      ['Enrolled in Texas public higher education', num(p.enrolledPublic), `${pct(p.rate)} of graduates`],
      ['Not found in Texas public higher-ed records', num(p.notFound), `${p.graduates ? pct((p.notFound / p.graduates) * 100) : '—'} of graduates`],
      ['Not trackable', num(p.notTrackable), p.fallTerm],
    ])}
    <div class="comparison-readout-grid" aria-label="Selected comparison postsecondary averages">
      ${comparisonReadout(vm, publicMetric.postsecondaryGraduates, {
        format: 'count', label: 'Graduates in the report', showDelta: false,
      })}
      ${comparisonReadout(vm, publicMetric.postsecondaryEnrolled, {
        format: 'count', label: 'Enrolled in Texas public higher education', showDelta: false,
      })}
      ${comparisonReadout(vm, publicMetric.postsecondaryRate, {
        format: 'pct', label: 'Texas-public enrollment rate',
      })}
      ${comparisonReadout(vm, publicMetric.postsecondaryNotFoundRate, {
        format: 'pct', label: 'Not-found rate',
      })}
      ${comparisonReadout(vm, publicMetric.postsecondaryNotTrackableRate, {
        format: 'pct', label: 'Not-trackable rate',
      })}
    </div>
    ${destinations}
    <p class="note">Selected comparison counts are neutral cohort scale context. The percentages put differently sized graduating classes on the same basis, but still cover only the limited Texas-public system observed by this report.</p>
    <p class="note">Source: Texas Higher Education Coordinating Board, <a href="${esc(meta.landing ?? 'https://www.txhighereddata.org/high-school-graduates/hsgradsenrolled/')}" rel="nofollow">high-school graduates enrolled in higher education</a>${meta.fetchedAt ? `, fetched ${esc(meta.fetchedAt)}` : ''}. The report covers graduates who enrolled in a Texas public college or university the following fall and includes only districts or campuses with more than 25 graduates.</p>
    <p class="note"><strong>“Not found” does not mean a graduate did not continue their education.</strong> It can include private or out-of-state college, work, military service, enrollment after the fall term, or another path the Texas public system does not observe.</p>
    <p class="note"><strong>“Not trackable” is not an outcome.</strong> THECB uses it for graduates with a non-standard identifier that could not be matched to higher-education records.</p>`,
    `Where ${vm.level === 'district' ? 'district' : 'school'} graduates appeared in Texas public higher-education records the fall after graduation. This is a limited next-step measure, not an eventual college-going or completion rate.`
  )
}

/* ------------------------------------------------------------------ money -- */

export function spending(vm) {
  if (!vm.finance?.years?.length) return null
  const f = vm.finance
  const active = vm.cohorts?.[0] ?? null
  const cohortMetricKeys = f.years.map((year) => publicMetric.spending(year))
  const selectedValues = cohortMetricKeys.map((key) => active?.metrics?.[key] ?? null)
  const selectedLatestIndex = selectedValues.findLastIndex(finite)
  const selectedLatestReporting = selectedLatestIndex >= 0
    ? active?.metricN?.[cohortMetricKeys[selectedLatestIndex]]
    : null
  const hasSelectedComparison = (vm.cohorts ?? []).some((cohort) =>
    cohortMetricKeys.some((key) => finite(cohort?.metrics?.[key]))
  )
  const latestComparisonIndex = cohortMetricKeys.findLastIndex((key) =>
    (vm.cohorts ?? []).some((cohort) => finite(cohort?.metrics?.[key]))
  )
  const selected = active && selectedValues.some(finite)
    ? {
        key: 'selected',
        label: active.key === 'state'
          ? `Selected comparison: txschools.net ${vm.isCharter ? 'Texas charter average' : 'statewide cohort average'}${finite(selectedLatestReporting) ? ` (${num(selectedLatestReporting)} rated Texas ${comparisonUnits(vm)} reporting for ${esc(f.years[selectedLatestIndex])})` : ''}`
          : active.key === 'size'
            ? `Selected comparison: average for ${comparisonAverageTarget(vm, active)}`
            : `Selected comparison: ${active.label}`,
        values: selectedValues,
      }
    : null
  const definitions = [
    { key: 'entity', field: 'spendEntity', label: vm.name },
    // A campus finance record carries its own expenditure and its parent
    // district's expenditure as two different series. Keep the latter fixed
    // while the page-wide selected comparison changes. `peer` supplies an
    // existing distinct line/swatch treatment; the visible label names the
    // parent explicitly, so it can never be read as the site's peer cohort.
    ...(vm.level === 'campus'
      ? [{ key: 'peer', field: 'spendDistrict', label: `Parent district: ${vm.districtName ?? 'Not named'}` }]
      : []),
    // `tea`, rather than `peer`: this is TEA's own published peer reference,
    // not this site's selectable economic-context cohort.
    { key: 'tea', field: 'spendPeer', label: 'TEA peer group' },
    { key: 'state', field: 'spendState', label: 'Texas average' },
  ]
  const available = definitions
    .map((d) => ({ ...d, values: Array.isArray(f[d.field]) ? f[d.field] : [] }))
    .filter((d) => d.values.some(finite))
  const missing = definitions.filter((d) => !available.some((a) => a.key === d.key))
  const chartSeries = [...available, selected].filter(Boolean)
  // Keep the dollar scale fixed while the reader moves among the site's five
  // standard comparison groups. If the domain were derived only from the
  // currently selected line, the district's unchanged dollar values would
  // jump vertically and look as though they had changed. Include every
  // available cohort here; the client receives this same domain below.
  const stableDomain = cmpDomain([
    ...available.flatMap((series) => series.values),
    ...(vm.cohorts ?? []).flatMap((cohort) =>
      cohortMetricKeys.map((key) => cohort?.metrics?.[key]).filter(finite)
    ),
  ])

  const gap = (value, label) => {
    if (!finite(value)) return null
    if (Math.abs(value) < 0.5) return `<strong>about the same</strong> per student as ${label}`
    return `<strong>${usd(Math.abs(value))} ${value > 0 ? 'more' : 'less'}</strong> per student than ${label}`
  }
  const comparisons = [gap(f.vsPeer, "TEA's peer group"), gap(f.vsState, 'the state average')].filter(Boolean)
  const campusLatestIndex = vm.level === 'campus' ? f.spendEntity?.findLastIndex(finite) ?? -1 : -1
  const campusLatestFigures = campusLatestIndex >= 0
    ? [
        ['this campus', f.spendEntity?.[campusLatestIndex]],
        [`its parent district${vm.districtName ? `, ${esc(vm.districtName)}` : ''}`, f.spendDistrict?.[campusLatestIndex]],
        ["TEA's peer group", f.spendPeer?.[campusLatestIndex]],
        ['the Texas average', f.spendState?.[campusLatestIndex]],
      ].filter(([, value]) => finite(value))
    : []
  const campusComparisonNote = campusLatestFigures.length
    ? `<p class="callout">For ${esc(schoolYear(f.years[campusLatestIndex]))}, TEA reported ${campusLatestFigures
        .map(([label, value]) => `<strong>${usd(value)}</strong> per student for ${label}`)
        .join(campusLatestFigures.length === 1 ? '' : campusLatestFigures.length === 2 ? ' and ' : ', ')
        .replace(/, ([^,]+)$/, ', and $1')}.</p>`
    : `<p class="note na">TEA did not publish a current campus spending figure.</p>`
  const comparisonNote = vm.level === 'campus'
    ? campusComparisonNote
    : comparisons.length
      ? `<p class="callout">This ${unit(vm)} spends ${comparisons.join(comparisons.length === 2 ? ', and ' : '')}.</p>`
      : `<p class="note na">TEA did not publish a current peer-group or statewide comparison for this ${unit(vm)}.</p>`

  const figures = available.length
    ? table({
        caption: 'Spending per student by year',
        head: [
          'Year',
          ...available.map((s) => ({ label: s.label, num: true })),
          ...(hasSelectedComparison
            ? [
                { label: 'Selected comparison average', num: true },
                { label: 'Reporting', sub: 'selected comparison', num: true },
              ]
            : []),
        ],
        rows: f.years.map(
          (year, i) =>
            `<tr><th scope="row">${esc(year)}</th>${available
              .map((s) => `<td class="num">${finite(s.values[i]) ? usd(s.values[i]) : '&mdash;'}</td>`)
              .join('')}${hasSelectedComparison ? `${comparisonCell(vm, cohortMetricKeys[i], 'usd')}<td class="num comparison-coverage-cell">${comparisonCoverage(vm, cohortMetricKeys[i])}</td>` : ''}</tr>`
        ),
      })
    : ''
  return section(
    'spending',
    'Spending per student',
    `${
      chartSeries.length
        ? comparisonChart({
            years: f.years,
            series: chartSeries.map(({ key, values }) => ({ key, values })),
            domain: stableDomain,
            fmt: (v) => `$${(v / 1000).toFixed(0)}k`,
          })
        : ''
    }
  ${chartSeries.length ? legend(chartSeries.map(({ key, label }) => ({ key, label }))) : ''}
  ${
    // The values this chart was drawn from, for site/app.js to redraw it with a
    // pinned district's line added. Spending was the one section that answered
    // to no comparison at all — not the cohort switch either — because its
    // three series are fixed and its SVG is the only copy of them. A reader who
    // pinned a neighbouring district saw every other figure on the page move
    // and this chart sit still.
    //
    // The same payload now serves campuses too. Its fixed series include the
    // campus and parent district independently; the selectable comparison is
    // still kept outside `series` so a switch cannot mutate either one.
    available.length
      ? `<script type="application/json" data-spending>${JSON.stringify({
          years: f.years,
          series: available.map(({ key, label, values }) => ({ key, label, values })),
          cohortMetricKeys,
          selected,
          domain: stableDomain,
        }).replace(/</g, '\\u003c')}</script>`
      : ''
  }
  ${latestComparisonIndex >= 0 ? comparisonReadout(vm, cohortMetricKeys[latestComparisonIndex], {
    format: 'usd',
    label: `Spending per student · ${esc(f.years[latestComparisonIndex])}`,
  }) : ''}
  ${comparisonNote}
  ${
    missing.length
      ? `<p class="note na">${vm.level === 'campus' ? 'Not reported in this TEA campus finance record' : 'Not reported by TEA for this entity'}: ${missing.map((d) => d.label).join(', ')}.</p>`
      : ''
  }
  ${figures ? `<details class="data-details"><summary>View yearly spending figures</summary>${figures}</details>` : ''}
  <p class="note">The selected-comparison reporting count is year-specific and can vary across the table. Dollar amounts are shown as TEA published them and are not adjusted for inflation.</p>`,
    vm.level === 'campus'
      ? "The campus and its parent district stay fixed while the selected same-sector txschools.net comparison changes with the page-wide control. TEA's own peer group and statewide reference remain visible as separately published, fixed TEA references."
      : "The selected txschools.net comparison changes with the page-wide control. TEA's own peer group and statewide reference stay visible as separately published, fixed TEA references."
  )
}

/* --------------------------------------------------------------- teachers -- */

export function teachers(vm) {
  const turnover = vm.teacherTurnover
  const classSize = vm.classSize
  const profileStats = [
    vm.profile?.avgSalary ? ['Average salary', usd(vm.profile.avgSalary) + contextCmp(vm, 'avgSalary', { fmt: 'usd' })] : null,
    vm.profile?.teachers ? ['Teachers', num(vm.profile.teachers) + contextCmp(vm, 'teachers', { fmt: 'ratio' })] : null,
    vm.profile?.stuPerStaff ? ['Students per staff member', num(vm.profile.stuPerStaff, 1) + contextCmp(vm, 'stuPerStaff', { fmt: 'ratio' })] : null,
  ]
  const exp = (vm.staffYears ?? []).map((v, i) => ({ label: EXPERIENCE[i], value: v })).filter((x) => x.value > 0)
  const turnoverHistory = turnover?.history ?? []
  const turnoverRows = turnoverHistory.map((point) => `<tr><th scope="row">${esc(schoolYear(point.year))}</th><td class="num">${point.ratePct == null ? '<span class="na">Not reported</span>' : pct(point.ratePct)}</td>${comparisonCell(vm, publicMetric.turnover(point.year), 'pct')}</tr>`)
  const classRows = (classSize?.categories ?? [])
    .filter((category) => category.studentsPerClass != null)
    .map((category) => `<tr><th scope="row" class="wrap">${esc(category.label)}</th><td class="num">${num(category.studentsPerClass, 1)}</td>${comparisonCell(vm, publicMetric.classSize(classSize.year, category.key), 'decimal')}</tr>`)
  if (!profileStats.some(Boolean) && !exp.length && !turnoverRows.length && !classRows.length) return null
  const meta = vm.publicDataMeta?.educators ?? {}
  return section(
    'teachers',
    vm.level === 'campus' && classRows.length ? 'Teachers and actual class size' : 'Teachers',
    `${profileStats.some(Boolean) ? statGrid(profileStats) : ''}
  ${exp.length ? `<h3>Teaching experience</h3>
    <p class="comparison-composition-title"><strong>${esc(vm.name)}</strong></p>
    ${stackedShare(exp)}${legend(exp.map((x, i) => ({ key: String(i % 7), label: `${x.label} ${x.value}%` })))}
    ${comparisonStackedShares(vm, 'experience', EXPERIENCE, 'Selected comparison average')}` : ''}
  ${turnoverRows.length ? `<h3>Teacher turnover over time</h3>
    ${turnover?.latest?.ratePct != null ? `<p class="callout">TEA reported a <strong>${pct(turnover.latest.ratePct)} teacher turnover rate</strong> in ${esc(schoolYear(turnover.latest.year))}.</p>` : ''}
    ${turnover?.latest?.ratePct != null ? comparisonReadout(vm, publicMetric.turnover(turnover.latest.year), {
      format: 'pct', label: `Teacher turnover rate · ${schoolYear(turnover.latest.year)}`,
    }) : ''}
    ${table({
      caption: `${vm.isCharter ? 'Charter-system' : 'District'} teacher turnover rate by school year for ${vm.name}`,
      className: 'data educator-table',
      head: [
        'School year',
        { label: 'Teacher turnover rate', sub: vm.name, num: true },
        { label: 'Average turnover rate', sub: 'selected comparison', num: true },
      ],
      rows: turnoverRows,
    })}
    <p class="note">TEA defines this ${unit(vm)} rate as the share of teacher full-time equivalents from the prior fall who are not employed as teachers in the ${unit(vm)} in the current fall. That can include leaving the ${unit(vm)} or remaining in a different role; it is not a campus-level measure. The comparison average changes with the selected group; this ${unit(vm)}'s reported rate does not.</p>` : ''}
  ${classRows.length ? `<h3>Average students in a class</h3>
    ${table({
      caption: `TEA average class size by grade or subject for ${vm.name} in ${schoolYear(classSize.year)}`,
      className: 'data educator-table',
      head: [
        'Grade or subject',
        { label: 'Average students per class', sub: `${vm.name} · ${schoolYear(classSize.year)}`, num: true },
        { label: 'Average students per class', sub: 'selected comparison', num: true },
      ],
      rows: classRows,
    })}
    <p class="note">These are TEA's actual class-size averages for the grade or subject shown, not the student-to-teacher ratio. TEA reported ${num(classSize.reported)} of 12 categories for this campus; the categories are not combined into a made-up campus-wide average. Each selected comparison average uses only schools reporting that same grade or subject.</p>` : ''}
  ${(turnoverRows.length || classRows.length) ? `<p class="note">Source: TEA <a href="${esc(meta.source ?? 'https://tea.texas.gov/texas-schools/accountability/academic-accountability/performance-reporting/texas-academic-performance-reports')}" rel="nofollow">Texas Academic Performance Reports</a>${meta.fetchedAt ? `, fetched ${esc(meta.fetchedAt)}` : ''}.</p>` : ''}`
  )
}

/* --------------------------------------------------------------- campuses -- */

export function campuses(vm) {
  if (!vm.campuses?.length) return null
  const system = vm.isCharter ? 'charter school system' : 'district'
  const typeCounts = [...vm.campuses.reduce((counts, c) => {
    const label = c.campusType ?? 'Other / not reported'
    counts.set(label, (counts.get(label) ?? 0) + 1)
    return counts
  }, new Map())]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const rows = vm.campuses.map(
    (c) =>
      `<tr><th scope="row"><a href="/campus/${esc(c.slug)}">${esc(c.name)}</a></th><td>${esc(c.campusType ?? '—')}</td><td>${grade(c.rating)}</td><td class="num">${c.score ?? '—'}</td><td class="num">${num(c.enrollment)}</td></tr>`
  )
  return section(
    'campuses',
    `${num(vm.campuses.length)} schools in this ${system}`,
    `${comparisonReadout(vm, publicMetric.districtCampusCount, {
      format: 'count', label: `Number of schools in the ${system}`, showDelta: false,
    })}
    <p class="note">The selected comparison is a neutral average ${system} size. This ${system}'s school count and school-type mix remain its own facts.</p>
    <dl class="campus-mix" aria-label="Schools by type">${typeCounts
      .map(([label, count]) => `<div><dt>${esc(label)}</dt><dd>${num(count)}</dd></div>`)
      .join('')}</dl>
    <details class="campus-roster">
      <summary><span>Browse all ${num(vm.campuses.length)} schools</span><small>Name, type, rating, score and enrollment</small></summary>
      ${table({
        caption: `Schools in this ${system}`,
        head: ['School', 'Type', 'Rating', { label: 'Score', num: true }, { label: 'Students', num: true }],
        rows,
        className: 'data scroll',
      })}
    </details>`
  )
}

/* -------------------------------------------------------------- standouts -- */

const ordSuffix = (i) => { const s = ['th','st','nd','rd'], v = i % 100; return s[(v - 20) % 10] || s[v] || s[0] }

/** A sentence someone can paste into a newsletter and have it hold up. */
export const claimSentence = (vm, r) => {
  const unit = comparisonUnits(vm)
  const scope =
    r.cohort === 'state' ? `Texas ${unit}`
    : r.cohort === 'peer' ? `${unit} serving a similar share of economically disadvantaged students`
    : r.cohort === 'size' ? `similarly sized ${unit}`
    : `${unit} in ${r.cohortLabel}`
  const tie = r.tied > 0 ? `, tied with ${r.tied} other${r.tied === 1 ? '' : 's'}` : ''
  const dir = r.lowerIsBetter ? 'lowest' : 'highest'
  // The measure is named where the sentence first refers to it. It used to read
  // "...of 19 districts in Harris County that report this measure for College,
  // career or military ready" — "this measure" pointing at something not yet
  // named, and the name bolted on after the denominator. Pasted into an email
  // or a story, that reads as a rank with no measure attached until the very
  // end, which is the one thing a citable sentence cannot afford.
  //
  // "among the N ... that report it" keeps the denominator qualifier doing its
  // job — the n is a count of who reports THIS measure, not of who exists —
  // while letting "it" refer back to a measure the reader has already been
  // given. Entity first, because a citation is about the entity.
  return `${vm.name} ranks ${r.rank}${ordSuffix(r.rank)} for ${r.label} among the ${r.of} ${scope} that report it (${dir}, 2025-26)${tie}. Source: txschools.net`
}

export function standouts(vm) {
  // "Where this district ranks best" is a claim about performance, so a metric
  // with no good direction cannot appear in it. metrics.js drops these before a
  // rank row exists at all; this is the presentation-side lock, so a view model
  // assembled elsewhere still cannot put a poverty rate under this heading.
  const placements = (vm.standouts ?? []).filter((r) => !isContextMetric(r.metric))
  if (!placements.length) return null

  const rowsFor = (placements) => placements
    .map((r) => {
      const claim = claimSentence(vm, r)
      // The whole ranking, not just this entity's place in it — pointed at the
      // page of it that carries this entity's own row (rankedBoard). A
      // placement measured against the peer band has no page to point at
      // (see the note above rankingPositions) and simply carries no link,
      // rather than borrowing a statewide list it was not measured against.
      const board = rankedBoard(vm, r.metric, r.cohort, r.rank, r.of, r.lowerIsBetter)
      // "full ranking" is now true of every board: paging replaced truncation,
      // so the ordering a reader arrives in is complete rather than its first
      // slice. Where that ordering runs to more than one page the text says
      // which page the link lands on, because "full ranking" pointing at page
      // 13 of 16 would otherwise read as a promise the destination breaks.
      // The aria-label carries the board's own title, so a screen reader hears
      // what the destination claims rather than a word this list chose for it.
      const linkText = !board ? '' : board.page > 1 ? `full ranking (page ${num(board.page)})` : 'full ranking'
      const ariaLabel = !board
        ? ''
        : board.page > 1
        ? `${esc(board.title ?? `Full ranking: ${r.label}, ${r.cohortLabel}`)}, page ${num(board.page)}`
        : `Full ranking: ${esc(r.label)}, ${esc(r.cohortLabel)}`
      const full = board
        ? ` &middot; <a href="${esc(board.href)}" aria-label="${ariaLabel}">${linkText}</a>`
        : ''
      return `<li class="standout">
      <div class="standout-rank"><span class="standout-n">${r.rank}</span><span class="standout-of">of ${num(r.of)}</span></div>
      <div class="standout-body">
        <p class="standout-metric">${esc(r.label)}${r.lowerIsBetter ? ' <span class="standout-dir">(lowest is best)</span>' : ''}</p>
        <p class="standout-scope">${esc(r.cohortLabel)} &middot; of the ${num(r.of)} that report this measure${r.tied > 0 ? ` &middot; tied with ${num(r.tied)}` : ''}${full}</p>
      </div>
      <button type="button" class="copy" data-claim="${esc(claim)}" aria-label="Copy this statement">Copy</button>
    </li>`
    })
    .join('\n    ')
  const bucketSpecs = [
    {
      key: 'first',
      title: '#1 rankings',
      description: 'First-place results',
      includes: (r) => r.rank === 1,
    },
    {
      key: 'top-three',
      title: '#2–3 rankings',
      description: 'Second- and third-place results',
      includes: (r) => r.rank >= 2 && r.rank <= 3,
    },
    {
      key: 'top-ten',
      title: '#4–10 rankings',
      description: 'Fourth- through tenth-place results',
      includes: (r) => r.rank >= 4 && r.rank <= 10,
    },
    {
      key: 'top-five-percent',
      title: 'Other top-5% rankings',
      description: 'High placements in larger reporting groups',
      includes: (r) => r.rank > 10,
    },
  ]
  const buckets = bucketSpecs
    .map((bucket) => ({ ...bucket, placements: placements.filter(bucket.includes) }))
    .filter((bucket) => bucket.placements.length)
    .map((bucket) => `<section class="standout-bucket" aria-labelledby="standout-bucket-${bucket.key}">
      <div class="standout-bucket-heading">
        <div>
          <h3 id="standout-bucket-${bucket.key}">${bucket.title}</h3>
          <p>${bucket.description}</p>
        </div>
        <p class="standout-bucket-count">${plural(bucket.placements.length, 'measure')}</p>
      </div>
      <ul class="standouts">${rowsFor(bucket.placements)}</ul>
    </section>`)
    .join('\n  ')

  // The section's own escape hatch out of the selection. "These are selected
  // high placements" is only an honest disclosure if the unselected ones are
  // reachable, and until the ranking pages existed they were not reachable from
  // anywhere on the site.
  const allRankings = vm.rankingsIndex
    ? ` <a href="${esc(vm.rankingsIndex)}">Every ranking this site publishes</a>, including the ones
  no ${unit(vm)} would put in a press release.`
    : ''

  return section(
    'standouts',
    `Where this ${unit(vm)} ranks best`,
    `<div class="standout-buckets">${buckets}</div>
  <p class="note"><strong>These are selected high placements, not a summary.</strong> Every figure above
  this section is the full picture, including where this ${unit(vm)} ranks poorly. Each measure appears
  once here, using its strongest qualifying placement across all available comparison groups. Very large ties are left out because they do not distinguish this ${unit(vm)}; any
  tie that does appear is labeled.${allRankings}</p>`,
    `Out of ${num(vm.ranks.length)} rankings computed across every published metric and every available comparison group, these are all the measures that meet this site&rsquo;s distinctive-placement threshold. The list does not change when you change Compare against. Each measure appears once, using its strongest placement. Press Copy for a citable sentence.`
  )
}

/* ----------------------------------------------------------------- source -- */

export function source(vm) {
  return section(
    'source',
    'Where this comes from',
    `<p>The Texas Education Agency publishes the underlying accountability reports and data downloads. Ratings,
     outcomes, demographics, staffing and finance on this page come from TEA data available through
     <a href="https://txschools.gov/?view=${vm.level}&amp;id=${esc(vm.id)}&amp;lng=en" rel="nofollow">txschools.gov</a>,
     ${vm.snapshotDate ? `fetched ${esc(vm.snapshotDate)}. ` : ''}<a href="https://tea.texas.gov/school-and-district-leaders/accountability/academic-accountability/performance-reporting/texas-education-agency-reports-and-data-portal" rel="nofollow">TEA&rsquo;s Reports and Data Portal</a>
     links the official bulk files. Enrollment history comes from TEA's
     <a href="${esc(vm.enrollmentSourceUrl ?? 'https://rptsvr1.tea.texas.gov/adhocrpt/adspr.html')}" rel="nofollow">PEIMS Student Program and Special Populations reports</a>${vm.enrollmentSnapshotDate ? `, fetched ${esc(vm.enrollmentSnapshotDate)}` : ''}.
     ${vm.accountabilityContext ? `The student-count context comes from TEA&rsquo;s <a href="${esc(vm.publicDataMeta?.accountability?.source ?? 'https://rptsvr1.tea.texas.gov/perfreport/account/acct_download?year=2026')}" rel="nofollow">bulk accountability summary</a>${vm.publicDataMeta?.accountability?.fetchedAt ? `, fetched ${esc(vm.publicDataMeta.accountability.fetchedAt)}` : ''}${vm.publicDataMeta?.accountability?.masking ? `; <a href="${esc(vm.publicDataMeta.accountability.masking)}" rel="nofollow">TEA&rsquo;s masking definitions</a> explain withheld values` : ''}. ` : ''}The dated notice, staffing, discipline, transfer, community and postsecondary sections cite their separate TEA, Census or THECB publication in place. Every archived source carries checksums so each number stays traceable to the bytes the public agency served.</p>
  ${downloadLinks(vm)}`
  )
}

/**
 * Per-entity files are pre-generated for districts only. 9,086 entities in two
 * formats would consume most of the site&rsquo;s 20,000-asset deployment cap before
 * any page, chart or source file is counted, so campus files are never written (see the note at the top of
 * src/prerender.js). _redirects cannot rescue them either — a splat there is
 * followed whether or not an asset matches, which took out all real district
 * files when it was tried. So the link has to be honest at the source: a
 * campus page links what exists rather than a file that 404s.
 */
const downloadLinks = (vm) =>
  vm.level === 'district'
    ? `<p class="downloads"><a href="/data/entity/${esc(vm.id)}.csv" download>Download this ${vm.isCharter ? 'charter school system' : 'district'} as CSV</a> &middot;
     <a href="/data/entity/${esc(vm.id)}.json" download>JSON</a> &middot;
     <a href="/download">the whole dataset</a></p>`
    : `<p class="downloads"><a href="/download">Download the full dataset</a>${
        vm.districtSlug ? ` &middot; <a href="/district/${esc(vm.districtSlug)}#source">this campus's district</a>` : ''
      }</p>
  <p class="note">Single-file records are pre-built for district-level records only, so there is no per-campus CSV to
     link here. Producing both formats for every entity would consume most of the 20,000-asset deployment limit before
     pages and shared data are counted. This campus is a row
     in the bulk files on the download page, keyed by its TEA id <code>${esc(vm.id)}</code>.</p>`

/** Page order. */
export const SECTIONS = [
  verdict,
  actionNotices,
  trajectory,
  domains,
  outcomes,
  postsecondary,
  students,
  accountabilityContext,
  enrollment,
  transfers,
  discipline,
  community,
  campuses,
  spending,
  teachers,
  standouts,
  source,
]
