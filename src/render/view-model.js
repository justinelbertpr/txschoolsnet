// Shapes raw tables into ONE object per entity. Sections never touch raw data,
// so a change in TEA's field names lands here and nowhere else.

import { num, percentage, str } from '../normalize/entities.js'
import { CCMR, GRADUATION, COMPLETION, DOMAIN_ORDER } from './labels.js'
import { DOMAIN_LABELS } from '../normalize/domains.js'
import { metricSpecs, sourceBundles, cohortMetrics, buildCohorts, rankAll, standouts } from './metrics.js'
import { buildHighlights } from './highlights.js'

export const slugify = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')

/** Named slug plus id: names are not unique (11 duplicate districts, 464 campuses). */
export const entitySlug = (e) => `${slugify(e.name)}-${e.id}`

const PEER_BAND = 10 // ±10 points of eco-dis %

const mean = (xs) => {
  const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x))
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

/**
 * The like-for-like comparison group: same level, eco-dis within ±10 points.
 * buildViewModel hands this the rated pool, not the full entity list, so the
 * band obeys the one cohort rule stated below along with everything else.
 * The state average alone systematically flatters wealthy entities and punishes
 * poor ones — this project's own poverty-gradient finding says so — so both are
 * shown and neither is presented as the whole answer.
 */
export function peerBand({ entity, entities, ecoDis }) {
  const mine = ecoDis.get(entity.id)
  if (mine == null) return { ids: new Set(), n: 0 }
  const ids = new Set(
    entities
      .filter((e) => e.level === entity.level && ecoDis.get(e.id) != null && Math.abs(ecoDis.get(e.id) - mine) <= PEER_BAND)
      .map((e) => e.id)
  )
  return { ids, n: ids.size }
}

const seriesByYear = (rows, keep) => {
  const acc = {}
  for (const r of rows) {
    if (r.score == null || !keep(r.id)) continue
    ;(acc[r.year] ??= []).push(r.score)
  }
  return Object.fromEntries(Object.entries(acc).map(([y, xs]) => [y, Math.round(mean(xs) * 10) / 10]))
}

/**
 * ONE definition of a cohort, used for every n this file publishes.
 *
 *   A cohort is every entity OF THE SAME LEVEL that TEA gave an overall score
 *   for the current year, narrowed by what the cohort is about (region, county,
 *   peer band, or nothing at all for the state) — the entity itself included,
 *   when it was rated.
 *
 * Three properties follow, and all three are the reason for the rule:
 *
 *   Including the entity is what a placement means. "12th of 378" says 378 is
 *   the population it was placed inside, not the 377 other schools.
 *
 *   Requiring a current-year score is what keeps the denominator honest. An
 *   entity TEA did not rate this year is not in the running, and counting it
 *   inflates the n of a contest it never entered. It also matches the rule
 *   stated on the about page: Not Rated is excluded from averages rather than
 *   counted as zero.
 *
 *   Membership is fixed by the current year, so a trajectory line is one set of
 *   schools followed backwards through time rather than a set that changes
 *   shape every year and moves the average by composition alone.
 *
 * Everything downstream reads this one pool: the trajectory picker, the peer
 * band, the state and peer series, the headline rank denominators, and the
 * entity list handed to metrics.js:buildCohorts, which drives the "compare
 * everything against" switch and every per-metric rank. One cohort therefore
 * cannot appear twice on a page with two different sizes.
 *
 * Per-metric ranks still carry their own n (rankAll counts entities holding
 * that metric, which not every cohort member reports) and each states it in
 * place, so a smaller denominator there is labelled rather than silently
 * different.
 */
const ratedPool = ({ entity, entities, ratings, latestYear }) => {
  const score = new Map()
  for (const r of ratings) {
    if (r.year !== latestYear) continue
    if (typeof r.score === 'number' && Number.isFinite(r.score)) score.set(r.id, r.score)
  }
  return { score, pool: entities.filter((e) => e.level === entity.level && score.has(e.id)) }
}

/**
 * Competition rank within a cohort: one plus the number of entities scoring
 * strictly better, plus how many OTHERS hold the identical score. Mirrors
 * metrics.js:rankAll deliberately — an array position would hand two entities
 * on the same score different placements purely by sort order, and the page
 * presents the result as a sole placement.
 */
const placement = ({ entity, pool, score }) => {
  const mine = score.get(entity.id)
  const of = pool.length
  if (mine == null) return { rank: null, of, tied: null }
  let better = 0
  let tied = 0
  for (const e of pool) {
    if (e.id === entity.id) continue
    const s = score.get(e.id)
    if (s > mine) better += 1
    else if (s === mine) tied += 1
  }
  return { rank: better + 1, of, tied }
}

/**
 * Turn an academic-year label into its starting calendar year. Requiring the
 * second half to agree with the first keeps an arbitrary string that happens
 * to contain a dash from entering a chronological series.
 */
const academicYearStart = (year) => {
  const match = /^(\d{4})-(\d{2})$/.exec(String(year ?? ''))
  if (!match) return null
  const start = Number(match[1])
  return Number(match[2]) === (start + 1) % 100 ? start : null
}

const adjacentAcademicYears = (from, to) => {
  const a = academicYearStart(from)
  const b = academicYearStart(to)
  return a != null && b === a + 1
}

const enrollmentChange = (from, to) => {
  const delta = to.enrollment - from.enrollment
  return {
    fromYear: from.year,
    toYear: to.year,
    from: from.enrollment,
    to: to.enrollment,
    delta,
    // A percentage from a zero base is undefined. The absolute change remains
    // available, so the page can state what happened without inventing a rate.
    pct: from.enrollment === 0 ? null : (delta / from.enrollment) * 100,
  }
}

/**
 * Enrollment is context, not a rating. Keep its chronology separate from the
 * accountability history and calculate changes only where two reported school
 * years are truly adjacent. Gaps remain gaps: no zeroes and no interpolation.
 */
const buildEnrollmentTrend = ({ entity, rows }) => {
  const byYear = new Map()
  const reportedByYear = new Map()
  for (const row of rows ?? []) {
    if (String(row?.id ?? '') !== String(entity.id)) continue
    if (row.level != null && row.level !== entity.level) continue
    const start = academicYearStart(row.year)
    if (start == null) continue
    if (row.enrollment == null) {
      reportedByYear.set(row.year, { year: row.year, enrollment: null, start })
      continue
    }
    if (!Number.isInteger(row.enrollment) || row.enrollment < 0) continue
    reportedByYear.set(row.year, { year: row.year, enrollment: row.enrollment, start })
    byYear.set(row.year, { year: row.year, enrollment: row.enrollment, start })
  }

  const reported = [...reportedByYear.values()]
    .sort((a, b) => a.start - b.start)
    .map(({ year, enrollment }) => ({ year, enrollment }))
  const base = [...byYear.values()].sort((a, b) => a.start - b.start)
  const points = base.map((point, i) => {
    const previous = base[i - 1]
    return {
      year: point.year,
      enrollment: point.enrollment,
      change: previous && adjacentAcademicYears(previous.year, point.year)
        ? enrollmentChange(previous, point)
        : null,
    }
  })

  if (points.length < 2) return { points, reported, summary: null }
  const latest = points.at(-1)
  const previous = points.at(-2)
  const contiguous = points.every((point, i) => i === 0 || adjacentAcademicYears(points[i - 1].year, point.year))
  return {
    points,
    reported,
    summary: {
      latest,
      previous: latest.change ? previous : null,
      yoy: latest.change,
      contiguous,
      sinceFirst: contiguous && points.length >= 3 ? enrollmentChange(points[0], latest) : null,
    },
  }
}

/**
 * TAPR publishes twelve separate campus class-size averages. Keeping the
 * categories explicit prevents a renderer from quietly manufacturing one
 * campus-wide average out of unlike grade and subject groups.
 */
export const CLASS_SIZE_CATEGORIES = Object.freeze([
  Object.freeze({ key: 'kindergarten', label: 'Kindergarten' }),
  Object.freeze({ key: 'grade1', label: 'Grade 1' }),
  Object.freeze({ key: 'grade2', label: 'Grade 2' }),
  Object.freeze({ key: 'grade3', label: 'Grade 3' }),
  Object.freeze({ key: 'grade4', label: 'Grade 4' }),
  Object.freeze({ key: 'grade5', label: 'Grade 5' }),
  Object.freeze({ key: 'grade6', label: 'Grade 6' }),
  Object.freeze({ key: 'secondaryEnglish', label: 'Secondary English' }),
  Object.freeze({
    key: 'secondaryLanguagesOtherThanEnglish',
    label: 'Secondary languages other than English',
  }),
  Object.freeze({ key: 'secondaryMath', label: 'Secondary math' }),
  Object.freeze({ key: 'secondaryScience', label: 'Secondary science' }),
  Object.freeze({ key: 'secondarySocialStudies', label: 'Secondary social studies' }),
])

const DISCIPLINE_CATEGORIES = Object.freeze([
  Object.freeze({ key: 'allDiscipline', heading: 'ALL DISCIPLINE', label: 'All discipline' }),
  Object.freeze({
    key: 'inSchoolSuspensions',
    heading: 'IN SCHOOL SUSPENSIONS',
    label: 'In-school suspensions',
  }),
  Object.freeze({
    key: 'outOfSchoolSuspensions',
    heading: 'OUT OF SCHOOL SUSPENSIONS',
    label: 'Out-of-school suspensions',
  }),
  Object.freeze({ key: 'daepPlacements', heading: 'DAEP PLACEMENTS', label: 'DAEP placements' }),
  Object.freeze({
    key: 'mandatoryDaepPlacements',
    heading: 'MANDATORY DAEP PLACEMENTS',
    label: 'Mandatory DAEP placements',
  }),
  Object.freeze({
    key: 'discretionaryDaepPlacements',
    heading: 'DISCRETIONARY DAEP PLACEMENTS',
    label: 'Discretionary DAEP placements',
  }),
  Object.freeze({ key: 'jjaepPlacements', heading: 'JJAEP PLACEMENTS', label: 'JJAEP placements' }),
  Object.freeze({
    key: 'mandatoryJjaepPlacements',
    heading: 'MANDATORY JJAEP PLACEMENTS',
    label: 'Mandatory JJAEP placements',
  }),
  Object.freeze({
    key: 'discretionaryJjaepPlacements',
    heading: 'DISCRETIONARY JJAEP PLACEMENTS',
    label: 'Discretionary JJAEP placements',
  }),
  Object.freeze({ key: 'expulsions', heading: 'EXPULSIONS', label: 'Expulsions' }),
  Object.freeze({
    key: 'mandatoryExpulsions',
    heading: 'MANDATORY EXPULSIONS',
    label: 'Mandatory expulsions',
  }),
  Object.freeze({
    key: 'discretionaryExpulsions',
    heading: 'DISCRETIONARY EXPULSIONS',
    label: 'Discretionary expulsions',
  }),
])

const reportedNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null

/**
 * Level-aware educator context. TEA reports turnover for districts and actual
 * class size for campuses; no value is inferred across that boundary.
 */
export function buildEducatorContext({ entity, rows = [], latestYear = null }) {
  const matching = rows
    .filter(
      (row) =>
        String(row?.id ?? '') === String(entity.id) &&
        row?.level === entity.level &&
        academicYearStart(row?.year) != null
    )
    .sort((a, b) => academicYearStart(a.year) - academicYearStart(b.year))

  if (entity.level === 'district') {
    const history = matching.map((row) => ({
      year: row.year,
      ratePct: reportedNumber(row.teacherTurnoverRate),
    }))
    return {
      teacherTurnover: history.length
        ? {
            unit: 'percent',
            history,
            latest: latestYear ? history.find((point) => point.year === latestYear) ?? null : null,
          }
        : null,
      classSize: null,
    }
  }

  if (entity.level === 'campus') {
    const current = latestYear ? matching.find((row) => row.year === latestYear) : null
    if (!current) return { teacherTurnover: null, classSize: null }
    const categories = CLASS_SIZE_CATEGORIES.map(({ key, label }) => ({
      key,
      label,
      studentsPerClass: reportedNumber(current.classSize?.[key]),
    }))
    return {
      teacherTurnover: null,
      classSize: {
        year: current.year,
        categories,
        reported: categories.filter((category) => category.studentsPerClass != null).length,
      },
    }
  }

  return { teacherTurnover: null, classSize: null }
}

const copyDisciplineDatum = (datum, rateKey = null) => {
  const value = {
    count: Number.isSafeInteger(datum?.count) && datum.count >= 0 ? datum.count : null,
    status: ['reported', 'suppressed', 'not-reported'].includes(datum?.status)
      ? datum.status
      : 'not-reported',
    mask: typeof datum?.mask === 'string' && datum.mask ? datum.mask : null,
  }
  return rateKey ? { ...value, [rateKey]: reportedNumber(datum?.[rateKey]) } : value
}

/**
 * The build table already contains only TEA's explicit Section B totals. This
 * final shape changes object-keyed current categories into a stable display
 * list and carries the non-additivity and 2020-21 cautions beside the data.
 */
export function buildDisciplineContext({ entity, summary = null, meta = null }) {
  if (
    !summary ||
    String(summary.id ?? '') !== String(entity.id) ||
    summary.level !== entity.level
  ) return null

  const categorySchema =
    Array.isArray(meta?.headlineCategories) && meta.headlineCategories.length === DISCIPLINE_CATEGORIES.length
      ? meta.headlineCategories
      : DISCIPLINE_CATEGORIES
  const point = (row) => ({
    year: row.year,
    cumulativeEnrollment: copyDisciplineDatum(row.cumulativeEnrollment),
    students: copyDisciplineDatum(row.students, 'ratePct'),
    actions: copyDisciplineDatum(row.actions, 'ratePer100'),
  })
  const latest = summary.latest
  return {
    history: Array.isArray(summary.history) ? summary.history.map(point) : [],
    current: latest
      ? {
          year: latest.year,
          cumulativeEnrollment: copyDisciplineDatum(latest.cumulativeEnrollment),
          categories: categorySchema.map(({ key, heading, label }) => ({
            key,
            heading,
            label,
            students: copyDisciplineDatum(latest.categories?.[key]?.students, 'ratePct'),
            actions: copyDisciplineDatum(latest.categories?.[key]?.actions, 'ratePer100'),
          })),
        }
      : null,
    caveats: {
      overlap: meta?.overlapCaveat ?? null,
      pandemic2020_21: meta?.pandemicCaveat ?? null,
      source: meta?.sourceCaveat ?? null,
    },
  }
}

/** District-only transfer totals and flows, already reduced from official rows. */
export function buildTransferContext({ entity, summary = null, meta = null }) {
  if (
    entity.level !== 'district' ||
    !summary ||
    String(summary.id ?? '') !== String(entity.id) ||
    summary.level !== 'district'
  ) return null

  return {
    netLabel: summary.netLabel ?? null,
    history: Array.isArray(summary.history) ? summary.history : [],
    current: summary.current ?? null,
    changeSinceFirst: summary.changeSinceFirst ?? null,
    caveats: meta?.caveats ?? null,
    scope: meta?.scope ?? null,
  }
}

export function buildViewModel({
  entity,
  entities,
  ratings,
  allRatings,
  domains,
  finance,
  profile,
  raw,
  achievement,
  snapshotDate,
  latestYear,
  previousYear = null,
  recentChangeRanks = [],
  enrollmentHistory = [],
  enrollmentSnapshotDate = null,
  enrollmentSourceUrl = null,
  actionNotices = [],
  communityContext = null,
  postsecondaryOutcome = null,
  educatorHistory = [],
  educatorLatestYear = null,
  disciplineSummary = null,
  transferSummary = null,
  publicDataMeta = null,
}) {
  const ecoDis = new Map(profile.map((p) => [p.id, p.ecoDisPct]))

  // The cohort pool: same level, rated this year. Every n below comes from it.
  const { score: latestScore, pool } = ratedPool({ entity, entities, ratings, latestYear })
  const poolIds = new Set(pool.map((e) => e.id))
  const band = peerBand({ entity, entities: pool, ecoDis })

  const history = ratings.filter((r) => r.id === entity.id).sort((a, b) => b.year.localeCompare(a.year))

  const state = placement({ entity, pool, score: latestScore })
  const region = placement({
    entity,
    pool: pool.filter((e) => e.regionId === entity.regionId),
    score: latestScore,
  })

  const stateByYear = seriesByYear(ratings, (id) => poolIds.has(id))
  const peerByYear = band.n > 1 ? seriesByYear(ratings, (id) => band.ids.has(id)) : null

  // Comparison groups the reader can switch between. Each is a real cohort with a
  // stated n, so a line never appears without the reader knowing what it averages.
  const cohort = (label, key, pred) => {
    const ids = pool.filter(pred).map((e) => e.id)
    if (ids.length < 2) return null
    const set = new Set(ids)
    return { key, label, n: ids.length, byYear: seriesByYear(ratings, (id) => set.has(id)) }
  }

  const enrol = entity.enrollment
  const comparisons = [
    { key: 'state', label: 'Texas average', n: pool.length, byYear: stateByYear },
    band.n > 1
      ? {
          key: 'peer',
          label: 'Similar economic-disadvantage rate',
          n: band.n,
          byYear: peerByYear,
          note: `Within 10 points of this ${entity.level}'s economically disadvantaged share`,
        }
      : null,
    cohort(`${str(raw?.region) ?? 'Region ' + entity.regionId}`, 'region', (e) => e.regionId === entity.regionId),
    cohort(`${entity.county} County`, 'county', (e) => e.countyId === entity.countyId),
    enrol
      ? cohort('Similar size', 'size', (e) => e.enrollment != null && e.enrollment >= enrol * 0.6 && e.enrollment <= enrol * 1.6)
      : null,
  ].filter(Boolean)

  const original = allRatings.find((r) => r.id === entity.id && r.method === 'original')
  const prof = profile.find((p) => p.id === entity.id) ?? null

  // Keep the entity's full domain series for the fixed latest-vs-previous-year
  // highlight window. The page still renders only the current rows below; this
  // second view exists solely so a positive-signal card can name both endpoints
  // instead of searching history for whichever starting year looks best.
  const entityDomains = domains.filter((d) => d.id === entity.id)
  const dom = entityDomains
    .filter((d) => d.year === latestYear)
    .map((d) => ({ ...d, label: DOMAIN_LABELS[d.domain] }))
    .sort((a, b) => DOMAIN_ORDER.indexOf(a.domain) - DOMAIN_ORDER.indexOf(b.domain))

  const fin = finance.filter((f) => f.id === entity.id).sort((a, b) => a.year.localeCompare(b.year))
  const last = fin.at(-1)

  const ach = achievement?.find((a) => a.id === entity.id) ?? null
  const gradLabels = entity.isAlt ? COMPLETION : GRADUATION
  // One comparison engine for every metric on the page. Declaring a metric in
  // metrics.js is what makes it comparable — a section cannot ship a number
  // without its context, because the context is computed for all of them at once.
  const bundles = sourceBundles({ entities, ratings, domains, profile, finance, achievement, latestYear })
  const specs = metricSpecs({ subjects: ach?.subject ?? [], isAlt: entity.isAlt })
  // `pool`, not `entities`: the cohort switch counts the same population the
  // trajectory picker and the headline rank do. See the cohort rule above.
  const { cohorts, ids: cohortIds } = buildCohorts({
    entity,
    entities: pool,
    bundles,
    specs,
    band,
    regionName: str(raw?.region) ?? `Region ${entity.regionId}`,
    countyName: entity.county,
  })
  const own = cohortMetrics(specs, bundles, [entity.id])
  const ranks = rankAll({ entity, cohorts, bundles, specs, cohortIds })
  const highlights = buildHighlights({
    history,
    domainHistory: entityDomains,
    own,
    cohorts,
    ranks,
    specs,
    recentChangeRanks,
    latestYear,
    previousYear,
    // Three is enough to establish a real strength without turning the top of
    // the page into a press release. A fourth qualifying fact remains in the
    // full comparisons/rankings below rather than being hidden from the site.
    limit: 3,
  })
  const enrollmentTrend = buildEnrollmentTrend({ entity, rows: enrollmentHistory })
  const educatorContext = buildEducatorContext({
    entity,
    rows: educatorHistory,
    latestYear: educatorLatestYear,
  })
  const discipline = buildDisciplineContext({
    entity,
    summary: disciplineSummary,
    meta: publicDataMeta?.discipline ?? null,
  })
  const transferContext = buildTransferContext({
    entity,
    summary: transferSummary,
    meta: publicDataMeta?.transfers ?? null,
  })

  return {
    ...entity,
    slug: entitySlug(entity),
    districtSlug: entity.districtName ? `${slugify(entity.districtName)}-${entity.districtId}` : null,
    countySlug: slugify(entity.county ?? ''),
    regionName: str(raw?.region) ?? `Region ${entity.regionId}`,
    snapshotDate,
    enrollmentSnapshotDate,
    enrollmentSourceUrl,
    actionNotices,
    communityContext,
    postsecondaryOutcome,
    teacherTurnover: educatorContext.teacherTurnover,
    classSize: educatorContext.classSize,
    discipline,
    transferContext,
    publicDataMeta,
    notRated: entity.rating === 'Not Rated',

    history,
    enrollmentHistory: enrollmentTrend.points,
    enrollmentReported: enrollmentTrend.reported,
    enrollmentTrend: enrollmentTrend.summary
      ? { points: enrollmentTrend.points, ...enrollmentTrend.summary }
      : null,
    stateByYear,
    stateAvg: stateByYear[latestYear] ?? null,
    peerByYear,
    peerAvg: peerByYear?.[latestYear] ?? null,
    peerN: band.n,
    comparisons,
    // Competition rank, with the number of others sharing the same score, so a
    // shared ceiling is never presented as a sole placement.
    rank: state.rank,
    rankOf: state.of,
    rankTied: state.tied,
    regionRank: region.rank,
    regionRankOf: region.of,
    regionRankTied: region.tied,
    originalScore: original?.score ?? null,
    originalRating: original?.rating ?? null,

    domains: dom,
    profile: prof
      ? { ...prof, teachers: num(raw?.Full_Time_Teachers), stuPerStaff: num(raw?.Stu_Per_Staff) }
      : null,
    raceShare: raw?.Enrollment ?? null,
    staffYears: raw?.Staff_Years ?? null,

    cohorts,
    own,
    ranks,
    standouts: standouts(ranks),
    highlights,

    staar:
      ach?.subject?.length && ach?.approach?.length
        ? { subjects: ach.subject, levels: [ach.approach, ach.meet, ach.master].map((lvl) => lvl.map(percentage)) }
        : null,
    graduation:
      ach?.grad_rate_col2?.length
        ? ach.grad_rate_col2
            .map((v, i) => ({ label: gradLabels[i] ?? `Measure ${i + 1}`, value: percentage(v) }))
            .filter((g) => g.value != null)
        : null,
    ccmr:
      ach?.ccmr_col2?.length > 1
        ? CCMR.map((label, i) => ({
            label,
            value: percentage(ach.ccmr_col2[i]) == null ? null : ach.ccmr_col2[i],
            compare: percentage(ach.ccmr_col3?.[i]) == null ? null : ach.ccmr_col3[i],
          })).filter((c) => c.value != null)
        : null,

    finance: fin.length
      ? {
          years: fin.map((f) => f.year),
          spendEntity: fin.map((f) => f.spendEntity),
          spendPeer: fin.map((f) => f.spendPeer),
          spendState: fin.map((f) => f.spendState),
          vsPeer: last?.spendEntity != null && last?.spendPeer != null ? last.spendEntity - last.spendPeer : null,
          vsState: last?.spendEntity != null && last?.spendState != null ? last.spendEntity - last.spendState : null,
        }
      : null,

    campuses:
      entity.level === 'district'
        ? entities
            .filter((c) => c.level === 'campus' && c.districtId === entity.id)
            .map((c) => ({ ...c, slug: entitySlug(c) }))
            .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
        : null,
  }
}
