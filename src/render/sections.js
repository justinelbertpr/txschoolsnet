// Every section is (vm) => html | null. The shell composes whatever returns
// content, so a district with no finance data, or a campus TEA declined to rate,
// needs no special-case anywhere — the section simply returns null and vanishes.
//
// Order here IS the page order. Adding a section is one function plus one entry
// in SECTIONS at the bottom.

import { cmp, esc, fmtDelta, grade, legend, navList, num, ordinal, pct, section, statGrid, table, usd } from './shell.js'
import { trajectoryChart, scoreBars, stackedShare, comparisonChart, groupedBars } from './charts.js'
import { RACE, EXPERIENCE, STAAR_LEVELS, GRADUATION, COMPLETION, CCMR } from './labels.js'
import { closestCounted, countedDomains, isContextMetric } from './metrics.js'
// LIST_LIMIT only — a number, not a renderer, so importing it does not pull
// this file into rankings-page.js's own layout choices. It is what decides
// which of the two boards for a metric actually lists this entity: see
// rankedBoard below.
import { LIST_LIMIT } from './rankings-page.js'

/* ------------------------------------------------------------------ words -- */

// Counts reach the page as prose, so the noun has to agree with the number. One
// year is a year, one student is a student. 179 pages read "1 years of ratings"
// and 61 read "1 students" before this existed.
const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`

// The reader-facing noun for the two levels. TEA calls a school a "campus";
// a parent calls it a school, and this noun is only ever used in prose a
// parent reads (the verdict says the same thing — see verdictSummary below).
// TEA's own word stays correct where it names TEA's own methodology, on /about.
const unit = (vm) => (vm.level === 'district' ? 'district' : 'school')

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
 * end ('top' | 'bottom'), holding the { href, title } of a ranking page that
 * WAS ACTUALLY WRITTEN. Consequences, and all three are the point:
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
 *   A link only exists where the BOARD actually lists this entity. rankings-
 *   page.js prints only the first LIST_LIMIT rows of a long ordering — the
 *   statewide campus boards run to roughly 8,500 entities and print 1,500 of
 *   them — so an entity ranked past that slice is not on the 'top' (highest-
 *   value-first) page at all, and one ranked past it from the OTHER end is
 *   not on the 'bottom' page either. Linking the wrong end, or an end that
 *   contains neither, sends the reader to a table that does not have this
 *   entity's own row in it: a verified defect on ~82% of campus pages before
 *   this existed. rankedBoard below is what closes it — it compares the
 *   entity's own rank and population against LIST_LIMIT and returns the one
 *   board (of the two that exist for a metric) whose printed rows actually
 *   include this entity, or null when neither slice does.
 */
const finite = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * Which end of an ordering — 'top' (highest value first) or 'bottom' (lowest
 * value first) — actually prints this entity's row, given its rank OUT OF a
 * population and LIST_LIMIT (src/render/rankings-page.js), the same cutoff
 * renderRankingPage prints a page's rows to. Returns null for the (large, for
 * a statewide campus board) middle band that is on neither page.
 *
 * `rank` here is the GOODNESS rank metrics.js:rankAll computes — 1st is
 * always the best result, whichever direction "best" runs. The two published
 * boards are not goodness-ordered, though: 'top' is sorted by VALUE, highest
 * first, and 'bottom' by value, lowest first (rankings-page.js's own rule —
 * "highest"/"lowest" name the number, never the result, which is why chronic
 * absence has a "highest" page that is its worst end). For a higher-is-better
 * metric the two agree, so goodness rank IS value-descending position. For a
 * lower-is-better one (chronic absence, dropout) the best row — rank 1 — has
 * the SMALLEST value, so it sits at the very end of the 'top' ordering and at
 * position 1 of the 'bottom' one; the formulas below swap accordingly rather
 * than assuming every metric reads the way score does.
 */
export const rankingEnd = (rank, of, lowerIsBetter = false) => {
  if (!finite(rank) || !finite(of) || of <= 0 || rank < 1 || rank > of) return null
  const posFromTop = lowerIsBetter ? of - rank + 1 : rank
  const posFromBottom = lowerIsBetter ? rank : of - rank + 1
  if (posFromTop <= LIST_LIMIT) return 'top'
  if (posFromBottom <= LIST_LIMIT) return 'bottom'
  return null
}

/**
 * The one board (of the two that exist for a metric+cohort) whose printed
 * rows actually contain this entity, or null when neither does — see the
 * note above. `{ href, title }`, where `title` is the board's own heading
 * ("Texas school districts with the highest overall score"), read off the
 * index rather than composed here, so a caller can label a link with a claim
 * the linked page actually makes instead of inventing its own completeness
 * claim ("Every ... ranked by ...") that a 1,500-row slice cannot back.
 */
export const rankedBoard = (vm, metric, cohort, rank, of, lowerIsBetter = false) => {
  const end = rankingEnd(rank, of, lowerIsBetter)
  const board = end && vm?.rankingLinks?.[cohort]?.[metric]?.[end]
  return board && typeof board.href === 'string' && board.href ? { ...board, end } : null
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
  if (other == null) return ''
  return `<span class="cmp cmp-neutral" data-metric="${esc(key)}" data-fmt="${esc(fmt)}" data-neutral="1">${fmtDelta(
    mine - other,
    fmt
  )} <span class="cmp-vs">vs ${esc(active.short)}</span></span>`
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
function verdictSummary(vm) {
  const latest = vm.history?.[0]
  // Reader-facing nouns. TEA calls them campuses; a parent calls them schools,
  // and this is the sentence a parent reads.
  const units = vm.level === 'district' ? 'districts' : 'schools'
  const one = vm.level === 'district' ? 'district' : 'school'

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

  const peer =
    vm.peerAvg != null && vm.peerN > 1
      ? `${versus(latest.score, vm.peerAvg)} the ${vm.peerAvg.toFixed(1)} average of the ${num(vm.peerN)} ${units} serving a similar share of economically disadvantaged students`
      : null
  const state = vm.stateAvg != null ? `${versus(latest.score, vm.stateAvg)} the statewide average of ${vm.stateAvg.toFixed(1)}` : null

  const against = peer && state ? ` — ${peer}, and ${state}.` : peer ? ` — ${peer}.` : state ? ` — ${state}.` : '.'

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
      earliest.year === '2021-22' && vm.originalScore != null
        ? ` — both years scored under TEA's current rules, since TEA rewrote them in 2023; under the rules in force back then it scored <strong>${vm.originalScore}</strong>`
        : ''
    trend = `It ${move}${rescored}.`
  }

  /* --- the rank, which is a denominator claim rather than a verdict --- */

  // Both placements link to the list they came out of, where one was built —
  // and where this entity's own rank actually places it in that list's
  // printed rows (rankedBoard; see the note above rankingEnd). The link text
  // is the whole claim — "400th of 1,184 Texas districts" — rather than a
  // bare "see the ranking" tacked on the end, so the destination is described
  // by the thing the reader is already looking at. The aria-label is the
  // linked board's OWN heading, read off the index rather than composed here
  // — it used to say "Every Texas school ranked by overall score", which is
  // false the moment the board is a 1,500-row slice of ~8,500 (every
  // statewide campus board); a board's own title never claims more than it
  // shows.
  // Built inside the branch, not above it: ordinal() has no answer for a null
  // rank and throws, and an entity TEA did not rate has no placement at all.
  const share = (n) => (n > 0 ? ` (tied with ${plural(n, 'other')})` : '')
  const stateBoard = rankedBoard(vm, 'score', 'state', vm.rank, vm.rankOf)
  const regionBoard = rankedBoard(vm, 'score', 'region', vm.regionRank, vm.regionRankOf)
  const rank = !(vm.rank && vm.rankOf)
    ? null
    : `Ranks ${linked(
        stateBoard?.href ?? null,
        `${ordinal(vm.rank)} of ${num(vm.rankOf)} Texas ${units}`,
        stateBoard?.title ?? null
      )}${share(vm.rankTied)}, and ${linked(
        regionBoard?.href ?? null,
        `${ordinal(vm.regionRank)} of ${num(vm.regionRankOf)} in ${esc(vm.regionName)}`,
        regionBoard?.title ?? null
      )}${share(vm.regionRankTied)}.`

  return { summary: `${head}${against} ${trend}`, rank }
}

export function verdict(vm) {
  const latest = vm.history[0]
  const kind = vm.level === 'district' ? 'District' : 'Campus'

  const alert =
    vm.multYear > 0
      ? `<p class="alert"><strong>${vm.multYear} consecutive ${vm.multYear === 1 ? 'year' : 'years'}</strong> rated unacceptable.${
          vm.multYear >= 3 ? ' At three or more years, Texas law provides for state intervention.' : ''
        }</p>`
      : ''

  const { summary, rank } = verdictSummary(vm)

  return `<section class="hero" id="${HERO_ID}" data-rail-label="${esc(HERO_LABEL)}">
  <p class="eyebrow">${kind} &middot; Traditional${vm.isAlt ? ' &middot; Alternative Education Accountability' : ''}</p>
  <h1>${esc(vm.name)}</h1>
  <p class="place">${esc(vm.county)} County &middot; ${esc(vm.regionName)}${vm.enrollment ? ` &middot; ${plural(vm.enrollment, 'student')}` : ''}</p>
  ${vm.website ? `<p class="enroll"><a href="https://${esc(vm.website)}" rel="nofollow">Learn more &amp; enroll</a></p>` : ''}
  <div class="verdict">
    ${grade(latest?.rating, latest?.score, 'lg')}
    <p class="summary">${summary}</p>
  </div>
  ${rank ? `<p class="note summary-rank">${rank}</p>` : ''}
  ${alert}
  ${vm.notRated ? `<p class="note">TEA did not issue an overall rating for this ${unit(vm)}. Scores below are the figures TEA published; the letter grades are the state's where it issued them.</p>` : ''}
</section>`
}

/* ------------------------------------------------------------- trajectory -- */

export function trajectory(vm) {
  if (!vm.history?.length) return null
  const years = [...vm.history].reverse().map((h) => h.year)
  const mine = [...vm.history].reverse().map((h) => h.score)
  const peer = vm.peerByYear ? years.map((y) => vm.peerByYear[y] ?? null) : null
  const state = vm.stateByYear ? years.map((y) => vm.stateByYear[y] ?? null) : null

  const rows = vm.history.map((h) => {
    const p = vm.peerByYear?.[h.year]
    return `<tr><th scope="row">${esc(h.year)}</th><td>${grade(h.rating)}</td><td class="num">${h.score ?? '—'}</td><td class="num">${p == null ? '—' : p.toFixed(1)}</td><td class="num">${vm.stateByYear?.[h.year]?.toFixed(1) ?? '—'}</td></tr>`
  })

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

  // Two comparisons are on by default so the page is complete without JavaScript.
  // The picker below is progressive enhancement: it swaps which cohorts are drawn.
  const defaults = ['peer', 'state'].filter((k) => comparisons.some((c) => c.key === k))
  const picker = comparisons.length
    ? `<div class="picker" role="group" aria-label="Choose comparisons">
    <span class="picker-label">Compare against</span>
    ${comparisons
      .map(
        (c) =>
          `<button type="button" class="chip" data-cmp="${esc(c.key)}" aria-pressed="${defaults.includes(c.key)}"${
            c.note ? ` title="${esc(c.note)}"` : ''
          }><span class="chip-dot chip-dot-${esc(c.key)}"></span>${esc(c.label)}<span class="chip-n">${num(c.n)}</span></button>`
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
        })),
        defaults,
      }).replace(/</g, '\\u003c')}</script>`
    : ''

  return section(
    'trajectory',
    `${plural(vm.history.length, 'year')} of ratings`,
    `${picker}
  ${trajectoryChart({ years, series: [
      { key: 'entity', values: mine, label: vm.name },
      // This is the line's accessible name. It was fixed at 'Districts like this
      // one' on 8,857 campus pages — the only string in the legend not switched
      // on the level of the page it appears on.
      peer ? { key: 'peer', values: peer, label: vm.level === 'district' ? 'Districts like this one' : 'Schools like this one' } : null,
      state ? { key: 'state', values: state, label: 'Texas average' } : null,
    ].filter(Boolean) })}
  ${payload}
  ${note ? `<p class="note">${note}</p>` : ''}
  ${table({
      caption: 'Rating history with comparisons',
      head: ['Year', 'Rating', { label: 'Score', num: true }, { label: 'Similar', num: true }, { label: 'State', num: true }],
      rows,
    })}`
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
    { label: `Texas ${vm.level === 'district' ? 'districts' : 'schools'}`, items: changeBoardItems(vm.rankingLinks?.state) },
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
        label: d.label,
        score: d.score,
        grade: derivedGrades ? d.grade : null,
        // The cohort's own key (peer/region/county/state), not a slot index.
        // vm.cohorts is [peer?, region?, county?, state] with state always
        // last, so a fixed "second slot is state" reads a region or county
        // cohort's tick in --c-state teal — the colour every other page on
        // the site uses for "Texas average".
        markers: (vm.cohorts ?? []).slice(0, 2).map((c) => ({
          key: c.key,
          label: c.label,
          short: c.short,
          value: c.metrics[`domain:${d.domain}`] ?? null,
        })),
      }))
    )}
  ${vm.cohorts?.length ? legend([{ key: 'entity', label: vm.name }, ...vm.cohorts.slice(0, 2).map((c) => ({ key: c.key, label: `${c.label} (${num(c.n)})` }))]) : ''}
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
        })),
        compareKey: tickCohort?.key ?? 'peer',
        compareLabel: tickCohort?.label ?? 'Similar schools',
      })}
  ${legend([...STAAR_LEVELS.map((label, i) => ({ key: `l${i}`, label })), tickCohort ? { key: tickCohort.key, label: `Tick: ${tickCohort.label} (${num(tickCohort.n)})` } : null].filter(Boolean))}
  <p class="note">Percentage of tests at or above each level. Masters is a subset of Meets, which is a subset of Approaches. ${
    // "Texas average" is itself the cohort's label, so "the average for Texas
    // average" is avoided as a special case rather than as the general rule.
    tickCohort
      ? tickCohort.key === 'state'
        ? `The tick on each bar marks the statewide average (${num(tickCohort.n)} ${vm.level === 'district' ? 'districts' : 'schools'})`
        : `The tick on each bar marks the average for <strong>${esc(tickCohort.label)}</strong> (${num(tickCohort.n)} ${vm.level === 'district' ? 'districts' : 'schools'})`
      : `The tick on each bar marks the average for ${vm.level === 'district' ? 'districts' : 'schools'} serving a similar share of economically disadvantaged students`
  } &mdash; a comparison TEA does not publish.</p>`
    : ''

  const grad = vm.graduation?.length
    ? `<h3>${vm.isAlt ? 'Completion' : 'Graduation'}</h3>
  ${statGrid(vm.graduation.map((g, i) => [g.label.replace(/ (Graduation|Completion) Rate/, ''), pct(g.value) + cmp(vm, `grad:${i}`, { fmt: 'pct', invert: g.label === 'Dropout Rate' })]))}`
    : ''

  const ccmr = vm.ccmr?.length
    ? `<h3>College, career and military readiness</h3>
  ${table({
        caption: 'CCMR criteria',
        head: ['Criterion', { label: 'This ' + (vm.level === 'district' ? 'district' : 'school'), num: true }, { label: vm.cohorts?.[0]?.short ?? 'Cohort', num: true }, { label: 'Gap', num: true }],
        rows: vm.ccmr.map((c, i) => {
          const other = vm.cohorts?.[0]?.metrics[`ccmr:${i}`] ?? null
          const mine = vm.own?.[`ccmr:${i}`] ?? null
          const gap = mine != null && other != null ? mine - other : null
          return `<tr><th scope="row" class="wrap">${esc(c.label)}</th><td class="num">${c.value ?? '—'}</td><td class="num">${other == null ? '—' : other.toFixed(1) + '%'}</td><td class="num">${gap == null ? '—' : `<span class="${gap >= 0 ? 'cmp-up' : 'cmp-down'}">${gap >= 0 ? '+' : '−'}${Math.abs(gap).toFixed(1)}</span>`}</td></tr>`
        }),
      })}`
    : ''

  return section('outcomes', 'Student outcomes', `${staar}\n  ${grad}\n  ${ccmr}`)
}

/* ------------------------------------------------------------- who it serves */

export function students(vm) {
  if (!vm.profile) return null
  const race = (vm.raceShare ?? []).map((v, i) => ({ label: RACE[i], value: v })).filter((r) => r.value > 0)
  return section(
    'students',
    `Who this ${vm.level === 'district' ? 'district' : 'school'} serves`,
    `${statGrid([
      ['Students', num(vm.profile.total)],
      // Three context metrics, three neutral chips: see contextCmp.
      ['Economically disadvantaged', pct(vm.profile.ecoDisPct) + contextCmp(vm, 'ecoDis')],
      ['English learners', pct(vm.profile.engLrnPct) + contextCmp(vm, 'engLrn')],
      ['Special education', pct(vm.profile.specEdPct) + contextCmp(vm, 'specEd')],
      ['Attendance', pct(vm.profile.attendance) + cmp(vm, 'attendance', { fmt: 'pct' })],
      ['Chronically absent', pct(vm.profile.absenteeism) + cmp(vm, 'absenteeism', { fmt: 'pct', invert: true })],
    ])}
  ${race.length ? `<h3>Student demographics</h3>${stackedShare(race)}${legend(race.map((r, i) => ({ key: String(i % 7), label: `${r.label} ${r.value}%` })))}` : ''}`,
    'Placed after the results deliberately: this is context for reading them, not an explanation of them.'
  )
}

/* ------------------------------------------------------------------ money -- */

export function spending(vm) {
  if (!vm.finance?.years?.length) return null
  const f = vm.finance
  const missing = ['spendPeer', 'spendState', 'spendEntity'].filter((k) => f[k].every((v) => v === null))
  return section(
    'spending',
    'Spending per student',
    `${comparisonChart({
      years: f.years,
      series: [
        { key: 'entity', values: f.spendEntity },
        // 'tea', not 'peer': this is the one figure whose "peer" is TEA's own
        // 40-district group, not this site's cohort — a different population
        // behind an identical-looking word, so it gets its own key rather than
        // reusing 'peer' and relying on a #spending CSS scope to repaint it.
        { key: 'tea', values: f.spendPeer },
        { key: 'state', values: f.spendState },
      ].filter((s) => !s.values.every((v) => v === null)),
      fmt: (v) => `$${(v / 1000).toFixed(0)}k`,
    })}
  ${legend([
      { key: 'entity', label: vm.name },
      { key: 'tea', label: 'TEA peer group' },
      { key: 'state', label: 'Texas average' },
    ])}
  ${
    f.vsPeer != null
      ? `<p class="callout">Spends <strong>${usd(Math.abs(f.vsPeer))} ${f.vsPeer > 0 ? 'more' : 'less'}</strong> per student than its peer group, and <strong>${usd(Math.abs(f.vsState))} ${f.vsState > 0 ? 'more' : 'less'}</strong> than the state average.</p>`
      : `<p class="note na">TEA's published file does not include peer-group spending for this entity, so no comparison is shown.</p>`
  }
  ${missing.length ? `<p class="note na">Not reported by TEA for this entity: ${missing.map((m) => m.replace('spend', '').toLowerCase()).join(', ')}.</p>` : ''}`,
    "Compared against TEA's own peer group, which controls for size and student population, and against the state."
  )
}

/* --------------------------------------------------------------- teachers -- */

export function teachers(vm) {
  if (!vm.profile?.avgSalary) return null
  const exp = (vm.staffYears ?? []).map((v, i) => ({ label: EXPERIENCE[i], value: v })).filter((x) => x.value > 0)
  return section(
    'teachers',
    'Teachers',
    `${statGrid([
      ['Average salary', usd(vm.profile.avgSalary) + cmp(vm, 'avgSalary', { fmt: 'usd' })],
      vm.profile.teachers ? ['Teachers', num(vm.profile.teachers)] : null,
      vm.profile.stuPerStaff ? ['Students per staff member', num(vm.profile.stuPerStaff, 1)] : null,
    ])}
  ${exp.length ? `<h3>Teaching experience</h3>${stackedShare(exp)}${legend(exp.map((x, i) => ({ key: String(i % 7), label: `${x.label} ${x.value}%` })))}` : ''}`
  )
}

/* --------------------------------------------------------------- campuses -- */

export function campuses(vm) {
  if (!vm.campuses?.length) return null
  const rows = vm.campuses.map(
    (c) =>
      `<tr><th scope="row"><a href="/campus/${esc(c.slug)}">${esc(c.name)}</a></th><td>${esc(c.campusType ?? '—')}</td><td>${grade(c.rating)}</td><td class="num">${c.score ?? '—'}</td><td class="num">${num(c.enrollment)}</td></tr>`
  )
  return section(
    'campuses',
    `${num(vm.campuses.length)} schools in this district`,
    table({
      caption: 'Schools in this district',
      head: ['School', 'Type', 'Rating', { label: 'Score', num: true }, { label: 'Students', num: true }],
      rows,
      className: 'data scroll',
    })
  )
}

/* -------------------------------------------------------------- standouts -- */

const ordSuffix = (i) => { const s = ['th','st','nd','rd'], v = i % 100; return s[(v - 20) % 10] || s[v] || s[0] }

/** A sentence someone can paste into a newsletter and have it hold up. */
export const claimSentence = (vm, r) => {
  const unit = vm.level === 'district' ? 'districts' : 'schools'
  const scope =
    r.cohort === 'state' ? `Texas ${unit}`
    : r.cohort === 'peer' ? `${unit} serving a similar share of economically disadvantaged students`
    : `${unit} in ${r.cohortLabel}`
  const tie = r.tied > 0 ? `, tied with ${r.tied} other${r.tied === 1 ? '' : 's'}` : ''
  const reporting = ' that report this measure'
  const dir = r.lowerIsBetter ? 'lowest' : 'highest'
  return `${vm.name} ranks ${r.rank}${ordSuffix(r.rank)} of ${r.of} ${scope}${reporting} for ${r.label} (${dir}, 2025-26)${tie}. Source: txschools.net`
}

export function standouts(vm) {
  // "Where this district ranks best" is a claim about performance, so a metric
  // with no good direction cannot appear in it. metrics.js drops these before a
  // rank row exists at all; this is the presentation-side lock, so a view model
  // assembled elsewhere still cannot put a poverty rate under this heading.
  const placements = (vm.standouts ?? []).filter((r) => !isContextMetric(r.metric))
  if (!placements.length) return null

  const rows = placements
    .map((r) => {
      const claim = claimSentence(vm, r)
      // The whole ranking, not just this entity's place in it — and, since a
      // long board prints only its first LIST_LIMIT rows, only when this
      // entity's own row is actually one of them (rankedBoard). A placement
      // measured against the peer band has no page to point at either way
      // (see the note above rankingEnd) and simply carries no link, rather
      // than borrowing a statewide list it was not measured against.
      const board = rankedBoard(vm, r.metric, r.cohort, r.rank, r.of, r.lowerIsBetter)
      // "full ranking" only when the board really is the whole thing: a
      // board covering more than LIST_LIMIT entities prints a slice, and
      // calling a slice "full" is the same false completeness claim the
      // verdict's rank line used to make. The link text says so; the
      // aria-label carries the board's own title either way, so a screen
      // reader hears what the destination actually claims rather than a
      // word this list chose for it.
      const complete = !!board && finite(r.of) && r.of <= LIST_LIMIT
      const linkText = !board ? '' : complete ? 'full ranking' : `ranking (${board.end} ${num(LIST_LIMIT)} shown)`
      const ariaLabel = !board
        ? ''
        : complete
        ? `Full ranking: ${esc(r.label)}, ${esc(r.cohortLabel)}`
        : esc(board.title ?? '')
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
    'Where this ' + (vm.level === 'district' ? 'district' : 'school') + ' ranks best',
    `<ul class="standouts">
    ${rows}
  </ul>
  <p class="note"><strong>These are selected high placements, not a summary.</strong> Every figure above
  this section is the full picture, including where this ${vm.level} ranks poorly. Each statement below
  states its cohort and its denominator so it can be checked — a rank without an n is a boast, not a
  fact. Ties are shown because a shared ceiling is not a sole first place.${allRankings}</p>`,
    `Out of ${num(vm.ranks.length)} rankings computed across every published metric and every comparison group, these are the placements that stand out. Press Copy for a citable sentence.`
  )
}

/* ----------------------------------------------------------------- source -- */

export function source(vm) {
  return section(
    'source',
    'Where this comes from',
    `<p>Every figure on this page comes from data the Texas Education Agency publishes at
     <a href="https://txschools.gov/?view=${vm.level}&amp;id=${esc(vm.id)}&amp;lng=en" rel="nofollow">txschools.gov</a>,
     fetched ${esc(vm.snapshotDate)} and archived with a checksum so each number stays traceable to the bytes TEA served.</p>
  ${downloadLinks(vm)}`
  )
}

/**
 * Per-entity files are pre-generated for districts only. 9,086 entities in two
 * formats is 18,172 assets, which on top of the rest of what this site
 * publishes is past the 20,000-asset cap a Workers version is capped at, so
 * the 8,066 campus files are never written (see the note at the top of
 * src/prerender.js). _redirects cannot rescue them either — a splat there is
 * followed whether or not an asset matches, which took out all real district
 * files when it was tried. So the link has to be honest at the source: a
 * campus page links what exists rather than a file that 404s.
 */
const downloadLinks = (vm) =>
  vm.level === 'district'
    ? `<p class="downloads"><a href="/data/entity/${esc(vm.id)}.csv" download>Download this district as CSV</a> &middot;
     <a href="/data/entity/${esc(vm.id)}.json" download>JSON</a> &middot;
     <a href="/download">the whole dataset</a></p>`
    : `<p class="downloads"><a href="/download">Download the full dataset</a>${
        vm.districtSlug ? ` &middot; <a href="/district/${esc(vm.districtSlug)}#source">this campus's district</a>` : ''
      }</p>
  <p class="note">Single-file records are pre-built for districts only, so there is no per-campus CSV to
     link here &mdash; 9,086 entities in two formats is 18,172 assets, on top of everything else this site
     publishes, and that is past the 20,000-asset limit this site is published under. This campus is a row
     in the bulk files on the download page, keyed by its TEA id <code>${esc(vm.id)}</code>.</p>`

/** Page order. */
export const SECTIONS = [verdict, trajectory, changeRankings, domains, outcomes, students, spending, teachers, standouts, campuses, source]
