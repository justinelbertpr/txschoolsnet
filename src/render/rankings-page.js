// The ranked lists, as documents.
//
// Everything else on this site answers "how did THIS school do?". A ranked list
// answers "who did best, out of how many?" — the question a reporter had to
// download ratings.csv to answer, and the only kind of page here that another
// newsroom has a reason to link. So these pages are static HTML with no
// JavaScript anywhere in them: the table is the content, and a crawler that
// never runs a script must be able to read every row of it.
//
// This module is presentation only. It computes no metric and reads no build
// table: it is handed rows and states exactly what it was handed. The ranking
// itself comes from src/render/rankings.js (RANKABLE / rankBy / changeMetrics /
// SCOPES); the arithmetic of ranks and ties is redone here anyway, from the
// values in the rows, because a placement is the one number on this site that
// must not be able to disagree with the column beside it.
//
// ------------------------------------------------------------ THE FIVE RULES
//
// 1. Every page states its population, its n, and what was excluded. A rank
//    without a denominator is a boast. `excludedLines` below will not let a
//    page print "1,184 districts" when it was told the population is 1,199
//    without also printing where the other 15 went — and if the reasons it was
//    given do not add up to the difference, it says so rather than rounding the
//    discrepancy away.
//
// 2. Ties are ties. Two districts sharing 3rd both print 3rd, the next
//    placement is 5th, and the page says in words that it works that way.
//
// 3. Only the flattering end is published. Every metric here has a direction
//    (rankings.js:rankable's `dir`/`lowerIsBetter`) — a higher score is better,
//    a lower dropout rate is better — and the catalogue below emits exactly one
//    end of each ordering: the one where 1st place is the best result. That is
//    the site owner's explicit call, made after this module shipped both ends
//    (see git history): txschools.net does not compile a standalone list of the
//    worst-scoring districts, the lowest scores, or the steepest rating drops.
//    It is a publishing decision, not a data one — every entity's own page
//    still shows its real score, its real grade and its real trend, bad ones
//    included, and rankings.js still computes the whole ordering underneath
//    (an entity's "412th of 1,184" on its own page reads off the same ranked
//    array a board would). What stops is assembling that ordering into an
//    indexable, linkable, shareable page whose entire subject is who is doing
//    worst. `goodEnd` below is the one place that decision is made; nothing
//    downstream re-derives it.
//
// 4. Demographics are never ranked. metrics.js:isContextMetric is imported
//    rather than re-listed, and renderRankingPage THROWS on a context metric —
//    "most economically disadvantaged districts" is not a leaderboard and must
//    be impossible to render here, not merely absent from the catalogue.
//
// 5. Nothing is invented. A column appears only when the rows carry it and the
//    caller supplied its label; a comparison sentence appears only when both
//    sides were given. Same rule the hubs follow.
//
// --------------------------------------------------------------- FILE BUDGET
//
// site/ holds 12,971 files against a CI guard of 18,000 and a Cloudflare hard
// cap of 20,000, so there are 5,029 spare and every page here spends one.
// Metrics x scopes explodes even at one page per metric: ~26 rankable district
// metrics x 274 scopes is 7,124 pages, which is not affordable and would not
// be read.
//
// The plan (DEFAULT_PLAN, below) and its arithmetic, against a RANKABLE of the
// 26 non-context metrics metrics.js declares for a district plus ~6 change
// metrics the multi-year tables actually support. Rule 3 above means every
// metric now spends ONE file, not two — its good end only, from `goodEnd`:
//
//     statewide districts   x 32 rankable metrics                =   32
//     statewide campuses    x  8 headline measures                =    8
//     20 regions, districts x  2 headline measures                =   40
//     the rankings index                                          =    1
//     ------------------------------------------------------------------
//                                                                     81
//
// 12,971 + 81 = 13,052, which is 4,948 under the CI guard and 6,948 under the
// hard cap — more headroom than when both ends were published, because Rule 3
// halves the catalogue by construction rather than by trimming a metric or a
// scope. rankingCatalogue() computes the exact figure from the metric list it
// is handed rather than trusting this comment, and throws above
// MAX_RANKING_PAGES (400), so a future metric added to RANKABLE cannot quietly
// multiply into the file cap — the build fails and someone chooses. The region
// row is where a loose selector would hurt: one more metric matching there is
// 20 pages, not 1, which is why that plan entry carries a hard `limit`.
//
// Counties are deliberately absent. 253 counties x even two metrics is 506
// pages, and most counties hold fewer than the 10 rated districts metrics.js
// already refuses to publish a rank out of. The county hubs list their
// districts by score; that is the right resolution for that population.

import {
  esc,
  fmtDelta,
  grade,
  navList,
  num,
  ordinal,
  pct,
  section,
  shell,
  table,
  usd,
  SITE_ORIGIN,
} from './shell.js'
import { entitySlug, slugify } from './view-model.js'
import { isContextMetric } from './metrics.js'
import { MIN_POPULATION } from './rankings.js'
import { datasetCsv, OFFICIAL_SOURCE } from './downloads.js'

/* ------------------------------------------------------------- primitives -- */

export const RANKINGS_ROOT = 'rankings'
export const RANKINGS_HREF = '/rankings'

/** How many rows the lead table shows before the full list, ties permitting. */
export const TOP_N = 20

/**
 * Below this, one table is the whole page: a "top 20" above a list of 23 is the
 * same rows twice with a rule between them.
 */
export const SHORT_LIST = 25

/**
 * The most rows any one page prints. 1,199 districts fit — that population is
 * the reason this module exists — but 9,031 campuses in one table is a
 * megabyte of markup nobody scrolls. Above the limit the page prints the top
 * slice and says plainly that it is a slice, with the download linked for the
 * rest. It never calls a truncated list "all".
 */
export const LIST_LIMIT = 1500

/** metrics.js will not publish a rank out of fewer than 10, and neither will this. */
export const MIN_RANKED = 10

/** The build fails rather than silently spending the file budget. See FILE BUDGET. */
export const MAX_RANKING_PAGES = 400

const finite = (v) => typeof v === 'number' && Number.isFinite(v)

const PLURAL = { district: 'districts', campus: 'campuses' }
const SINGULAR = { district: 'district', campus: 'campus' }

const levelPlural = (level) => PLURAL[level] ?? `${level ?? 'entity'}s`
const levelSingular = (level) => SINGULAR[level] ?? level ?? 'entity'
const countOf = (n, level) => `${num(n)} ${n === 1 ? levelSingular(level) : levelPlural(level)}`

/**
 * A change metric is one whose values are differences, not levels. It reads
 * differently everywhere — "+3.0" not "3.0", "largest gains" not "highest",
 * gains/declines rather than highest/lowest in the URL — so it is detected once,
 * here, from whatever the metric object happens to declare. A metric that
 * declares none of these is treated as a level, which is the safe reading: a
 * level printed without a sign is still true.
 */
export const isChangeMetric = (m) =>
  m?.change === true || m?.kind === 'change' || m?.fmt === 'delta' || /^change[:-]/.test(String(m?.key ?? ''))

/** true when a smaller number is the better result (dropout, chronic absence). */
export const lowerIsBetter = (m) => m?.lowerIsBetter === true || m?.dir === 'lower'

/**
 * The one end of an ordering this site publishes for a given metric: whichever
 * one puts the best result in 1st place. See Rule 3 at the top of this file.
 *
 * 'top' and 'bottom' name a VALUE direction (endSlug: highest/lowest,
 * gains/declines), never a goodness direction, so the good end is not always
 * 'top'. For a higher-is-better metric (score, attendance, spending) the
 * highest figure IS the best result, so 'top' is the good end and the
 * catalogue's "-highest" page is the flattering one. For a lower-is-better
 * metric (chronic absenteeism, dropout rate) the LOWEST figure is the best
 * result, so 'bottom' is the good end — the catalogue's "-lowest" page for
 * chronic absenteeism is the one showing the districts with the LEAST chronic
 * absence, and it is "-highest" that would have been the worst-performers
 * list. Getting this backwards for a lower-is-better metric would keep
 * exactly the leaderboard Rule 3 exists to drop and drop the one it exists to
 * keep, so this is the one function every caller that decides what to publish
 * must go through rather than assuming 'top'.
 *
 * A change metric's good end follows the same rule from the metric's own
 * direction, not from whether it happens to be a change: an increase in score
 * is a gain because score is higher-is-better, not because 'top' always means
 * gains. No change metric in CHANGE_METRICS (rankings.js) is lower-is-better
 * today, so in practice every change board's good end is 'top' — but a future
 * one (a decrease being the improvement) would resolve correctly without this
 * function needing to change.
 */
export const goodEnd = (metric) => (lowerIsBetter(metric) ? 'bottom' : 'top')

/* ------------------------------------------------------------------ paths -- */

/**
 * `texas-districts`, `texas-campuses`, `region-10-districts`. Two path segments
 * per page and no deeper: /rankings/<scope>/<metric>-<end>. Directories are free
 * under Cloudflare's asset count but a five-segment URL is not free to read.
 */
export const scopeSlug = (scope) => {
  const level = levelPlural(scope?.level ?? 'district')
  if (scope?.slug) return `${slugify(scope.slug)}-${level}`
  const kind = scope?.kind ?? 'state'
  if (kind === 'state') return `texas-${level}`
  const id = scope?.id ?? scope?.label ?? ''
  return `${slugify(`${kind}-${id}`)}-${level}`
}

/**
 * `highest` / `lowest` for a level, `gains` / `declines` for a change. Both are
 * statements about the VALUE, never about the result: "highest" on chronic
 * absence is the worst end of that list, and the page says so in words rather
 * than lying in the URL by calling it "worst" or "best".
 */
export const endSlug = (metric, end) =>
  isChangeMetric(metric) ? (end === 'bottom' ? 'declines' : 'gains') : end === 'bottom' ? 'lowest' : 'highest'

export const metricSlug = (metric) => slugify(metric?.slug ?? metric?.key ?? metric?.label ?? 'metric')

/** Site-relative path, no extension and no leading slash: what the sitemap wants. */
export const rankingPath = ({ scope, metric, end = 'top' }) =>
  `${RANKINGS_ROOT}/${scopeSlug(scope)}/${metricSlug(metric)}-${endSlug(metric, end)}`

export const rankingHref = (spec) => `/${rankingPath(spec)}`
export const rankingFile = (spec) => `${rankingPath(spec)}.html`

/**
 * The board's own CSV, referenced the way the page itself has to reach it: a
 * bare relative filename, same basename as the HTML, sitting in the same
 * directory. src/prerender.js is the file-writing driver and is not imported
 * here — see the top-of-file note on what this module may depend on — so its
 * `rankingCsvFile(htmlFile)` (same rule, `.html` -> `.csv`, applied to the
 * path it already has) is a second, independent statement of this same
 * convention rather than a shared function, and the two are expected to
 * agree because both start from `rankingPath`.
 */
export const rankingCsvHref = (spec) => {
  const path = rankingPath(spec)
  return `${path.slice(path.lastIndexOf('/') + 1)}.csv`
}

/* ------------------------------------------------------------------ words -- */

/**
 * True when a label carries a capital past its first word — "Student
 * Achievement", "Reading — Approaches", "Four-Year Graduation Rate" — as
 * opposed to this site's usual sentence case, "Overall score" or
 * "Chronically absent". Checked on words split from every run of non-letters
 * (space, hyphen, the em dash STAAR labels use), so a hyphenated word or a
 * dash-joined phrase cannot hide a capital the way testing only the raw
 * string's second character would.
 */
const hasInternalCap = (s) => {
  const words = String(s ?? '').split(/[^A-Za-z]+/).filter(Boolean)
  return words.slice(1).some((w) => /^[A-Z]/.test(w))
}

/**
 * Sentence-cases a label for embedding mid-sentence: "Overall score" becomes
 * "overall score" so "the highest overall score" reads as English. Applied
 * ONLY when the label is sentence case throughout already — a label that is
 * Title Case throughout ("Student Achievement", "Four-Year Graduation Rate",
 * every domain and graduation-family label TEA's own bundle ships) is left
 * exactly as published. Lowercasing just its first letter would strand a
 * capital on every word after it — "student Achievement" — which is the
 * title-casing bug this split exists so as not to have.
 */
const lower1 = (s) => {
  const t = String(s ?? '')
  if (hasInternalCap(t)) return t
  return /^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t
}

/**
 * The thing measured, in prose. Falls back to the column label.
 *
 * An alternative-education-accountability metric (metric.population ===
 * 'aea') carries a suffix naming that: TEA judges these entities under a
 * different bar at the same array index (rankings.js:rankable), so without
 * this "Dropout Rate" is the identical string for both populations and the
 * AEA board renders a <title>, an <h1> and a lede byte-identical to its
 * standard sibling's — two different rankings sharing one page identity.
 */
const nounOf = (metric) => {
  const base = lower1(metric?.noun ?? metric?.label ?? metric?.key ?? 'measure')
  return metric?.population === 'aea' ? `${base} — alternative education` : base
}

/** "Texas school districts", "Region 10 school districts", "Texas campuses". */
export const populationLabel = (scope) => {
  if (scope?.population) return scope.population
  const level = scope?.level ?? 'district'
  const noun = level === 'district' ? 'school districts' : 'campuses'
  const where = scope?.label ?? (scope?.kind === 'state' ? 'Texas' : '')
  return where ? `${where} ${noun}` : noun
}

/**
 * The claim the page makes, which is also its <h1> and the first half of its
 * <title>. A caller may override it wholesale with meta.headline; the generated
 * form covers every metric the catalogue produces.
 */
export const rankingHeadline = ({ metric, scope, end = 'top', meta = {} }) => {
  if (meta.headline) return meta.headline
  const who = populationLabel(scope)
  const window = metric?.window ?? meta?.window ?? null
  const tail = window ? ` ${lower1(window)}` : ''
  if (isChangeMetric(metric)) {
    return `${who} with the largest ${nounOf(metric)} ${end === 'bottom' ? 'declines' : 'gains'}${tail}`
  }
  return `${who} with the ${end === 'bottom' ? 'lowest' : 'highest'} ${nounOf(metric)}${tail}`
}

/** Sentence-cased for a heading; the population is a proper noun so it survives. */
const asTitle = (s) => String(s ?? '').replace(/^./, (c) => c.toUpperCase())

/* ------------------------------------------------------------------ values -- */

/**
 * One formatter, chosen by the metric's own `fmt`, and signed when the metric is
 * a change. fmtDelta is shell.js's — the same "+3.0" / "−1.2" / "+$412" the
 * comparison chips use, so a delta reads identically wherever it appears.
 */
export const fmtValue = (v, metric) => {
  if (!finite(v)) return '—'
  const fmt = metric?.fmt ?? 'points'
  if (isChangeMetric(metric)) return fmtDelta(v, fmt)
  if (fmt === 'usd') return usd(v)
  if (fmt === 'pct') return pct(v, 1)
  if (fmt === 'count') return num(v)
  return num(v, 1)
}

/* ------------------------------------------------------------------ ranks -- */

/**
 * Competition rank, computed from the values rather than from array position.
 *
 * An array index would hand two districts on the same score different
 * placements purely by sort order, and this page presents a placement as a
 * fact. So: rank is one plus the number of entities strictly ahead, ties share
 * a placement, and the next placement skips — 1, 2, 2, 4. `tied` is how many
 * OTHERS hold the identical value, which is what the row badge and the tie
 * sentence both count. Mirrors metrics.js:rankAll and view-model.js:placement
 * deliberately; three different rank definitions on one site is how two pages
 * start disagreeing about the same district.
 *
 * A rank the caller supplied is kept, so a scope whose ranking was computed
 * against a larger population than the rows shown still prints the true one.
 */
export const withRanks = (rows, { end = 'top' } = {}) => {
  const vals = rows.map((r) => r.value).filter(finite)
  const sorted = [...vals].sort(end === 'bottom' ? (a, b) => a - b : (a, b) => b - a)
  const first = new Map()
  const seen = new Map()
  sorted.forEach((v, i) => {
    if (!first.has(v)) first.set(v, i + 1)
    seen.set(v, (seen.get(v) ?? 0) + 1)
  })
  return rows.map((r) => ({
    ...r,
    rank: finite(r.rank) ? r.rank : finite(r.value) ? first.get(r.value) : null,
    tied: finite(r.tied) ? r.tied : finite(r.value) ? seen.get(r.value) - 1 : null,
  }))
}

/**
 * The lead slice. Cutting at exactly 20 would split a tie — three districts
 * sharing 20th, two printed and one not — which is precisely the failure the
 * tie rule exists to prevent, so the slice runs to the end of whatever
 * placement it lands in and the heading reports the number it actually shows.
 */
export const topSlice = (rows, n = TOP_N) => {
  if (rows.length <= n) return rows
  const edge = rows[n - 1]?.rank
  if (!finite(edge)) return rows.slice(0, n)
  let i = n
  while (i < rows.length && rows[i].rank === edge) i += 1
  return rows.slice(0, i)
}

/* ------------------------------------------------------------------ table -- */

const entityHref = (row, scope) => {
  const level = row.level ?? scope?.level ?? 'district'
  const slug = row.slug ?? (row.name && row.id ? entitySlug(row) : null)
  return slug ? `/${level}/${esc(slug)}` : null
}

const nameCell = (row, scope) => {
  const href = entityHref(row, scope)
  const label = esc(row.name ?? row.id ?? '—')
  return `<th scope="row">${href ? `<a href="${href}">${label}</a>` : label}</th>`
}

/**
 * The rank cell. `tied` is printed as a word beside the placement rather than
 * left for the reader to notice that 4th is missing — and it is a real word in
 * the cell, not a colour or a symbol, so a screen reader reads "3rd tied" and a
 * reader who cannot distinguish the styling still gets the fact. `.chip-n` is
 * the site's existing muted-annotation class; `.na-sm` sizes itself from a
 * variable that only exists inside a chart, so it would render at full weight
 * here.
 */
const rankCell = (row) =>
  `<td class="num${finite(row.rank) && row.rank <= 3 ? ' rk-podium' : ''}">${
    finite(row.rank) ? esc(ordinal(row.rank)) : '—'
  }${finite(row.tied) && row.tied > 0 ? ` <span class="chip-n">tied</span>` : ''}</td>`

const whereCell = (row) => {
  if (row.districtName) {
    return `<td>${
      row.districtSlug ? `<a href="/district/${esc(row.districtSlug)}">${esc(row.districtName)}</a>` : esc(row.districtName)
    }</td>`
  }
  if (row.county) {
    const slug = row.countySlug ?? slugify(row.county)
    return `<td><a href="/county/${esc(slug)}">${esc(row.county)}</a></td>`
  }
  return '<td>—</td>'
}

/**
 * The columns are decided by what the rows carry and what the caller named. A
 * from/to pair appears only when BOTH its labels were supplied, because "Then"
 * and "Now" over two academic years is a caption this module would be inventing.
 */
const columnPlan = (rows, { metric, meta, wide }) => ({
  where: rows.some((r) => r.districtName || r.county),
  rating: wide && rows.some((r) => r.rating),
  span: !!(meta?.fromLabel && meta?.toLabel) && rows.some((r) => finite(r.from) && finite(r.to)),
  enrollment: wide && rows.some((r) => finite(r.enrollment)),
  metric,
})

/**
 * A span column's header. Bare, it is false the instant the column is
 * 2021-22 and the window carries a methodology note: that figure is TEA's
 * re-scored "2021-22 What If" score, not the one TEA originally published
 * that year, and a reader checking this column against TEA's own site would
 * find a different number under the same label. Only marked when the
 * caller's own meta.methodology says which year that is — this function does
 * not re-derive it.
 */
const spanColumnLabel = (label, meta) =>
  meta?.methodology && meta.methodology.year === label ? `${label} "What If"` : label

const rankingTable = (rows, { metric, scope, meta, caption, wide = false }) => {
  const plan = columnPlan(rows, { metric, meta, wide })
  const whereLabel = rows.some((r) => r.districtName) ? 'District' : 'County'

  // The endpoints of a change are LEVELS, not changes: a 2021-22 score of 74 is
  // "74", never "+74". Built explicitly rather than by spreading the metric,
  // because every one of isChangeMetric's signals — kind, fmt, the key prefix —
  // would survive a spread and re-sign the column.
  const base = { fmt: metric?.baseFmt ?? (metric?.fmt === 'delta' ? 'points' : metric?.fmt) }

  const head = [
    { label: 'Rank', num: true },
    asTitle(levelSingular(scope?.level ?? 'district')),
    plan.where ? whereLabel : null,
    plan.rating ? 'Rating' : null,
    { label: metric?.label ?? 'Value', num: true },
    plan.span ? { label: spanColumnLabel(meta.fromLabel, meta), num: true } : null,
    plan.span ? { label: spanColumnLabel(meta.toLabel, meta), num: true } : null,
    plan.enrollment ? { label: 'Students', num: true } : null,
  ].filter(Boolean)

  const body = rows.map(
    (r) =>
      `<tr>${rankCell(r)}${nameCell(r, scope)}${plan.where ? whereCell(r) : ''}${
        plan.rating ? `<td>${grade(r.rating)}</td>` : ''
      }<td class="num">${esc(fmtValue(r.value, metric))}</td>${
        plan.span
          ? `<td class="num">${esc(fmtValue(r.from, base))}</td><td class="num">${esc(fmtValue(r.to, base))}</td>`
          : ''
      }${plan.enrollment ? `<td class="num">${num(r.enrollment)}</td>` : ''}</tr>`
  )

  return table({ caption, head, rows: body, className: 'data scroll' })
}

/* ------------------------------------------------------- what was excluded -- */

/**
 * "1,184 of 1,199 districts. 15 were not rated by TEA and are not ranked."
 *
 * The residual line is the point of this function. A caller that says the
 * population is 1,199, ranks 1,184 and explains 12 of the 15 gets a sentence
 * saying 3 are unaccounted for. The alternative — printing the reasons given
 * and letting the arithmetic fail quietly — is how a denominator stops meaning
 * anything.
 */
export const excludedLines = ({ level, ranked, eligible, excluded = [] }) => {
  const lines = []
  if (finite(eligible)) lines.push(`${countOf(ranked, level)} of ${countOf(eligible, level)} are ranked here.`)
  else lines.push(`${countOf(ranked, level)} are ranked here.`)

  const named = excluded.reduce((a, x) => a + (finite(x?.n) && x.n > 0 ? x.n : 0), 0)
  for (const x of excluded) {
    if (!x || !finite(x.n) || x.n <= 0) continue
    lines.push(`${num(x.n)} ${x.reason} and ${x.n === 1 ? 'is' : 'are'} not ranked.`)
  }

  if (finite(eligible)) {
    const rest = eligible - ranked - named
    if (rest > 0) {
      lines.push(
        `${num(rest)} more ${rest === 1 ? 'is' : 'are'} not ranked, and this snapshot does not record why.`
      )
    } else if (rest < 0) {
      lines.push(
        `The counts above do not reconcile: ${num(named)} excluded plus ${num(
          ranked
        )} ranked exceeds the population of ${num(eligible)}. Treat the denominator as unverified.`
      )
    }
  }
  return lines
}

/**
 * The population arithmetic behind the denominator callout: which rows carry
 * a figure, their competition ranks, and the exclusions — named by the
 * caller, plus whatever unnamed gap the caller's own `eligible` implies.
 * Factored out of renderRankingPage so rankingCsv can state the identical
 * population rather than risk a second copy of this reconciliation drifting
 * from the page it sits beside.
 */
const rankedPopulation = (rows, meta = {}, end = 'top') => {
  // A row with no figure is not in the running, and counting it would inflate
  // the denominator of a contest it never entered.
  const missing = rows.filter((r) => !finite(r.value)).length
  const ranked = withRanks(rows.filter((r) => finite(r.value)), { end })

  // Exclusions the caller named, plus — only to the extent the named ones do not
  // already account for the gap — the rows that arrived carrying no figure. A
  // caller that both filters its rows AND declares the exclusion is the normal
  // case; double-counting it would print a reconciliation warning on a page
  // whose arithmetic is in fact correct.
  const given = (Array.isArray(meta.excluded) ? meta.excluded : meta.excluded ? [meta.excluded] : []).filter(
    (x) => x && finite(x.n) && x.n > 0
  )
  const namedTotal = given.reduce((a, x) => a + x.n, 0)
  const unexplained = finite(meta.eligible) ? meta.eligible - rows.length + missing - namedTotal : missing
  const auto = Math.max(0, Math.min(missing, unexplained))
  const excluded = [...given, auto ? { n: auto, reason: 'published no figure for this measure' } : null].filter(
    Boolean
  )
  return { ranked, excluded, missing }
}

/* ------------------------------------------------------------------- page -- */

/**
 * The caveat every raw ranking owes a reader, and the one this site is
 * otherwise careful never to leave unsaid: "the highest overall score" is not
 * "the best school" — it correlates with size and, more strongly, with how
 * poor a school's students are. src/render/about.js's "How the peer group is
 * chosen" section is where that finding actually lives (with its own
 * numbers, kept there so this file cannot quote a stale copy of them); this
 * reuses that section's own words for the claim itself rather than writing a
 * second, driftable version of it, and links straight to it. Printed on the
 * /rankings hub's "How to read these" block and on every individual board's
 * "What this ranking counts" block — see both call sites below.
 */
const povertyCaveat = () =>
  `<p class="note">A ranking by a raw figure is not a measure of teaching quality on its own: it correlates with school size and, more strongly, with how many of a school's students live in poverty. Every entity page on this site instead compares a school against a peer group — districts with districts, campuses with campuses — whose share of economically disadvantaged students falls within 10 percentage points of its own, because a comparison against the state average measures the composition of a school's intake at least as much as anything the school did. This list does not: it orders by the raw figure alone. <a href="/about#peer-cohort">How the peer group is chosen</a>.</p>`

const sourceSection = (snapshotDate) =>
  section(
    'source',
    'Where this comes from',
    `<p>Every figure in this table comes from data the Texas Education Agency publishes at
     <a href="${OFFICIAL_SOURCE}" rel="nofollow">txschools.gov</a>${
       snapshotDate ? `, fetched ${esc(snapshotDate)}` : ''
     }. TEA publishes the ratings; it does not publish this ordering. This site is unofficial and is
     not affiliated with TEA. <a href="/about">How this site works</a> records the snapshot this page
     was built from and what this site does and does not verify about it.</p>
  <p class="downloads"><a href="/download">Download the whole dataset</a> &middot;
     <a href="/about">how this site works</a> &middot;
     <a href="${RANKINGS_HREF}">every ranked list on this site</a></p>`
  )

const linkRow = (items, label) =>
  navList(
    items.filter(Boolean).map((i) => ({ href: i.href, label: i.label, current: i.current, meta: i.meta ?? null })),
    { label }
  )

/**
 * renderRankingPage({ metric, scope, rows, meta, snapshotDate, related, end })
 *
 *   metric  { key, label, fmt, noun?, window?, dir?, change?, description? }
 *           `noun` is the thing measured, in prose ("overall score"), used in the
 *           headline where `label` would read as a column heading. `window` is a
 *           prose phrase carrying its own preposition — "since 2021-22", "in
 *           2025-26" — because it is dropped straight into a sentence.
 *   scope   { kind: 'state'|'region'|'county', id?, label, level, href? }
 *   rows    [{ id, name, slug, level?, value, rank?, tied?, rating?, county?,
 *              countySlug?, districtName?, districtSlug?, enrollment?, from?, to? }]
 *   meta    { eligible?, excluded?: [{ n, reason }], measured?, window?,
 *             fromLabel?, toLabel?, headline?, listLimit? }
 *   related { inverse?, metrics?: [], scopes?: [], index? }
 *   end     'top' (default) or 'bottom'
 *
 * Rows arrive in the order they should be read; nothing here re-sorts them, so a
 * caller's tie-break survives. Ranks are recomputed from the values regardless.
 */
export function renderRankingPage({
  metric,
  scope,
  rows = [],
  meta = {},
  snapshotDate = null,
  related = {},
  end = 'top',
}) {
  if (isContextMetric(metric?.key)) {
    // Rule 4. Ranking a demographic share asserts that one end of it is the good
    // end. There is no good end to the share of a school's students living in
    // poverty, and no caption makes an ordering of it anything but a leaderboard.
    throw new TypeError(
      `refusing to rank the context metric "${metric.key}": a demographic share describes who an entity serves, not how it did`
    )
  }

  const level = scope?.level ?? 'district'
  const listLimit = finite(meta.listLimit) ? meta.listLimit : LIST_LIMIT

  const { ranked, excluded } = rankedPopulation(rows, meta, end)

  const headline = rankingHeadline({ metric, scope, end, meta })
  const who = populationLabel(scope)
  const shown = ranked.slice(0, listLimit)
  const truncated = ranked.length > shown.length
  const lead = topSlice(shown)
  const short = shown.length <= SHORT_LIST
  // When the lead slice ran past 20 to keep a tie whole, the sentence saying so
  // counts the entities actually sharing that placement — which can include rows
  // above the 20th as well as below it.
  const edgeRank = lead.at(-1)?.rank ?? lead.length
  const edgeShare = lead.filter((r) => r.rank === edgeRank).length

  const denominator = excludedLines({ level, ranked: ranked.length, eligible: meta.eligible, excluded })
    .map((l) => `<p>${esc(l)}</p>`)
    .join('\n     ')

  const tieCount = ranked.filter((r) => finite(r.tied) && r.tied > 0).length
  const ties = tieCount
    ? `${num(tieCount)} of the ranked ${levelPlural(level)} share a placement with at least one other. Tied
       ${levelPlural(level)} print the same placement and the next placement skips, so two ${levelPlural(
        level
      )} sharing 3rd are both 3rd and the one behind them is 5th.`
    : `No two ${levelPlural(level)} in this list share a placement.`

  // Direction, said out loud, because "1st" on a measure where less is better
  // reads as a boast unless the page states what end it counted from.
  const worse = lowerIsBetter(metric)
  const direction = isChangeMetric(metric)
    ? end === 'bottom'
      ? `Ordered by the largest fall first. A negative figure is a decline.`
      : `Ordered by the largest rise first. A negative figure is a decline.`
    : end === 'bottom'
    ? `Ordered from the lowest figure upward.${worse ? ' A lower figure is the better result for this measure, so 1st here is the best end of the list.' : ''}`
    : `Ordered from the highest figure downward.${worse ? ' A lower figure is the better result for this measure, so 1st here is the largest share, not the best result.' : ''}`

  // What was measured, in one sentence. A change is never described as something
  // "TEA published": TEA publishes the score for each year, and the difference
  // between two of them is this site's arithmetic, not TEA's figure. Nor is a
  // 2021-22 endpoint honestly "the figure TEA published for 2021-22" when the
  // window carries a methodology note: TEA re-scored that year under the rules
  // it adopted for 2022-23, and this site reads that re-scoring, not what TEA
  // originally published in 2021-22 (see METHOD_BREAK_NOTE, rankings.js).
  // `meta.methodology` is exactly rankings.js's `result.window.methodology` —
  // this function states it, never re-derives which year it is.
  const win = metric?.window ?? meta?.window ?? null
  const span = meta.fromLabel && meta.toLabel
  const methodology = meta.methodology ?? null
  const endpoint = (label, verb) =>
    methodology && label === methodology.year
      ? `TEA's re-scored "${label} What If" figure`
      : `the figure ${verb} published for ${label}`
  const measured =
    meta.measured ??
    metric?.description ??
    (isChangeMetric(metric)
      ? `The change in ${nounOf(metric)}${win ? ` ${lower1(win)}` : ''}, ${
          span
            ? `from ${endpoint(meta.fromLabel, 'TEA')} to ${endpoint(meta.toLabel, 'it')}`
            : 'computed from the figures TEA published for each year'
        }.`
      : `${asTitle(nounOf(metric))}, as TEA published it${win ? ` ${lower1(win)}` : ''}.`)

  const lede = `${esc(measured)}${methodology ? ` ${esc(methodology.note)}` : ''} ${esc(
    `Measured across ${who}, of which ${countOf(ranked.length, level)} ${ranked.length === 1 ? 'is' : 'are'} ranked below.`
  )}`

  // Rule 3: only the flattering end of an ordering is published. When a
  // caller does supply `related.inverse` anyway — hand-built related data, not
  // anything rankingCatalogue() itself produces, see relatedFor's own comment —
  // this still links it rather than hiding a page that genuinely exists. The
  // ordinary case is the second branch, and it states the policy rather than
  // reading like a gap this build happened to leave: the other end would be a
  // standalone list of the worst-performing ${levelPlural(level)} on this
  // measure, and this site does not compile one. It is not a data omission —
  // every entity's own page still prints its real figure for this measure,
  // whatever it is.
  const inverse = related.inverse
    ? `<p class="callout">The other end of this list: <a href="${esc(related.inverse.href)}">${esc(
        related.inverse.label
      )}</a>.</p>`
    : `<p class="note na">This site does not publish the other end of this ordering. This page already shows the
       better-performing end of ${esc(nounOf(metric))}; the other end would be a standalone list of the ${levelPlural(
        level
      )} doing worst on it, and txschools.net does not compile one. That is a publishing choice, not a data one —
       every ${levelSingular(level)}'s own page still shows its real figure for this measure, good or bad.</p>`

  const crumbs = [{ href: '/', label: 'Texas schools' }, { href: RANKINGS_HREF, label: 'Rankings' }]
  if (scope?.href && scope?.label) crumbs.push({ href: scope.href, label: scope.label })
  crumbs.at(-1).current = asTitle(headline)

  const truncNote = truncated
    ? `<p class="note">This page prints the first ${num(shown.length)} of ${countOf(
        ranked.length,
        level
      )}. The complete ordering, and every figure behind it, is in <a href="/download">the downloadable dataset</a>.</p>`
    : ''

  const tooSmall =
    ranked.length < MIN_RANKED
      ? `<p class="note na">Only ${countOf(
          ranked.length,
          level
        )} carry this measure. A placement out of fewer than ${MIN_RANKED} is not worth much, and this page states the figure rather than dressing it as a contest.</p>`
      : ''

  return shell({
    title: `${asTitle(headline)} — txschools.net`,
    description: `${asTitle(headline)}: a ranked table of ${countOf(
      ranked.length,
      level
    )}, with the figure behind each placement, what was excluded, and every tie shown. Unofficial republication of Texas Education Agency data.`,
    canonical: `${SITE_ORIGIN}${rankingHref({ scope, metric, end })}`,
    crumbs,
    sections: [
      `<section class="hero">
  <p class="eyebrow">Ranked list &middot; ${esc(who)}</p>
  <h1>${esc(asTitle(headline))}</h1>
  <p class="place">${esc(countOf(ranked.length, level))}${
        metric?.window || meta?.window ? ` &middot; ${esc(metric?.window ?? meta.window)}` : ''
      }${snapshotDate ? ` &middot; TEA data fetched ${esc(snapshotDate)}` : ''}</p>
  <p class="lede">${lede}</p>
  <p class="downloads"><a href="${esc(rankingCsvHref({ scope, metric, end }))}">Download this table (CSV)</a></p>
</section>`,
      section(
        'counted',
        'What this ranking counts',
        `<div class="callout">
     ${denominator}
   </div>
  <p class="note">${esc(direction)}</p>
  <p class="note">${ties}</p>
  ${tooSmall}
  ${povertyCaveat()}`
      ),
      short
        ? null
        : section(
            'top',
            lead.length === TOP_N ? `The top ${TOP_N}` : `The top ${num(lead.length)}`,
            rankingTable(lead, {
              metric,
              scope,
              meta,
              wide: true,
              caption: `${asTitle(headline)}: the leading ${num(lead.length)} of ${countOf(ranked.length, level)}`,
            }),
            lead.length > TOP_N
              ? `${num(lead.length)} rows, not ${TOP_N}: ${num(edgeShare)} ${levelPlural(
                  level
                )} share ${esc(ordinal(edgeRank))} place, and cutting a tie in half is how a ranked list stops being true. The full list follows.`
              : `Ranked ${esc(ordinal(1))} to ${esc(ordinal(lead.at(-1)?.rank ?? lead.length))}. The full list follows.`
          ),
      shown.length
        ? section(
            'full',
            truncated
              ? `The first ${num(shown.length)} of ${countOf(ranked.length, level)}`
              : short
              ? `All ${countOf(shown.length, level)}`
              : `The full list: all ${countOf(shown.length, level)}`,
            `${rankingTable(shown, {
              metric,
              scope,
              meta,
              wide: short,
              caption: `${asTitle(headline)}: ${truncated ? 'the first' : 'all'} ${num(shown.length)} rows`,
            })}${truncNote}`
          )
        : section(
            'full',
            'Nothing to rank',
            `<p class="note na">No ${levelSingular(level)} in this population carries a figure for ${esc(
              nounOf(metric)
            )} in this snapshot, so there is no ranking to publish.</p>`
          ),
      section(
        'other',
        'What this list leaves out, and the other lists',
        `${inverse}
  ${
    related.metrics?.length
      ? `<h3>Other rankings of ${esc(who)}</h3>\n  ${linkRow(related.metrics, `Other rankings of ${who}`)}`
      : ''
  }
  ${
    related.scopes?.length
      ? `<h3>${esc(asTitle(nounOf(metric)))} ranked elsewhere</h3>\n  ${linkRow(
          related.scopes,
          `${asTitle(nounOf(metric))} at other scopes`
        )}`
      : ''
  }
  <p class="note"><a href="${RANKINGS_HREF}">Every ranked list on this site</a>, with what each one counts.</p>`
      ),
      sourceSection(snapshotDate),
    ],
  })
}

/* -------------------------------------------------------------------- csv -- */

/** A label as a CSV column name: lowercase, non-letters/digits collapsed to `_`. */
const csvToken = (s) =>
  String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'value'

/**
 * rankingCsv({ metric, scope, rows, meta, snapshotDate, end })
 *
 * One board's rows as a file — the answer to "no ranking can be downloaded",
 * a real complaint about this feature. Same shape renderRankingPage takes,
 * and rows are ranked here the same way, through the same `rankedPopulation`
 * the page's own denominator is built from, so the file and the page can
 * never disagree about who is 1st or how many rows exist.
 *
 * The provenance header is src/render/downloads.js:datasetCsv's, byte for
 * byte — same unofficial/not-affiliated line, same source URL, same snapshot
 * line, same "empty cell is not zero" note, same comment-skipping tip — so a
 * reader who has already opened one of THAT module's files does not meet a
 * second house style here. Numbers are written raw, through neither fmtValue
 * nor `num`/`pct`/`usd`: a data file is not locale-formatted (downloads.js
 * rule 2), even though the page beside it is.
 *
 * Throws on a context metric for the same reason renderRankingPage does —
 * see Rule 4 at the top of this file.
 */
export function rankingCsv({ metric, scope, rows = [], meta = {}, snapshotDate = null, end = 'top' }) {
  if (isContextMetric(metric?.key)) {
    throw new TypeError(
      `refusing to rank the context metric "${metric.key}": a demographic share describes who an entity serves, not how it did`
    )
  }

  const level = scope?.level ?? 'district'
  const { ranked, excluded } = rankedPopulation(rows, meta, end)
  const denominator = excludedLines({ level, ranked: ranked.length, eligible: meta.eligible, excluded })

  const hasWhere = rows.some((r) => r.districtName || r.county)
  const whereKey = rows.some((r) => r.districtName) ? 'district' : 'county'
  const hasRating = rows.some((r) => r.rating)
  const hasSpan = !!(meta.fromLabel && meta.toLabel) && rows.some((r) => finite(r.from) && finite(r.to))
  const hasEnrollment = rows.some((r) => finite(r.enrollment))
  const fromCol = hasSpan ? csvToken(meta.fromLabel) : null
  const toCol = hasSpan ? csvToken(meta.toLabel) : null

  const columns = [
    'rank',
    'rank_of',
    'tied',
    'entity_id',
    'name',
    ...(hasWhere ? [whereKey] : []),
    ...(hasRating ? ['rating'] : []),
    'value',
    ...(hasSpan ? [fromCol, toCol] : []),
    ...(hasEnrollment ? ['enrollment'] : []),
    'url',
  ]

  const csvRows = ranked.map((r) => ({
    rank: r.rank,
    rank_of: ranked.length,
    tied: finite(r.tied) ? r.tied : 0,
    entity_id: r.id ?? null,
    name: r.name ?? r.id ?? null,
    ...(hasWhere ? { [whereKey]: (whereKey === 'district' ? r.districtName : r.county) ?? null } : {}),
    ...(hasRating ? { rating: r.rating ?? null } : {}),
    value: finite(r.value) ? r.value : null,
    ...(hasSpan ? { [fromCol]: finite(r.from) ? r.from : null, [toCol]: finite(r.to) ? r.to : null } : {}),
    ...(hasEnrollment ? { enrollment: finite(r.enrollment) ? r.enrollment : null } : {}),
    url: entityHref(r, scope) ? `${SITE_ORIGIN}${entityHref(r, scope)}` : null,
  }))

  const notes = [
    `ranking: ${asTitle(rankingHeadline({ metric, scope, end, meta }))}`,
    ...denominator.map((l) => `population: ${l}`),
    'rank_of is how many rows were actually ranked (can be smaller than the population above); two rows on the same value share a rank ("tied"), and the next rank is skipped.',
  ]
  if (meta.methodology?.note) notes.push(`methodology: ${meta.methodology.note}`)

  return datasetCsv(csvRows, {
    columns,
    snapshotDate,
    dataset: 'ranking board',
    meta: {
      page: `${SITE_ORIGIN}${rankingHref({ scope, metric, end })}`,
      notes,
    },
  })
}

/* -------------------------------------------------------------- catalogue -- */

/**
 * The headline set: what a region gets, and the spine of the campus set. Kept
 * deliberately short — a region page nobody links is a file spent for nothing,
 * and the overall score plus its five-year change are the two orderings a
 * newsroom actually asks for.
 */
export const HEADLINE_KEYS = new Set(['score'])

export const isHeadlineMetric = (m) =>
  m?.headline === true || HEADLINE_KEYS.has(m?.key) || (isChangeMetric(m) && /score/.test(String(m?.key ?? '')))

/** Statewide campuses: the headline pair plus the measures TEA scores every campus on. */
export const CAMPUS_KEYS = new Set([
  'score',
  'domain:achievement',
  'domain:progress',
  'domain:gaps',
  'attendance',
  'absenteeism',
])

export const isCampusMetric = (m) => CAMPUS_KEYS.has(m?.key) || isHeadlineMetric(m)

/**
 * Which populations get which metrics. See FILE BUDGET at the top for the
 * arithmetic this encodes; a caller may pass its own plan, and the count is
 * always computed rather than assumed.
 */
export const DEFAULT_PLAN = [
  { kind: 'state', level: 'district', select: () => true },
  { kind: 'state', level: 'campus', select: isCampusMetric },
  // `limit` is per scope, and 20 regions is where a loose selector gets
  // expensive: one extra metric that happens to match adds 40 pages, not 2. Two
  // metrics per region — the overall score and the first change metric the
  // caller listed — is what the plan promises, and the cap holds whatever
  // RANKABLE grows into.
  { kind: 'region', level: 'district', select: isHeadlineMetric, limit: 2 },
]

/**
 * rankingCatalogue({ metrics, scopes, plan, max })
 *
 * Every page this module will produce, as data: one entry per metric x scope —
 * see Rule 3 above. `end` is not a second axis to loop; it is decided once per
 * metric by `goodEnd`, so a district-level score board publishes only
 * "-highest" and a district-level chronic-absenteeism board publishes only
 * "-lowest", never the other end of either. The caller loops the result,
 * computes rows for each entry and renders. Because the catalogue is the same
 * object the cross-links are built from (relatedFor), a page can never link a
 * ranking that was not generated — which, now, includes never being able to
 * link the worse end of an ordering, because no entry for it exists to link.
 *
 * Context metrics are dropped here as well as refused in renderRankingPage —
 * the catalogue is where a demographic share would otherwise be silently
 * included by a plan that said `select: () => true`.
 */
export function rankingCatalogue({ metrics = [], scopes = [], plan = DEFAULT_PLAN, max = MAX_RANKING_PAGES } = {}) {
  const out = []
  for (const p of plan) {
    const matching = scopes.filter((s) => (s?.kind ?? 'state') === p.kind && (s?.level ?? 'district') === p.level)
    for (const scope of matching) {
      let taken = 0
      for (const metric of metrics) {
        if (!metric?.key || isContextMetric(metric.key)) continue
        if (metric.levels && !metric.levels.includes(p.level)) continue
        if (!p.select(metric)) continue
        if (finite(p.limit) && taken >= p.limit) break
        taken += 1
        const end = goodEnd(metric)
        const path = rankingPath({ scope, metric, end })
        out.push({
          key: path,
          path,
          href: `/${path}`,
          file: `${path}.html`,
          metric,
          scope,
          end,
          title: asTitle(rankingHeadline({ metric, scope, end })),
        })
      }
    }
  }

  const seen = new Set()
  for (const e of out) {
    if (seen.has(e.path)) throw new Error(`two rankings claim the same path: ${e.path}`)
    seen.add(e.path)
  }
  if (out.length > max) {
    throw new Error(
      `${out.length} ranking pages exceeds the ${max}-page budget: site/ holds 12,971 files against an 18,000 CI guard, so narrow the plan rather than raising this`
    )
  }
  return out
}

/**
 * The cross-links for one catalogue entry: its inverse (if the catalogue
 * happens to carry one), the other metrics at its scope, and the same metric
 * at every other scope. Every href here is a page the catalogue produced, so
 * no link can 404.
 *
 * `inverse` will be null for everything rankingCatalogue() itself produces,
 * always, now: each metric contributes exactly one end (goodEnd), so no two
 * entries sharing a scope and a metric key ever differ by `end`. The lookup is
 * left in rather than deleted, because it is still the correct way to ask "is
 * this metric's other end also in the catalogue I was handed" — a caller
 * assembling its own catalogue by hand (a test, or a future page that really
 * does want to show both) gets the real answer instead of a hard-coded null.
 * renderRankingPage's own fallback copy is what a reader sees in the ordinary
 * case: it explains the policy rather than treating a missing inverse as an
 * omission.
 *
 * `metrics` (other rankings of this population) is filtered by scope and
 * metric key only, NOT by `end`: a lower-is-better metric's only entry has
 * `end: 'bottom'` while a higher-is-better one's has `end: 'top'`, so
 * matching on `end` would silently drop chronic absenteeism and dropout rate
 * from every other board's "other rankings of Texas school districts" list.
 * `scopes` (the same metric at other scopes) does not need the same fix: a
 * metric's good end is a property of the metric, not the scope, so every
 * entry sharing `metric.key` already shares `end` with `entry` by
 * construction — filtering on it would be redundant, not wrong, so it is
 * dropped for clarity rather than kept as a no-op check.
 */
export function relatedFor(catalogue, entry, { limit = 24 } = {}) {
  const same = (a, b) => a?.path === b?.path
  const inverse = catalogue.find(
    (e) => e.scope === entry.scope && e.metric?.key === entry.metric?.key && e.end !== entry.end
  )
  const metrics = catalogue
    .filter((e) => e.scope === entry.scope && e.metric?.key !== entry.metric?.key)
    .slice(0, limit)
    .map((e) => ({ href: e.href, label: e.metric?.label ?? e.metric?.key }))
  const scopes = catalogue
    .filter((e) => e.metric?.key === entry.metric?.key && !same(e, entry))
    .slice(0, limit)
    .map((e) => ({ href: e.href, label: populationLabel(e.scope) }))

  return {
    inverse: inverse
      ? {
          href: inverse.href,
          label: inverse.title,
        }
      : null,
    metrics,
    scopes,
  }
}

/* ------------------------------------------------------------------ index -- */

/**
 * The interactive tool's DOM contract, exactly as site/rankings.js documents
 * at the top of its own file: a payload URL, an empty controls mount, a
 * status line OUTSIDE the region the script replaces, and an output div
 * holding one real, complete ranking — plus a lookups script naming every
 * region and county, and the module script that boots the whole thing.
 * Everything here is optional except [data-rankings] and a payload URL, per
 * that same contract, so a caller with nothing to offer yet gets nothing
 * rendered rather than a half-wired section a reader's script cannot use:
 * missing `payloadHref`, `defaults`, `metric` or `scope` returns ''.
 *
 * `defaults` is stated by the caller, not derived here. This module has no
 * way to know which AEA filter actually produced `tool.rows` —
 * rankings.js's row shape carries no such flag — so guessing a defaults
 * object would risk declaring a selection the rows do not match, which is
 * exactly the "the page visibly rewrites itself the moment the payload
 * lands" failure site/rankings.js's own comment warns about.
 */
function renderRankingsTool({
  payloadHref,
  snapshot = null,
  defaults,
  lookups = {},
  metric,
  scope,
  end = 'top',
  rows = [],
  meta = {},
} = {}) {
  if (!payloadHref || !defaults || !metric || !scope) return ''

  const level = scope?.level ?? 'district'
  const { ranked, excluded } = rankedPopulation(rows, meta, end)
  const denominator = excludedLines({ level, ranked: ranked.length, eligible: meta.eligible, excluded })
  const headline = asTitle(rankingHeadline({ metric, scope, end, meta }))

  // A straight slice at `defaults.n`, NOT topSlice: site/rankings.js's own
  // client-side render() cuts at exactly `state.n` with no tie-extension
  // (ranked.slice(0, limit)), unlike the static board pages elsewhere in this
  // file. Extending past a tie here — correct as this module's own standard
  // is — would show one row COUNT now and a different one the moment the
  // client re-renders from the same declared defaults, which is precisely
  // the mismatch data-defaults exists to prevent.
  const n = defaults?.n === 'all' ? ranked.length : Number(defaults?.n)
  const shown = ranked.slice(0, Number.isFinite(n) && n > 0 ? n : TOP_N)

  const lookupsJson = JSON.stringify({ regions: lookups.regions ?? {}, counties: lookups.counties ?? {} }).replace(
    /</g,
    '\\u003c'
  )

  return `<section data-rankings data-payload="${esc(payloadHref)}"${
    snapshot ? ` data-snapshot="${esc(snapshot)}"` : ''
  } data-defaults='${esc(JSON.stringify(defaults))}'>
  <div data-rankings-controls></div>
  <p data-rankings-status role="status" aria-live="polite" class="rankings-status"></p>
  <div data-rankings-output>
    <p class="rk-headline">${esc(headline)}</p>
    <div class="callout">${denominator.map((l) => `<p>${esc(l)}</p>`).join('\n     ')}</div>
    ${rankingTable(shown, { metric, scope, meta, wide: true, caption: headline })}
  </div>
</section>
<script type="application/json" data-rankings-lookups>${lookupsJson}</script>
<script type="module" src="/rankings.js"></script>`
}

/* ------------------------------------------------------ grouped accordions -- */
//
// The /rankings hub carries one link-list per scope — Texas school districts,
// Texas campuses, each of 20 regions, each county that clears MIN_POPULATION —
// which is ~44 headed lists holding ~256 links. Printed flat, one after
// another, that is reachable but not readable: a visitor after "Dallas
// County" scrolls past every other county to find it. Below, each scope's
// list is wrapped in a native <details>, grouped under three headings
// (statewide / by region / by county — the grouping rankingScopes() already
// encodes in scope.kind). Statewide opens by default: two groups, worth
// seeing without a click. Region and county groups start closed, so the page
// loads as ~44 one-line summaries instead of one long scroll.
//
// This is a real <details>/<summary>, not a JS-built collapse: clicking (or
// Enter/Space on) a summary is the browser's own behaviour, so every group is
// reachable with JavaScript off exactly as it is with JavaScript on.

/** Which of the three population kinds a scope's boards belong to, and how the group opens. */
const GROUP_KINDS = [
  { kind: 'state', heading: 'Statewide', open: true },
  { kind: 'region', heading: 'By region', open: false },
  { kind: 'county', heading: 'By county', open: false },
]

/** One scope's link list, as a collapsible group. `data-name` is what the filter script below matches against. */
const groupDetails = (g, open) =>
  `<details class="rk-group" data-name="${esc(g.label)}"${open ? ' open' : ''}>
  <summary><h3>${esc(g.label)} <span class="chip-n">${esc(num(g.items.length))} ranked ${
    g.items.length === 1 ? 'list' : 'lists'
  }</span></h3></summary>
  ${linkRow(
    g.items.map((i) => ({ href: i.href, label: i.title })),
    `Ranked lists of ${g.label}`
  )}
</details>`

/**
 * The text filter's whole behaviour: show/hide `.rk-group` elements by a
 * case-insensitive substring match on each group's own name, and open a
 * matching group so a reader does not also have to click it. Independent of
 * site/rankings.js and its [data-rankings] contract — this runs whenever the
 * groups below exist, whether or not the interactive tool's payload does —
 * and touches nothing outside the elements this page itself renders.
 *
 * The filter input is kept `hidden` in the markup and only revealed here,
 * the same pattern site/rankings.js's own controls mount uses: a reader
 * without JavaScript never meets a text box that does nothing when they type
 * into it. What they get instead — every group, reachable by opening its
 * <details> — is unaffected by whether this script ever runs.
 *
 * This markup is emitted *before* the `.rk-group` elements it queries for
 * (the filter box belongs above the groups it filters), so the plain,
 * unmodulized `<script>` below runs mid-parse, before those groups exist.
 * It defers its own body to DOMContentLoaded — the same readyState guard
 * site/rankings.js's own boot() uses — so `querySelectorAll('.rk-group')`
 * runs only after the whole document, groups included, has been parsed.
 */
const RANKINGS_GROUP_FILTER_JS = `(function () {
  function run() {
    var wrap = document.getElementById('rk-filter-wrap')
    var input = document.getElementById('rk-filter-input')
    var empty = document.getElementById('rk-filter-empty')
    var groups = Array.prototype.slice.call(document.querySelectorAll('.rk-group'))
    if (!wrap || !input || !groups.length) return
    var openByDefault = groups.map(function (g) { return g.hasAttribute('open') })
    wrap.hidden = false
    input.addEventListener('input', function () {
      var q = input.value.trim().toLowerCase()
      var shown = 0
      groups.forEach(function (g, i) {
        var name = (g.getAttribute('data-name') || '').toLowerCase()
        var match = !q || name.indexOf(q) !== -1
        g.hidden = !match
        if (match) shown += 1
        g.open = q ? match : openByDefault[i]
      })
      if (empty) empty.hidden = shown !== 0
    })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run)
  else run()
})()`

const groupFilterInput = () =>
  `<div class="rk-filter" id="rk-filter-wrap" hidden>
  <label for="rk-filter-input">Filter these lists by name</label>
  <input type="text" id="rk-filter-input" autocomplete="off" placeholder="Region, county, or statewide">
  <p class="rk-filter-empty" id="rk-filter-empty" role="status" aria-live="polite" hidden>No groups match that filter. Clear it to see them all.</p>
</div>
<script>${RANKINGS_GROUP_FILTER_JS}</script>`

/**
 * renderRankingsIndexPage({ pages, snapshotDate, note, lookups, countiesTotal, tool })
 *
 * The hub every ranked list hangs off, grouped by population. `pages` is the
 * catalogue (or any subset of it that was actually built — pass what you wrote,
 * not what you planned, so the index never links a file that does not exist).
 *
 *   lookups        { regions: {"01": "Region 01: Edinburg"}, counties: {"001":
 *                  "Anderson"} } — named separately from `tool` because
 *                  site/rankings.js's own lookups script is a sibling of
 *                  [data-rankings], not a child of it; falls back to
 *                  `tool.lookups` when omitted.
 *   countiesTotal  every Texas county in this snapshot, rated or not. This
 *                  module counts how many counties `pages` gave a board to;
 *                  it cannot know how many exist in total on its own — that
 *                  is county census data, not something a ranking is handed
 *                  — so the excluded count in the county-selection sentence
 *                  only appears when the caller states this.
 *   tool           { payloadHref, snapshot?, defaults, metric, scope, end?,
 *                  rows, meta } — the interactive tool's starting ranking,
 *                  in the exact shape renderRankingPage itself takes. Omit
 *                  it and the tool section is skipped entirely.
 */
export function renderRankingsIndexPage({
  pages = [],
  snapshotDate = null,
  note = null,
  lookups = null,
  countiesTotal = null,
  tool = null,
}) {
  const groups = []
  const byScope = new Map()
  for (const p of pages) {
    const slug = scopeSlug(p.scope)
    if (!byScope.has(slug)) {
      const g = { slug, scope: p.scope, label: populationLabel(p.scope), items: [] }
      byScope.set(slug, g)
      groups.push(g)
    }
    byScope.get(slug).items.push(p)
  }

  // The same groups, bucketed into the three population kinds and each
  // wrapped as a <details> — see the "grouped accordions" note above
  // renderRankingsTool for why, and for what stays reachable without
  // JavaScript.
  const bucketSections = GROUP_KINDS.map(({ kind, heading, open }) => {
    const kindGroups = groups.filter((g) => (g.scope?.kind ?? 'state') === kind)
    if (!kindGroups.length) return null
    return section(
      `group-${kind}`,
      `${heading}: ${num(kindGroups.length)} ranked ${kindGroups.length === 1 ? 'population' : 'populations'}`,
      `<div class="rk-groups">${kindGroups.map((g) => groupDetails(g, open)).join('\n')}</div>`
    )
  }).filter(Boolean)

  // Which counties get a board of their own, and how many do not — the same
  // standard every ranking on this site holds itself to (Rule 1: a ranking
  // states what it excluded). The rule is rankings.js's own MIN_POPULATION,
  // imported rather than restated, so a change to the floor there cannot
  // leave this sentence quoting a stale number.
  const countyCount = groups.filter((g) => g.scope?.kind === 'county').length
  const countyRule = countyCount
    ? `<li>${num(countyCount)} ${countyCount === 1 ? 'county has' : 'counties have'} at least ${num(
        MIN_POPULATION
      )} rated districts — the same floor every ranking on this site refuses to publish a placement under —
        and get${countyCount === 1 ? 's' : ''} a ranking board of ${countyCount === 1 ? 'its' : 'their'} own.${
        finite(countiesTotal)
          ? ` The other ${num(countiesTotal - countyCount)} of Texas's ${num(
              countiesTotal
            )} counties fall short of that floor; each keeps its county hub page's own score-ordered list instead
        of a board here.`
          : ` Counties short of that floor keep their county hub page's own score-ordered list instead of a
        board here.`
      }</li>`
    : ''

  const toolMarkup = tool ? renderRankingsTool({ ...tool, lookups: lookups ?? tool.lookups }) : ''

  return shell({
    title: 'Ranked lists of Texas school districts and campuses',
    description: `Every ranked list on this site: ${num(
      pages.length
    )} tables ordering Texas school districts and campuses by the figures the Texas Education Agency publishes, each stating its population, its n and what it excluded. Unofficial.`,
    canonical: `${SITE_ORIGIN}${RANKINGS_HREF}`,
    crumbs: [{ href: '/', label: 'Texas schools', current: 'Rankings' }],
    sections: [
      `<section class="hero">
  <p class="eyebrow">Ranked lists</p>
  <h1>Texas school rankings</h1>
  <p class="place">${esc(num(pages.length))} ranked ${pages.length === 1 ? 'list' : 'lists'}${
        snapshotDate ? ` &middot; TEA data fetched ${esc(snapshotDate)}` : ''
      }</p>
  <p class="lede">TEA publishes a rating for every district and campus. It does not publish them in
    order. These tables do, and each one states the population it ranked, how many entities that was,
    and which were left out and why. Only the better-performing end of each ordering is published —
    never a standalone list of the worst.</p>
</section>`,
      section(
        'how',
        'How to read these',
        `<ul>
    <li>Every list names its population and its n. A placement without a denominator is a boast.</li>
    <li>Ties are shown as ties: two districts sharing 3rd both read 3rd, and the next reads 5th.</li>
    <li>Entities TEA did not rate are excluded, not counted as zero, and each page says how many.</li>
    <li>Student demographics — economic disadvantage, English learners, special education — are
        never ranked. They describe who a school serves, not how it did.</li>
    <li>Each list publishes only the end where 1st place is the best result — the highest score, the
        lowest dropout rate, the largest gain — never the worst end of the same ordering. Every
        district's and campus's own page still shows its real figure for every measure, whatever it
        is; this site simply does not assemble a standalone leaderboard of who is doing worst.</li>
    ${countyRule}
  </ul>
  <p class="note">TEA publishes most measures for the current year only. Where a list ranks change
     over time, the underlying figure is one TEA publishes for several years — the overall score,
     the domain scores, per-student spending. Nothing else here is presented as a trend.</p>
  ${povertyCaveat()}
  ${note ? `<p class="note">${esc(note)}</p>` : ''}`
      ),
      toolMarkup
        ? section(
            'build',
            'Build your own ranking',
            toolMarkup,
            `Everything else on this page is fixed. This one is not: choose a measure, an area and a level,
             and the table below recomputes without leaving the page.`
          )
        : null,
      groups.length ? groupFilterInput() : null,
      ...(bucketSections.length
        ? bucketSections
        : [section('none', 'No ranked lists', '<p class="note na">No ranked lists were built for this snapshot.</p>')]),
      sourceSection(snapshotDate),
    ],
  })
}
