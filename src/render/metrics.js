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

const numPct = (v) => {
  const n = Number(String(v ?? '').replace('%', ''))
  return Number.isFinite(n) ? n : null
}

const mean = (xs) => {
  const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x))
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

/**
 * Metric declarations. `key` is stable and used by the client to swap cohorts;
 * `get` pulls the value from the per-entity source bundle; `fmt` says how a
 * delta should read, since a percentage point and a dollar are not the same
 * kind of difference.
 */
export function metricSpecs({ subjects = [], isAlt = false } = {}) {
  const gradLabels = isAlt ? COMPLETION : GRADUATION
  const specs = [
    { key: 'score', label: 'Overall score', fmt: 'points', get: (s) => s.score },

    ...['achievement', 'progress', 'gaps', 'progress_growth', 'progress_relative'].map((d) => ({
      key: `domain:${d}`,
      label: DOMAIN_LABELS[d],
      fmt: 'points',
      get: (s) => s.domains?.[d] ?? null,
    })),

    ...subjects.flatMap((subj, si) =>
      [0, 1, 2].map((li) => ({
        key: `staar:${subj}:${li}`,
        label: `${subj} — ${STAAR_LEVELS[li].replace(' grade level', '')}`,
        fmt: 'pct',
        // Aligned on subject NAME: entities report different subject sets, and
        // aligning on array position would compare Reading against Science.
        get: (s) => {
          const at = s.subjects?.indexOf(subj) ?? -1
          return at === -1 ? null : s.staar?.[li]?.[at] ?? null
        },
      }))
    ),

    ...[0, 1, 2, 3].map((i) => ({
      key: `grad:${i}`,
      label: gradLabels[i],
      fmt: 'pct',
      get: (s) => s.grad?.[i] ?? null,
    })),

    ...Array.from({ length: 12 }, (_, i) => ({
      key: `ccmr:${i}`,
      label: i === 0 ? 'College, career or military ready' : CCMR[i],
      fmt: 'pct',
      get: (s) => s.ccmr?.[i] ?? null,
    })),

    { key: 'ecoDis', label: 'Economically disadvantaged', fmt: 'pct', get: (s) => s.profile?.ecoDisPct },
    { key: 'engLrn', label: 'English learners', fmt: 'pct', get: (s) => s.profile?.engLrnPct },
    { key: 'specEd', label: 'Special education', fmt: 'pct', get: (s) => s.profile?.specEdPct },
    { key: 'attendance', label: 'Attendance', fmt: 'pct', get: (s) => s.profile?.attendance },
    { key: 'absenteeism', label: 'Chronically absent', fmt: 'pct', get: (s) => s.profile?.absenteeism },
    { key: 'avgSalary', label: 'Average teacher salary', fmt: 'usd', get: (s) => s.profile?.avgSalary },
    // Students-per-staff is deliberately absent: toProfile does not carry
    // Stu_Per_Staff, so a spec for it would resolve to undefined for every entity
    // and quietly produce an empty comparison. Add it to the normalizer first.
    { key: 'spend', label: 'Per-student spending', fmt: 'usd', get: (s) => s.spend },
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

  for (const e of entities) put(e.id, { id: e.id, level: e.level, regionId: e.regionId })
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
      cur.staar = [a.approach, a.meet, a.master].map((lvl) => (lvl ?? []).map(numPct))
    }
    if (a.grad_rate_col2?.length) cur.grad = a.grad_rate_col2.map(numPct)
    if (a.ccmr_col2?.length > 1) cur.ccmr = a.ccmr_col2.map(numPct)
  }

  return byId
}

/** Average every metric across one cohort. */
export function cohortMetrics(specs, bundles, ids) {
  const acc = new Map(specs.map((s) => [s.key, []]))
  for (const id of ids) {
    const b = bundles.get(id)
    if (!b) continue
    for (const s of specs) {
      const v = s.get(b)
      if (typeof v === 'number' && Number.isFinite(v)) acc.get(s.key).push(v)
    }
  }
  const out = {}
  for (const s of specs) {
    const m = mean(acc.get(s.key))
    if (m !== null) out[s.key] = Math.round(m * 10) / 10
  }
  return out
}

/** The three cohorts every metric is compared against. */
export function buildCohorts({ entity, entities, bundles, specs, band, regionName, countyName }) {
  const sameLevel = entities.filter((e) => e.level === entity.level)
  const region = sameLevel.filter((e) => e.regionId === entity.regionId)
  const county = sameLevel.filter((e) => e.countyId === entity.countyId)

  const defs = [
    band.n > 1
      ? {
          key: 'peer',
          label: 'Similar student population',
          short: 'similar',
          note: `Within 10 points of this ${entity.level}'s economically disadvantaged share`,
          ids: [...band.ids],
        }
      : null,
    region.length > 1 ? { key: 'region', label: regionName, short: 'region', ids: region.map((e) => e.id) } : null,
    county.length > 1 ? { key: 'county', label: `${countyName} County`, short: 'county', ids: county.map((e) => e.id) } : null,
    { key: 'state', label: 'Texas average', short: 'state', ids: sameLevel.map((e) => e.id) },
  ].filter(Boolean)

  const ids = Object.fromEntries(defs.map((d) => [d.key, d.ids]))
  return {
    cohorts: defs.map((d) => ({ ...d, n: d.ids.length, metrics: cohortMetrics(specs, bundles, d.ids), ids: undefined })),
    ids,
  }
}

/* ------------------------------------------------------------------ ranks -- */

/**
 * Where this entity sits within each cohort, for every metric.
 *
 * This is what lets a district comms officer write a true sentence: "2nd of 294
 * districts serving a similar student population." Every claim carries its
 * cohort and its denominator, because a rank without an n is a boast, not a fact.
 *
 * `higherIsBetter: false` metrics (dropout, absenteeism, students per staff)
 * rank ascending — being 1st means the lowest, and the statement says so.
 */
const LOWER_IS_BETTER = new Set(['absenteeism', 'stuPerStaff', 'grad:3'])

export function rankAll({ entity, cohorts, bundles, specs, cohortIds }) {
  const out = []
  for (const c of cohorts) {
    const ids = cohortIds[c.key] ?? []
    for (const s of specs) {
      const mine = s.get(bundles.get(entity.id) ?? {})
      if (typeof mine !== 'number' || !Number.isFinite(mine)) continue

      const values = []
      for (const id of ids) {
        const v = s.get(bundles.get(id) ?? {})
        if (typeof v === 'number' && Number.isFinite(v)) values.push(v)
      }
      if (values.length < 10) continue // a rank out of 9 is not worth publishing

      const lower = LOWER_IS_BETTER.has(s.key)
      const better = values.filter((v) => (lower ? v < mine : v > mine)).length
      const rank = better + 1
      const pctile = Math.round((1 - (rank - 1) / values.length) * 100)

      // Ties are reported, never hidden. "1st of 1,084" when 213 districts share
      // a 100% graduation rate is the kind of claim that gets a comms officer
      // corrected in public, and this site's whole premise is claims that hold up.
      const tied = values.filter((v) => v === mine).length - 1

      out.push({
        metric: s.key,
        label: s.label,
        fmt: s.fmt,
        cohort: c.key,
        cohortLabel: c.label,
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

/** The subset worth putting in front of someone: genuinely high placements. */
export function standouts(ranks, { limit = 12 } = {}) {
  const distinct = (r) => r.tied <= Math.max(2, r.of * 0.02)
  const strong = ranks.filter((r) => (r.rank <= 10 || r.pctile >= 95) && distinct(r))
  const shared = ranks.filter((r) => (r.rank <= 10 || r.pctile >= 95) && !distinct(r))

  // Sole placements first; heavily-tied ones still shown, but ranked behind and
  // labelled, so a reader never mistakes a shared ceiling for a sole first place.
  const by = (a, b) => a.rank - b.rank || b.of - a.of || b.pctile - a.pctile
  return [...strong.sort(by), ...shared.sort(by)].slice(0, limit)
}
