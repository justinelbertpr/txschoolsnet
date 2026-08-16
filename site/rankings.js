// The interactive ranking tool at /rankings.
//
// WHAT THIS IS. The page is prerendered with one complete ranked list already in
// the HTML — statewide districts, overall score, highest first. This file adds
// the controls that let a reader ask for a different one. It is an upgrade, never
// the only way to see a ranking: if it fails to load, fails to parse, or the
// reader has JavaScript off, the served list is still there, still readable,
// still crawlable. Nothing here hides or empties server-rendered content until it
// has a replacement ranking in hand.
//
// WHAT IT WILL RANK, AND WHY THE LIST IS SHORT. The only numbers this file has
// are the ones in site/data/payload-<hash>.json: five years of overall score and
// letter grade, enrollment, economically-disadvantaged share, region, county,
// charter flag and alternative-education flag, for all 10,230 entities. STAAR,
// CCMR, graduation and chronic absence are NOT in that payload, so they are not
// offered here. They are not approximated either — a ranking of a measure this
// file cannot see would be a fabrication with a download button under it. If they
// are wanted, the fix is to add those columns in src/export.js; the metric table
// below is the only place this file would need to change.
//
// TWO RULES THAT ARE NOT NEGOTIABLE, both inherited from src/render/metrics.js:
//
//  1. Every list states its population, its n, and what was excluded. A rank
//     without a denominator is a boast. describe() builds that sentence from the
//     same numbers the table was built from, so it cannot drift from the rows.
//
//  2. Demographics are not achievements. The economically-disadvantaged share is
//     shown as a column, because a ranking of scores that hides who is being
//     taught is worse than useless — but it is not a metric you can rank by and
//     it is not a column you can sort by. A rank is an ordering and an ordering
//     asserts that one end is the good end; there is no good end to a poverty
//     rate. metrics.js excludes the same three shares from every rank it emits,
//     and this file is not the back door.
//
// The current selection lives in the query string. That is the point of the
// feature: "the 20 Texas districts with the largest gain since the pandemic" has
// to be a link somebody can paste into a story.
//
// ---------------------------------------------------------------------------
// THE MARKUP THIS FILE EXPECTS. Everything is optional except [data-rankings]
// and a payload URL; anything missing degrades to the served page, silently.
//
//   <section data-rankings
//            data-payload="/data/payload-<hash>.json"   <- or reuse the existing
//                                                          [data-pin-source] tag
//            data-snapshot="2026-08"                    <- for CSV provenance
//            data-defaults='{"scope":"c.201","n":"25"}'><- what THIS page shows
//     <div data-rankings-controls></div>   empty; filled at runtime, and left
//                                          empty (so invisible) without JS
//     <p data-rankings-status role="status" aria-live="polite"
//        class="rankings-status"></p>      OUTSIDE the replaced region, or the
//                                          announcement never fires
//     <div data-rankings-output>
//         ... the prerendered ranking, INCLUDING its own population sentence ...
//     </div>                               replaced wholesale on first render
//   </section>
//   <script type="application/json" data-rankings-lookups>
//     {"regions":{"01":"Region 01: Edinburg"},"counties":{"001":"Anderson"}}
//   </script>
//   <script type="module" src="/rankings.js"></script>
//
// `data-defaults` is the one that matters for correctness. It declares the
// selection the served table already represents, so the first render reproduces
// it exactly and the query string stays empty until the reader changes
// something. A prerendered county list that omits it will visibly rewrite
// itself into the statewide list the moment the payload lands.
//
// The lookups tag carries names only. Without it the tool still works and falls
// back to raw TEA ids ("county 057"), which is worse but not wrong.
// ---------------------------------------------------------------------------

/* ------------------------------------------------------------- constants -- */

const SITE_ORIGIN = 'https://txschools.net'
const OFFICIAL_SOURCE = 'https://txschools.gov'

/** Every rendered row past this many gets a warning, not a refusal. */
const BIG_LIST = 2000

const DEFAULTS = {
  metric: 'score.latest',
  level: 'district',
  scope: 'state',
  sector: 'all',
  aea: 'exclude',
  order: 'top',
  n: '50',
}

const SIZES = ['25', '50', '100', '250', 'all']

/* ------------------------------------------------------------- formatting -- */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ESCAPES[c])

const n0 = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-US'))
const n1 = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }))

// U+2212 for a displayed minus, matching site/app.js. CSV never sees this — a
// data file is not locale-formatted (src/render/downloads.js, rule 2).
const signed = (v) => (v === null || v === undefined ? '—' : v > 0 ? `+${v}` : v < 0 ? `\u2212${Math.abs(v)}` : '\u00b10')

const plural = (n, one, many) => `${n0(n)} ${n === 1 ? one : many}`

const slugify = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')

/** The same href src/render/view-model.js builds: named slug plus id. */
const hrefFor = (level, name, id) => `/${level}/${slugify(name)}-${id}`

/* ---------------------------------------------------------------- metrics -- */

/**
 * The metric table, derived from the years the payload actually carries rather
 * than hardcoded, so a snapshot with a sixth year grows a sixth entry and a
 * fifth change metric without an edit here.
 *
 * `dir` is which end the ranking counts from when order is "top". Both kinds
 * here read higher-is-better, but the field is declared rather than assumed so a
 * future lower-is-better metric (chronic absence, dropout) cannot be added and
 * silently rank the wrong way round — the same reason metrics.js declares it.
 *
 * `kind` decides the wording of the order control. "Highest first" is the right
 * phrase for a score and the wrong one for enrollment, where neither end is a
 * verdict; size gets "Largest first" and a caption that says so.
 */
export function buildMetrics(years) {
  const latest = years[0]
  const metrics = []

  for (let i = 0; i < years.length; i++) {
    metrics.push({
      // `.` rather than `:` throughout the query string: URLSearchParams leaves a
      // dot alone and percent-encodes a colon, and a link meant to be pasted into
      // a story should stay readable in the story.
      key: i === 0 ? 'score.latest' : `score.${years[i]}`,
      group: 'Overall score',
      label: `Overall score, ${years[i]}`,
      short: `overall score for ${years[i]}`,
      kind: 'score',
      dir: 'higher',
      unit: 'points',
      year: years[i],
      yearIndex: i,
      csv: `score_${years[i].replace('-', '_')}`,
      get: (r) => r.scores[i],
      note: i === years.length - 1 ? whatIfNote(years[i]) : null,
      missingWhy: `TEA published no ${years[i]} overall score for them`,
    })
  }

  for (let i = 1; i < years.length; i++) {
    const span = i === 1 ? 'since last year' : `since ${years[i]}`
    metrics.push({
      key: `change.${years[i]}`,
      group: 'Change in overall score',
      label: `Change ${years[i]} \u2192 ${latest}`,
      short: `change in overall score from ${years[i]} to ${latest}`,
      kind: 'change',
      dir: 'higher',
      unit: 'points',
      span,
      from: years[i],
      to: latest,
      fromIndex: i,
      csv: `change_${years[i].replace('-', '_')}_to_${latest.replace('-', '_')}`,
      get: (r) => (r.scores[0] === null || r.scores[i] === null ? null : r.scores[0] - r.scores[i]),
      note:
        i === years.length - 1
          ? `${whatIfNote(years[i])} Without that re-scoring the comparison would cross a methodology change and show a collapse no school caused.`
          : null,
      missingWhy: `TEA published no comparable score in both ${years[i]} and ${latest} for them`,
    })
  }

  metrics.push({
    key: 'enrollment',
    group: 'Size',
    label: 'Enrollment',
    short: 'enrollment',
    kind: 'size',
    dir: 'higher',
    unit: 'students',
    csv: 'enrollment',
    get: (r) => r.enrollment,
    note: 'Enrollment is a description of size, not a measure of performance. This ordering says which are biggest, and nothing else.',
    missingWhy: 'TEA published no enrollment figure for them',
  })

  return metrics
}

const whatIfNote = (year) =>
  year === '2021-22'
    ? `${year} uses TEA's own re-scoring of that year under the current rules (published as "${year} What If"), which is what makes it comparable with later years.`
    : null

/* ------------------------------------------------------- payload decoding -- */

/**
 * Column-oriented payload to one row object per entity.
 *
 * The parent district of a campus is recovered from the id rather than fetched:
 * TEA campus ids are nine digits whose first six are the district's id, and
 * every one of the 9,031 campuses in this snapshot resolves that way. It is
 * checked per row all the same — an id that does not resolve gets no district
 * name rather than a wrong one.
 */
export function decodePayload(payload) {
  const e = payload.entities
  const years = payload.years
  const ids = e.id
  const districts = new Map()
  for (let i = 0; i < ids.length; i++) if (e.level[i] === 'district') districts.set(ids[i], e.name[i])

  const rows = new Array(ids.length)
  for (let i = 0; i < ids.length; i++) {
    const level = e.level[i]
    const name = e.name[i]
    rows[i] = {
      id: ids[i],
      level,
      name,
      href: hrefFor(level, name, ids[i]),
      district: level === 'campus' ? districts.get(ids[i].slice(0, 6)) ?? null : null,
      regionId: e.regionId[i],
      countyId: e.countyId[i],
      isCharter: !!e.isCharter[i],
      isAlt: !!e.isAlt[i],
      enrollment: e.enrollment[i],
      ecoDis: e.ecoDisPct[i],
      scores: payload.scores[i],
      grades: payload.grades[i],
    }
  }
  return { years, rows, metrics: buildMetrics(years) }
}

/* --------------------------------------------------------------- the sift -- */

/**
 * Population first, ranking second, and they are counted separately.
 *
 * `total` is every entity at this level. `pool` is what survives the reader's
 * filters — that is the population the ranking is OF. Rows in the pool that
 * carry no value for the chosen metric drop out of the ranking but stay in the
 * accounting, because "1,157 of 1,169" and "1,157" are different claims and only
 * the first one is checkable.
 */
export function selectPool(rows, state) {
  const [kind, id] = splitScope(state.scope)
  let total = 0
  let inScope = 0
  let aeaRemoved = 0
  let sectorRemoved = 0
  const pool = []
  for (const r of rows) {
    if (r.level !== state.level) continue
    total++
    if (kind === 'r' && r.regionId !== id) continue
    if (kind === 'c' && r.countyId !== id) continue
    inScope++
    if (state.sector === 'traditional' && r.isCharter) { sectorRemoved++; continue }
    if (state.sector === 'charter' && !r.isCharter) { sectorRemoved++; continue }
    if (state.aea === 'exclude' && r.isAlt) { aeaRemoved++; continue }
    pool.push(r)
  }
  return { total, inScope, pool, aeaRemoved, sectorRemoved }
}

export const splitScope = (scope) => {
  const at = scope.indexOf('.')
  return at === -1 ? [scope, null] : [scope.slice(0, at), scope.slice(at + 1)]
}

/**
 * Competition ranking: equal values share a rank and the next rank is skipped
 * (1, 2, 2, 4). A tie is a tie. Publishing the second of two 96s as "3rd" would
 * be a lie about the gap, and publishing it as a sole 2nd would be a lie about
 * the company it keeps — so each row also carries how many others share its
 * value, and the table marks it.
 *
 * The display tie-break is the entity name, so the same query always produces
 * the same file. It is a presentation order only; it never changes a rank.
 */
export function rankPool(pool, metric, order) {
  const scored = []
  for (const r of pool) {
    const v = metric.get(r)
    if (typeof v === 'number' && Number.isFinite(v)) scored.push({ row: r, value: v })
  }

  const worstFirst = (order === 'bottom') === (metric.dir === 'higher')
  scored.sort((a, b) => (worstFirst ? a.value - b.value : b.value - a.value) || a.row.name.localeCompare(b.row.name))

  const counts = new Map()
  for (const s of scored) counts.set(s.value, (counts.get(s.value) ?? 0) + 1)

  let rank = 0
  let previous = null
  let tiedRows = 0
  for (let i = 0; i < scored.length; i++) {
    const s = scored[i]
    if (previous === null || s.value !== previous) rank = i + 1
    previous = s.value
    s.rank = rank
    s.tied = counts.get(s.value) - 1
    if (s.tied > 0) tiedRows++
  }

  // `distinct` is reported alongside the tie count because on its own "1,157 of
  // 1,163 districts are tied" reads as a fault in the ranking. It is not: TEA
  // publishes the overall score as a whole number, so 1,163 districts are sharing
  // 48 possible values, and the reader needs the second number to see that.
  return { ranked: scored, missing: pool.length - scored.length, tiedRows, distinct: counts.size }
}

/* -------------------------------------------------------------- the words -- */

const LEVEL_NOUN = { district: ['district', 'districts'], campus: ['campus', 'campuses'] }
const noun = (level, n) => LEVEL_NOUN[level][n === 1 ? 0 : 1]

const scopePhrase = (state, names) => {
  const [kind, id] = splitScope(state.scope)
  if (kind === 'r') return `in ${names.regions[id] ?? `Region ${id}`}`
  if (kind === 'c') return `in ${names.counties[id] ?? `county ${id}`} County`
  return 'statewide'
}

const sectorPhrase = (sector) =>
  sector === 'traditional' ? 'traditional (non-charter) only'
  : sector === 'charter' ? 'open-enrolment charters only'
  : 'traditional and charter'

const orderPhrase = (metric, order) => {
  const top = order === 'top'
  if (metric.kind === 'size') return top ? 'largest first' : 'smallest first'
  if (metric.kind === 'change') return top ? 'largest gain first' : 'largest loss first'
  return top ? 'highest first' : 'lowest first'
}

/**
 * The population sentence, plus the lines that account for everyone who is not
 * in the table. Built from the same counts the rows were built from — there is
 * no second computation here that could disagree with the list underneath it.
 */
export function describe({ state, metric, names, total, inScope, pool, aeaRemoved, sectorRemoved, ranked, missing, tiedRows, distinct, shown }) {
  const level = state.level
  const many = noun(level, 2)
  const count = (n) => `${n0(n)} ${noun(level, n)}`
  const where = scopePhrase(state, names)
  const statewide = where === 'statewide'

  const headline = `${count(ranked)} ${where}, ranked by ${metric.short}, ${orderPhrase(metric, state.order)}.`

  const lines = []

  // The population, as arithmetic a reader can follow one subtraction at a time:
  // everyone at this level, then the area, then each filter, ending on the number
  // the ranking is actually of.
  const steps = [`${count(total)} in this dataset`]
  if (!statewide) steps.push(`${n0(inScope)} of them ${where}`)
  if (sectorRemoved) steps.push(`${n0(sectorRemoved)} removed by the sector filter (${sectorPhrase(state.sector)})`)
  if (aeaRemoved) steps.push(`${n0(aeaRemoved)} alternative-education ${many} excluded`)
  lines.push(
    `Population: ${count(pool)} ${where} — ${sectorPhrase(state.sector)}, ` +
      `alternative-education ${many} ${state.aea === 'exclude' ? 'excluded' : 'included'}. ` +
      `${steps.join('; ')}; leaves ${n0(pool)}.`
  )

  if (missing > 0) {
    lines.push(`Not ranked: ${count(missing)} of those ${n0(pool)} — ${metric.missingWhy}. A blank is not a zero, so they are absent rather than last.`)
  }

  if (state.aea === 'exclude') {
    lines.push(
      `TEA judges alternative-education ${many} against a different bar, so mixing them in would flatter every other row. Include them with the checkbox above if that is the comparison you want.`
    )
  }

  if (shown < ranked) {
    lines.push(`Showing the first ${n0(shown)} of ${n0(ranked)}. The rank column counts the whole ranking, not the visible part.`)
  }

  if (tiedRows > 0) {
    lines.push(
      `Ties are shown as ties, marked =: ${count(tiedRows)} share their value with at least one other, because these ${n0(ranked)} ` +
        `${many} hold only ${n0(distinct)} distinct values. Equal values share a rank and the next rank is skipped, so ranks jump.`
    )
  }

  if (metric.note) lines.push(metric.note)

  return { headline, lines }
}

/* -------------------------------------------------------------- the table -- */

/**
 * Column definitions for the current metric. `get` returns the raw value — that
 * is what sorts and what goes into the CSV; `cell` returns the HTML a reader
 * sees. Keeping them the same function would force one of the two to be wrong,
 * since a data file must not be locale-formatted and a table must be.
 *
 * `sortable: false` on the economically-disadvantaged column is deliberate and
 * is explained at the top of this file. It is a column, not a leaderboard.
 */
export function columnsFor(metric, state, names) {
  const cols = [
    {
      key: 'rank',
      csv: 'rank',
      label: 'Rank',
      cls: 'num',
      sortable: true,
      defaultDir: 'asc',
      get: (s) => s.rank,
      cell: (s) =>
        `${n0(s.rank)}${s.tied > 0 ? `<span class="rk-tie" aria-hidden="true">=</span><span class="sr-only"> tied with ${plural(s.tied, 'other', 'others')}</span>` : ''}`,
    },
    {
      key: 'name',
      csv: 'name',
      label: state.level === 'campus' ? 'Campus' : 'District',
      cls: 'rk-name',
      rowHeader: true,
      sortable: true,
      defaultDir: 'asc',
      get: (s) => s.row.name,
      cell: (s) => `<a href="${esc(s.row.href)}">${esc(s.row.name)}</a>`,
    },
  ]

  if (state.level === 'campus') {
    cols.push({
      key: 'district',
      csv: 'district',
      label: 'District',
      cls: 'rk-sub',
      sortable: true,
      defaultDir: 'asc',
      get: (s) => s.row.district,
      cell: (s) => esc(s.row.district ?? '—'),
    })
  }

  cols.push({
    key: 'county',
    csv: 'county',
    label: 'County',
    cls: 'rk-sub',
    sortable: true,
    defaultDir: 'asc',
    // The id is the fallback in BOTH, so the file never disagrees with the screen
    // about what a cell said — even on a page served without the name lookup.
    get: (s) => names.counties[s.row.countyId] ?? s.row.countyId,
    cell: (s) => esc(names.counties[s.row.countyId] ?? s.row.countyId),
  })

  // The letter grade for the year being ranked, not always the latest one:
  // ranking 2022-23 scores beside a 2025-26 grade would read as a contradiction
  // on every row where the grade moved. Grades are never colour-coded here —
  // every green-amber-red ramp this site tested failed colour-vision testing.
  const gradeIndex = metric.kind === 'score' ? metric.yearIndex : 0
  const gradeYear = metric.kind === 'score' ? metric.year : null
  cols.push({
    key: 'grade',
    csv: gradeYear ? `grade_${gradeYear.replace('-', '_')}` : 'grade_latest',
    label: gradeYear ? `Grade ${gradeYear}` : 'Grade',
    cls: 'rk-grade',
    sortable: false,
    get: (s) => s.row.grades[gradeIndex],
    cell: (s) => esc(s.row.grades[gradeIndex] ?? '—'),
  })

  if (metric.kind === 'change') {
    cols.push(
      {
        key: 'from',
        csv: `score_${metric.from.replace('-', '_')}`,
        label: metric.from,
        cls: 'num',
        sortable: true,
        defaultDir: 'desc',
        get: (s) => s.row.scores[metric.fromIndex],
        cell: (s) => n0(s.row.scores[metric.fromIndex]),
      },
      {
        key: 'to',
        csv: `score_${metric.to.replace('-', '_')}`,
        label: metric.to,
        cls: 'num',
        sortable: true,
        defaultDir: 'desc',
        get: (s) => s.row.scores[0],
        cell: (s) => n0(s.row.scores[0]),
      },
      {
        key: 'value',
        csv: metric.csv,
        label: 'Change',
        cls: 'num rk-value',
        sortable: true,
        defaultDir: 'desc',
        get: (s) => s.value,
        cell: (s) => signed(s.value),
      }
    )
  } else if (metric.kind === 'score') {
    cols.push({
      key: 'value',
      csv: metric.csv,
      label: `Score ${metric.year}`,
      cls: 'num rk-value',
      sortable: true,
      defaultDir: 'desc',
      get: (s) => s.value,
      cell: (s) => n0(s.value),
    })
  }

  cols.push({
    key: 'enrollment',
    csv: 'enrollment',
    label: 'Enrollment',
    cls: metric.kind === 'size' ? 'num rk-value' : 'num',
    sortable: true,
    defaultDir: 'desc',
    get: (s) => s.row.enrollment,
    cell: (s) => n0(s.row.enrollment),
  })

  cols.push({
    key: 'ecoDis',
    csv: 'eco_dis_pct',
    label: 'Econ. disadv.',
    cls: 'num rk-context',
    sortable: false,
    get: (s) => s.row.ecoDis,
    cell: (s) => (s.row.ecoDis === null ? '—' : `${n1(s.row.ecoDis)}%`),
  })

  return cols
}

const arrow = (dir) => (dir === 'asc' ? '\u25b2' : '\u25bc')

function renderTable(displayed, cols, caption, sorted, dir) {
  const head = cols
    .map((c) => {
      const active = sorted === c.key
      const sort = active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'
      const inner = c.sortable
        ? `<button type="button" class="rk-sort" data-col="${esc(c.key)}">${esc(c.label)}` +
          `<span class="rk-arrow" aria-hidden="true">${active ? arrow(dir) : ''}</span></button>`
        : `${esc(c.label)}${c.key === 'ecoDis' ? '<span class="sr-only"> — context, not a ranking measure. This column does not sort.</span>' : ''}`
      return `<th scope="col" class="${esc(c.cls)}"${c.sortable ? ` aria-sort="${sort}"` : ''}>${inner}</th>`
    })
    .join('')

  const body = displayed
    .map((s) => {
      const cells = cols
        .map((c) =>
          c.rowHeader
            ? `<th scope="row" class="${esc(c.cls)}">${c.cell(s)}</th>`
            : `<td class="${esc(c.cls)}">${c.cell(s)}</td>`
        )
        .join('')
      return `<tr>${cells}</tr>`
    })
    .join('')

  return (
    `<div class="rk-scroll" tabindex="0" role="region" aria-label="Ranked list">` +
    `<table class="data rk-table">` +
    `<caption class="sr-only">${esc(caption)}</caption>` +
    `<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
  )
}

const sortKey = (state, cols) => (state.sort && cols.some((c) => c.key === state.sort && c.sortable) ? state.sort : 'rank')

/**
 * The direction actually in force. `state.dir` is only set once a reader has
 * clicked a header; before that each column falls back to its own natural
 * direction — ranks ascending, numbers descending, names A to Z. The indicator
 * and the comparator both read this, so the arrow can never point one way while
 * the rows go the other.
 */
const effectiveDir = (state, col) => state.dir ?? col.defaultDir ?? 'asc'

/* ---------------------------------------------------------------- the csv -- */

const NEEDS_QUOTING = /[",\r\n]/
const csvCell = (v) => {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  const s = String(v)
  if (s === '') return ''
  return NEEDS_QUOTING.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s
}
const csvRow = (vals) => vals.map(csvCell).join(',')

/**
 * The rows on screen, as a file somebody can cite.
 *
 * The `# ` comment block is the same shape src/render/downloads.js writes, and
 * for the same reason: a journalist who downloads a table and cannot later
 * reconstruct what produced it has a file they cannot use. It records the exact
 * filter set, the population arithmetic, and the URL that reproduces the list —
 * so the file and the page can be checked against each other a year from now.
 */
export function buildCsv({ displayed, cols, description, state, metric, snapshot, url, ranked, pool, total, inScope, missing }) {
  const lines = [
    'txschools.net — unofficial. Not operated by, endorsed by, or affiliated with the Texas Education Agency.',
    `source: Texas Education Agency, published publicly at ${OFFICIAL_SOURCE}`,
    `snapshot: ${snapshot ?? 'unrecorded'} — the date this site fetched TEA's data. TEA may have revised it since.`,
    'dataset: interactive ranking (/rankings)',
    `ranked by: ${metric.label} (${orderPhrase(metric, state.order)})`,
    `ranking: ${description.headline}`,
    ...description.lines.map((l) => `note: ${l}`),
    `filters: level=${state.level} scope=${state.scope} sector=${state.sector} alternative_education=${state.aea === 'include' ? 'included' : 'excluded'} order=${state.order} show=${state.n}`,
    `counts: ${total} at this level; ${inScope} in the selected area; ${pool} in the population after filters; ${ranked} ranked; ${missing} in the population with no value for this measure`,
    `rows in this file: ${displayed.length} — exactly the rows shown on screen when it was downloaded, in the order shown`,
    'ties: competition ranking — equal values share a rank and the next rank is skipped. tied_with counts the others sharing that value.',
    `reproduce: ${url}`,
    'empty cell = TEA did not publish that figure. It does not mean zero.',
    'numbers are unformatted: no thousands separators, no currency symbols, no percent signs.',
    "lines starting with # are comments — pandas: read_csv(path, comment='#')",
  ]

  const header = lines.map((l) => `# ${l}`).join('\n') + '\n'
  const names = [...cols.map((c) => c.csv), 'tied_with', 'entity_id', 'url']
  const rows = displayed.map((s) =>
    csvRow([...cols.map((c) => c.get(s)), s.tied, s.row.id, `${SITE_ORIGIN}${s.row.href}`])
  )
  return header + [csvRow(names), ...rows].join('\n') + '\n'
}

export const csvFilename = (state, metric) =>
  ['txschools', 'rankings', slugify(metric.key), state.level === 'campus' ? 'campuses' : 'districts', slugify(state.scope), state.order]
    .join('-') + '.csv'

/* --------------------------------------------------------------- url state -- */

/**
 * The query string, read defensively: anything unrecognized falls back to the
 * default rather than throwing or rendering an empty table. A link that has
 * rotted — a metric that no longer exists after a new snapshot, a county id that
 * changed — must still land on a real ranking.
 *
 * `:` is accepted wherever `.` is written, so links minted before the separator
 * changed keep working.
 */
const SCOPE_RE = /^(state|r\.\d{2}|c\.\d{3})$/

/**
 * `defaults` is what the HOST PAGE already shows. On /rankings that is the
 * statewide district list; on a prerendered county list it is that county. The
 * script's first render must reproduce the served table exactly — otherwise the
 * page visibly rewrites itself the moment the payload lands, and the reader
 * watches the list they came for get replaced by a different one.
 */
export function readState(search, metrics, defaults = DEFAULTS) {
  const q = new URLSearchParams(search)
  // A page default is honoured only if it is itself valid; a typo in the markup
  // falls back to the built-in rather than producing a state nothing can render.
  const fallback = (key, allowed) => (allowed.includes(defaults[key]) ? defaults[key] : DEFAULTS[key])
  const pick = (key, allowed) => {
    const v = q.get(key)
    return v && allowed.includes(v) ? v : fallback(key, allowed)
  }
  const known = (k) => metrics.some((m) => m.key === k)
  const metric = (q.get('metric') ?? '').replace(':', '.')
  const state = {
    metric: known(metric) ? metric : known(defaults.metric) ? defaults.metric : DEFAULTS.metric,
    level: pick('level', ['district', 'campus']),
    scope: SCOPE_RE.test(defaults.scope ?? '') ? defaults.scope : DEFAULTS.scope,
    sector: pick('sector', ['all', 'traditional', 'charter']),
    aea: pick('aea', ['exclude', 'include']),
    order: pick('order', ['top', 'bottom']),
    n: pick('n', SIZES),
    sort: q.get('sort') || null,
    dir: q.get('dir') === 'asc' ? 'asc' : q.get('dir') === 'desc' ? 'desc' : null,
  }
  const scope = (q.get('scope') ?? '').replace(':', '.')
  if (SCOPE_RE.test(scope)) state.scope = scope
  return state
}

/**
 * Only what differs from the page's own default is written, so a shared link is
 * short and a page that has not been touched carries no query string at all.
 */
export function writeQuery(state, defaults = DEFAULTS) {
  const q = new URLSearchParams()
  for (const key of ['metric', 'level', 'scope', 'sector', 'aea', 'order', 'n']) {
    if (state[key] !== (defaults[key] ?? DEFAULTS[key])) q.set(key, state[key])
  }
  if (state.sort && state.sort !== 'rank') {
    q.set('sort', state.sort)
    if (state.dir) q.set('dir', state.dir)
  }
  const s = q.toString()
  return s ? `?${s}` : ''
}

/** True when the URL already asks for something, i.e. this is a shared link. */
export const isSharedLink = (search) => {
  const q = new URLSearchParams(search)
  return ['metric', 'level', 'scope', 'sector', 'aea', 'order', 'n', 'sort'].some((k) => q.has(k))
}

/* ------------------------------------------------------------------- boot -- */

const PAYLOAD_SELECTORS = ['[data-rankings]', 'script[data-pin-source]', '[data-pin-source]']

function payloadUrl(root) {
  const direct = root.getAttribute('data-payload')
  if (direct) return direct
  for (const sel of PAYLOAD_SELECTORS.slice(1)) {
    const el = document.querySelector(sel)
    if (!el) continue
    const attr = el.getAttribute('data-pin-source')
    if (attr) return attr
    try {
      const parsed = JSON.parse(el.textContent)
      const url = typeof parsed === 'string' ? parsed : parsed?.payload ?? parsed?.url ?? parsed?.src
      if (url) return url
    } catch { /* a tag we cannot read is a tag we do not use */ }
  }
  return null
}

function readNames() {
  const tag = document.querySelector('script[data-rankings-lookups]')
  if (!tag) return { regions: {}, counties: {} }
  try {
    const parsed = JSON.parse(tag.textContent)
    return { regions: parsed.regions ?? {}, counties: parsed.counties ?? {} }
  } catch {
    return { regions: {}, counties: {} }
  }
}

function option(value, label, selected) {
  return `<option value="${esc(value)}"${selected ? ' selected' : ''}>${esc(label)}</option>`
}

/** What the served page is already showing; see readState. */
function pageDefaults(root) {
  const raw = root.getAttribute('data-defaults')
  if (!raw) return { ...DEFAULTS }
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? { ...DEFAULTS, ...parsed } : { ...DEFAULTS }
  } catch {
    return { ...DEFAULTS }
  }
}

function init(root) {
  const names = readNames()
  const src = payloadUrl(root)
  if (!src) return // no data to upgrade with: the served list stands as it is

  const defaults = pageDefaults(root)
  const snapshot = root.getAttribute('data-snapshot')
  const output = root.querySelector('[data-rankings-output]')
  const status = root.querySelector('[data-rankings-status]')
  if (!output) return

  let mount = root.querySelector('[data-rankings-controls]')
  if (!mount) {
    mount = document.createElement('div')
    mount.setAttribute('data-rankings-controls', '')
    root.insertBefore(mount, root.firstChild)
  }

  let data = null // { years, rows, metrics }
  let pending = null
  let state = null
  let last = null // everything the CSV button needs, from the render that produced the screen

  const say = (msg) => { if (status) status.textContent = msg }

  /* ---- controls -------------------------------------------------------- */

  const form = document.createElement('form')
  form.className = 'rk-controls'
  form.setAttribute('aria-label', 'Choose a ranking')
  form.addEventListener('submit', (e) => e.preventDefault()) // there is no endpoint; Enter just re-applies

  const scopeOptions = (level) => {
    const regions = Object.keys(names.regions).sort()
    const counties = Object.keys(names.counties).sort((a, b) =>
      (names.counties[a] ?? a).localeCompare(names.counties[b] ?? b)
    )
    // Only areas that actually contain something at this level are offered, so
    // the menu can never lead to an empty table.
    const present = data
      ? new Set(data.rows.filter((r) => r.level === level).flatMap((r) => [`r.${r.regionId}`, `c.${r.countyId}`]))
      : null
    const keep = (v) => !present || present.has(v)
    return (
      option('state', 'Texas — statewide', state.scope === 'state') +
      `<optgroup label="Education service centre region">` +
      regions.filter((id) => keep(`r.${id}`)).map((id) => option(`r.${id}`, names.regions[id] ?? `Region ${id}`, state.scope === `r.${id}`)).join('') +
      `</optgroup><optgroup label="County">` +
      counties.filter((id) => keep(`c.${id}`)).map((id) => option(`c.${id}`, `${names.counties[id] ?? id} County`, state.scope === `c.${id}`)).join('') +
      `</optgroup>`
    )
  }

  const metricOptions = () => {
    const groups = []
    for (const m of data.metrics) {
      const g = groups.find((x) => x.name === m.group) ?? (groups.push({ name: m.group, items: [] }), groups.at(-1))
      g.items.push(m)
    }
    return groups
      .map((g) => `<optgroup label="${esc(g.name)}">${g.items.map((m) => option(m.key, m.label, state.metric === m.key)).join('')}</optgroup>`)
      .join('')
  }

  const orderOptions = () => {
    const m = currentMetric()
    const pairs =
      m.kind === 'size' ? [['top', 'Largest first'], ['bottom', 'Smallest first']]
      : m.kind === 'change' ? [['top', 'Largest gain first'], ['bottom', 'Largest loss first']]
      : [['top', 'Highest first'], ['bottom', 'Lowest first']]
    return pairs.map(([v, l]) => option(v, l, state.order === v)).join('')
  }

  const field = (id, label, inner, hint) =>
    `<p class="rk-field"><label for="${id}">${esc(label)}</label>${inner}` +
    (hint ? `<span class="rk-hint" id="${id}-hint">${esc(hint)}</span>` : '') +
    `</p>`

  function paintControls() {
    const altNoun = state.level === 'campus' ? 'alternative-education campuses' : 'alternative-education districts'
    form.innerHTML =
      `<div class="rk-grid">` +
      field('rk-metric', 'Rank by', `<select id="rk-metric" name="metric">${metricOptions()}</select>`) +
      field('rk-level', 'Level', `<select id="rk-level" name="level">${option('district', 'Districts', state.level === 'district')}${option('campus', 'Campuses', state.level === 'campus')}</select>`) +
      field('rk-scope', 'Population', `<select id="rk-scope" name="scope">${scopeOptions(state.level)}</select>`) +
      field('rk-sector', 'Sector', `<select id="rk-sector" name="sector">${option('all', 'All', state.sector === 'all')}${option('traditional', 'Traditional only', state.sector === 'traditional')}${option('charter', 'Charters only', state.sector === 'charter')}</select>`) +
      field('rk-order', 'Order', `<select id="rk-order" name="order">${orderOptions()}</select>`) +
      field('rk-n', 'Show', `<select id="rk-n" name="n">${SIZES.map((s) => option(s, s === 'all' ? 'All rows' : `Top ${s}`, state.n === s)).join('')}</select>`) +
      `</div>` +
      `<div class="rk-row">` +
      `<label class="rk-check"><input type="checkbox" name="aea"${state.aea === 'include' ? ' checked' : ''}> Include ${esc(altNoun)}</label>` +
      `<span class="rk-actions">` +
      `<button type="button" class="rk-btn" data-csv>Download this list (CSV)</button>` +
      (navigator.clipboard ? `<button type="button" class="rk-btn" data-copy>Copy link to this ranking</button>` : '') +
      `</span></div>` +
      `<p class="rk-avail">Rankable here: the overall accountability score for each of the ${data.years.length} years TEA publishes it, the change between any two of them, and enrollment. ` +
      `STAAR, CCMR, graduation and chronic absence are published for one year at a time and are not in this dataset, so they are not offered rather than estimated.</p>`
  }

  /* ---- render ---------------------------------------------------------- */

  const currentMetric = () => data.metrics.find((m) => m.key === state.metric) ?? data.metrics[0]

  /**
   * An area that holds nothing at the chosen level falls back to statewide.
   * Without this, switching from districts to campuses in a county that has no
   * campuses — or following a link that names one — would leave the selection
   * pointing at an area the menu no longer offers, and the reader would get an
   * empty table with no way to see why.
   */
  function normalizeScope() {
    if (state.scope === 'state') return
    const [kind, id] = splitScope(state.scope)
    const has = data.rows.some((r) => r.level === state.level && (kind === 'r' ? r.regionId === id : r.countyId === id))
    if (!has) state.scope = 'state'
  }

  function render({ announce = true, repaint = false, refocus = null } = {}) {
    const metric = currentMetric()
    const { total, inScope, pool, aeaRemoved, sectorRemoved } = selectPool(data.rows, state)
    const { ranked, missing, tiedRows, distinct } = rankPool(pool, metric, state.order)

    const limit = state.n === 'all' ? ranked.length : Math.min(Number(state.n), ranked.length)
    const shown = ranked.slice(0, limit)

    const cols = columnsFor(metric, state, names)
    const key = sortKey(state, cols)
    const col = cols.find((c) => c.key === key)
    const dir = effectiveDir(state, col)
    const displayed =
      key === 'rank' && dir === 'asc'
        ? shown
        : [...shown].sort((a, b) => {
            const av = col.get(a)
            const bv = col.get(b)
            const blankA = av === null || av === undefined
            const blankB = bv === null || bv === undefined
            // A blank is not a low value: TEA did not publish the figure. It goes
            // to the bottom either way rather than winning an ascending sort.
            if (blankA || blankB) return blankA === blankB ? 0 : blankA ? 1 : -1
            const c = typeof av === 'string' ? av.localeCompare(bv) : av - bv
            return (dir === 'asc' ? c : -c) || a.row.name.localeCompare(b.row.name)
          })

    const description = describe({
      state, metric, names, total, inScope, pool: pool.length, aeaRemoved, sectorRemoved,
      ranked: ranked.length, missing, tiedRows, distinct, shown: shown.length,
    })

    if (key !== 'rank') {
      description.lines.unshift(
        `Rank is by ${metric.short}; the visible rows are sorted by ${col.label.toLowerCase()} instead, which reorders the display and changes no rank.`
      )
    }
    if (displayed.length > BIG_LIST) {
      description.lines.push(`This is a ${n0(displayed.length)}-row table. It is long on purpose; use your browser's find, or download the CSV.`)
    }

    output.innerHTML =
      `<p class="rk-headline">${esc(description.headline)}</p>` +
      renderTable(displayed, cols, description.headline, key, dir) +
      (displayed.length ? '' : `<p class="rk-empty">No ${noun(state.level, 2)} match that combination. Widen the population or turn a filter off.</p>`) +
      `<ul class="rk-notes">${description.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`

    if (announce) say(`${description.headline} ${description.lines[0]}`)

    last = { displayed, cols, description, metric, ranked: ranked.length, pool: pool.length, total, inScope, missing }

    // Changing the metric or the level rewrites the whole control panel — the
    // scope menu, the order wording and the checkbox label all depend on them.
    // That throws away the element the reader was standing on, so it is handed
    // back deliberately; without this, one keypress on the metric menu drops a
    // keyboard user at the top of the document.
    if (repaint) {
      paintControls()
      const back = refocus && form.querySelector(refocus)
      if (back) back.focus()
    }
  }

  function apply(patch, opts) {
    Object.assign(state, patch)
    normalizeScope()
    const url = location.pathname + writeQuery(state, defaults) + location.hash
    history.replaceState(null, '', url) // replace, not push: the Back button belongs to the site, not the filter bar
    render(opts)
  }

  /* ---- events ---------------------------------------------------------- */

  form.addEventListener('change', (e) => {
    const el = e.target
    if (!el.name) return
    if (el.name === 'aea') return apply({ aea: el.checked ? 'include' : 'exclude' })
    // Both of these change what the other controls can say, so the panel is
    // rebuilt and the reader is put back where they were.
    if (el.name === 'level') return apply({ level: el.value, sort: null, dir: null }, { repaint: true, refocus: '#rk-level' })
    if (el.name === 'metric') return apply({ metric: el.value, sort: null, dir: null }, { repaint: true, refocus: '#rk-metric' })
    apply({ [el.name]: el.value })
  })

  output.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-col]')
    if (!btn) return
    const key = btn.dataset.col
    const cols = columnsFor(currentMetric(), state, names)
    const col = cols.find((c) => c.key === key)
    if (!col) return
    const active = sortKey(state, cols) === key
    const dir = active ? (effectiveDir(state, col) === 'asc' ? 'desc' : 'asc') : col.defaultDir
    apply({ sort: key === 'rank' && dir === 'asc' ? null : key, dir })
    // Keep the keyboard where it was: the header was just replaced wholesale.
    const again = output.querySelector(`button[data-col="${CSS.escape(key)}"]`)
    if (again) again.focus()
  })

  form.addEventListener('click', (e) => {
    if (e.target.closest('[data-csv]')) return downloadCsv()
    if (e.target.closest('[data-copy]')) return copyLink()
  })

  function downloadCsv() {
    if (!last) return
    const text = buildCsv({
      displayed: last.displayed,
      cols: last.cols,
      description: last.description,
      state,
      metric: last.metric,
      snapshot,
      url: SITE_ORIGIN + location.pathname + writeQuery(state, defaults),
      ranked: last.ranked,
      pool: last.pool,
      total: last.total,
      inScope: last.inScope,
      missing: last.missing,
    })
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
    const href = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = href
    a.download = csvFilename(state, last.metric)
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(href), 1000)
    say(`Downloading ${csvFilename(state, last.metric)} — ${plural(last.displayed.length, 'row', 'rows')}, the list as shown.`)
  }

  function copyLink() {
    const url = SITE_ORIGIN + location.pathname + writeQuery(state, defaults)
    navigator.clipboard.writeText(url).then(
      () => say(`Link copied: ${url}`),
      () => say(`Copy failed. The link is in the address bar: ${url}`)
    )
  }

  /* ---- data ------------------------------------------------------------ */

  function load() {
    if (pending) return pending
    say('Loading the statewide dataset\u2026')
    pending = fetch(src, { credentials: 'omit' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((payload) => {
        data = decodePayload(payload)
        state = readState(location.search, data.metrics, defaults)
        normalizeScope()
        paintControls()
        mount.textContent = ''
        mount.appendChild(form)
        mount.removeAttribute('hidden')
        render()
      })
      .catch(() => {
        pending = null // a failure must leave a real retry behind, not a cached one
        say('The dataset could not be loaded, so the controls are unavailable. The ranking already on this page is unaffected.')
      })
    return pending
  }

  // Never on page load. The served ranking is complete without this file, and a
  // reader who came to read it should not pay 229 KB for controls they did not
  // ask for. Two things count as asking: touching the controls area, or arriving
  // on a link that already names a ranking — that link is the request.
  if (isSharedLink(location.search)) load()
  else {
    const wake = () => load()
    mount.addEventListener('pointerdown', wake, { once: true })
    mount.addEventListener('focusin', wake, { once: true })
    mount.addEventListener('keydown', wake, { once: true })
  }

  // The placeholder is a real, focusable prompt before the data arrives, so a
  // keyboard reader can reach the controls at all. It is skipped when a fetch is
  // already in flight — a shared link goes straight to its ranking rather than
  // flashing a button nobody needs to press.
  if (!pending && !mount.textContent.trim()) {
    const prompt = document.createElement('button')
    prompt.type = 'button'
    prompt.className = 'rk-btn rk-wake'
    prompt.textContent = 'Change this ranking (metric, area, level, sector)'
    prompt.addEventListener('click', load)
    mount.appendChild(prompt)
    mount.removeAttribute('hidden')
  }
}

if (typeof document !== 'undefined') {
  const boot = () => {
    const root = document.querySelector('[data-rankings]')
    if (root) init(root)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
}
