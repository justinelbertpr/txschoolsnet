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
const provenanceLines = ({ snapshotDate = null, entityId = null, entityName = null, level = null, page = null, dataset = null, rows = null, notes = [] }) => {
  const lines = [
    'txschools.net — unofficial. Not operated by, endorsed by, or affiliated with the Texas Education Agency.',
    `source: Texas Education Agency, published publicly at ${OFFICIAL_SOURCE}`,
    `snapshot: ${snapshotDate ?? 'unrecorded'} — the date this site fetched TEA's data. TEA may have revised it since.`,
  ]
  if (dataset) lines.push(`dataset: ${dataset}`)
  if (entityId) lines.push(`entity: ${entityId}${entityName ? ` — ${entityName}` : ''}${level ? ` (${level})` : ''}`)
  if (page) lines.push(`page: ${page}`)
  if (rows !== null) lines.push(`rows: ${rows} (excluding this header and the column row)`)
  for (const n of notes) lines.push(n)
  lines.push('empty cell = TEA did not publish that figure. It does not mean zero.')
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
  'cohort', 'cohort_label', 'cohort_n', 'cohort_value', 'rank', 'rank_of', 'rank_tied',
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

const entityPath = (vm) => `${SITE_ORIGIN}/${vm.level}/${vm.slug ?? vm.id}`

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

  /* history — one row per year per comparison line drawn on the page */
  for (const h of vm.history ?? []) {
    push({ section: 'rating_history', metric: 'rating', label: 'Overall rating', year: h.year, value: h.rating, unit: 'grade' })
    const lines = [
      vm.peerByYear ? ['peer', 'Similar economic-disadvantage rate', vm.peerN ?? cohortN('peer'), vm.peerByYear[h.year] ?? null] : null,
      vm.stateByYear ? ['state', 'Texas average', cohortN('state'), vm.stateByYear[h.year] ?? null] : null,
    ].filter(Boolean)
    if (!lines.length) {
      push({ section: 'rating_history', metric: 'score', label: 'Overall score', year: h.year, value: h.score, unit: 'points' })
      continue
    }
    for (const [key, label, n, value] of lines) {
      push({
        section: 'rating_history', metric: 'score', label: 'Overall score', year: h.year, value: h.score, unit: 'points',
        cohort: key, cohort_label: label, cohort_n: n, cohort_value: value,
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
        cohort: c.key, cohort_label: c.label, cohort_n: c.n, cohort_value: c.metrics[s.key] ?? null,
        rank: r?.rank ?? h?.rank ?? null, rank_of: r?.of ?? h?.of ?? null, rank_tied: r?.tied ?? null,
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
  if (vm.profile?.total != null) push({ section: 'students', metric: 'students_total', label: 'Students', year: latestYear, value: vm.profile.total, unit: 'count' })
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
  const head = commentBlock({
    snapshotDate: vm.snapshotDate ?? null,
    entityId: vm.id,
    entityName: vm.name,
    level: vm.level,
    page: entityPath(vm),
    rows: rows.length,
    notes: [
      'key: (section, metric, year, cohort). That tuple appears at most once in this file, so the table pivots without collapsing two different values into one cell.',
      "reconciled: where this site's comparison engine and the page's headline rank both described a cohort, the comparison engine's row is the one kept — it also carries cohort_n and cohort_value. The headline rank is folded into that row, and rank_of is the number of entities actually ranked, which can be smaller than cohort_n because entities without a score cannot be ranked.",
    ],
  })
  return head + [csvRow(ENTITY_COLUMNS), ...rows.map((r) => csvRow(ENTITY_COLUMNS.map((c) => r[c])))].join('\n') + '\n'
}

/* ------------------------------------------------------------------ json --- */

/** One entity's full record as JSON. `_meta` first, so provenance is unmissable. */
export function entityJson(vm, { space = 2 } = {}) {
  const latest = vm.history?.[0] ?? null
  const kind = vm.level === 'district' ? 'district' : 'campus'

  const doc = {
    _meta: {
      site: 'txschools.net',
      unofficial: 'Unofficial. Not operated by, endorsed by, or affiliated with the Texas Education Agency.',
      source: 'Texas Education Agency',
      sourceUrl: `${OFFICIAL_SOURCE}/?view=${kind}&id=${vm.id}&lng=en`,
      officialSource: OFFICIAL_SOURCE,
      snapshotDate: vm.snapshotDate ?? null,
      snapshotNote: "The date this site fetched TEA's data. TEA may have revised it since.",
      entityId: vm.id,
      entityName: vm.name ?? null,
      level: vm.level ?? null,
      page: entityPath(vm),
      nullNote: 'null means TEA did not publish that figure. It does not mean zero.',
      numberNote: 'Numbers are unformatted: percentages are plain numbers, money is plain dollars.',
      license: 'The underlying figures are TEA public data and this site claims no rights in them. The structure, derived comparisons and ranks are free to reuse; a link back is appreciated.',
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
      peerAverage: vm.peerByYear?.[h.year] ?? null,
      stateAverage: vm.stateByYear?.[h.year] ?? null,
    })),

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

    graduation: vm.graduation ? vm.graduation.map((g) => ({ label: g.label, value: g.value ?? null, unit: 'percent' })) : null,
    ccmr: vm.ccmr ? vm.ccmr.map((c) => ({ label: c.label, value: c.value ?? null })) : null,

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
export function renderDownloadPage({ files = [], snapshotDate = null, counts = {} } = {}) {
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
  <p class="summary">Everything on this site comes from one archived snapshot of what the Texas Education
  Agency publishes at <a href="${OFFICIAL_SOURCE}">txschools.gov</a>${snapshotDate ? `, fetched <strong>${esc(snapshotDate)}</strong>` : ''}.
  These files are that snapshot, restructured. Each one records inside itself where it came from and when,
  so a figure taken from here can be traced back to TEA without this page.</p>
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
    <li><strong>An empty cell is not a zero.</strong> TEA masks small groups and omits measures that do
      not apply to a campus. Empty in CSV and <code>null</code> in JSON both mean “not published”.
      Treating them as zero will invent schools with no graduates.</li>
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
        `<p>The figures in these files are the Texas Education Agency's, published publicly by the agency.
  This site claims no rights in them, and cannot grant you any — if you need formal terms for TEA's data,
  ask TEA. What this site adds is the structure: the joins between TEA's separate tables, the comparison
  cohorts, the ranks and their denominators. That part is free to use, commercially or otherwise, and a
  link back is appreciated rather than required.</p>
  <p>An honest citation names both:</p>
  <p class="callout">Texas Education Agency accountability data${snapshotDate ? `, snapshot of ${esc(snapshotDate)}` : ''},
  via txschools.net (unofficial). Original: <a href="${OFFICIAL_SOURCE}">txschools.gov</a>.</p>
  <p>If a number here matters to your story, check it against
  <a href="${OFFICIAL_SOURCE}">txschools.gov</a> before you publish it. This site is one person's
  restructuring of a snapshot; TEA is the authority, and the agency revises its files.</p>`
      ),
    ],
  })
}
