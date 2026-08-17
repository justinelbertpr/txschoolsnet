// Shapes raw tables into ONE object per entity. Sections never touch raw data,
// so a change in TEA's field names lands here and nowhere else.

import { num, percentage, str } from '../normalize/entities.js'
import { CCMR, GRADUATION, COMPLETION, DOMAIN_ORDER } from './labels.js'
import { DOMAIN_LABELS } from '../normalize/domains.js'
import { metricSpecs, sourceBundles, cohortMetrics, buildCohorts, rankAll, standouts } from './metrics.js'

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

export function buildViewModel({ entity, entities, ratings, allRatings, domains, finance, profile, raw, achievement, snapshotDate, latestYear }) {
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

  const dom = domains
    .filter((d) => d.id === entity.id && d.year === latestYear)
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

  return {
    ...entity,
    slug: entitySlug(entity),
    districtSlug: entity.districtName ? `${slugify(entity.districtName)}-${entity.districtId}` : null,
    countySlug: slugify(entity.county ?? ''),
    regionName: str(raw?.region) ?? `Region ${entity.regionId}`,
    snapshotDate,
    notRated: entity.rating === 'Not Rated',

    history,
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
