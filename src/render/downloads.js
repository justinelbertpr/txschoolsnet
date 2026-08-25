// Data files, for people who need to check the site rather than read it.
//
// Three rules run through everything here, and they are the reason this module
// exists instead of a JSON.stringify at the call site:
//
//  1. A file carries its own provenance. A journalist who downloads a table and
//     cannot later reconstruct what produced it has a file they cannot cite. CSV
//     gets leading `# ` comment lines; JSON gets a top-level `_meta`. Both name
//     the snapshot date, the source, the entity and the fact that this site is
//     unofficial.
//  2. A data file is never locale-formatted. No thousands separators, no `$`, no
//     `%`, no em dashes. `num`/`usd`/`pct` from shell.js are for reading; these
//     are for parsing, and the two must not be confused.
//  3. Missing is not zero. TEA masks small cohorts and omits measures that do not
//     apply. Null stays empty in CSV and null in JSON — writing 0 would invent a
//     school with no graduates.
//
// Nothing here stamps a wall-clock timestamp. The meaningful date is the snapshot
// date; a generation time would only make every file churn on every build.

import { esc, num, section, shell, table, SITE_ORIGIN } from './shell.js'
import { metricSpecs } from './metrics.js'
import { RACE, EXPERIENCE } from './labels.js'

export const OFFICIAL_SOURCE = 'https://txschools.gov'
export const ENROLLMENT_SOURCE = 'https://rptsvr1.tea.texas.gov/adhocrpt/adspr.html'
const TRANSFER_SOURCE = 'https://rptsvr1.tea.texas.gov/adhocrpt/Standard_Reports/Transfer_Reports/transfer_reports.html'
const EDUCATOR_SOURCE = 'https://tea.texas.gov/texas-schools/accountability/academic-accountability/performance-reporting/texas-academic-performance-reports'
const DISCIPLINE_SOURCE = 'https://tea.texas.gov/data-reports/student-data/discipline-data-products/discipline-reports'

/* ------------------------------------------------------------------- csv --- */

// RFC 4180, minus the CRLF: a field is quoted when it contains a delimiter, a
// quote, a newline, or edge whitespace a spreadsheet would silently eat. Internal
// quotes double. Lines end in \n — every reader accepts it and it diffs cleanly.
const NEEDS_QUOTING = /[",\r\n]/

/**
 * One CSV field. Numbers stringify raw (no separators, no symbols); null and
 * undefined become empty, never 0; NaN and Infinity become empty rather than
 * writing the literal "NaN" into a data file.
 */
export const csvCell = (v) => {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  const s = String(v)
  if (s === '') return ''
  return NEEDS_QUOTING.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s
}

const csvRow = (values) => values.map(csvCell).join(',')

/**
 * The comment block both formats share, as plain lines. Callers prefix `# `.
 * Order matters: what this is, where it came from, when, and what the blanks
 * mean — the four questions a reader asks before trusting a column.
 */
const provenanceLines = ({ snapshotDate = null, sourceUrl = OFFICIAL_SOURCE, sourceName = 'Texas Education Agency', entityId = null, entityName = null, level = null, page = null, dataset = null, rows = null, notes = [] }) => {
  const lines = [
    'txschools.net — unofficial. Not operated by, endorsed by, or affiliated with the Texas Education Agency.',
    `source: ${sourceName}, published publicly at ${sourceUrl}`,
    `snapshot: ${snapshotDate ?? 'unrecorded'} — the date this site fetched the source data. The publisher may have revised it since.`,
  ]
  if (dataset) lines.push(`dataset: ${dataset}`)
  if (entityId) lines.push(`entity: ${entityId}${entityName ? ` — ${entityName}` : ''}${level ? ` (${level})` : ''}`)
  if (page) lines.push(`page: ${page}`)
  if (rows !== null) lines.push(`rows: ${rows} (excluding this header and the column row)`)
  for (const n of notes) lines.push(n)
  lines.push('empty cell = the source did not publish that figure, suppressed it, or did not report it. It does not mean zero.')
  lines.push('numbers are unformatted: no thousands separators, no currency symbols, no percent signs.')
  lines.push("lines starting with # are comments — pandas: read_csv(path, comment='#')")
  return lines
}

const commentBlock = (meta) => provenanceLines(meta).map((l) => `# ${l}`).join('\n') + '\n'

/**
 * A whole table as CSV. `rows` is an array of plain objects; ragged rows are fine,
 * columns are the union in first-seen order unless `columns` is given.
 *
 * The options argument is optional so the documented `datasetCsv(rows)` call works,
 * but a dataset without a snapshot date is a dataset nobody can cite — pass one.
 */
export function datasetCsv(rows, { columns, snapshotDate = null, dataset = null, meta = {} } = {}) {
  const list = rows ?? []
  const cols = columns ?? [...new Set(list.flatMap((r) => Object.keys(r)))]
  const head = commentBlock({ snapshotDate, dataset, rows: list.length, ...meta })
  return head + [csvRow(cols), ...list.map((r) => csvRow(cols.map((c) => r[c])))].join('\n') + '\n'
}

/* ------------------------------------------------- one entity, long format -- */

// Long/tidy, not one wide row. An entity's record is ragged — a high school
// reports four graduation measures and twelve CCMR criteria, an elementary school
// reports none, and STAAR subjects differ between them. A wide table would need
// hundreds of mostly-empty columns and would break the day TEA adds a subject.
// One row per (metric, cohort) pivots cleanly and, crucially, lets every row carry
// its own cohort and denominator: a rank without an n is a boast, not a fact.
export const ENTITY_COLUMNS = [
  'entity_id', 'level', 'name', 'section', 'metric', 'label', 'year', 'value', 'unit',
  'status', 'mask',
  'cohort', 'cohort_label', 'cohort_n', 'cohort_reporting_n', 'cohort_value',
  'rank', 'rank_of', 'rank_tied',
]

const UNIT = { points: 'points', pct: 'percent', usd: 'usd', ratio: 'ratio' }

const SECTION_OF = (key) =>
  key === 'score' ? 'rating'
  : key.startsWith('domain:') ? 'domains'
  : key.startsWith('staar:') ? 'staar'
  : key.startsWith('grad:') ? 'graduation'
  : key.startsWith('ccmr:') ? 'ccmr'
  : key === 'avgSalary' ? 'teachers'
  : key === 'spend' ? 'spending'
  : 'students'

/**
 * Human-readable metadata for the supplemental comparison keys merged into
 * `vm.own` and each cohort. These metrics are not part of metricSpecs because
 * they come from separately dated public datasets, but a downloaded comparison
 * still needs an intelligible section, label, year and unit.
 */
const publicComparisonDescriptor = (key, vm) => {
  let match
  if ((match = key.match(/^public:spending:(.+)$/))) {
    return { section: 'spending', label: 'Spending per student', year: match[1], unit: 'usd_per_student' }
  }
  if ((match = key.match(/^public:enrollment:(.+)$/))) {
    return { section: 'enrollment_history', label: 'Students enrolled', year: match[1], unit: 'students' }
  }
  if ((match = key.match(/^public:transfers:(in|out|balance):(.+)$/))) {
    const [, direction, year] = match
    return {
      section: 'transfers',
      label: direction === 'in' ? 'Official transfers in' : direction === 'out' ? 'Official transfers out' : 'Transfers in minus transfers out',
      year,
      unit: direction === 'balance' ? 'students_net' : 'students',
    }
  }
  if ((match = key.match(/^public:educators:turnover:(.+)$/))) {
    return { section: 'teacher_turnover', label: 'Teacher turnover rate', year: match[1], unit: 'percent' }
  }
  if ((match = key.match(/^public:educators:class-size:([^:]+):(.+)$/))) {
    const [, year, category] = match
    const categoryLabel = vm.classSize?.categories?.find((item) => item.key === category)?.label ?? category
    return { section: 'class_size', label: `${categoryLabel} — average class size`, year, unit: 'students_per_class' }
  }
  if ((match = key.match(/^public:discipline:(students|actions)-rate:(.+)$/))) {
    const [, measure, year] = match
    return {
      section: 'discipline',
      label: measure === 'students'
        ? 'All discipline — students as a share of cumulative enrollment'
        : 'All discipline — actions per 100 cumulative students',
      year,
      unit: measure === 'students'
        ? 'percent_of_cumulative_enrollment'
        : 'disciplinary_actions_per_100_cumulative_enrollment',
    }
  }
  if ((match = key.match(/^public:discipline:category:([^:]+):([^:]+):(students|actions)-rate$/))) {
    const [, year, category, measure] = match
    const categoryLabel = vm.discipline?.current?.categories?.find((item) => item.key === category)?.label ?? category
    return {
      section: 'discipline',
      label: measure === 'students'
        ? `${categoryLabel} — students as a share of cumulative enrollment`
        : `${categoryLabel} — actions per 100 cumulative students`,
      year,
      unit: measure === 'students'
        ? 'percent_of_cumulative_enrollment'
        : 'disciplinary_actions_per_100_cumulative_enrollment',
    }
  }

  const staticDescriptors = {
    'public:community:population': ['community', 'People living inside the district boundary', vm.communityContext?.year, 'people'],
    'public:community:school-age': ['community', 'Resident children ages 5–17', vm.communityContext?.year, 'children'],
    'public:community:school-age-poverty': ['community', 'Resident children ages 5–17 in families in poverty', vm.communityContext?.year, 'children'],
    'public:community:school-age-poverty-rate': ['community', 'School-age child poverty rate', vm.communityContext?.year, 'percent'],
    'public:postsecondary:graduates': ['postsecondary', 'High-school graduates in THECB report', vm.postsecondaryOutcome?.graduateYear, 'graduates'],
    'public:postsecondary:enrolled': ['postsecondary', 'Enrolled in Texas public higher education the following fall', vm.postsecondaryOutcome?.graduateYear, 'graduates'],
    'public:postsecondary:rate': ['postsecondary', 'Share enrolled in Texas public higher education the following fall', vm.postsecondaryOutcome?.graduateYear, 'percent'],
    'public:postsecondary:not-found-rate': ['postsecondary', 'Share not found in Texas public higher-education records', vm.postsecondaryOutcome?.graduateYear, 'percent'],
    'public:postsecondary:not-trackable-rate': ['postsecondary', 'Share not trackable by THECB', vm.postsecondaryOutcome?.graduateYear, 'percent'],
    'public:notices:improvement': ['official_notices', 'Campus identified for federal improvement support', '2026', 'percent'],
    'public:notices:peg': ['official_notices', 'Campus on the Public Education Grant transfer list', '2026-27', 'percent'],
    'public:campuses:count': ['campuses', 'Schools in the district', null, 'schools'],
    'public:notices:improvement-count': ['official_notices', 'Campuses identified for federal improvement support', '2026', 'campuses'],
    'public:notices:peg-count': ['official_notices', 'Campuses on the Public Education Grant transfer list', '2026-27', 'campuses'],
    'public:notices:improvement-share': ['official_notices', 'Share of campuses identified for federal improvement support', '2026', 'percent'],
    'public:notices:peg-share': ['official_notices', 'Share of campuses on the Public Education Grant transfer list', '2026-27', 'percent'],
  }
  const descriptor = staticDescriptors[key]
  return descriptor
    ? { section: descriptor[0], label: descriptor[1], year: descriptor[2] ?? null, unit: descriptor[3] }
    : { section: 'public_comparisons', label: key, year: null, unit: 'number' }
}

const entityPath = (vm) => `${SITE_ORIGIN}/${vm.level}/${vm.slug ?? vm.id}`

const hasOfficialNoticeData = (vm) =>
  Boolean(
    vm.actionNotices?.length ||
    vm.publicDataMeta?.actionFlags ||
    Object.keys(vm.own ?? {}).some((key) => key.startsWith('public:notices:'))
  )

/** Every trajectory cohort carried by the view model, with a legacy fallback. */
const historyComparisons = (vm) => {
  const declared = (vm.comparisons ?? []).filter((comparison) => comparison?.key && comparison?.byYear)
  if (declared.length) return declared
  return [
    vm.peerByYear
      ? {
          key: 'peer', label: 'Similar economic-disadvantage rate',
          n: vm.peerN ?? vm.cohorts?.find((cohort) => cohort.key === 'peer')?.n ?? null,
          byYear: vm.peerByYear,
        }
      : null,
    vm.stateByYear
      ? {
          key: 'state', label: 'Texas average',
          n: vm.cohorts?.find((cohort) => cohort.key === 'state')?.n ?? null,
          byYear: vm.stateByYear,
        }
      : null,
  ].filter(Boolean)
}

/**
 * Interpretation limits that must travel with the supplemental figures.
 *
 * The rendered page already explains these beside each section. A downloaded
 * record has no surrounding page, though, and a source URL alone cannot tell a
 * reporter that a PEG listing is only permission to request a transfer, or that
 * THECB's "not found" bucket is not a no-college outcome. Keep the notes typed
 * by dataset for JSON; entityCsv flattens the same object into comment lines.
 */
const entityDataNotes = (vm) => {
  const notes = {}

  if ((vm.enrollmentReported ?? vm.enrollmentHistory ?? []).length) {
    notes.enrollmentHistory = [
      'Counts are TEA fall PEIMS snapshots; adjacent-year changes use only published counts.',
      'Enrollment growth or decline is not a measure of school quality and does not identify why enrollment changed.',
    ]
  }

  if (hasOfficialNoticeData(vm)) {
    notes.officialNotices = [
      'These are dated campus statuses kept separate from the district or campus rating; absence from these two lists does not mean absence from every intervention or support program.',
      'A Public Education Grant listing allows an assigned student to request a transfer; it does not guarantee acceptance, available space, or transportation.',
    ]
  }

  if (vm.communityContext) {
    notes.community = [
      'SAIPE modeled estimates describe residents inside the geographic district boundary, not students enrolled by the district.',
      "A family's poverty status is community context, not a measure of school quality.",
    ]
  }

  if (vm.postsecondaryOutcome) {
    notes.postsecondary = [
      'The report observes enrollment in Texas public higher education in the fall immediately after graduation and includes only districts or campuses with more than 25 graduates; it is not an eventual college-going or completion rate.',
      '“Not found” can include private or out-of-state college, work, military service, later enrollment, or another path outside the Texas public higher-education records.',
      '“Not trackable” means a graduate had a non-standard identifier that THECB could not match; it is not an outcome.',
    ]
  }

  if (vm.transferContext) {
    const published = Object.values(vm.transferContext.caveats ?? {}).filter(
      (note) => typeof note === 'string' && note.trim()
    )
    notes.transfers = [
      ...published,
      'Transfers in minus transfers out and changes over time are arithmetic context derived by txschools.net, not TEA source totals and not measures of school quality.',
    ]
  }

  if (vm.teacherTurnover || vm.classSize) {
    notes.educators = [
      ...(vm.teacherTurnover
        ? ['Teacher turnover is a district rate: the share of prior-fall teacher full-time equivalents not employed as district teachers in the current fall. It can include leaving the district or moving to a different role; it is not a campus-level measure.']
        : []),
      ...(vm.classSize
        ? ["Class-size figures are separate TEA averages for the named grade or subject, not student-to-teacher ratios; categories are not combined into an invented campus-wide average."]
        : []),
    ]
  }

  if (vm.discipline) {
    const published = Object.values(vm.discipline.caveats ?? {}).filter(
      (note) => typeof note === 'string' && note.trim()
    )
    notes.discipline = [
      'Students, disciplinary actions, and incidents are different units. One student can receive multiple actions; overlapping categories must not be added together.',
      "Rates use TEA's matching cumulative year-end enrollment, not the October enrollment reported elsewhere.",
      'Suppressed values remain null rather than being estimated. Use 2020–21 cautiously because remote instruction changed students’ exposure to in-person discipline.',
      ...published,
    ]
  }

  return notes
}

const dataNoteLines = (notes) =>
  Object.entries(notes).flatMap(([dataset, items]) => items.map((note) => `caveat (${dataset}): ${note}`))

// (section, metric, year, cohort) is the key a reader pivots on, so it has to be
// unique. Two things used to break that: the page's headline ranks and the
// comparison engine both described the region cohort, and a repeated STAAR
// subject produced the same metric key twice. Both are reconciled below, and this
// guard is the backstop — a key that has already been written is never written
// again, so no future source can quietly reintroduce a conflicting pair.
//
// Both the cohort key and the cohort label are guarded: two cohorts that print
// the same label are the same cohort as far as a reader is concerned, whatever
// the keys say.
const rowKeys = (r) => {
  const stem = `${r.section ?? ''}|${r.metric ?? ''}|${r.year ?? ''}`
  return [`k:${stem}|${r.cohort ?? ''}`, `l:${stem}|${r.cohort_label ?? ''}`]
}

/** Every row an entity contributes, as objects keyed by ENTITY_COLUMNS. */
export function entityRows(vm) {
  const out = []
  const base = { entity_id: vm.id, level: vm.level, name: vm.name }
  const seen = new Set()
  const push = (r) => {
    const keys = rowKeys(r)
    if (keys.some((k) => seen.has(k))) return
    for (const k of keys) seen.add(k)
    out.push({ ...base, ...r })
  }
  const latestYear = vm.history?.[0]?.year ?? null
  const cohortN = (key) => vm.cohorts?.find((c) => c.key === key)?.n ?? null

  /* The metric specs are declared up here because the rating block below has to
     know which cohorts the comparison engine will cover before it decides what to
     emit itself. */
  const specs = metricSpecs({ subjects: vm.staar?.subjects ?? [], isAlt: vm.isAlt })
  const rankAt = new Map((vm.ranks ?? []).map((r) => [`${r.metric}|${r.cohort}`, r]))

  // Cohorts the engine will publish an overall-score row for. The engine's row is
  // the richer one — it carries the cohort average and the tie count — so where
  // both it and the page's headline rank describe the same cohort, the engine's
  // row wins and the headline rank is folded into it rather than emitted beside
  // it. `texas` is the headline name for what the engine calls `state`.
  const engineScoreCohorts = new Set((vm.cohorts ?? []).filter((c) => c.metrics?.score != null).map((c) => c.key))
  const headlineRank = new Map()
  if (vm.rank && vm.rankOf) headlineRank.set('state', { rank: vm.rank, of: vm.rankOf })
  if (vm.regionRank && vm.regionRankOf) headlineRank.set('region', { rank: vm.regionRank, of: vm.regionRankOf })

  /* identity — the columns that make a row joinable to anything else */
  const identity = [
    ['id', 'Entity id (TEA)', vm.id, 'text'],
    ['level', 'District or campus', vm.level, 'text'],
    ['name', 'Name', vm.name, 'text'],
    ['county', 'County', vm.county, 'text'],
    ['county_id', 'County id', vm.countyId, 'text'],
    ['region_id', 'Education Service Center region', vm.regionId, 'text'],
    ['region_name', 'Region name', vm.regionName, 'text'],
    ['district_id', 'Parent district id', vm.districtId, 'text'],
    ['district_name', 'Parent district', vm.districtName, 'text'],
    ['entity_type', 'Entity type', vm.entityType, 'text'],
    ['campus_type', 'Campus type', vm.campusType, 'text'],
    ['is_charter', 'Charter', vm.isCharter, 'boolean'],
    ['is_alternative', 'Alternative Education Accountability', vm.isAlt, 'boolean'],
    ['enrollment', 'Students enrolled', vm.enrollment, 'count'],
    ['snapshot_date', 'Snapshot date', vm.snapshotDate, 'text'],
  ]
  for (const [metric, label, value, unit] of identity) {
    push({ section: 'identity', metric, label, value, unit })
  }

  /* current rating, and where it sits — each rank with its denominator */
  const latest = vm.history?.[0] ?? null
  if (latest) {
    push({ section: 'rating', metric: 'rating', label: 'Overall rating', year: latest.year, value: latest.rating, unit: 'grade' })
  }
  // Only where the engine publishes nothing for that cohort — otherwise these
  // ranks travel on the engine's own rows, below.
  if (vm.rank && vm.rankOf && !engineScoreCohorts.has('state')) {
    push({
      section: 'rating', metric: 'score', label: 'Overall score', year: latestYear, value: latest?.score, unit: 'points',
      cohort: 'texas', cohort_label: `All Texas ${vm.level === 'district' ? 'districts' : 'campuses'} with a score`,
      cohort_n: vm.rankOf, rank: vm.rank, rank_of: vm.rankOf,
    })
  }
  if (vm.regionRank && vm.regionRankOf && !engineScoreCohorts.has('region')) {
    push({
      section: 'rating', metric: 'score', label: 'Overall score', year: latestYear, value: latest?.score, unit: 'points',
      cohort: 'region', cohort_label: vm.regionName, cohort_n: vm.regionRankOf,
      rank: vm.regionRank, rank_of: vm.regionRankOf,
    })
  }
  if (vm.originalScore != null || vm.originalRating != null) {
    push({ section: 'rating', metric: 'score_original_methodology', label: 'Score under the pre-2023 methodology', year: '2021-22', value: vm.originalScore, unit: 'points' })
    push({ section: 'rating', metric: 'rating_original_methodology', label: 'Rating under the pre-2023 methodology', year: '2021-22', value: vm.originalRating, unit: 'grade' })
  }

  /* history — one row per year per comparison line available on the page */
  const trajectoryComparisons = historyComparisons(vm)
  for (const h of vm.history ?? []) {
    push({ section: 'rating_history', metric: 'rating', label: 'Overall rating', year: h.year, value: h.rating, unit: 'grade' })
    if (!trajectoryComparisons.length) {
      push({ section: 'rating_history', metric: 'score', label: 'Overall score', year: h.year, value: h.score, unit: 'points' })
      continue
    }
    for (const comparison of trajectoryComparisons) {
      push({
        section: 'rating_history', metric: 'score', label: 'Overall score', year: h.year, value: h.score, unit: 'points',
        cohort: comparison.key,
        cohort_label: comparison.label,
        cohort_n: comparison.n ?? cohortN(comparison.key),
        cohort_reporting_n: comparison.reportingNByYear?.[h.year] ?? null,
        cohort_value: comparison.byYear?.[h.year] ?? null,
      })
    }
  }

  /* every declared metric, against every cohort, with its rank where one exists */
  for (const s of specs) {
    const mine = vm.own?.[s.key]
    const cohorts = (vm.cohorts ?? []).filter((c) => c.metrics?.[s.key] != null)
    if (mine == null && !cohorts.length) continue
    const row = {
      section: SECTION_OF(s.key), metric: s.key, label: s.label, year: latestYear,
      value: mine ?? null, unit: UNIT[s.fmt] ?? s.fmt,
    }
    if (!cohorts.length) { push(row); continue }
    for (const c of cohorts) {
      const r = rankAt.get(`${s.key}|${c.key}`)
      // The engine's rank wins where it has one; the page's headline rank fills
      // in only where it does not, so a reconciled row never loses a rank the
      // separate row used to carry.
      const h = s.key === 'score' && !r ? headlineRank.get(c.key) : null
      push({
        ...row,
        cohort: c.key,
        cohort_label: c.label,
        cohort_n: c.n,
        cohort_reporting_n: c.metricN?.[s.key] ?? null,
        cohort_value: c.metrics[s.key] ?? null,
        rank: r?.rank ?? h?.rank ?? null, rank_of: r?.of ?? h?.of ?? null, rank_tied: r?.tied ?? null,
      })
    }
  }

  /* Supplemental comparisons use stable `public:*` keys rather than
     metricSpecs. Export them in the same long comparison shape without folding
     their reporting denominator into cohort membership: cohort_n says how many
     rated entities belong to the group, while cohort_reporting_n says how many
     actually supplied this particular source figure. */
  const publicKeys = [...new Set([
    ...Object.keys(vm.own ?? {}),
    ...(vm.cohorts ?? []).flatMap((cohort) => Object.keys(cohort.metrics ?? {})),
  ])].filter((key) => key.startsWith('public:'))
  for (const key of publicKeys) {
    const descriptor = publicComparisonDescriptor(key, vm)
    const cohorts = (vm.cohorts ?? []).filter((cohort) => cohort.metrics?.[key] != null)
    const row = {
      section: descriptor.section,
      metric: key,
      label: descriptor.label,
      year: descriptor.year,
      value: vm.own?.[key] ?? null,
      unit: descriptor.unit,
    }
    if (!cohorts.length) {
      push(row)
      continue
    }
    for (const cohort of cohorts) {
      push({
        ...row,
        cohort: cohort.key,
        cohort_label: cohort.label,
        cohort_n: cohort.n,
        cohort_reporting_n: cohort.metricN?.[key] ?? null,
        cohort_value: cohort.metrics[key],
      })
    }
  }

  /* domain detail the metric specs do not carry */
  for (const d of vm.domains ?? []) {
    push({ section: 'domains', metric: `domain:${d.domain}:grade`, label: `${d.label} — grade`, year: latestYear, value: d.grade, unit: 'grade' })
    if (d.toNextGrade != null) {
      push({ section: 'domains', metric: `domain:${d.domain}:to_next_grade`, label: `${d.label} — points to the next grade`, year: latestYear, value: d.toNextGrade, unit: 'points' })
    }
  }

  /* demographics and teaching experience: shares TEA publishes as bare arrays */
  ;(vm.raceShare ?? []).forEach((v, i) => {
    if (v == null) return
    push({ section: 'demographics', metric: `race:${i}`, label: RACE[i] ?? `Group ${i + 1}`, year: latestYear, value: v, unit: 'percent' })
  })
  ;(vm.staffYears ?? []).forEach((v, i) => {
    if (v == null) return
    push({ section: 'teachers', metric: `experience:${i}`, label: `Teachers with ${EXPERIENCE[i] ?? `band ${i + 1}`} of experience`, year: latestYear, value: v, unit: 'percent' })
  })
  if (vm.profile?.total != null) push({ section: 'students', metric: 'students_total', label: 'Students', year: vm.profile.schoolYear ?? latestYear, value: vm.profile.total, unit: 'count' })

  // One row per official PEIMS school-year report, including a null for a
  // suppressed count. The bulk file and entity JSON therefore preserve the
  // difference between “not reported” and zero instead of making a chart's
  // available points the only historical record.
  for (const point of vm.enrollmentReported ?? vm.enrollmentHistory ?? []) {
    push({
      section: 'enrollment_history', metric: 'students_enrolled', label: 'Students enrolled',
      year: point.year, value: point.enrollment ?? null, unit: 'count',
    })
  }

  /* Dated public-data modules. These remain separate from the comparison
     engine: an official notice is not a score, Census residents are not an
     enrolled cohort, and THECB observes only Texas public higher education. */
  for (const notice of vm.actionNotices ?? []) {
    if (notice.improvement) {
      push({
        section: 'official_notices', metric: `improvement:${notice.id}`,
        label: `${notice.name ?? notice.id} — ${notice.improvement.reason || notice.improvement.supportLabel || notice.improvement.kind}`,
        year: notice.improvement.year ?? null, value: notice.improvement.kind, unit: 'official_status',
      })
    }
    if (notice.peg) {
      push({
        section: 'official_notices', metric: `peg:${notice.id}`,
        label: `${notice.name ?? notice.id} — Public Education Grant transfer list`,
        year: notice.peg.schoolYear ?? null, value: true, unit: 'boolean',
      })
    }
  }

  const community = vm.communityContext
  if (community) {
    const values = [
      ['resident_population', 'People living inside the district boundary', community.totalPopulation, 'count'],
      ['resident_children_5_17', 'Resident children ages 5–17', community.schoolAgePopulation, 'count'],
      ['resident_children_5_17_poverty', 'Resident children ages 5–17 in families in poverty', community.schoolAgePoverty, 'count'],
      ['resident_children_5_17_poverty_rate', 'School-age child poverty rate', community.schoolAgePovertyRate, 'percent'],
    ]
    for (const [metric, label, value, unit] of values) {
      push({ section: 'community', metric, label, year: community.year ?? null, value: value ?? null, unit })
    }
  }

  const postsecondary = vm.postsecondaryOutcome
  if (postsecondary) {
    const values = [
      ['graduates', 'High-school graduates in THECB report', postsecondary.graduates, 'count'],
      ['texas_public_enrolled_following_fall', 'Enrolled in Texas public higher education the following fall', postsecondary.enrolledPublic, 'count'],
      ['texas_public_enrolled_following_fall_rate', 'Share enrolled in Texas public higher education the following fall', postsecondary.rate, 'percent'],
      ['not_found', 'Not found in Texas public higher-education records', postsecondary.notFound, 'count'],
      ['not_trackable', 'Not trackable by THECB', postsecondary.notTrackable, 'count'],
    ]
    for (const [metric, label, value, unit] of values) {
      push({ section: 'postsecondary', metric, label, year: postsecondary.graduateYear ?? null, value: value ?? null, unit })
    }
    for (const [index, destination] of (postsecondary.destinations ?? []).entries()) {
      push({
        section: 'postsecondary', metric: `destination:${index + 1}`,
        label: `Named Texas public destination — ${destination.institution}`,
        year: postsecondary.graduateYear ?? null,
        value: destination.students ?? null,
        unit: 'students',
      })
    }
  }

  /* Transfers remain district-only and retain TEA's status for each official
     total. Detail rows here are only the reported flows selected for the page;
     the coverage rows are what disclose how many additional counterpart rows
     TEA masked. Net and change values are arithmetic, never source totals. */
  const transfers = vm.transferContext
  if (transfers) {
    const current = transfers.current
    for (const point of transfers.history ?? []) {
      const coverage = point.coverage ?? (current?.year === point.year ? current.coverage : null)
      const totals = [
        ['transfers_in', 'Official transfers in', point.transfersIn, coverage?.officialTotals?.in],
        ['transfers_out', 'Official transfers out', point.transfersOut, coverage?.officialTotals?.out],
      ]
      for (const [metric, label, value, sourceStatus] of totals) {
        push({
          section: 'transfers', metric, label, year: point.year, value: value ?? null,
          unit: 'students', status: sourceStatus ?? (value == null ? 'not-reported' : 'reported'),
        })
      }
      push({
        section: 'transfers', metric: 'transfers_in_minus_out',
        label: transfers.netLabel ?? 'Transfers in minus transfers out',
        year: point.year, value: point.net ?? null, unit: 'students_net',
        status: point.net == null ? 'not-calculable' : 'derived',
      })

      for (const [direction, label, detail] of [
        ['origin', 'Transfer-origin detail rows', coverage?.origins],
        ['destination', 'Transfer-destination detail rows', coverage?.destinations],
      ]) {
        if (!detail) continue
        for (const [kind, value] of Object.entries({
          published: detail.published,
          reported: detail.reported,
          masked: detail.masked,
        })) {
          push({
            section: 'transfer_coverage', metric: `${direction}_rows_${kind}`,
            label: `${label} — ${kind}`, year: point.year, value: value ?? null,
            unit: 'counterpart_rows', status: value == null ? 'not-reported' : 'reported',
          })
        }
      }
    }

    for (const flow of current?.topOrigins ?? []) {
      push({
        section: 'transfer_flows', metric: `transfers_in_from:${flow.id}`,
        label: `Transfers in from ${flow.name ?? `district ${flow.id}`}`,
        year: current.year ?? null, value: flow.transfers ?? null, unit: 'students',
        status: flow.transfers == null ? 'not-reported' : 'reported',
      })
    }
    for (const flow of current?.topDestinations ?? []) {
      push({
        section: 'transfer_flows', metric: `transfers_out_to:${flow.id}`,
        label: `Transfers out to ${flow.name ?? `district ${flow.id}`}`,
        year: current.year ?? null, value: flow.transfers ?? null, unit: 'students',
        status: flow.transfers == null ? 'not-reported' : 'reported',
      })
    }

    const change = transfers.changeSinceFirst
    if (change) {
      for (const [metric, label, value, unit] of [
        ['transfers_in_change', 'Change in transfers in', change.transfersInChange, 'students_change'],
        ['transfers_out_change', 'Change in transfers out', change.transfersOutChange, 'students_change'],
        ['transfers_net_change', 'Change in transfers in minus transfers out', change.netChange, 'students_net_change'],
      ]) {
        push({
          section: 'transfer_change', metric,
          label: `${label}, ${change.fromYear ?? 'first year'} to ${change.toYear ?? 'latest year'}`,
          year: change.toYear ?? null, value: value ?? null, unit,
          status: value == null ? 'not-calculable' : 'derived',
        })
      }
    }
  }

  /* TAPR publishes teacher turnover for districts and twelve distinct class-
     size averages for campuses. Every category is retained, including nulls;
     no campus-wide class-size average is manufactured. */
  for (const point of vm.teacherTurnover?.history ?? []) {
    push({
      section: 'teacher_turnover', metric: 'teacher_turnover_rate',
      label: 'Teacher turnover rate', year: point.year, value: point.ratePct ?? null,
      unit: vm.teacherTurnover?.unit ?? 'percent',
      status: point.ratePct == null ? 'not-reported' : 'reported',
    })
  }
  for (const category of vm.classSize?.categories ?? []) {
    push({
      section: 'class_size', metric: `class_size:${category.key}`,
      label: `${category.label} — average class size`, year: vm.classSize?.year ?? null,
      value: category.studentsPerClass ?? null, unit: 'students_per_class',
      status: category.studentsPerClass == null ? 'not-reported' : 'reported',
    })
  }

  /* Discipline uses two irreducible measures: students and actions. The count
     rows preserve TEA's exact status and mask. Rates are explicitly labelled as
     derived and remain null when either numerator or cumulative enrollment was
     unavailable; overlapping categories are never added together. */
  const discipline = vm.discipline
  if (discipline) {
    const rateStatus = (datum, rateKey) =>
      datum?.[rateKey] != null
        ? 'derived'
        : datum?.status === 'reported'
          ? 'not-calculable'
          : datum?.status ?? 'not-reported'
    const addCumulativeEnrollment = (year, datum) => push({
      section: 'discipline', metric: 'cumulative_year_end_enrollment',
      label: 'Cumulative year-end enrollment', year, value: datum?.count ?? null,
      unit: 'students_cumulative_year_end', status: datum?.status ?? 'not-reported',
      mask: datum?.mask ?? null,
    })
    const addCategory = (year, category) => {
      const label = category.label ?? category.heading ?? category.key
      for (const [measure, datum, countUnit, rateKey, rateUnit] of [
        ['students', category.students, 'students', 'ratePct', 'percent_of_cumulative_enrollment'],
        ['actions', category.actions, 'disciplinary_actions', 'ratePer100', 'disciplinary_actions_per_100_cumulative_enrollment'],
      ]) {
        push({
          section: 'discipline', metric: `${category.key}:${measure}`,
          label: `${label} — ${measure}`, year, value: datum?.count ?? null,
          unit: countUnit, status: datum?.status ?? 'not-reported', mask: datum?.mask ?? null,
        })
        push({
          section: 'discipline', metric: `${category.key}:${measure}_rate`,
          label: `${label} — ${measure === 'students' ? 'students as a share of cumulative enrollment' : 'actions per 100 cumulative students'}`,
          year, value: datum?.[rateKey] ?? null, unit: rateUnit,
          status: rateStatus(datum, rateKey), mask: datum?.mask ?? null,
        })
      }
    }

    const disciplineHistoryYears = new Set()
    for (const point of discipline.history ?? []) {
      disciplineHistoryYears.add(point.year)
      addCumulativeEnrollment(point.year, point.cumulativeEnrollment)
      addCategory(point.year, {
        key: 'allDiscipline', label: 'All discipline',
        students: point.students, actions: point.actions,
      })
    }
    if (discipline.current) {
      const currentAlreadyInHistory = disciplineHistoryYears.has(discipline.current.year)
      if (!currentAlreadyInHistory) {
        addCumulativeEnrollment(discipline.current.year, discipline.current.cumulativeEnrollment)
      }
      for (const category of discipline.current.categories ?? []) {
        if (currentAlreadyInHistory && category.key === 'allDiscipline') continue
        addCategory(discipline.current.year, category)
      }
    }
  }

  if (vm.profile?.teachers != null) push({ section: 'teachers', metric: 'teachers_full_time', label: 'Full-time teachers', year: latestYear, value: vm.profile.teachers, unit: 'count' })
  if (vm.profile?.stuPerStaff != null) push({ section: 'teachers', metric: 'students_per_staff', label: 'Students per staff member', year: latestYear, value: vm.profile.stuPerStaff, unit: 'ratio' })

  /* spending over time, against TEA's own peer group. That group is not this
     site's peer band, so these rows use their own metric name and their own
     cohort keys — reusing `spend`/`peer` would silently mix two definitions. */
  const f = vm.finance
  ;(f?.years ?? []).forEach((year, i) => {
    const lines = [
      ['tea_peer', "TEA's peer group", f.spendPeer?.[i] ?? null],
      ['tea_state', 'Texas average (TEA)', f.spendState?.[i] ?? null],
    ]
    for (const [key, label, value] of lines) {
      push({
        section: 'spending', metric: 'spend_per_student', label: 'Spending per student', year,
        value: f.spendEntity?.[i] ?? null, unit: 'usd',
        cohort: key, cohort_label: label, cohort_value: value,
      })
    }
  })

  /* Rows are written in several passes, and reconciliation moved the overall-score
     rows out of the rating block and into the comparison engine's pass, so a
     section can now be written in two places. Group by first-seen section, stably,
     so someone scrolling the file still meets each section once. Sorting nothing
     else keeps year order and cohort order exactly as written. */
  const sectionOrder = [...new Set(out.map((r) => r.section))]
  return sectionOrder.flatMap((s) => out.filter((r) => r.section === s))
}

/** One entity's full record as CSV, provenance header included. */
export function entityCsv(vm) {
  const rows = entityRows(vm)
  const dataNotes = entityDataNotes(vm)
  const actionMeta = vm.publicDataMeta?.actionFlags
  const communityMeta = vm.publicDataMeta?.community
  const postsecondaryMeta = vm.publicDataMeta?.postsecondary
  const transfersMeta = vm.publicDataMeta?.transfers
  const educatorsMeta = vm.publicDataMeta?.educators
  const disciplineMeta = vm.publicDataMeta?.discipline
  const fetched = (date) => date ? `, fetched ${date}` : ''
  const head = commentBlock({
    snapshotDate: vm.snapshotDate ?? null,
    entityId: vm.id,
    entityName: vm.name,
    level: vm.level,
    page: entityPath(vm),
    rows: rows.length,
    notes: [
      `additional source: enrollment history comes from ${vm.enrollmentSourceUrl ?? ENROLLMENT_SOURCE}${vm.enrollmentSnapshotDate ? `, fetched ${vm.enrollmentSnapshotDate}` : ''}.`,
      hasOfficialNoticeData(vm)
        ? `additional source: official improvement and Public Education Grant notices come from dated TEA lists at ${actionMeta?.sources?.landing ?? actionMeta?.sources?.improvement ?? 'https://tea.texas.gov'}${fetched(actionMeta?.fetchedAt)}.`
        : null,
      vm.communityContext
        ? `additional source: community figures come from U.S. Census Bureau SAIPE at ${communityMeta?.landing ?? 'https://www.census.gov/programs-surveys/saipe.html'}${fetched(communityMeta?.fetchedAt)}; they describe residents inside the district boundary, not enrolled students.`
        : null,
      vm.postsecondaryOutcome
        ? `additional source: following-fall outcomes come from the Texas Higher Education Coordinating Board at ${postsecondaryMeta?.landing ?? 'https://www.txhighereddata.org/high-school-graduates/hsgradsenrolled/'}${fetched(postsecondaryMeta?.fetchedAt)} and cover Texas public higher education only. “Not trackable” means a graduate had a non-standard identifier that could not be matched; it is not a non-enrollment outcome.`
        : null,
      vm.transferContext
        ? `additional source: district transfer totals, detail coverage and reported top flows come from TEA Student Transfer Reports at ${transfersMeta?.source ?? TRANSFER_SOURCE}${fetched(transfersMeta?.fetchedAt)}. Net and change rows are arithmetic context, not quality measures.`
        : null,
      vm.teacherTurnover || vm.classSize
        ? `additional source: teacher turnover and class-size averages come from TEA Texas Academic Performance Reports at ${educatorsMeta?.source ?? EDUCATOR_SOURCE}${fetched(educatorsMeta?.fetchedAt)}. Turnover is district-only; class sizes are separate grade/subject averages, with no invented campus-wide average.`
        : null,
      vm.discipline
        ? `additional source: discipline counts come from TEA Discipline Reports at ${disciplineMeta?.source ?? DISCIPLINE_SOURCE}${fetched(disciplineMeta?.fetchedAt)}. Students and actions have different units, categories overlap, masks and statuses are preserved, and rates use cumulative year-end enrollment.`
        : null,
      ...dataNoteLines(dataNotes),
      'comparison scope: this static file contains every available peer, similar-size, region, county, and state cohort for the entity. It does not inherit a transient comparison selection or pinned entity from the web page; use cohort and cohort_label to select a comparison.',
      'key: (section, metric, year, cohort). That tuple appears at most once in this file, so the table pivots without collapsing two different values into one cell.',
      'denominators: cohort_n is the rated membership of the selected group; cohort_reporting_n is the subset reporting that row\'s metric and is the denominator behind cohort_value. rank_of is the number actually ranked and can differ from both.',
      "reconciled: where this site's comparison engine and the page's headline rank both described a cohort, the comparison engine's row is the one kept. The headline rank is folded into that row.",
    ].filter(Boolean),
  })
  return head + [csvRow(ENTITY_COLUMNS), ...rows.map((r) => csvRow(ENTITY_COLUMNS.map((c) => r[c])))].join('\n') + '\n'
}

/* ------------------------------------------------------------------ json --- */

/** One entity's full record as JSON. `_meta` first, so provenance is unmissable. */
export function entityJson(vm, { space = 2 } = {}) {
  const latest = vm.history?.[0] ?? null
  const kind = vm.level === 'district' ? 'district' : 'campus'
  const dataNotes = entityDataNotes(vm)

  const doc = {
    _meta: {
      site: 'txschools.net',
      unofficial: 'Unofficial. Not operated by, endorsed by, or affiliated with the Texas Education Agency.',
      source: 'Texas Education Agency',
      sourceUrl: `${OFFICIAL_SOURCE}/?view=${kind}&id=${vm.id}&lng=en`,
      officialSource: OFFICIAL_SOURCE,
      sources: [
        { name: 'TEA accountability and profile data', url: `${OFFICIAL_SOURCE}/?view=${kind}&id=${vm.id}&lng=en`, fetched: vm.snapshotDate ?? null },
        { name: 'TEA PEIMS Student Program and Special Populations Reports', url: vm.enrollmentSourceUrl ?? ENROLLMENT_SOURCE, fetched: vm.enrollmentSnapshotDate ?? null },
        hasOfficialNoticeData(vm) ? { name: 'TEA Schools Identified for Improvement and Public Education Grant lists', url: vm.publicDataMeta?.actionFlags?.sources?.landing ?? vm.publicDataMeta?.actionFlags?.sources?.improvement ?? null, fetched: vm.publicDataMeta?.actionFlags?.fetchedAt ?? null } : null,
        vm.communityContext ? { name: 'U.S. Census Bureau Small Area Income and Poverty Estimates', url: vm.publicDataMeta?.community?.landing ?? null, fetched: vm.publicDataMeta?.community?.fetchedAt ?? null } : null,
        vm.postsecondaryOutcome ? { name: 'Texas Higher Education Coordinating Board following-fall enrollment report', url: vm.publicDataMeta?.postsecondary?.landing ?? null, fetched: vm.publicDataMeta?.postsecondary?.fetchedAt ?? null } : null,
        vm.transferContext ? { name: 'TEA Student Transfer Reports', url: vm.publicDataMeta?.transfers?.source ?? TRANSFER_SOURCE, fetched: vm.publicDataMeta?.transfers?.fetchedAt ?? null } : null,
        vm.teacherTurnover || vm.classSize ? { name: 'TEA Texas Academic Performance Reports (TAPR)', url: vm.publicDataMeta?.educators?.source ?? EDUCATOR_SOURCE, fetched: vm.publicDataMeta?.educators?.fetchedAt ?? null } : null,
        vm.discipline ? { name: 'TEA Discipline Reports', url: vm.publicDataMeta?.discipline?.source ?? DISCIPLINE_SOURCE, fetched: vm.publicDataMeta?.discipline?.fetchedAt ?? null } : null,
      ].filter(Boolean),
      snapshotDate: vm.snapshotDate ?? null,
      snapshotNote: 'Snapshot dates record when this site fetched each source. A publisher may have revised its data since.',
      entityId: vm.id,
      entityName: vm.name ?? null,
      level: vm.level ?? null,
      page: entityPath(vm),
      nullNote: 'null means the source did not publish, suppressed, or did not report that figure. It does not mean zero; use status and mask where present.',
      numberNote: 'Numbers are unformatted: percentages are plain numbers, money is plain dollars.',
      comparisonNote: 'This static file contains every available peer, similar-size, region, county, and state cohort for the entity. It does not inherit a transient comparison selection or pinned entity from the web page; select a cohort by its key or label. Cohort n is rated membership; current cohort averages use metricN for their reporting denominator, while history[].comparisons[] uses reportingN for each year.',
      dataNotes,
      postsecondaryNote: vm.postsecondaryOutcome
        ? '“Not found” can include private or out-of-state college and later enrollment. “Not trackable” means a graduate had a non-standard identifier that could not be matched; neither label by itself means no college.'
        : null,
      highlightsNote: 'highlights is a deterministic selection of positive evidence, not a summary or a separate source. Each item carries the values, years, benchmark coverage and ties that caused it to be selected.',
      license: 'The underlying figures are public data from the publishers named in sources, and this site claims no rights in them. The structure, derived comparisons and ranks are free to reuse; a link back is appreciated.',
    },

    entity: {
      id: vm.id,
      name: vm.name ?? null,
      level: vm.level ?? null,
      county: vm.county ?? null,
      countyId: vm.countyId ?? null,
      regionId: vm.regionId ?? null,
      regionName: vm.regionName ?? null,
      districtId: vm.districtId ?? null,
      districtName: vm.districtName ?? null,
      entityType: vm.entityType ?? null,
      campusType: vm.campusType ?? null,
      isCharter: vm.isCharter ?? null,
      isAlternative: vm.isAlt ?? null,
      enrollment: vm.enrollment ?? null,
      notRated: vm.notRated ?? null,
    },

    rating: {
      year: latest?.year ?? null,
      rating: latest?.rating ?? null,
      score: latest?.score ?? null,
      consecutiveUnacceptableYears: vm.multYear ?? null,
      rankInTexas: vm.rank && vm.rankOf ? { rank: vm.rank, of: vm.rankOf } : null,
      rankInRegion: vm.regionRank && vm.regionRankOf ? { rank: vm.regionRank, of: vm.regionRankOf, region: vm.regionName ?? null } : null,
      originalMethodology:
        vm.originalScore != null || vm.originalRating != null
          ? { year: '2021-22', rating: vm.originalRating ?? null, score: vm.originalScore ?? null }
          : null,
    },

    history: (vm.history ?? []).map((h) => ({
      year: h.year,
      rating: h.rating ?? null,
      score: h.score ?? null,
      // Retained for backwards compatibility with files published before the
      // page-wide comparison picker existed.
      peerAverage: vm.peerByYear?.[h.year] ?? null,
      stateAverage: vm.stateByYear?.[h.year] ?? null,
      comparisons: historyComparisons(vm).map((comparison) => ({
        key: comparison.key,
        label: comparison.label,
        cohortN: comparison.n ?? null,
        reportingN: comparison.reportingNByYear?.[h.year] ?? null,
        average: comparison.byYear?.[h.year] ?? null,
      })),
    })),

    enrollmentHistory: (vm.enrollmentReported ?? vm.enrollmentHistory ?? []).map((point) => ({
      year: point.year,
      students: point.enrollment ?? null,
    })),

    officialNotices: vm.actionNotices ?? [],
    community: vm.communityContext ?? null,
    postsecondary: vm.postsecondaryOutcome ?? null,
    transfers: vm.transferContext ?? null,
    teacherTurnover: vm.teacherTurnover ?? null,
    classSize: vm.classSize ?? null,
    discipline: vm.discipline ?? null,

    // The UI never gets a prose-only claim that the reporter file cannot audit.
    // Keep the selector's typed evidence intact: endpoints, benchmark averages,
    // reporting n, placement denominator and ties stay numeric and reusable.
    highlights: vm.highlights ?? [],

    domains: (vm.domains ?? []).map((d) => ({
      key: d.domain,
      label: d.label ?? null,
      score: d.score ?? null,
      grade: d.grade ?? null,
      pointsToNextGrade: d.toNextGrade ?? null,
    })),

    staar: vm.staar
      ? {
          subjects: vm.staar.subjects,
          unit: 'percent of tests at or above the level',
          approaches: vm.staar.levels?.[0] ?? null,
          meets: vm.staar.levels?.[1] ?? null,
          masters: vm.staar.levels?.[2] ?? null,
        }
      : null,

    graduation: vm.graduation ? vm.graduation.map((g) => ({ key: g.key ?? null, label: g.label, value: g.value ?? null, unit: 'percent' })) : null,
    ccmr: vm.ccmr ? vm.ccmr.map((c) => ({ key: c.key ?? null, label: c.label, value: c.value ?? null })) : null,

    students: vm.profile
      ? {
          total: vm.profile.total ?? null,
          economicallyDisadvantagedPct: vm.profile.ecoDisPct ?? null,
          englishLearnersPct: vm.profile.engLrnPct ?? null,
          specialEducationPct: vm.profile.specEdPct ?? null,
          attendancePct: vm.profile.attendance ?? null,
          chronicallyAbsentPct: vm.profile.absenteeism ?? null,
          demographics: (vm.raceShare ?? []).map((v, i) => ({ label: RACE[i] ?? `Group ${i + 1}`, pct: v ?? null })),
        }
      : null,

    teachers: vm.profile
      ? {
          averageSalary: vm.profile.avgSalary ?? null,
          fullTimeTeachers: vm.profile.teachers ?? null,
          studentsPerStaff: vm.profile.stuPerStaff ?? null,
          experience: (vm.staffYears ?? []).map((v, i) => ({ label: EXPERIENCE[i] ?? `Band ${i + 1}`, pct: v ?? null })),
        }
      : null,

    spending: vm.finance
      ? {
          unit: 'usd per student',
          years: vm.finance.years,
          perStudent: vm.finance.spendEntity,
          teaPeerGroup: vm.finance.spendPeer,
          stateAverage: vm.finance.spendState,
        }
      : null,

    // Cohorts and ranks last: they are this site's contribution, not TEA's
    // publication, and the file should make that ordering obvious.
    cohorts: (vm.cohorts ?? []).map((c) => ({
      key: c.key,
      label: c.label,
      n: c.n,
      note: c.note ?? null,
      averages: c.metrics ?? {},
      metricN: c.metricN ?? {},
    })),
    metrics: vm.own ?? {},
    ranks: (vm.ranks ?? []).map((r) => ({
      metric: r.metric,
      label: r.label,
      cohort: r.cohort,
      cohortLabel: r.cohortLabel,
      value: r.value ?? null,
      rank: r.rank,
      of: r.of,
      tied: r.tied,
      percentile: r.pctile,
      lowerIsBetter: r.lowerIsBetter,
    })),
  }

  return JSON.stringify(doc, null, space) + '\n'
}

/* ------------------------------------------------------- the download page -- */

/** Decimal, and the page says so. 1 MB = 1,000,000 bytes. */
export const fileSize = (bytes) => {
  if (bytes === null || bytes === undefined || !Number.isFinite(Number(bytes))) return null
  const b = Number(bytes)
  if (b < 1000) return `${Math.round(b)} bytes`
  if (b < 1e6) return `${(b / 1e3).toFixed(b < 1e4 ? 1 : 0)} KB`
  return `${(b / 1e6).toFixed(b < 1e7 ? 1 : 0)} MB`
}

/** `ratingYears` -> `Rating years`. Sentence case, matching the rest of the site. */
const humanKey = (k) =>
  k
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, (_, a, b) => `${a} ${b.toLowerCase()}`)
    .replace(/^./, (c) => c.toUpperCase())

/**
 * The download index.
 *
 * files:   [{ href, label, format, bytes?, rows?, description? }]
 * counts:  { districts: 1207, campuses: 9029, ... } — rendered as-is
 */
export function renderDownloadPage({ files = [], snapshotDate = null, enrollmentSnapshotDate = null, counts = {} } = {}) {
  const rows = files.map((f) => {
    const size = fileSize(f.bytes)
    return `<tr><th scope="row"><a href="${esc(f.href)}"${f.href?.startsWith('http') ? '' : ' download'}>${esc(f.label ?? f.href)}</a>${
      f.description ? `<p class="stat-note">${esc(f.description)}</p>` : ''
    }</th><td>${esc((f.format ?? '').toUpperCase())}</td><td class="num">${f.rows == null ? '<span class="na">—</span>' : num(f.rows)}</td><td class="num">${
      size ? esc(size) : '<span class="na">not measured</span>'
    }</td></tr>`
  })

  const list = files.length
    ? table({
        caption: 'Files available for download',
        head: ['File', 'Format', { label: 'Rows', num: true }, { label: 'Size', num: true }],
        rows,
      })
    : `<p class="note na">No bulk files have been generated for this snapshot yet. Every district page still
       offers its own record as CSV and JSON, linked from the “Where this comes from” section at the
       bottom of the page.</p>`

  // The per-entity section states a real file count, so it counts the real
  // entities where the caller passed them rather than repeating a number that
  // could drift from the build.
  const whole = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null)
  const districtCount = whole(counts.districts)
  const campusCount = whole(counts.campuses)
  const entityCount = districtCount != null && campusCount != null ? districtCount + campusCount : null

  const countList = Object.entries(counts)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `<div class="stat"><dt>${esc(humanKey(k))}</dt><dd>${typeof v === 'number' ? num(v) : esc(v)}</dd></div>`)
    .join('')

  return shell({
    title: 'Download the data — txschools.net',
    description:
      'Texas school and district accountability data as CSV and JSON, with the snapshot date and source recorded inside every file.',
    canonical: `${SITE_ORIGIN}/download`,
    crumbs: [{ href: '/', label: 'Texas schools', current: 'Download' }],
    sections: [
      `<section class="hero">
  <p class="eyebrow">Data</p>
  <h1>Download the data</h1>
  <p class="summary">The site combines archived Texas Education Agency data from
  <a href="${OFFICIAL_SOURCE}">txschools.gov</a>${snapshotDate ? `, fetched <strong>${esc(snapshotDate)}</strong>` : ''},
  with five years of <a href="${ENROLLMENT_SOURCE}">PEIMS enrollment reports</a>${enrollmentSnapshotDate ? `, fetched <strong>${esc(enrollmentSnapshotDate)}</strong>` : ''}.
  Separate TEA staffing, discipline, transfer and action lists, Census community estimates, and THECB
  postsecondary outcomes are listed with their own dates and limits below. These files restructure those
  official public sources. Each one records inside itself where it came from and when, so a figure taken
  from here can be traced back without this page.</p>
  ${countList ? `<dl class="stats">${countList}</dl>` : ''}
</section>`,

      section(
        'files',
        'What is available',
        list,
        'Sizes are uncompressed; files are served gzipped, so the download is smaller than the figure shown. 1 MB means 1,000,000 bytes.'
      ),

      section(
        'per-entity',
        'One district at a time',
        `<p>Per-entity files are built for ${districtCount ? `the ${num(districtCount)} ` : ''}districts only.
  Every district page links its own record in both formats:</p>
  <ul class="legend">
    <li><code>/data/entity/&lt;district id&gt;.csv</code> — long format, one row per metric and comparison
      group. Each <code>(section, metric, year, cohort)</code> appears once.</li>
    <li><code>/data/entity/&lt;district id&gt;.json</code> — the same record nested, with a
      <code>_meta</code> block</li>
  </ul>
  <p><strong>Campus records come from the bulk files, not from a per-campus download.</strong> This site
  is served as static assets under a 20,000-file cap. There are ${entityCount ? num(entityCount) : '10,230'}
  districts and campuses, so a CSV and a JSON for each would be ${entityCount ? num(entityCount * 2) : '20,460'}
  files before a single page. Districts took the slots: they are the smaller half${
    districtCount && campusCount ? ` (${num(districtCount)} against ${num(campusCount)})` : ''
  } and the half
  people download. A campus page therefore links the bulk files rather than a per-campus file that does
  not exist. Those bulk tables list campuses as well as districts, but they carry fewer columns than a
  per-entity record: the rest of a campus's figures are on its own page.</p>
  <p>The id is TEA's own: six digits for a district (<code>057905</code>), nine for a campus
  (<code>001902001</code>). It is the last part of every URL on this site, and it is the key to join
  these files back to anything TEA publishes — including joining a campus back to its district.</p>`,
        'Useful when you are checking one district rather than analysing all of them.'
      ),

      section(
        'reading',
        'How to read these files',
        `<ul class="legend">
    <li><strong>An empty cell is not a zero.</strong> Source publishers mask, suppress or omit figures
      that are unavailable or do not apply. Empty in CSV and <code>null</code> in JSON both mean “not
      published”; a <code>status</code> or <code>mask</code> column preserves the reason where the source
      supplies one. Treating an empty cell as zero invents data.</li>
    <li><strong>Numbers are unformatted.</strong> No thousands separators, no dollar signs, no percent
      signs. A percentage is <code>52.6</code>, money is <code>11482</code>.</li>
    <li><strong>The header is commented.</strong> CSV files begin with <code>#</code> lines carrying the
      provenance. Most tools skip them on request:
      <code>pandas.read_csv(path, comment='#')</code>, or <code>csvkit</code>'s <code>--skip-lines</code>.</li>
    <li><strong>Every rank carries its denominator.</strong> Rows with a <code>rank</code> also carry
      <code>rank_of</code> and the cohort they were ranked within.</li>
    <li><strong>2021-22 appears under the refreshed methodology</strong> TEA adopted in 2023, which is
      what makes it comparable with later years. Where TEA published an original 2021-22 score too, it is
      in the file separately and labelled as such.</li>
  </ul>`
      ),

      section(
        'citing',
        'Citing and licence',
        `<p>The files combine public figures from the Texas Education Agency, U.S. Census Bureau and
  Texas Higher Education Coordinating Board. Each file names its actual publisher and source URL. This
  site claims no rights in those figures and cannot grant formal terms for them — ask TEA for TEA data,
  or the other publisher named in the file. What this site adds is the structure: joins across separate
  tables, comparison cohorts, ranks and their denominators. That part is free to use, commercially or
  otherwise, and a link back is appreciated rather than required.</p>
  <p>An honest citation names the originating publisher and this unofficial restructuring. For example:</p>
  <p class="callout">Texas Education Agency accountability and PEIMS enrollment data${snapshotDate ? `, accountability snapshot of ${esc(snapshotDate)}` : ''},
  via txschools.net (unofficial). Originals: <a href="${OFFICIAL_SOURCE}">txschools.gov</a> and
  <a href="${ENROLLMENT_SOURCE}">TEA PEIMS Student Program reports</a>. For Census, THECB or another
  supplemental table, substitute the publisher and source recorded in that file's header.</p>
  <p>If a number matters to your story, check it against the original publisher before publishing. This
  site is one person's restructuring of snapshots; the agencies named in each file remain the authorities
  and may revise their files.</p>`
      ),
    ],
  })
}
