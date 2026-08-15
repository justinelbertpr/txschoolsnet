// Shapes raw tables into ONE object per entity. Sections never touch raw data,
// so a change in TEA's field names lands here and nowhere else.

import { num, str } from '../normalize/entities.js'
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

export function buildViewModel({ entity, entities, ratings, allRatings, domains, finance, profile, raw, achievement, snapshotDate, latestYear }) {
  const ecoDis = new Map(profile.map((p) => [p.id, p.ecoDisPct]))
  const byId = new Map(entities.map((e) => [e.id, e]))
  const band = peerBand({ entity, entities, ecoDis })

  const history = ratings.filter((r) => r.id === entity.id).sort((a, b) => b.year.localeCompare(a.year))

  const sameLevel = ratings
    .filter((r) => r.year === latestYear && byId.get(r.id)?.level === entity.level && r.score !== null)
    .sort((a, b) => b.score - a.score)
  const rank = sameLevel.findIndex((r) => r.id === entity.id) + 1
  const inRegion = sameLevel.filter((r) => byId.get(r.id)?.regionId === entity.regionId)

  const sameLevelId = (id) => byId.get(id)?.level === entity.level
  const stateByYear = seriesByYear(ratings, sameLevelId)
  const peerByYear = band.n > 1 ? seriesByYear(ratings, (id) => band.ids.has(id)) : null

  // Comparison groups the reader can switch between. Each is a real cohort with a
  // stated n, so a line never appears without the reader knowing what it averages.
  const cohort = (label, key, pred) => {
    const ids = entities.filter((e) => e.level === entity.level && e.id !== entity.id && pred(e)).map((e) => e.id)
    if (ids.length < 2) return null
    const set = new Set(ids)
    return { key, label, n: ids.length, byYear: seriesByYear(ratings, (id) => set.has(id)) }
  }

  const enrol = entity.enrollment
  const comparisons = [
    { key: 'state', label: 'Texas average', n: entities.filter((e) => e.level === entity.level).length, byYear: stateByYear },
    band.n > 1
      ? {
          key: 'peer',
          label: 'Similar student population',
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
  const pctNum = (v) => {
    const n = Number(String(v ?? '').replace('%', ''))
    return Number.isFinite(n) ? n : null
  }

  // One comparison engine for every metric on the page. Declaring a metric in
  // metrics.js is what makes it comparable — a section cannot ship a number
  // without its context, because the context is computed for all of them at once.
  const bundles = sourceBundles({ entities, ratings, domains, profile, finance, achievement, latestYear })
  const specs = metricSpecs({ subjects: ach?.subject ?? [], isAlt: entity.isAlt })
  const { cohorts, ids: cohortIds } = buildCohorts({
    entity,
    entities,
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
    rank,
    rankOf: sameLevel.length,
    regionRank: inRegion.findIndex((r) => r.id === entity.id) + 1,
    regionRankOf: inRegion.length,
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
        ? { subjects: ach.subject, levels: [ach.approach, ach.meet, ach.master].map((lvl) => lvl.map(pctNum)) }
        : null,
    graduation:
      ach?.grad_rate_col2?.length
        ? ach.grad_rate_col2
            .map((v, i) => ({ label: gradLabels[i] ?? `Measure ${i + 1}`, value: pctNum(v) }))
            .filter((g) => g.value != null)
        : null,
    ccmr:
      ach?.ccmr_col2?.length > 1
        ? CCMR.map((label, i) => ({ label, value: ach.ccmr_col2[i] ?? null, compare: ach.ccmr_col3?.[i] ?? null })).filter(
            (c) => c.value != null
          )
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
