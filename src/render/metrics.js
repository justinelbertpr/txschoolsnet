// One comparison engine for the whole page.
//
// Every number this site publishes is comparable against three cohorts: entities
// serving a similar student population, entities in the same region, and the
// state. Rather than each section computing its own comparison, every metric is
// declared once here with an extractor, and cohort averages are computed for all
// of them in a single pass.
//
// The consequence that matters: adding a metric to the page automatically makes
// it comparable. There is no way to ship a number without its context.

import { CCMR, GRADUATION, COMPLETION, STAAR_LEVELS } from './labels.js'
import { DOMAIN_LABELS } from '../normalize/domains.js'
import { percentage } from '../normalize/entities.js'

const mean = (xs) => {
  const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x))
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

/**
 * Accountability populations. TEA judges alternative-education campuses against
 * a different bar and relabels the same array COMPLETION rather than GRADUATION
 * (see labels.js) — 30 districts and 416 campuses in this snapshot. Averaging a
 * comprehensive high school's four-year graduation rate with an AEA campus's
 * four-year completion rate is not one metric with two names; it is two metrics.
 * In the 2026-08 snapshot the two populations differ by ~35 points on the
 * four-year rate and ~10 points on dropout, so pooling them is not a rounding
 * error — it flatters every standard campus and buries every AEA campus.
 *
 * A metric that carries a `population` is only ever averaged and ranked against
 * cohort members in that same population; members of the other population are
 * read as null, which drops them from the mean AND from the rank denominator.
 */
const AEA = 'aea'
const STANDARD = 'standard'
const POPULATION_LABEL = {
  [AEA]: 'alternative-education accountability only',
  [STANDARD]: 'standard accountability only',
}
const populationOf = (bundle) => (bundle?.isAlt ? AEA : STANDARD)

/**
 * Direction, declared once per metric, because it decides three things at once:
 * which end of the cohort a rank counts from, whether the claim sentence says
 * "highest" or "lowest", and — for one third value — whether the metric may be
 * ranked at all.
 *
 *   'higher'   more is better. Ranked descending; 1st is the largest value.
 *   'lower'    less is better. Ranked ascending; 1st is the smallest value.
 *   'context'  NEITHER, and therefore never ranked. See CONTEXT below.
 *
 * A spec that omits `dir` falls back to the key sets, so a spec object built by
 * hand (tests, a future consumer) still ranks in the right direction rather than
 * silently defaulting to descending.
 */
export const HIGHER = 'higher'
export const LOWER = 'lower'
export const CONTEXT = 'context'

/**
 * Metrics that describe WHO an entity serves rather than how it did.
 *
 * A rank is an ordering, and an ordering asserts that one end is the good end.
 * There is no good end to the share of a school's students living in poverty,
 * learning English, or receiving special education services. Ranking them
 * produced exactly the claim this site exists to avoid — "Abilene ISD ranks 8th
 * of 43 districts for Economically disadvantaged (highest)" — with a Copy button
 * under it, and on a D-rated campus the only thing the page could find to
 * celebrate was "3 of 309 · Economically disadvantaged".
 *
 * Neutral wording would not have fixed it. The standouts selector takes one tail
 * (rank <= 10, or the 95th percentile up), so the artifact is a leaderboard
 * whatever the caption says, and the downloadable rank rows carry a
 * `lowerIsBetter` boolean that has no honest value for these keys.
 *
 * So they are excluded from ranking outright. They keep their cohort averages
 * and their comparison chips — context is worth comparing, it is just not worth
 * placing — and rankAll emits no row for them, which is what makes the sentence
 * above impossible to produce rather than merely unlikely.
 *
 * Where the line falls: an entity does not choose how many of its students are
 * poor, and ranking it for that is ranking its intake. It does choose what it
 * spends per student and what it pays teachers, and a district will defend those
 * numbers as decisions, so they stay ranked. If that reading is ever rejected
 * for spending, adding 'spend' here is the whole change.
 */
const CONTEXT_KEYS = new Set(['ecoDis', 'engLrn', 'specEd'])

/** True for a metric key that describes the student population, not performance. */
export const isContextMetric = (key) => CONTEXT_KEYS.has(key)

/**
 * Metric declarations. `key` is stable and used by the client to swap cohorts;
 * `get` pulls the value from the per-entity source bundle; `fmt` says how a
 * delta should read, since a percentage point and a dollar are not the same
 * kind of difference; `dir` says which way it reads (above). `population`, where
 * present, is the comparison population the key is confined to.
 */
export function metricSpecs({ subjects = [], isAlt = false } = {}) {
  const gradLabels = isAlt ? COMPLETION : GRADUATION
  const gradPopulation = isAlt ? AEA : STANDARD
  const specs = [
    { key: 'score', label: 'Overall score', fmt: 'points', dir: HIGHER, get: (s) => s.score },

    ...['achievement', 'progress', 'gaps', 'progress_growth', 'progress_relative'].map((d) => ({
      key: `domain:${d}`,
      label: DOMAIN_LABELS[d],
      fmt: 'points',
      dir: HIGHER,
      get: (s) => s.domains?.[d] ?? null,
    })),

    ...subjects.flatMap((subj, si) =>
      [0, 1, 2].map((li) => ({
        key: `staar:${subj}:${li}`,
        label: `${subj} — ${STAAR_LEVELS[li].replace(' grade level', '')}`,
        fmt: 'pct',
        dir: HIGHER,
        // Aligned on subject NAME: entities report different subject sets, and
        // aligning on array position would compare Reading against Science.
        get: (s) => {
          const at = s.subjects?.indexOf(subj) ?? -1
          return at === -1 ? null : s.staar?.[li]?.[at] ?? null
        },
      }))
    ),

    // The key stays `grad:i` under both standards so one page template can render
    // either, but the extractor is confined to the calling entity's population:
    // a graduation figure only ever meets other graduation figures, a completion
    // figure only other completion figures. Index 3 (dropout) is confined too —
    // it is the same relabelled array, judged against the same different bar —
    // and it is the one member of the array where less is better.
    ...[0, 1, 2, 3].map((i) => ({
      key: `grad:${i}`,
      label: gradLabels[i],
      fmt: 'pct',
      dir: i === 3 ? LOWER : HIGHER,
      population: gradPopulation,
      populationLabel: POPULATION_LABEL[gradPopulation],
      get: (s) => (populationOf(s) === gradPopulation ? s.grad?.[i] ?? null : null),
    })),

    ...Array.from({ length: 12 }, (_, i) => ({
      key: `ccmr:${i}`,
      label: i === 0 ? 'College, career or military ready' : CCMR[i],
      fmt: 'pct',
      dir: HIGHER,
      get: (s) => s.ccmr?.[i] ?? null,
    })),

    // The three shares below are CONTEXT, not performance: compared, never
    // ranked. See CONTEXT_KEYS.
    { key: 'ecoDis', label: 'Economically disadvantaged', fmt: 'pct', dir: CONTEXT, get: (s) => s.profile?.ecoDisPct },
    { key: 'engLrn', label: 'English learners', fmt: 'pct', dir: CONTEXT, get: (s) => s.profile?.engLrnPct },
    { key: 'specEd', label: 'Special education', fmt: 'pct', dir: CONTEXT, get: (s) => s.profile?.specEdPct },
    // Attendance is the share of days attended, so more is better; chronic
    // absence is its complement in spirit, and less of it is better. They are
    // opposite metrics with opposite directions, not one metric twice.
    { key: 'attendance', label: 'Attendance', fmt: 'pct', dir: HIGHER, get: (s) => s.profile?.attendance },
    { key: 'absenteeism', label: 'Chronically absent', fmt: 'pct', dir: LOWER, get: (s) => s.profile?.absenteeism },
    { key: 'avgSalary', label: 'Average teacher salary', fmt: 'usd', dir: HIGHER, get: (s) => s.profile?.avgSalary },
    // Students-per-staff is deliberately absent: toProfile does not carry
    // Stu_Per_Staff, so a spec for it would resolve to undefined for every entity
    // and quietly produce an empty comparison. Add it to the normalizer first.
    { key: 'spend', label: 'Per-student spending', fmt: 'usd', dir: HIGHER, get: (s) => s.spend },
  ]
  return specs
}

/**
 * Builds the per-entity source bundle the extractors read. Doing this once per
 * entity, rather than inside every extractor, is what keeps a 35-metric x
 * 3-cohort computation over 9,031 entities cheap.
 */
export function sourceBundles({ entities, ratings, domains, profile, finance, achievement, latestYear }) {
  const byId = new Map()
  const put = (id, patch) => byId.set(id, Object.assign(byId.get(id) ?? {}, patch))

  // isAlt rides on the bundle because it decides which population a member's
  // graduation/completion figure belongs to — see metricSpecs.
  for (const e of entities) put(e.id, { id: e.id, level: e.level, regionId: e.regionId, isAlt: !!e.isAlt })
  for (const r of ratings) if (r.year === latestYear) put(r.id, { score: r.score })
  for (const p of profile) put(p.id, { profile: p })

  for (const d of domains) {
    if (d.year !== latestYear) continue
    const cur = byId.get(d.id)
    if (!cur) continue
    ;(cur.domains ??= {})[d.domain] = d.score
  }

  for (const f of finance) {
    const cur = byId.get(f.id)
    if (!cur) continue
    if (!cur._finYear || f.year > cur._finYear) {
      cur._finYear = f.year
      cur.spend = f.spendEntity
    }
  }

  for (const a of achievement ?? []) {
    const cur = byId.get(a.id)
    if (!cur) continue
    if (a.subject?.length) {
      cur.subjects = a.subject
      cur.staar = [a.approach, a.meet, a.master].map((lvl) => (lvl ?? []).map(percentage))
    }
    if (a.grad_rate_col2?.length) cur.grad = a.grad_rate_col2.map(percentage)
    if (a.ccmr_col2?.length > 1) cur.ccmr = a.ccmr_col2.map(percentage)
  }

  return byId
}

/** Average every metric across one cohort and retain its reporting coverage. */
export function cohortMetricSummary(specs, bundles, ids) {
  const acc = new Map(specs.map((s) => [s.key, []]))
  for (const id of ids) {
    const b = bundles.get(id)
    if (!b) continue
    for (const s of specs) {
      const v = s.get(b)
      if (typeof v === 'number' && Number.isFinite(v)) acc.get(s.key).push(v)
    }
  }
  const metrics = {}
  const metricN = {}
  for (const s of specs) {
    const values = acc.get(s.key)
    const m = mean(values)
    if (m !== null) {
      metrics[s.key] = Math.round(m * 10) / 10
      metricN[s.key] = values.length
    }
  }
  return { metrics, metricN }
}

/** Backwards-compatible average-only view used for the entity's own values. */
export const cohortMetrics = (specs, bundles, ids) => cohortMetricSummary(specs, bundles, ids).metrics

/** The three cohorts every metric is compared against. */
export function buildCohorts({ entity, entities, bundles, specs, band, regionName, countyName }) {
  const sameLevel = entities.filter((e) => e.level === entity.level)
  const region = sameLevel.filter((e) => e.regionId === entity.regionId)
  const county = sameLevel.filter((e) => e.countyId === entity.countyId)

  const defs = [
    band.n > 1
      ? {
          key: 'peer',
          label: 'Similar economic-disadvantage rate',
          short: 'similar economic context',
          note: `Within 10 points of this ${entity.level}'s economically disadvantaged share`,
          ids: [...band.ids],
        }
      : null,
    region.length > 1 ? { key: 'region', label: regionName, short: 'region', ids: region.map((e) => e.id) } : null,
    county.length > 1 ? { key: 'county', label: `${countyName} County`, short: 'county', ids: county.map((e) => e.id) } : null,
    { key: 'state', label: 'Texas average', short: 'state', ids: sameLevel.map((e) => e.id) },
  ].filter(Boolean)

  // `n` is the number of entities IN the cohort, not the number that reported any
  // one metric — most cohort members report no graduation rate at all, and for a
  // population-confined metric the members of the other accountability population
  // contribute nothing either. The denominator that gets published is rankAll's
  // `of`, which counts only the members that actually carried a value.
  const ids = Object.fromEntries(defs.map((d) => [d.key, d.ids]))
  return {
    cohorts: defs.map((d) => {
      const summary = cohortMetricSummary(specs, bundles, d.ids)
      return { ...d, n: d.ids.length, ...summary, ids: undefined }
    }),
    ids,
  }
}

/* --------------------------------------------------- what the score reads -- */

/**
 * Which domains the overall rating is actually built from.
 *
 * TEA's formula is not "add up the domains". The overall score is the BETTER of
 * Domain 1 (Student Achievement) and Domain 2 (School Progress), weighted 70%,
 * plus Domain 3 (Closing the Gaps) at 30%. The lower of the first two is
 * discarded outright, and 8,621 of the 9,245 entities in this snapshot that
 * publish both have one to discard.
 *
 * This page used to name the domain with the smallest points-to-next-grade and
 * say it was "closest to moving up". For Dallas ISD — Student Achievement 79,
 * School Progress 86 — that named Student Achievement, one point below a B,
 * which TEA does not count at all: it is the lower of the two, so a point there
 * moves nothing until it passes 86. The sentence was false on thousands of
 * pages, and hedging it would only have made it vague as well as false.
 *
 * So the candidates are computed instead. `counted` is the domains that carry
 * weight for THIS entity, `discarded` is the 70% measure TEA throws away, and
 * `kept` is the one it keeps. Academic Growth and Relative Performance are
 * excluded on purpose: they are the two halves School Progress is the better of,
 * not measures the overall score reads directly.
 */
export function countedDomains(doms) {
  const by = new Map((doms ?? []).filter((d) => d?.score != null).map((d) => [d.domain, d]))
  const a = by.get('achievement') ?? null
  const p = by.get('progress') ?? null
  const g = by.get('gaps') ?? null

  let kept = null
  let discarded = null
  if (a && p) {
    kept = a.score >= p.score ? a : p
    discarded = kept === a ? p : a
  } else kept = a ?? p ?? null

  // Equal scores: neither is discarded, because raising either raises the max.
  const tied = a && p && a.score === p.score
  const counted = [...(tied ? [a, p] : kept ? [kept] : []), ...(g ? [g] : [])]
  return { counted, kept, discarded: tied ? null : discarded, gaps: g }
}

/**
 * The counted domain nearest its own next letter. A tie goes to a 70% measure
 * over Closing the Gaps, since that is the lane the same point buys more in.
 */
export const closestCounted = (counted) =>
  counted
    .filter((d) => d.toNextGrade != null)
    .sort((x, y) => x.toNextGrade - y.toNextGrade || (x.domain === 'gaps' ? 1 : 0) - (y.domain === 'gaps' ? 1 : 0))[0] ?? null

/* ------------------------------------------------------------------ ranks -- */

/**
 * Where this entity sits within each cohort, for every metric.
 *
 * This is what lets a district comms officer write a true sentence: "2nd of 294
 * districts serving a similar student population." Every claim carries its
 * cohort and its denominator, because a rank without an n is a boast, not a fact.
 *
 * Metrics where less is better (dropout, absenteeism, students per staff) rank
 * ascending — being 1st means the lowest, and the statement says so.
 *
 * Metrics whose direction is `context` are not ranked at all: no row is emitted,
 * so nothing downstream — standouts, the copyable claim sentence, the per-entity
 * JSON — has a placement to publish for a demographic share.
 */
const LOWER_IS_BETTER = new Set(['absenteeism', 'stuPerStaff', 'grad:3'])

/**
 * The direction a spec ranks in. Declared on the spec where one exists; the key
 * sets are the fallback for a spec object assembled without a `dir`, so a metric
 * can never rank the wrong way round merely because a caller left the field off.
 */
export const directionOf = (spec) =>
  spec?.dir ?? (isContextMetric(spec?.key) ? CONTEXT : LOWER_IS_BETTER.has(spec?.key) ? LOWER : HIGHER)

export function rankAll({ entity, cohorts, bundles, specs, cohortIds }) {
  const out = []
  for (const c of cohorts) {
    const ids = cohortIds[c.key] ?? []
    for (const s of specs) {
      if (directionOf(s) === CONTEXT) continue // context is compared, never placed
      const mine = s.get(bundles.get(entity.id) ?? {})
      if (typeof mine !== 'number' || !Number.isFinite(mine)) continue

      const values = []
      for (const id of ids) {
        const v = s.get(bundles.get(id) ?? {})
        if (typeof v === 'number' && Number.isFinite(v)) values.push(v)
      }
      if (values.length < 10) continue // a rank out of 9 is not worth publishing

      const lower = directionOf(s) === LOWER
      const better = values.filter((v) => (lower ? v < mine : v > mine)).length
      const rank = better + 1
      const pctile = Math.round((1 - (rank - 1) / values.length) * 100)

      // Ties are reported, never hidden. "1st of 1,084" when 213 districts share
      // a 100% graduation rate is the kind of claim that gets a comms officer
      // corrected in public, and this site's whole premise is claims that hold up.
      const tied = values.filter((v) => v === mine).length - 1

      // A population-confined metric names its population in the cohort label,
      // because the cohort the reader was told about ("Texas average", n=2,119)
      // is not the group this figure was measured against (325 AEA campuses).
      // sections.js renders cohortLabel verbatim as the scope line under every
      // standout and inside every copyable claim sentence, so the disclosure
      // travels with the claim rather than sitting in a footnote.
      out.push({
        metric: s.key,
        label: s.label,
        fmt: s.fmt,
        population: s.population ?? null,
        populationLabel: s.populationLabel ?? null,
        cohort: c.key,
        cohortLabel: s.population ? `${c.label} (${s.populationLabel})` : c.label,
        cohortShort: c.short,
        rank,
        of: values.length,
        pctile,
        value: mine,
        tied,
        lowerIsBetter: lower,
      })
    }
  }
  return out
}

/**
 * The subset worth putting in front of someone: genuinely high placements.
 *
 * rankAll already emits no context metric, so the filter below is the second
 * lock rather than the first — this list is what a Copy button turns into a
 * quotable sentence, and it must not be reachable by a demographic share even
 * if some other caller hands in rows it built itself.
 */
export function standouts(ranks, { limit = 12 } = {}) {
  const performance = ranks.filter((r) => !isContextMetric(r.metric))
  const distinct = (r) => r.tied <= Math.max(2, r.of * 0.02)
  const strong = performance.filter((r) => (r.rank <= 10 || r.pctile >= 95) && distinct(r))
  const shared = performance.filter((r) => (r.rank <= 10 || r.pctile >= 95) && !distinct(r))

  // Sole placements first; heavily-tied ones still shown, but ranked behind and
  // labelled, so a reader never mistakes a shared ceiling for a sole first place.
  const by = (a, b) => a.rank - b.rank || b.of - a.of || b.pctile - a.pctile
  return [...strong.sort(by), ...shared.sort(by)].slice(0, limit)
}
