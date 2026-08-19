// Evidence-backed positive signals for an entity page.
//
// This module deliberately returns data, not promotional sentences. A renderer
// can change the presentation without changing the selection rules, and every
// visible claim can travel with the values, years, cohort, coverage and tie
// information that support it.

/** @typedef {'gain'|'benchmark'|'subject-benchmark'|'rank'} HighlightKind */
/** @typedef {'change'|'benchmark'|'rank'} EvidenceKind */

const finite = (v) => typeof v === 'number' && Number.isFinite(v)
const round1 = (v) => Math.round(v * 10) / 10

/** The performance measures this editorial surface is allowed to celebrate. */
export const isHighlightMetric = (key) =>
  key === 'score' ||
  key === 'attendance' ||
  key === 'absenteeism' ||
  key?.startsWith('domain:') ||
  /^staar:.+:[12]$/.test(key ?? '') ||
  key?.startsWith('grad:') ||
  key?.startsWith('ccmr:')

const isLower = (spec) => spec?.dir === 'lower' || spec?.key === 'absenteeism' || spec?.key === 'grad:3'

const schoolYearStart = (year) => {
  const match = String(year ?? '').match(/^(\d{4})/)
  return match ? Number(match[1]) : null
}

// The caller names the comparison years, but this check prevents a stale older
// year being relabelled as "last year". Missing adjacent-year data means no gain
// card; it never causes the selector to reach farther back for a nicer result.
const isAdjacentWindow = (latestYear, previousYear) => {
  const latest = schoolYearStart(latestYear)
  const previous = schoolYearStart(previousYear)
  return latest != null && previous != null && latest - previous === 1
}

const rowValue = (row) => (finite(row?.score) ? row.score : finite(row?.value) ? row.value : null)

const valueAt = (rows, year) => {
  const candidates = (rows ?? []).filter((row) => row?.year === year && row?.method !== 'original' && rowValue(row) != null)
  return rowValue(candidates.find((row) => row.method === 'current') ?? candidates[0])
}

const domainRows = (history) => {
  if (!Array.isArray(history)) return []
  return history.flatMap((entry) => {
    if (Array.isArray(entry?.history)) {
      const domain = entry.domain ?? String(entry.metric ?? '').replace(/^domain:/, '')
      return entry.history.map((row) => ({ ...row, domain: row.domain ?? domain }))
    }
    return entry
  })
}

const metricOfDomain = (row) => {
  if (String(row?.metric ?? '').startsWith('domain:')) return row.metric
  return row?.domain ? `domain:${row.domain}` : null
}

const distinctRank = (row) =>
  finite(row?.rank) &&
  finite(row?.of) &&
  row.of >= 10 &&
  finite(row?.tied) &&
  row.tied >= 0 &&
  row.tied <= Math.max(2, row.of * 0.02)

const cohortPriority = (key) => ({ state: 0, peer: 1, region: 2, county: 3 }[key] ?? 4)

const bestRank = (rows, metric, { latestYear, previousYear, recent = false } = {}) =>
  (rows ?? [])
    .filter((row) => {
      if (row?.metric !== metric || row.rank > 3 || !distinctRank(row)) return false
      if (!recent && row.year != null && row.year !== latestYear) return false
      if (recent && row.latestYear != null && row.latestYear !== latestYear) return false
      if (recent && row.toYear != null && row.toYear !== latestYear) return false
      if (recent && row.previousYear != null && row.previousYear !== previousYear) return false
      if (recent && row.fromYear != null && row.fromYear !== previousYear) return false
      return true
    })
    .sort((a, b) =>
      a.rank - b.rank ||
      cohortPriority(a.cohort) - cohortPriority(b.cohort) ||
      b.of - a.of ||
      String(a.cohort ?? '').localeCompare(String(b.cohort ?? ''))
    )[0] ?? null

const rankEvidence = (row, period, latestYear, previousYear) => ({
  kind: /** @type {EvidenceKind} */ ('rank'),
  period,
  metric: row.metric,
  label: row.label,
  fmt: row.fmt,
  cohort: row.cohort,
  cohortLabel: row.cohortLabel,
  rank: row.rank,
  of: row.of,
  tied: row.tied,
  value: row.value,
  lowerIsBetter: !!row.lowerIsBetter,
  population: row.population ?? null,
  populationLabel: row.populationLabel ?? null,
  latestYear,
  ...(period === 'change' ? { previousYear } : {}),
})

const metricPriority = (key) => {
  if (key === 'score') return 0
  const domains = {
    'domain:gaps': 10,
    'domain:progress': 11,
    'domain:achievement': 12,
    'domain:progress_growth': 13,
    'domain:progress_relative': 14,
  }
  if (domains[key] != null) return domains[key]

  const staar = String(key).match(/^staar:(.+):([12])$/)
  if (staar) {
    const subject = staar[1].toLowerCase()
    const subjectWeight = subject === 'all subjects' ? 0 : subject.includes('math') ? 2 : subject.includes('read') ? 3 : 5
    return 20 + subjectWeight + (staar[2] === '2' ? 0 : 1)
  }

  if (key === 'grad:0') return 35
  if (key === 'grad:3') return 36
  if (key?.startsWith('grad:')) return 37
  if (key === 'ccmr:0') return 40
  if (key === 'attendance' || key === 'absenteeism') return 45
  if (key === 'ccmr:3') return 50 // AP/IB criterion
  if (key?.startsWith('ccmr:')) return 55 + Number(key.split(':')[1] ?? 99)
  return 100
}

const benchmarkEvidence = ({ spec, ownValue, cohort, average, metricN, latestYear }) => {
  const lower = isLower(spec)
  const advantage = lower ? average - ownValue : ownValue - average
  return {
    kind: /** @type {EvidenceKind} */ ('benchmark'),
    metric: spec.key,
    label: spec.label,
    fmt: spec.fmt,
    cohort: cohort.key,
    cohortLabel: cohort.label,
    cohortN: cohort.n,
    metricN,
    coverage: metricN / cohort.n,
    value: ownValue,
    benchmark: average,
    advantage: round1(advantage),
    lowerIsBetter: lower,
    population: spec.population ?? null,
    populationLabel: spec.populationLabel ?? null,
    latestYear,
  }
}

const qualifyingBenchmarks = ({ own, cohorts, specs, latestYear }) => {
  const byMetric = new Map()
  const eligibleCohorts = (cohorts ?? [])
    .filter((cohort) => cohort?.key === 'state' || cohort?.key === 'peer')
    .sort((a, b) => cohortPriority(a.key) - cohortPriority(b.key))

  for (const spec of specs ?? []) {
    if (!isHighlightMetric(spec?.key) || (spec.fmt !== 'points' && spec.fmt !== 'pct')) continue
    const mine = own?.[spec.key]
    if (!finite(mine)) continue
    for (const cohort of eligibleCohorts) {
      const average = cohort.metrics?.[spec.key]
      const metricN = cohort.metricN?.[spec.key]
      if (!finite(average) || !finite(metricN) || !finite(cohort.n) || cohort.n <= 0) continue
      if (metricN < 20 || metricN / cohort.n < 0.8) continue
      const advantage = isLower(spec) ? average - mine : mine - average
      const minimum = spec.fmt === 'points' ? 2 : 1
      if (advantage < minimum) continue
      const evidence = benchmarkEvidence({ spec, ownValue: mine, cohort, average, metricN, latestYear })
      const list = byMetric.get(spec.key) ?? []
      list.push(evidence)
      byMetric.set(spec.key, list)
    }
  }
  return byMetric
}

const preferredBenchmark = (byMetric, metric) =>
  (byMetric.get(metric) ?? []).sort((a, b) =>
    cohortPriority(a.cohort) - cohortPriority(b.cohort) ||
    b.advantage - a.advantage
  )[0] ?? null

const newCard = ({ id, kind, metric, metrics, label, latestYear, previousYear, evidence = [] }) => ({
  id,
  kind: /** @type {HighlightKind} */ (kind),
  metric,
  metrics: metrics ?? [metric],
  label,
  latestYear,
  ...(previousYear ? { previousYear } : {}),
  evidence,
})

const addOnce = (card, evidence) => {
  if (!evidence) return
  const duplicate = card.evidence.some((item) =>
    item.kind === evidence.kind &&
    item.metric === evidence.metric &&
    item.period === evidence.period &&
    item.cohort === evidence.cohort
  )
  if (!duplicate) card.evidence.push(evidence)
}

const hasEvidence = (card, kind) => card.evidence.some((item) => item.kind === kind)
const hasStateBenchmark = (card) => card.evidence.some((item) => item.kind === 'benchmark' && item.cohort === 'state')
const hasPeerBenchmark = (card) => card.evidence.some((item) => item.kind === 'benchmark' && item.cohort === 'peer')

/**
 * Select at most four uniformly-defined, evidence-backed positive signals.
 *
 * The returned objects contain only source facts and selection metadata. There
 * is intentionally no fallback card: an entity without a qualifying result gets
 * an empty array rather than a vague or made-up compliment.
 */
export function buildHighlights({
  history = [],
  domainHistory = [],
  own = {},
  cohorts = [],
  ranks = [],
  specs = [],
  recentChangeRanks = [],
  latestYear,
  previousYear,
  limit = 4,
} = {}) {
  if (!latestYear) return []
  const cap = Math.max(0, Math.min(4, Math.floor(limit)))
  if (!cap) return []

  const specByMetric = new Map((specs ?? []).filter((spec) => spec?.key).map((spec) => [spec.key, spec]))
  const benchmarks = qualifyingBenchmarks({ own, cohorts, specs, latestYear })
  const fixedWindow = isAdjacentWindow(latestYear, previousYear)
  const cards = []
  const cardByMetric = new Map()

  const attachRanks = (card, metric) => {
    const spec = specByMetric.get(metric)
    if (!spec || !isHighlightMetric(metric)) return
    const current = bestRank(ranks, metric, { latestYear, previousYear })
    const recent = fixedWindow ? bestRank(recentChangeRanks, metric, { latestYear, previousYear, recent: true }) : null
    addOnce(card, current ? rankEvidence(current, 'current', latestYear, previousYear) : null)
    addOnce(card, recent ? rankEvidence(recent, 'change', latestYear, previousYear) : null)
  }

  const attachBenchmark = (card, metric) => addOnce(card, preferredBenchmark(benchmarks, metric))

  // A gain is valid only for the named adjacent school years. We never scan the
  // full history for a more flattering start point.
  if (fixedWindow) {
    const scoreSpec = specByMetric.get('score')
    const latest = valueAt(history, latestYear)
    const previous = valueAt(history, previousYear)
    if (scoreSpec && finite(latest) && finite(previous) && latest - previous >= 2) {
      const card = newCard({
        id: 'gain:score',
        kind: 'gain',
        metric: 'score',
        label: scoreSpec.label,
        latestYear,
        previousYear,
        evidence: [{
          kind: /** @type {EvidenceKind} */ ('change'),
          metric: 'score',
          label: scoreSpec.label,
          fmt: 'points',
          fromValue: previous,
          toValue: latest,
          delta: round1(latest - previous),
          previousYear,
          latestYear,
        }],
      })
      attachBenchmark(card, 'score')
      attachRanks(card, 'score')
      cards.push(card)
      cardByMetric.set('score', card)
    }

    const rows = domainRows(domainHistory)
    const domainMetrics = [...new Set(rows.map(metricOfDomain).filter(Boolean))]
    const gains = domainMetrics.flatMap((metric) => {
      const spec = specByMetric.get(metric)
      if (!spec || !isHighlightMetric(metric)) return []
      const relevant = rows.filter((row) => metricOfDomain(row) === metric)
      const latest = valueAt(relevant, latestYear)
      const previous = valueAt(relevant, previousYear)
      if (!finite(latest) || !finite(previous) || latest - previous < 2) return []
      return [{ metric, spec, latest, previous, delta: latest - previous }]
    })
    gains.sort((a, b) => b.delta - a.delta || metricPriority(a.metric) - metricPriority(b.metric) || a.metric.localeCompare(b.metric))
    const gain = gains[0]
    if (gain) {
      const card = newCard({
        id: `gain:${gain.metric}`,
        kind: 'gain',
        metric: gain.metric,
        label: gain.spec.label,
        latestYear,
        previousYear,
        evidence: [{
          kind: /** @type {EvidenceKind} */ ('change'),
          metric: gain.metric,
          label: gain.spec.label,
          fmt: 'points',
          fromValue: gain.previous,
          toValue: gain.latest,
          delta: round1(gain.delta),
          previousYear,
          latestYear,
        }],
      })
      attachBenchmark(card, gain.metric)
      attachRanks(card, gain.metric)
      cards.push(card)
      cardByMetric.set(gain.metric, card)
    }
  }

  // If Meets and Masters both clear the same benchmark, publish one coherent
  // subject result instead of two near-duplicate cards.
  const subjectGroups = new Map()
  for (const spec of specs ?? []) {
    const match = String(spec?.key ?? '').match(/^staar:(.+):([12])$/)
    if (!match || !benchmarks.has(spec.key)) continue
    const [, subject, level] = match
    const group = subjectGroups.get(subject) ?? {}
    group[level] = spec
    subjectGroups.set(subject, group)
  }

  const pairCards = []
  const pairedMetrics = new Set()
  for (const [subject, group] of subjectGroups) {
    if (!group[1] || !group[2]) continue
    const sharedCohort = ['state', 'peer'].find((cohort) =>
      (benchmarks.get(group[1].key) ?? []).some((evidence) => evidence.cohort === cohort) &&
      (benchmarks.get(group[2].key) ?? []).some((evidence) => evidence.cohort === cohort)
    )
    if (!sharedCohort) continue
    const metrics = [group[1].key, group[2].key]
    const evidence = metrics.map((metric) => benchmarks.get(metric).find((item) => item.cohort === sharedCohort))
    const card = newCard({
      id: `subject:${subject.toLowerCase().replace(/[^a-z0-9]+/g, '-')}:${sharedCohort}`,
      kind: 'subject-benchmark',
      metric: null,
      metrics,
      label: `${subject} — Meets and Masters`,
      latestYear,
      evidence,
    })
    for (const metric of metrics) attachRanks(card, metric)
    pairCards.push(card)
    metrics.forEach((metric) => pairedMetrics.add(metric))
  }

  pairCards.sort((a, b) => {
    const aBenchmark = a.evidence.find((item) => item.kind === 'benchmark')
    const bBenchmark = b.evidence.find((item) => item.kind === 'benchmark')
    const aMin = Math.min(...a.evidence.filter((item) => item.kind === 'benchmark').map((item) => item.advantage))
    const bMin = Math.min(...b.evidence.filter((item) => item.kind === 'benchmark').map((item) => item.advantage))
    return cohortPriority(aBenchmark?.cohort) - cohortPriority(bBenchmark?.cohort) ||
      metricPriority(a.metrics[0]) - metricPriority(b.metrics[0]) ||
      bMin - aMin ||
      a.id.localeCompare(b.id)
  })

  // Every remaining benchmark or distinct top-three placement gets one card per
  // metric. Evidence for a gain metric is merged into its gain card above.
  const remaining = []
  for (const spec of specs ?? []) {
    const metric = spec?.key
    if (!isHighlightMetric(metric) || pairedMetrics.has(metric)) continue
    const existing = cardByMetric.get(metric)
    if (existing) continue

    // A single STAAR threshold is too easy to cherry-pick: a result that clears
    // Meets but not Masters (or vice versa) is not a subject-level win. Only the
    // paired card above may surface STAAR benchmark evidence. A genuinely
    // distinctive current top-three placement can still stand on its own.
    const isStaarThreshold = /^staar:.+:[12]$/.test(metric)
    const benchmark = isStaarThreshold ? null : preferredBenchmark(benchmarks, metric)
    const current = bestRank(ranks, metric, { latestYear, previousYear })
    const recent = fixedWindow ? bestRank(recentChangeRanks, metric, { latestYear, previousYear, recent: true }) : null
    // A recent-change placement is supporting evidence for one of the two gain
    // cards above, not a reason to fill the whole summary with several versions
    // of the same rebound. A standalone card needs a current top-three result or
    // a qualifying current benchmark; otherwise Spring-style pages become three
    // regional change ranks and push current student outcomes out of view.
    if (!benchmark && !current) continue
    const kind = benchmark ? 'benchmark' : 'rank'
    const card = newCard({ id: `${kind}:${metric}`, kind, metric, label: spec.label, latestYear })
    addOnce(card, benchmark)
    addOnce(card, current ? rankEvidence(current, 'current', latestYear, previousYear) : null)
    addOnce(card, recent ? rankEvidence(recent, 'change', latestYear, previousYear) : null)
    remaining.push(card)
  }

  const candidatePriority = (card) => {
    if (card.kind === 'subject-benchmark') return 2
    if (card.evidence.some((item) => item.kind === 'rank' && item.period === 'current')) return 0
    if (card.evidence.some((item) => item.kind === 'rank' && item.period === 'change')) return 1
    if (hasStateBenchmark(card)) return 3
    if (hasPeerBenchmark(card)) return 4
    return 5
  }
  const cardMetricPriority = (card) => Math.min(...card.metrics.map(metricPriority))
  const bestPlacement = (card) => Math.min(...card.evidence.filter((item) => item.kind === 'rank').map((item) => item.rank), Infinity)
  const benchmarkMargin = (card) => Math.max(...card.evidence.filter((item) => item.kind === 'benchmark').map((item) => item.advantage), -Infinity)

  remaining.push(...pairCards)
  remaining.sort((a, b) =>
    candidatePriority(a) - candidatePriority(b) ||
    bestPlacement(a) - bestPlacement(b) ||
    cardMetricPriority(a) - cardMetricPriority(b) ||
    benchmarkMargin(b) - benchmarkMargin(a) ||
    a.id.localeCompare(b.id)
  )

  return [...cards, ...remaining].slice(0, cap)
}
