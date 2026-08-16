// Ranked lists: the thing this site published ranks for but never published a
// LIST of.
//
// Everything before this file ranks ONE entity against a cohort — "12th of 378"
// printed on that entity's own page. That answers "how did my school do?" and
// nothing else. It cannot answer "which twenty districts improved most since the
// pandemic?", because that question needs the whole ordering, not one row of it,
// and because the only ranks the entity pages surface are the flattering ones
// (see metrics.js:standouts, which takes one tail).
//
// This module produces the whole ordering, for a stated population, with the
// denominator and the exclusions attached to it. Four things follow from that,
// and all four are requirements rather than preferences:
//
//   1. CHANGE IS THE POINT. TEA publishes most measures for the current year
//      only. Three families genuinely carry history — the overall score (five
//      years), the five domain scores (three), and per-pupil spending (eight) —
//      and those are the only three this module will compute change for. STAAR,
//      CCMR, graduation and absenteeism are single-year in this snapshot, so a
//      "growth" ranking for them would be fabricated. RANKABLE says which is
//      which (`change`), and changeMetrics refuses the rest outright.
//
//   2. EVERY RESULT STATES ITS POPULATION. `population` on the returned envelope
//      carries the ranked n, the pool it was drawn from, and a funnel counting
//      what each filter removed — plus a sentence a page can print verbatim, so
//      four different consumers cannot disclose four different things.
//
//   3. TIES ARE TIES. Rank semantics are copied from metrics.js:rankAll, not
//      reinvented: rank = (number strictly better) + 1, and every member of a
//      tie group carries the same rank plus a count of the others sharing it.
//      `place` below is the O(n log n) form of exactly that arithmetic, and
//      test/render/rankings.test.js cross-checks it against a transcription of
//      rankAll's own inner loop so the two cannot drift.
//
//   4. DEMOGRAPHICS ARE NOT RANKED. See the CONTEXT note further down.
//
// PERFORMANCE. rankingBundles is the expensive half and is entity-invariant, so
// it is built ONCE per process and handed to every rankBy/changeMetrics call.
// Measured on the 2026-08 snapshot — 10,230 entities, Node 24, Apple silicon,
// mean of 20 runs after warm-up:
//
//     rankingBundles                            43 ms   once, not per call
//     rankBy      score, state, district       0.5 ms
//     rankBy      score, state, campus         2.8 ms
//     changeMetrics score, state, district     0.7 ms
//     changeMetrics score, state, campus       4.6 ms
//     rankEverywhere  253 counties, district  12.4 ms
//     rankEverywhere  253 counties, campus    46.9 ms
//     rankEverywhere   20 regions,   campus    6.4 ms
//     -------------------------------------------------
//     full sweep: 30 metrics + 7 change metrics,
//     x 4 scope kinds x 2 levels = 20,646 tables  3.4 s
//
// 3.4 seconds against a ~100 s site build, and a full sweep is far more tables
// than the file budget can publish anyway — the cost of this layer is not what
// constrains what gets built. Time is dominated by the campus-level sorts
// (9,031 rows each); nothing here is worth caching further.
//
// WHAT THIS COSTS IN FILES, for whoever turns these into pages. The site sits at
// 12,971 of the 18,000 CI guard, so ~5,029 slots are spare. Measured on this
// snapshot, with MIN_POPULATION applied:
//
//     scope kind   groups   clear n>=10 (district / campus)
//     state             1   1 / 1
//     region           20   20 / 20
//     band              5   5 / 5
//     county          253   22 / 125     <- most counties hold under ten districts
//
// 37 rankable-or-change metrics x 2 levels across state + region + band is 1,924
// tables, of which 1,848 clear the floor — that fits, with ~3,100 slots to spare.
// The same sweep across counties is 18,722 tables (about 5,400 publishable) and
// does not fit alongside anything else. So a county ranking belongs INSIDE the
// county hub page that already exists rather than on pages of its own, and
// `rankEverywhere` is shaped to make that cheap: one call yields every county's
// table for a metric in ~12 ms.

import { metricSpecs, sourceBundles, directionOf, isContextMetric, HIGHER, LOWER, CONTEXT } from './metrics.js'
import { preferredRatings } from '../normalize/ratings.js'
import { STAAR_LEVELS } from './labels.js'
import { entitySlug, slugify } from './view-model.js'

// This module imports NOTHING from the page layer, and must not. It is the data
// layer: src/prerender.js:planRankings selects which rankings become pages and
// src/render/rankings-page.js renders them, both by calling into here. Reaching
// back the other way would make the ranking arithmetic untestable without a page
// shape in the way, and would close an import cycle the moment either of those
// files wanted a constant from this one.

// Re-exported so a page can test `metric.dir === HIGHER` without also importing
// metrics.js. Same constants, one source.
export { HIGHER, LOWER, CONTEXT }

/* ------------------------------------------------------------ small tools -- */

const finite = (v) => typeof v === 'number' && Number.isFinite(v)
const nf = (n) => Number(n).toLocaleString('en-US')

/**
 * Region ids arrive zero-padded from the entity table ('07'), but a URL, a test
 * or a hand-typed call may carry 7 or '7'. Same rule as hubs.js:regionPath,
 * restated rather than imported: a ranking hub page will import this module, and
 * importing hubs.js back would close a cycle for the sake of one padStart.
 */
const padRegion = (id) => String(id ?? '').padStart(2, '0')

/** district -> districts, campus -> campuses. */
const levelWord = (level, n) => (n === 1 ? level : level === 'campus' ? 'campuses' : 'districts')

/* ------------------------------------------------------- what is rankable -- */

/**
 * TEA's published STAAR subject set in the 2026-08 snapshot. Declared rather
 * than derived so RANKABLE is a constant four other modules can import at load
 * time; `rankable({ subjects })` rebuilds the list for a snapshot whose subject
 * set differs, and test/render/rankings.test.js asserts the two agree.
 */
export const STAAR_SUBJECTS = ['All Subjects', 'Reading', 'Math', 'Science', 'Social Studies']

/**
 * The minimum population a published rank may be drawn from.
 *
 * 10, the same floor metrics.js:rankAll uses, for the same reason: "3rd of 6" is
 * a sentence that reads like an achievement and means almost nothing. A result
 * below the floor is returned with `published: false` and `suppressed:
 * 'population'` rather than thrown, because a page iterating 253 counties needs
 * to skip the thin ones without a try/catch around every call.
 */
export const MIN_POPULATION = 10

/**
 * A year is usable as a change-window endpoint only if at least this share of
 * the ranked pool reports the metric in it.
 *
 * Without a floor, one district reporting a stray 2014 expenditure would set the
 * default window for all 1,199 and silently exclude the other 1,198 for having
 * no starting value. With it, the window is the widest span the population
 * actually shares, and `availableYears` exposes the coverage so a page can offer
 * a shorter window on purpose.
 */
export const WINDOW_COVERAGE = 0.5

/**
 * The 2021-22 methodology break, and why a change measured across it is honest.
 *
 * TEA re-scored 2021-22 under the post-2023 rules and publishes the result
 * labelled "2021-22 What If". normalize/ratings.js:preferredRatings prefers that
 * re-scoring over the original 2021-22 row precisely so a trend line does not
 * cross a methodology change, and rankingBundles below builds the score series
 * from the preferred rows — it re-runs preferredRatings on whatever it is given,
 * so a caller who hands over the raw `allRatings` table still gets the
 * comparable series rather than a phantom collapse no school caused.
 *
 * This sentence is attached to the window metadata of any change ranking whose
 * span includes 2021-22, so the page can print the justification next to the
 * number instead of leaving a reader to wonder.
 */
export const METHOD_BREAK_YEAR = '2021-22'
export const METHOD_BREAK_NOTE =
  'TEA re-scored 2021-22 under the rules it adopted for 2022-23 and publishes that re-scoring as "2021-22 What If". ' +
  'This ranking reads the re-scored series, so the change spans one consistent methodology rather than a break.'

/**
 * WHY DEMOGRAPHICS ARE NOT ON THIS LIST.
 *
 * metrics.js already refuses to RANK the three context shares — economically
 * disadvantaged, English learners, special education — on the grounds that an
 * ordering asserts one end is the good end and there is no good end to how many
 * of a school's children are poor. A ranked-list page makes that worse in a way
 * neutral wording cannot fix: the artifact of this module is a numbered table
 * with a #1 in it and a headline above it, and "Texas districts with the most
 * economically disadvantaged students" is a leaderboard no caption can un-write.
 * The affordance, not the adjective, is the problem.
 *
 * So they are excluded outright. rankBy throws on a context key rather than
 * returning an empty result, because a consumer asking for one has made a
 * mistake worth failing the build over, not a thin cohort worth skipping.
 *
 * What replaces them is better journalism anyway: every ranked row carries the
 * three shares and enrollment in `row.context`, so "the top 20 districts" prints
 * alongside who each one serves — which is the honest use of a demographic in a
 * ranking, as the column that complicates the story rather than the column that
 * is the story. The peer-band SCOPE does the other half: it ranks performance
 * WITHIN a stated poverty band, which is the comparison that de-confounds the
 * state's poverty gradient instead of laundering it.
 *
 * Enrollment is excluded on the same reasoning. "Largest districts in Texas" has
 * no good end either, and it is available as a context column and as a sort a
 * table can offer without this module blessing it as a rank.
 */

const CONTEXT_COLUMNS = ['ecoDisPct', 'engLrnPct', 'specEdPct', 'enrollment']

/**
 * Change-capable series, keyed by the RANKABLE metric key.
 *
 *   `series`   the key under bundle.series holding {year: value}
 *   `yearKind` 'academic' prints as 2024-25; 'fiscal' as 2025. TEA's finance
 *              export is keyed by a single fiscal year and the two must not be
 *              formatted alike, or a window reads as though it spans one year.
 *   `note`     printed under the window label, naming what the span measures.
 */
const CHANGE = {
  score: {
    series: 'score',
    yearKind: 'academic',
    note: 'Overall accountability score, as re-scored under the current methodology.',
  },
  spend: {
    series: 'spend',
    yearKind: 'fiscal',
    note: 'Per-student operating expenditure, in nominal dollars — not adjusted for inflation.',
  },
}
for (const d of ['achievement', 'progress', 'gaps', 'progress_growth', 'progress_relative']) {
  CHANGE[`domain:${d}`] = {
    series: `domain:${d}`,
    yearKind: 'academic',
    note: 'TEA publishes domain scores for three years in this snapshot.',
  }
}

/**
 * The curated set. A metric earns a place here by being (a) something an entity
 * is answerable for rather than something it was handed, and (b) legible enough
 * that a ranked table of it means one thing. That is why five of TEA's twelve
 * CCMR components and two of its four graduation measures are absent: they are
 * real numbers, they are on every entity page, and a statewide leaderboard of
 * "graduated under an advanced diploma plan and identified as a current special
 * education student" would be a table nobody can read a claim off.
 *
 * Fields, all of which four downstream modules depend on:
 *
 *   key            the metrics.js metric key, suffixed '@aea' for the
 *                  alternative-education variant of a population-confined metric
 *   slug           stable URL segment; never derived, so a label edit cannot
 *                  silently move a published page
 *   label          the metric's name, as metrics.js names it
 *   title          headline-ready noun phrase for a page about this ranking
 *   unit           'points' | 'percent' | 'dollars'
 *   fmt            metrics.js formatting key: 'points' | 'pct' | 'usd'
 *   dir            HIGHER | LOWER, from metrics.js:directionOf
 *   lowerIsBetter  the same fact as a boolean, matching rankAll's row field
 *   topLabel       what first place means, in words
 *   group          'overall' | 'domains' | 'staar' | 'outcomes' | 'resources'
 *   population     null, 'standard' or 'aea' — the accountability population
 *                  this metric is confined to (see metrics.js)
 *   change         null, or the CHANGE entry above
 *   changeTitle    headline-ready phrase for the change ranking, or null
 *   get(bundle)    the extractor, taken from metricSpecs rather than rewritten
 */
export function rankable({ subjects = STAAR_SUBJECTS } = {}) {
  // Both spec tables are built once. Every extractor except grad:* is identical
  // between them; taking the extractors from metricSpecs rather than writing new
  // ones is what stops a ranked table from reading a different number than the
  // entity page it links to.
  const std = new Map(metricSpecs({ subjects, isAlt: false }).map((s) => [s.key, s]))
  const aea = new Map(metricSpecs({ subjects, isAlt: true }).map((s) => [s.key, s]))

  const from = (table, key, extra) => {
    const s = table.get(key)
    if (!s) throw new Error(`rankable: metrics.js declares no spec for ${key}`)
    const dir = directionOf(s)
    if (dir === CONTEXT) throw new Error(`rankable: ${key} is a context metric and must not be ranked`)
    const change = CHANGE[key] ?? null
    const fallbackChangeTitle =
      dir === LOWER ? `Largest reduction in ${s.label.toLowerCase()}` : `Largest gain in ${s.label.toLowerCase()}`
    return {
      key: extra.key ?? key,
      specKey: key,
      slug: extra.slug,
      label: extra.label ?? s.label,
      title: extra.title ?? extra.label ?? s.label,
      unit: s.fmt === 'usd' ? 'dollars' : s.fmt === 'pct' ? 'percent' : 'points',
      fmt: s.fmt,
      dir,
      lowerIsBetter: dir === LOWER,
      topLabel: dir === LOWER ? 'Lowest' : 'Highest',
      group: extra.group,
      population: s.population ?? null,
      populationLabel: s.populationLabel ?? null,
      change,
      changeTitle: change ? extra.changeTitle ?? fallbackChangeTitle : null,
      get: s.get,
    }
  }

  const domains = [
    ['achievement', 'student-achievement', 'Student Achievement'],
    ['progress', 'school-progress', 'School Progress'],
    ['gaps', 'closing-the-gaps', 'Closing the Gaps'],
    ['progress_growth', 'academic-growth', 'Academic Growth'],
    ['progress_relative', 'relative-performance', 'Relative Performance'],
  ]

  const staarSlug = (subj, li) => `${slugify(subj)}-${['approaches', 'meets', 'masters'][li]}-grade-level`

  return [
    from(std, 'score', {
      slug: 'overall-score',
      title: 'Overall accountability score',
      group: 'overall',
      changeTitle: 'Largest gain in overall score',
    }),

    ...domains.map(([d, slug, title]) =>
      from(std, `domain:${d}`, { slug, title, group: 'domains', changeTitle: `Largest gain in ${title}` })
    ),

    // Graduation and dropout exist twice, once per accountability population,
    // because TEA relabels the same array for alternative-education entities and
    // judges it against a different bar. One list mixing the two would be two
    // metrics under one heading — see the AEA note in metrics.js. The '@aea'
    // suffix is this module's, not TEA's; `specKey` still points at grad:N.
    from(std, 'grad:0', { slug: 'four-year-graduation-rate', title: 'Four-year graduation rate', group: 'outcomes' }),
    from(aea, 'grad:0', {
      key: 'grad:0@aea',
      slug: 'four-year-completion-rate',
      title: 'Four-year completion rate (alternative-education accountability)',
      group: 'outcomes',
    }),
    from(std, 'grad:3', { slug: 'dropout-rate', title: 'Dropout rate', group: 'outcomes' }),
    from(aea, 'grad:3', {
      key: 'grad:3@aea',
      slug: 'dropout-rate-alternative-education',
      title: 'Dropout rate (alternative-education accountability)',
      group: 'outcomes',
    }),

    from(std, 'ccmr:0', {
      slug: 'college-career-military-ready',
      title: 'College, career or military readiness',
      group: 'outcomes',
    }),

    from(std, 'attendance', { slug: 'attendance', title: 'Attendance rate', group: 'outcomes' }),
    from(std, 'absenteeism', { slug: 'chronically-absent', title: 'Chronic absenteeism', group: 'outcomes' }),

    from(std, 'avgSalary', { slug: 'average-teacher-salary', title: 'Average teacher salary', group: 'resources' }),
    from(std, 'spend', {
      slug: 'per-student-spending',
      title: 'Per-student spending',
      group: 'resources',
      changeTitle: 'Largest increase in per-student spending',
    }),

    ...subjects.flatMap((subj) =>
      [0, 1, 2].map((li) =>
        from(std, `staar:${subj}:${li}`, {
          slug: staarSlug(subj, li),
          title: `${subj}: ${STAAR_LEVELS[li]}`,
          group: 'staar',
        })
      )
    ),
  ]
}

/** The curated list, for the subject set TEA publishes in this snapshot. */
export const RANKABLE = rankable()

export const RANKABLE_BY_KEY = new Map(RANKABLE.map((m) => [m.key, m]))
export const RANKABLE_BY_SLUG = new Map(RANKABLE.map((m) => [m.slug, m]))

/** The subset with real history. Everything else is single-year in this snapshot. */
export const CHANGE_METRICS = RANKABLE.filter((m) => m.change)

export const isRankable = (key) => RANKABLE_BY_KEY.has(key)

/**
 * Resolve a metric argument: a RANKABLE entry, its key, or its slug.
 * Throws rather than returning null — a page asking for a metric that does not
 * exist is a build-time mistake, and a silent empty table hides it.
 */
export function resolveMetric(metric) {
  if (metric && typeof metric === 'object' && metric.key) return metric
  const key = String(metric ?? '')
  const found = RANKABLE_BY_KEY.get(key) ?? RANKABLE_BY_SLUG.get(key)
  if (found) return found
  if (isContextMetric(key)) {
    throw new Error(
      `rankings: ${key} describes who an entity serves, not how it did, and is deliberately not rankable — see the CONTEXT note in src/render/rankings.js`
    )
  }
  throw new Error(`rankings: unknown metric ${JSON.stringify(key)}`)
}

/* ----------------------------------------------------------------- scopes -- */

/**
 * The four populations a ranking can be drawn from.
 *
 * The peer band deserves a note. view-model.js:peerBand is a SLIDING window —
 * every entity gets its own ±10-point neighbourhood — which is right for "how
 * did I do against schools like mine" and useless for a list, because a sliding
 * window is not a partition: entity A is in B's band while B is outside A's, so
 * there is no set to rank. A list needs fixed edges, so the band scope uses the
 * five stated bands below. They are wider than ±10 on purpose; a page must
 * therefore say "60% to under 80% economically disadvantaged", never "similar
 * student population", because it is not the same cohort the entity pages use.
 */
export const PEER_BANDS = [
  { id: '0-20', lo: 0, hi: 20, label: 'Under 20% economically disadvantaged', short: 'under 20% eco-dis', phrase: 'among entities serving under 20% economically disadvantaged students' },
  { id: '20-40', lo: 20, hi: 40, label: '20% to under 40% economically disadvantaged', short: '20–40% eco-dis', phrase: 'among entities serving 20% to under 40% economically disadvantaged students' },
  { id: '40-60', lo: 40, hi: 60, label: '40% to under 60% economically disadvantaged', short: '40–60% eco-dis', phrase: 'among entities serving 40% to under 60% economically disadvantaged students' },
  { id: '60-80', lo: 60, hi: 80, label: '60% to under 80% economically disadvantaged', short: '60–80% eco-dis', phrase: 'among entities serving 60% to under 80% economically disadvantaged students' },
  { id: '80-100', lo: 80, hi: 101, label: '80% or more economically disadvantaged', short: '80%+ eco-dis', phrase: 'among entities serving 80% or more economically disadvantaged students' },
]

const bandFor = (pct) => (finite(pct) ? PEER_BANDS.find((b) => pct >= b.lo && pct < b.hi) ?? null : null)

export const SCOPES = [
  {
    kind: 'state',
    label: 'Texas',
    plural: 'Texas',
    note: 'Every rated entity of this level in the state.',
    groupOf: () => 'tx',
  },
  {
    kind: 'region',
    label: 'Education service region',
    plural: 'Education service regions',
    note: 'One of the twenty regions TEA uses to organise Texas public education.',
    groupOf: (b) => (b.regionId ? padRegion(b.regionId) : null),
  },
  {
    kind: 'county',
    label: 'County',
    plural: 'Counties',
    note: 'All rated entities of this level in one county.',
    groupOf: (b) => b.countyId ?? null,
  },
  {
    kind: 'band',
    label: 'Economically disadvantaged band',
    plural: 'Economically disadvantaged bands',
    note: 'A fixed band of student poverty, so performance is compared across similar intakes.',
    groupOf: (b) => bandFor(b.profile?.ecoDisPct)?.id ?? null,
  },
]

export const SCOPE_KINDS = SCOPES.map((s) => s.kind)
const SCOPE_BY_KIND = new Map(SCOPES.map((s) => [s.kind, s]))

/** 'state' | 'region:07' | {kind:'county', id:'001'} -> {kind, id}. */
export function parseScope(scope = 'state') {
  const raw = typeof scope === 'string' ? scope : `${scope?.kind ?? 'state'}${scope?.id != null ? `:${scope.id}` : ''}`
  const [kind, ...rest] = String(raw).split(':')
  if (!SCOPE_BY_KIND.has(kind)) throw new Error(`rankings: unknown scope kind ${JSON.stringify(kind)}`)
  const id = rest.join(':') || null
  if (kind === 'state') return { kind, id: null }
  if (id == null) throw new Error(`rankings: scope ${kind} needs an id, e.g. "${kind}:07"`)
  return { kind, id: kind === 'region' ? padRegion(id) : id }
}

/** The inverse, for URL building. */
export const scopeKey = (scope) => {
  const { kind, id } = parseScope(scope)
  return kind === 'state' ? 'state' : `${kind}:${id}`
}

/**
 * A scope's human label, taken from the members where possible so a region and
 * county print the name TEA publishes rather than a bare id.
 */
function scopeLabel({ kind, id }, members) {
  if (kind === 'state') return { label: 'Texas', phrase: 'in Texas' }
  if (kind === 'region') {
    const name = members.find((b) => b.regionName)?.regionName ?? `Region ${id}`
    return { label: name, phrase: `in ${name}` }
  }
  if (kind === 'county') {
    const name = members.find((b) => b.county)?.county
    const label = name ? `${name} County` : `County ${id}`
    return { label, phrase: `in ${label}` }
  }
  const band = PEER_BANDS.find((b) => b.id === id)
  return { label: band?.label ?? `Band ${id}`, phrase: band?.phrase ?? `in band ${id}` }
}

/* ---------------------------------------------------------------- filters -- */

export const SECTORS = ['all', 'traditional', 'charter']
export const AEA_MODES = ['include', 'exclude', 'only']
export const LEVELS = ['district', 'campus']

const DEFAULT_FILTERS = { sector: 'all', aea: 'include' }

function normalizeFilters(filters = {}) {
  const f = { ...DEFAULT_FILTERS, ...filters }
  if (!SECTORS.includes(f.sector)) throw new Error(`rankings: sector must be one of ${SECTORS.join(', ')}`)
  if (!AEA_MODES.includes(f.aea)) throw new Error(`rankings: aea must be one of ${AEA_MODES.join(', ')}`)
  return f
}

/**
 * How the filters read in a sentence. Stated even when nothing was filtered,
 * because "charter districts are included" is information a reader needs to
 * interpret the table, and only saying so when it is unusual makes the common
 * case the ambiguous one.
 */
function filterPhrases(filters, level) {
  const kind = levelWord(level, 2)
  const out = []
  out.push(
    filters.sector === 'all'
      ? `open-enrollment charter ${kind} are included`
      : filters.sector === 'charter'
        ? `open-enrollment charter ${kind} only`
        : `traditional ${kind} only, charters excluded`
  )
  out.push(
    filters.aea === 'include'
      ? `alternative-education ${kind} are included`
      : filters.aea === 'only'
        ? `alternative-education ${kind} only`
        : `alternative-education ${kind} are excluded`
  )
  return out
}

/* --------------------------------------------------------------- bundles -- */

/**
 * One pass over the whole snapshot, producing everything every ranking needs.
 *
 * Extends metrics.js:sourceBundles — same object, same extractors, so a ranked
 * value and the value on the entity's own page come from one place — with the
 * entity fields a list row and a scope filter need (name, county, sector,
 * enrollment) and with `series`, the per-year history the change rankings read.
 *
 * `ratings` is passed through preferredRatings again on the way in. That is
 * deliberately redundant: prerender.js already hands over the preferred rows,
 * but preferredRatings is idempotent, and a caller who passes `allRatings` by
 * mistake would otherwise build a score series containing both the original and
 * the re-scored 2021-22 — one of which is not comparable with 2022-23, and
 * neither of which would announce itself in the output.
 */
export function rankingBundles({
  entities,
  ratings,
  allRatings,
  domains = [],
  profile = [],
  finance = [],
  achievement = [],
  latestYear,
  raw = null,
  regionNames = null,
}) {
  const preferred = preferredRatings(ratings ?? allRatings ?? [])
  const bundles = sourceBundles({ entities, ratings: preferred, domains, profile, finance, achievement, latestYear })
  // Rides on the Map so a page does not have to thread it through every call
  // alongside the bundles it already has. An explicit `latestYear` argument to
  // rankBy/changeMetrics still wins; this is the fallback, and it is only ever
  // used to name the year in the population sentence.
  bundles.latestYear = latestYear ?? null

  for (const e of entities) {
    const b = bundles.get(e.id)
    if (!b) continue
    b.name = e.name
    b.slug = entitySlug(e)
    b.level = e.level
    b.countyId = e.countyId
    b.county = e.county
    b.districtId = e.districtId
    b.districtName = e.districtName
    b.isCharter = !!e.isCharter
    b.isAlt = !!e.isAlt
    b.enrollment = e.enrollment ?? null
    b.rating = e.rating ?? null
    b.regionName =
      regionNames?.get(padRegion(e.regionId)) ?? (raw?.get?.(e.id)?.region ? String(raw.get(e.id).region).trim() : null)
    b.series = {}
  }

  for (const r of preferred) {
    if (!finite(r.score)) continue
    const b = bundles.get(r.id)
    if (!b?.series) continue
    ;(b.series.score ??= {})[r.year] = r.score
  }

  for (const d of domains) {
    if (!finite(d.score)) continue
    const b = bundles.get(d.id)
    if (!b?.series) continue
    ;(b.series[`domain:${d.domain}`] ??= {})[d.year] = d.score
  }

  for (const f of finance) {
    if (!finite(f.spendEntity)) continue
    const b = bundles.get(f.id)
    if (!b?.series) continue
    ;(b.series.spend ??= {})[f.year] = f.spendEntity
  }

  return bundles
}

/* --------------------------------------------------------- rank semantics -- */

/**
 * Competition ranking, identical in result to metrics.js:rankAll.
 *
 * rankAll computes, per entity, `values.filter(better).length + 1` — O(n²) over
 * a cohort, which is fine for one entity and impossible for 9,031 of them. Sort
 * once and the same number falls out of the index: everything before a tie group
 * is strictly better, so the group's rank is (index of its first member) + 1,
 * and every member of the group carries that same rank plus a count of the
 * others sharing it. `pctile` uses rankAll's formula unchanged.
 *
 * Within a tie group rows are ordered by name then id, so the table is
 * deterministic across builds and alphabetical where the numbers cannot separate
 * — never by input order, which would imply a ranking the data does not support.
 */
export function place(rows, lowerIsBetter) {
  const sorted = [...rows].sort(
    (a, b) =>
      (lowerIsBetter ? a.value - b.value : b.value - a.value) ||
      String(a.name ?? '').localeCompare(String(b.name ?? '')) ||
      String(a.id).localeCompare(String(b.id))
  )
  const of = sorted.length
  let i = 0
  while (i < of) {
    let j = i
    while (j + 1 < of && sorted[j + 1].value === sorted[i].value) j += 1
    const rank = i + 1
    const tied = j - i
    const pctile = Math.round((1 - (rank - 1) / of) * 100)
    for (let k = i; k <= j; k += 1) {
      sorted[k].rank = rank
      sorted[k].of = of
      sorted[k].tied = tied
      sorted[k].pctile = pctile
    }
    i = j + 1
  }
  return sorted
}

/**
 * Rounding, applied to change values only.
 *
 * A level value is published exactly as TEA reports it — rankAll does not round,
 * and rounding here would make a ranked table disagree with the entity page it
 * links to. A change value is a subtraction, and binary floating point turns
 * 86.1 - 84.3 into 1.7999999999999972: two districts that both gained 1.8 points
 * would compare unequal and be published as ranks 7 and 8 rather than as the tie
 * they are. Since a tie shown as a sole placement is the exact failure this site
 * exists to avoid, deltas are rounded to the precision the metric is reported
 * in: whole dollars, one decimal place otherwise.
 */
const roundDelta = (v, fmt) => (fmt === 'usd' ? Math.round(v) : Math.round(v * 10) / 10)

/* ------------------------------------------------------------- the engine -- */

/**
 * Narrow `entities` to the population a ranking is drawn from, counting what
 * each step removed. The counts are a funnel: each is entities dropped AT that
 * step from whatever survived the steps before it, so they sum with the final n
 * to the number handed in. Reported that way in `population.excluded`.
 */
function poolFor({ entities, bundles, metric, scope, level, filters }) {
  const excluded = { level: 0, scope: 0, sector: 0, aea: 0, population: 0, notRated: 0 }
  const def = SCOPE_BY_KIND.get(scope.kind)
  const members = []

  for (const e of entities) {
    if (e.level !== level) {
      excluded.level += 1
      continue
    }
    const b = bundles.get(e.id)
    if (!b) {
      excluded.level += 1
      continue
    }
    const group = def.groupOf(b)
    if (group == null || (scope.id != null && group !== scope.id)) {
      excluded.scope += 1
      continue
    }
    if (filters.sector === 'traditional' && b.isCharter) {
      excluded.sector += 1
      continue
    }
    if (filters.sector === 'charter' && !b.isCharter) {
      excluded.sector += 1
      continue
    }
    if (filters.aea === 'exclude' && b.isAlt) {
      excluded.aea += 1
      continue
    }
    if (filters.aea === 'only' && !b.isAlt) {
      excluded.aea += 1
      continue
    }
    // A population-confined metric (graduation, completion, dropout) only ever
    // meets figures measured against the same bar. Counted separately from the
    // AEA filter so a page can say "416 alternative-education campuses are
    // measured on completion instead and are ranked separately" rather than
    // burying them in "no value reported".
    if (metric.population && (metric.population === 'aea') !== b.isAlt) {
      excluded.population += 1
      continue
    }
    // The site's one cohort rule (view-model.js): the population is entities TEA
    // rated THIS year. An entity it did not rate is not in the running, and
    // counting it inflates the denominator of a contest it never entered.
    if (!finite(b.score)) {
      excluded.notRated += 1
      continue
    }
    members.push(b)
  }

  return { members, excluded }
}

/**
 * Assemble the envelope every ranking returns. `rows` may be empty; `published`
 * says whether the result cleared MIN_POPULATION, and a page must honour it.
 */
function envelope({ metric, scope, level, filters, members, excluded, rows, kind, window, basis, limit, latestYear }) {
  const { label: sLabel, phrase } = scopeLabel(scope, members)
  const eligible = members.length
  const of = rows.length
  const published = of >= MIN_POPULATION

  const reasons = []
  if (excluded.notRated > 0) reasons.push(`${nf(excluded.notRated)} TEA did not rate in ${latestYear ?? 'the current year'}`)
  if (excluded.population > 0) {
    reasons.push(
      `${nf(excluded.population)} judged under ${metric.population === 'aea' ? 'standard' : 'alternative-education'} accountability, where this measure means something different`
    )
  }
  if (excluded.sector > 0) reasons.push(`${nf(excluded.sector)} removed by the sector filter`)
  if (excluded.aea > 0) reasons.push(`${nf(excluded.aea)} removed by the alternative-education filter`)
  const missing = (excluded.noValue ?? 0) + (excluded.noStart ?? 0) + (excluded.noEnd ?? 0)
  if (missing > 0) {
    reasons.push(
      kind === 'change'
        ? `${nf(missing)} without a figure at both ends of the window`
        : `${nf(missing)} that did not report this measure`
    )
  }

  // The window belongs in the sentence, not only in the metadata: "improved
  // most" is not a claim until it says over what, and the sentence is the part a
  // page prints verbatim.
  const opening =
    kind === 'change' && window
      ? `${nf(of)} ${levelWord(level, of)} ranked ${phrase} by change from ${window.label}`
      : `${nf(of)} ${levelWord(level, of)} ranked ${phrase}`

  const sentence = [
    opening,
    reasons.length ? `Excluded: ${reasons.join('; ')}` : 'Nothing was excluded',
    filterPhrases(filters, level).join('; '),
    'Entities on the same figure share a rank, and the number sharing it is shown',
  ].join('. ') + '.'

  return {
    kind,
    metric: {
      key: metric.key,
      slug: metric.slug,
      label: metric.label,
      title: kind === 'change' ? metric.changeTitle ?? metric.title : metric.title,
      unit: metric.unit,
      fmt: metric.fmt,
      dir: metric.dir,
      lowerIsBetter: metric.lowerIsBetter,
      topLabel: metric.topLabel,
      group: metric.group,
      population: metric.population,
      populationLabel: metric.populationLabel,
    },
    scope: { ...scope, label: sLabel, phrase, kindLabel: SCOPE_BY_KIND.get(scope.kind).label },
    level,
    filters,
    basis: basis ?? null,
    window: window ?? null,
    population: {
      n: of,
      eligible,
      minimum: MIN_POPULATION,
      excluded,
      sentence,
    },
    published,
    suppressed: published ? null : 'population',
    rows: limit != null ? rows.slice(0, limit) : rows,
    truncated: limit != null && limit < of,
  }
}

/** The display fields every ranked row carries, ranking aside. */
const rowOf = (b) => ({
  id: b.id,
  name: b.name ?? null,
  slug: b.slug ?? null,
  level: b.level ?? null,
  regionId: b.regionId ?? null,
  regionName: b.regionName ?? null,
  countyId: b.countyId ?? null,
  county: b.county ?? null,
  districtId: b.districtId ?? null,
  districtName: b.districtName ?? null,
  isCharter: !!b.isCharter,
  isAlt: !!b.isAlt,
  rating: b.rating ?? null,
  score: finite(b.score) ? b.score : null,
  // Context travels WITH the ranking, never as the ranking. See the CONTEXT note.
  context: {
    ecoDisPct: b.profile?.ecoDisPct ?? null,
    engLrnPct: b.profile?.engLrnPct ?? null,
    specEdPct: b.profile?.specEdPct ?? null,
    enrollment: b.enrollment ?? null,
  },
})

/**
 * Rank a population by one current-year metric.
 *
 *   rankBy({ entities, bundles, metric, scope, level, filters, limit })
 *
 *   entities  the entity table (both levels; `level` selects)
 *   bundles   the Map from rankingBundles — build it ONCE per process
 *   metric    a RANKABLE entry, its key ('score') or its slug ('overall-score')
 *   scope     'state' | 'region:07' | 'county:001' | 'band:80-100', or {kind,id}
 *   level     'district' | 'campus'
 *   filters   { sector: 'all'|'traditional'|'charter', aea: 'include'|'exclude'|'only' }
 *   limit     rows to return; `population.n` always reports the full count
 *
 * Returns the envelope documented in `envelope` above. Every row carries rank,
 * of, tied and pctile; every result carries the population it was drawn from and
 * what each filter removed.
 */
export function rankBy({ entities, bundles, metric, scope = 'state', level = 'district', filters, limit = null, latestYear = null }) {
  const m = resolveMetric(metric)
  if (!LEVELS.includes(level)) throw new Error(`rankings: level must be one of ${LEVELS.join(', ')}`)
  const f = normalizeFilters(filters)
  const s = parseScope(scope)
  const { members, excluded } = poolFor({ entities, bundles, metric: m, scope: s, level, filters: f })

  excluded.noValue = 0
  const rows = []
  for (const b of members) {
    const v = m.get(b)
    if (!finite(v)) {
      excluded.noValue += 1
      continue
    }
    rows.push({ ...rowOf(b), value: v })
  }

  return envelope({
    metric: m,
    scope: s,
    level,
    filters: f,
    members,
    excluded,
    rows: place(rows, m.lowerIsBetter),
    kind: 'level',
    window: null,
    basis: null,
    limit,
    latestYear: latestYear ?? bundles?.latestYear ?? null,
  })
}

/* ----------------------------------------------------------------- change -- */

/** '2021-22 to 2025-26' — the label without which "improved most" means nothing. */
export const windowLabel = (from, to) => `${from} to ${to}`

/**
 * Which years a change metric can actually be measured between, with coverage.
 *
 * Returned ascending, each with the number of the eligible pool reporting that
 * year and its share. `eligible` marks the years clearing WINDOW_COVERAGE — the
 * ones a default window may use. A page offering "1 year / 3 years / since the
 * pandemic" reads its options off this rather than hard-coding years that the
 * next snapshot will move.
 */
export function availableYears({ entities, bundles, metric, scope = 'state', level = 'district', filters }) {
  const m = resolveMetric(metric)
  if (!m.change) return []
  const f = normalizeFilters(filters)
  const s = parseScope(scope)
  const { members } = poolFor({ entities, bundles, metric: m, scope: s, level, filters: f })

  const counts = new Map()
  for (const b of members) {
    const series = b.series?.[m.change.series]
    if (!series) continue
    for (const [year, v] of Object.entries(series)) {
      if (finite(v)) counts.set(year, (counts.get(year) ?? 0) + 1)
    }
  }
  const pool = members.length || 1
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year, n]) => ({ year, n, share: n / pool, eligible: n / pool >= WINDOW_COVERAGE }))
}

/**
 * Rank a population by CHANGE in one metric over a stated window.
 *
 *   changeMetrics({ entities, bundles, metric, scope, level, filters, from, to, basis, limit })
 *
 * `from`/`to` default to the widest span the population actually shares — the
 * first and last years clearing WINDOW_COVERAGE, per availableYears. The window
 * is always reported, never assumed: `result.window` carries { from, to, label,
 * years, yearKind, note } and, when the span reaches back to 2021-22, the
 * methodology note explaining why a change across that year is comparable.
 *
 * `basis` is 'absolute' (default) — points or dollars gained — or 'relative',
 * the percentage change, which is the fairer read for spending because a $2,000
 * rise means something different on a $9,000 base than on a $30,000 one. A
 * relative ranking drops entities whose starting figure is zero or negative,
 * counted as `excluded.noStart`, since a percentage of nothing is not a number.
 *
 * Refuses any metric without real history. There are exactly seven — the overall
 * score, the five domains and spending — and inventing growth for the rest by
 * differencing a single year against itself would be fabrication, not a bug.
 */
export function changeMetrics({
  entities,
  bundles,
  metric,
  scope = 'state',
  level = 'district',
  filters,
  from = null,
  to = null,
  basis = 'absolute',
  limit = null,
  latestYear = null,
}) {
  const m = resolveMetric(metric)
  if (!m.change) {
    throw new Error(
      `rankings: ${m.key} has one year of data in this snapshot, so change over time cannot be computed for it — CHANGE_METRICS lists the ${CHANGE_METRICS.length} that can`
    )
  }
  if (basis !== 'absolute' && basis !== 'relative') throw new Error(`rankings: basis must be 'absolute' or 'relative'`)
  if (!LEVELS.includes(level)) throw new Error(`rankings: level must be one of ${LEVELS.join(', ')}`)

  const f = normalizeFilters(filters)
  const s = parseScope(scope)
  const { members, excluded } = poolFor({ entities, bundles, metric: m, scope: s, level, filters: f })

  let start = from
  let end = to
  if (start == null || end == null) {
    const eligible = availableYears({ entities, bundles, metric: m, scope: s, level, filters: f }).filter((y) => y.eligible)
    start ??= eligible[0]?.year ?? null
    end ??= eligible.at(-1)?.year ?? null
  }

  // No usable window: return a suppressed, fully-labelled empty result rather
  // than a table of zeroes. A page iterating scopes must be able to skip it.
  if (start == null || end == null || start === end) {
    return envelope({
      metric: m,
      scope: s,
      level,
      filters: f,
      members,
      excluded: { ...excluded, noStart: 0, noEnd: 0 },
      rows: [],
      kind: 'change',
      window: null,
      basis,
      limit,
      latestYear: latestYear ?? bundles?.latestYear ?? null,
    })
  }
  if (start > end) [start, end] = [end, start]

  excluded.noStart = 0
  excluded.noEnd = 0
  const rows = []
  for (const b of members) {
    const series = b.series?.[m.change.series] ?? null
    const a = series?.[start]
    const z = series?.[end]
    if (!finite(a)) {
      excluded.noStart += 1
      continue
    }
    if (!finite(z)) {
      excluded.noEnd += 1
      continue
    }
    if (basis === 'relative' && a <= 0) {
      excluded.noStart += 1
      continue
    }
    const value = basis === 'relative' ? Math.round(((z - a) / a) * 1000) / 10 : roundDelta(z - a, m.fmt)
    rows.push({ ...rowOf(b), value, from: a, to: z, delta: roundDelta(z - a, m.fmt) })
  }

  const spansBreak = start <= METHOD_BREAK_YEAR && end >= METHOD_BREAK_YEAR && m.change.series === 'score'
  const window = {
    from: start,
    to: end,
    label: windowLabel(start, end),
    yearKind: m.change.yearKind,
    note: m.change.note,
    series: 'preferred',
    methodology: spansBreak ? { year: METHOD_BREAK_YEAR, comparable: true, note: METHOD_BREAK_NOTE } : null,
  }

  return envelope({
    metric: m,
    scope: s,
    level,
    filters: f,
    members,
    excluded,
    // A relative change is a percentage whatever the metric's own unit is.
    rows: place(rows, m.lowerIsBetter),
    kind: 'change',
    window,
    basis,
    limit,
    latestYear: latestYear ?? bundles?.latestYear ?? null,
  })
}

/* ------------------------------------------------------------------ batch -- */

/**
 * Every group of one scope kind, in one pass.
 *
 * Calling rankBy 253 times for the county tables would walk all 10,230 entities
 * 253 times. This partitions once and ranks each group, which is what makes a
 * full county sweep ~17 ms instead of ~2 s. Groups below MIN_POPULATION come
 * back with `published: false` rather than being dropped, so a caller can report
 * how many counties were too small to rank rather than quietly omitting them.
 *
 * Returns a Map of group id -> result, ordered by group id.
 */
export function rankEverywhere({
  entities,
  bundles,
  metric,
  kind = 'region',
  level = 'district',
  filters,
  change = false,
  from = null,
  to = null,
  basis = 'absolute',
  limit = null,
  latestYear = null,
}) {
  if (!SCOPE_BY_KIND.has(kind)) throw new Error(`rankings: unknown scope kind ${JSON.stringify(kind)}`)
  const def = SCOPE_BY_KIND.get(kind)
  const ids = new Set()
  for (const e of entities) {
    if (e.level !== level) continue
    const b = bundles.get(e.id)
    if (!b) continue
    const g = def.groupOf(b)
    if (g != null) ids.add(g)
  }

  const out = new Map()
  for (const id of [...ids].sort()) {
    const scope = kind === 'state' ? 'state' : { kind, id }
    const args = { entities, bundles, metric, scope, level, filters, limit, latestYear }
    out.set(id, change ? changeMetrics({ ...args, from, to, basis }) : rankBy(args))
  }
  return out
}
