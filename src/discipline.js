// Official discipline and removal-from-class history from TEA's annual PEIMS
// Discipline Summary downloads. TEA publishes three different units in the
// same long-form table: unique students, disciplinary actions, and incidents.
// They are deliberately kept separate here. In particular, this module never
// divides an action count by enrollment or presents actions as students.
//
// Raw broker responses are archived byte-for-byte inside gzip. The manifest's
// SHA-256 describes the uncompressed bytes TEA returned; parsing is a separate,
// deterministic normalization step shared by fetch, verify, and build code.

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { gunzipSync, gzipSync } from 'node:zlib'

export const DISCIPLINE_ROOT = 'data/discipline'
export const DISCIPLINE_LANDING_URL =
  'https://tea.texas.gov/data-reports/student-data/discipline-data-products/discipline-reports'
export const DISCIPLINE_DOWNLOAD_URL =
  'https://rptsvr1.tea.texas.gov/adhocrpt/Disciplinary_Data_Products/Discipline_Summary_Download.html'
export const DISCIPLINE_DEFINITIONS_URL =
  'https://tea.texas.gov/data-reports/student-data/discipline-data-products/discipline-action-group-summary-reports-0'
export const DISCIPLINE_BROKER_URL = 'https://rptsvr1.tea.texas.gov/cgi/sas/broker'

// 2024-25 is TEA's latest published discipline year. These are the latest five
// annual-summary downloads with the same long-form headers and core A/B/H
// sections. TEA consolidated its separate Discipline Action Group reports into
// this product in 2024-25, so section membership can expand even though these
// core annual-summary dimensions remain comparable.
export const DISCIPLINE_YEARS = Object.freeze([
  Object.freeze({ year: '2020-21', schoolYear: '21' }),
  Object.freeze({ year: '2021-22', schoolYear: '22' }),
  Object.freeze({ year: '2022-23', schoolYear: '23' }),
  Object.freeze({ year: '2023-24', schoolYear: '24' }),
  Object.freeze({ year: '2024-25', schoolYear: '25' }),
])

// Entity floors, rather than row floors, make changes to TEA's list of reason
// codes harmless while still rejecting a partial statewide response.
export const DISCIPLINE_MIN_ENTITIES = Object.freeze({ district: 1100, campus: 8500 })

export const DISCIPLINE_SOURCES = Object.freeze(
  DISCIPLINE_YEARS.flatMap(({ year, schoolYear }) =>
    ['district', 'campus'].map((level) =>
      Object.freeze({
        key: `${year}-${level}`,
        file: `${year}-${level}.csv.gz`,
        year,
        schoolYear,
        level,
        aggregation: level === 'district' ? 'allDISTRICT' : 'CAMPUS',
        referrer: level === 'district' ? 'Download_All_Districts.html' : 'Download_All_Campuses.html',
        submit:
          level === 'district'
            ? 'Download_All_Districts_Summaries'
            : 'Download_All_Campuses_Summaries',
        minEntities: DISCIPLINE_MIN_ENTITIES[level],
      })
    )
  )
)

const SOURCE_BY_KEY = new Map(DISCIPLINE_SOURCES.map((source) => [source.key, source]))
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

const MEASURE = Object.freeze({
  'STUDENT COUNTS': 'students',
  'ACTION COUNTS': 'actions',
  'INCIDENT COUNTS': 'incidents',
})

const REQUIRED_HEADERS = Object.freeze({
  district: Object.freeze([
    'AGGREGATION LEVEL',
    'REGION',
    'DISTNAME',
    'DISTRICT',
    'CHARTER_STATUS',
    'SECTION',
    'HEADING NAME',
    'INDICATOR',
    'VALUE',
  ]),
  campus: Object.freeze([
    'AGGREGATION LEVEL',
    'CAMPUS',
    'REGION',
    'DISTRICT NAME AND NUMBER',
    'CHARTER_STATUS',
    'CAMPUS NAME AND NUMBER',
    'SECTION',
    'HEADING NAME',
    'INDICATOR',
    'VALUE',
  ]),
})

const clean = (value) => String(value).trim().replace(/\s+/g, ' ')
const cleanHeader = (value) => clean(value).toUpperCase()

function longYear(year) {
  const match = /^(\d{4})-(\d{2})$/.exec(year)
  if (!match) throw new Error(`invalid academic year ${JSON.stringify(year)}; expected YYYY-YY`)
  const start = Number(match[1])
  if ((start + 1) % 100 !== Number(match[2])) {
    throw new Error(`invalid academic year ${JSON.stringify(year)}; years must be consecutive`)
  }
  return `${start}-${start + 1}`
}

function assertLevel(level) {
  if (level !== 'district' && level !== 'campus') {
    throw new Error(`invalid discipline level ${JSON.stringify(level)}; expected district or campus`)
  }
}

/**
 * Yields RFC 4180-style records without materializing the entire 150 MB campus
 * report as an array of arrays. The yielded line is the physical line on which
 * each record began, which makes malformed-source errors reproducible.
 */
export function* disciplineCsvRecords(input) {
  if (typeof input !== 'string') throw new TypeError('CSV input must be a string')
  let text = input
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)

  let record = []
  let field = ''
  let state = 'plain'
  let line = 1
  let recordLine = 1

  const endField = () => {
    record.push(field)
    field = ''
    state = 'plain'
  }
  const endRecord = function* () {
    endField()
    yield { record, line: recordLine }
    record = []
    recordLine = line + 1
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (state === 'quoted') {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          state = 'after-quote'
        }
      } else {
        field += ch
        if (ch === '\n') line++
      }
      continue
    }

    if (state === 'after-quote') {
      if (ch === ',') endField()
      else if (ch === '\n') {
        yield* endRecord()
        line++
      } else if (ch === '\r') {
        yield* endRecord()
        if (text[i + 1] === '\n') i++
        line++
      } else if (ch !== ' ' && ch !== '\t') {
        throw new Error(`CSV line ${line}: unexpected ${JSON.stringify(ch)} after closing quote`)
      }
      continue
    }

    if (ch === '"') {
      if (field.length > 0) throw new Error(`CSV line ${line}: unexpected quote in unquoted field`)
      state = 'quoted'
    } else if (ch === ',') {
      endField()
    } else if (ch === '\n') {
      yield* endRecord()
      line++
    } else if (ch === '\r') {
      yield* endRecord()
      if (text[i + 1] === '\n') i++
      line++
    } else {
      field += ch
    }
  }

  if (state === 'quoted') throw new Error(`CSV line ${line}: unterminated quoted field`)
  if (field.length > 0 || record.length > 0 || state === 'after-quote') {
    endField()
    yield { record, line: recordLine }
  }
}

function parseCount(raw, rowNumber) {
  const value = String(raw).trim()
  // Complementary masking can produce bounds much larger than the familiar
  // <10/<20 examples (for example "<3,110"). It is still a bound, not a
  // publishable count, so retain the token and never substitute its endpoint.
  if (value === '-999' || value === '-9999999' || /^<\s*\d{1,3}(?:,\d{3})*$/.test(value) || /^<\s*\d+$/.test(value)) {
    return { count: null, status: 'suppressed', mask: value.replace(/\s+/g, '') }
  }
  if (value === '' || /^(?:N\/?A|NOT AVAILABLE|-|\*)$/i.test(value)) {
    return { count: null, status: 'not-reported', mask: null }
  }
  if (/^-\d+$/.test(value)) {
    throw new Error(`CSV row ${rowNumber}: unexpected negative count ${JSON.stringify(value)}`)
  }
  if (!/^\d+$/.test(value)) {
    throw new Error(`CSV row ${rowNumber}: invalid count ${JSON.stringify(value)}`)
  }
  const count = Number(value)
  if (!Number.isSafeInteger(count)) throw new Error(`CSV row ${rowNumber}: count is outside the safe integer range`)
  return { count, status: 'reported', mask: null }
}

function nameAndId(value, digits, label, rowNumber) {
  const match = new RegExp(`^(.*\\S)\\s+(\\d{${digits}})$`).exec(clean(value))
  if (!match) {
    throw new Error(`CSV row ${rowNumber}: ${label} must end with a ${digits}-digit identifier`)
  }
  return { name: match[1], id: match[2] }
}

function rowFromRecord(record, at, { year, level }, rowNumber) {
  const expectedAggregation = level === 'district' ? 'DISTRICT SUMMARY' : 'CAMPUS SUMMARY'
  const aggregation = cleanHeader(record[at['AGGREGATION LEVEL']])
  if (aggregation !== expectedAggregation) {
    throw new Error(
      `${year} ${level}: CSV row ${rowNumber} has aggregation ${JSON.stringify(aggregation)}, expected ${expectedAggregation}`
    )
  }

  const region = clean(record[at.REGION])
  if (!/^(?:0[1-9]|1\d|20)$/.test(region)) {
    throw new Error(`${year} ${level}: CSV row ${rowNumber} has invalid region ${JSON.stringify(region)}`)
  }

  const section = clean(record[at.SECTION])
  const heading = clean(record[at['HEADING NAME']])
  const indicator = cleanHeader(record[at.INDICATOR])
  const measure = MEASURE[indicator]
  if (!section || !heading) throw new Error(`${year} ${level}: CSV row ${rowNumber} has a blank section or heading`)
  if (!measure) {
    throw new Error(`${year} ${level}: CSV row ${rowNumber} has unknown indicator ${JSON.stringify(indicator)}`)
  }

  const charterStatus = clean(record[at.CHARTER_STATUS])
  if (!charterStatus) throw new Error(`${year} ${level}: CSV row ${rowNumber} has a blank charter status`)
  const value = parseCount(record[at.VALUE], rowNumber)

  if (level === 'district') {
    const id = clean(record[at.DISTRICT])
    if (!/^\d{6}$/.test(id)) {
      throw new Error(`${year} district: CSV row ${rowNumber} has invalid district id ${JSON.stringify(id)}`)
    }
    const name = clean(record[at.DISTNAME])
    if (!name) throw new Error(`${year} district: CSV row ${rowNumber} has a blank district name`)
    return { id, level, year, region, name, districtId: id, districtName: name, charterStatus, section, heading, measure, ...value }
  }

  const id = clean(record[at.CAMPUS])
  if (!/^\d{9}$/.test(id)) {
    throw new Error(`${year} campus: CSV row ${rowNumber} has invalid campus id ${JSON.stringify(id)}`)
  }
  const campus = nameAndId(record[at['CAMPUS NAME AND NUMBER']], 9, 'campus name and number', rowNumber)
  const district = nameAndId(record[at['DISTRICT NAME AND NUMBER']], 6, 'district name and number', rowNumber)
  if (campus.id !== id) {
    throw new Error(`${year} campus: CSV row ${rowNumber} repeats campus id ${campus.id}, expected ${id}`)
  }
  if (district.id !== id.slice(0, 6)) {
    throw new Error(
      `${year} campus: CSV row ${rowNumber} reports district ${district.id}, expected campus prefix ${id.slice(0, 6)}`
    )
  }
  return {
    id,
    level,
    year,
    region,
    name: campus.name,
    districtId: district.id,
    districtName: district.name,
    charterStatus,
    section,
    heading,
    measure,
    ...value,
  }
}

function isFooter(record) {
  if (record.length !== 1) return false
  const value = clean(record[0])
  return (
    value.startsWith('-999 and ranges (e.g. <10 and <20) indicate counts are not available') ||
    value.startsWith("'-999' and ranges (e.g. <10 and <20) indicate counts are not available") ||
    value.startsWith('Masked numbers are typically small although larger numbers may be masked')
  )
}

function scanDisciplineReport(text, source, { collect = true, filter = () => true } = {}) {
  const { year, level } = source ?? {}
  longYear(year)
  assertLevel(level)
  if (typeof filter !== 'function') throw new TypeError('discipline row filter must be a function')

  const expectedYear = longYear(year)
  const title = `PEIMS Discipline Data for ${expectedYear}`
  if (!text.includes(title)) {
    throw new Error(`${year} ${level}: response is missing ${JSON.stringify(title)}`)
  }

  const required = REQUIRED_HEADERS[level]
  let header = null
  let at = null
  const rows = []
  const entities = new Set()
  const dimensions = new Set()
  const measures = { students: 0, actions: 0, incidents: 0 }
  const statuses = { reported: 0, suppressed: 0, 'not-reported': 0 }
  let rowCount = 0
  const seen = new Map()

  for (const { record, line } of disciplineCsvRecords(text)) {
    if (!header) {
      const candidate = record.map(cleanHeader)
      if (!required.every((name) => candidate.includes(name))) continue
      if (candidate.length !== required.length || required.some((name) => candidate.filter((cell) => cell === name).length !== 1)) {
        throw new Error(`${year} ${level}: CSV header must contain each expected column exactly once and no extras`)
      }
      header = candidate
      at = Object.fromEntries(required.map((name) => [name, header.indexOf(name)]))
      continue
    }

    const candidate = record.map(cleanHeader)
    if (required.every((name) => candidate.includes(name))) {
      throw new Error(`${year} ${level}: CSV contains more than one matching header row`)
    }
    if (record.every((cell) => clean(cell) === '') || isFooter(record)) continue
    if (record.length !== header.length) {
      throw new Error(`${year} ${level}: CSV row ${line} has ${record.length} columns; header has ${header.length}`)
    }

    const row = rowFromRecord(record, at, { year, level }, line)
    const key = `${row.id}\u001f${row.section}\u001f${row.heading}\u001f${row.measure}`
    const prior = seen.get(key)
    if (prior) {
      if (
        prior.count !== row.count ||
        prior.status !== row.status ||
        prior.mask !== row.mask ||
        prior.name !== row.name ||
        prior.districtName !== row.districtName
      ) {
        throw new Error(`${year} ${level}: conflicting duplicate discipline row for ${row.id}, ${row.section}, ${row.heading}, ${row.measure}`)
      }
      continue
    }
    seen.set(key, row)
    rowCount++
    entities.add(row.id)
    dimensions.add(`${row.section}\u001f${row.heading}\u001f${row.measure}`)
    measures[row.measure]++
    statuses[row.status]++
    if (collect && filter(row)) rows.push(row)
  }

  if (!header) throw new Error(`${year} ${level}: CSV header is missing ${required.join(', ')}`)
  if (rowCount === 0) throw new Error(`${year} ${level}: report contains no data rows`)

  return {
    rows,
    stats: {
      rows: rowCount,
      entities: entities.size,
      measures,
      statuses,
      dimensions: dimensions.size,
      dimensionsSha256: sha256([...dimensions].sort().join('\n')),
      header,
    },
  }
}

/** Canonicalizes all unique source rows without calculating any rates. */
export function parseDisciplineReport(text, { year, level }, options = {}) {
  return scanDisciplineReport(text, { year, level }, { ...options, collect: true }).rows
}

/** Scans a report for provenance/coverage without retaining hundreds of thousands of row objects. */
export function inspectDisciplineReport(text, { year, level }) {
  return scanDisciplineReport(text, { year, level }, { collect: false }).stats
}

function validateCoverage(stats, source) {
  if (stats.entities < source.minEntities) {
    throw new Error(`${source.key}: got ${stats.entities} entities, below completeness floor ${source.minEntities}`)
  }
  for (const measure of ['students', 'actions', 'incidents']) {
    if (!Number.isInteger(stats.measures[measure]) || stats.measures[measure] === 0) {
      throw new Error(`${source.key}: report contains no ${measure} rows`)
    }
  }
}

export function disciplineRequest(source) {
  const canonical = SOURCE_BY_KEY.get(source?.key)
  if (!canonical) throw new Error(`unknown discipline source ${source?.key ?? '—'}`)
  return {
    method: 'GET',
    url: DISCIPLINE_BROKER_URL,
    query: {
      _service: 'marykay',
      _program: 'adhoc.download_static_summary.sas',
      district: '',
      agg_level: canonical.aggregation,
      referrer: canonical.referrer,
      test_flag: '',
      _debug: '0',
      school_yr: canonical.schoolYear,
      report_type: 'csv',
      [canonical.submit]: 'Next',
    },
  }
}

export function disciplineSnapshotDir(date, root = DISCIPLINE_ROOT) {
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) throw new TypeError('snapshot date must be a valid Date')
  return `${root}/${date.toISOString().slice(0, 10)}`
}

function isSnapshotName(name) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(name)
  if (!match) return false
  const date = new Date(`${name}T00:00:00.000Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === name
}

export function latestDisciplineSnapshot(names, hasManifest = () => true) {
  const dirs = names.filter((name) => isSnapshotName(name) && hasManifest(name)).sort()
  if (dirs.length === 0) {
    throw new Error('no complete discipline snapshot found under data/discipline — run `node src/discipline.js`')
  }
  return dirs[dirs.length - 1]
}

export function buildDisciplineManifest(entries, fetchedAt) {
  const files = {}
  for (const entry of entries) {
    const body = Buffer.isBuffer(entry.body) ? entry.body : Buffer.from(entry.body)
    files[entry.source.key] = {
      file: entry.source.file,
      sha256: sha256(body),
      bytes: body.length,
      rows: entry.stats.rows,
      entities: entry.stats.entities,
      measures: entry.stats.measures,
      statuses: entry.stats.statuses,
      dimensions: entry.stats.dimensions,
      dimensionsSha256: entry.stats.dimensionsSha256,
      header: entry.stats.header,
      year: entry.source.year,
      level: entry.source.level,
      request: disciplineRequest(entry.source),
      etag: entry.etag ?? null,
      lastModified: entry.lastModified ?? null,
    }
  }
  return {
    schemaVersion: 1,
    fetchedAt,
    source: DISCIPLINE_LANDING_URL,
    download: DISCIPLINE_DOWNLOAD_URL,
    definitions: DISCIPLINE_DEFINITIONS_URL,
    caveat:
      'TEA consolidated Discipline Action Group reports into Discipline Reports in 2024-25; compare stable section/heading/measure keys and do not infer absent rows as zero.',
    files,
  }
}

async function fetchDisciplineSource(source, fetchImpl) {
  const request = disciplineRequest(source)
  const url = new URL(request.url)
  for (const [key, value] of Object.entries(request.query)) url.searchParams.set(key, value)
  const response = await fetchImpl(url, {
    method: request.method,
    headers: {
      Accept: 'text/csv,*/*;q=0.8',
      'User-Agent': 'txschools.net discipline fetch (+https://txschools.net/about)',
    },
  })
  if (!response.ok) throw new Error(`${source.key}: HTTP ${response.status} from ${request.url}`)

  const body = Buffer.from(await response.arrayBuffer())
  let stats
  try {
    stats = inspectDisciplineReport(body.toString('utf8'), source)
    validateCoverage(stats, source)
  } catch (err) {
    throw new Error(`${source.key}: ${err.message}`)
  }
  return {
    source,
    body,
    stats,
    etag: response.headers?.get?.('etag') ?? null,
    lastModified: response.headers?.get?.('last-modified') ?? null,
  }
}

/** Fetches all ten statewide reports; manifest.json is written only after all pass validation. */
export async function fetchDiscipline({
  date = new Date(),
  root = DISCIPLINE_ROOT,
  fetchImpl = fetch,
  log = console.log,
} = {}) {
  const dir = disciplineSnapshotDir(date, root)
  await mkdir(dir, { recursive: true })
  await rm(`${dir}/manifest.json`, { force: true })

  const entries = []
  for (const source of DISCIPLINE_SOURCES) {
    const entry = await fetchDisciplineSource(source, fetchImpl)
    await writeFile(`${dir}/${source.file}`, gzipSync(entry.body, { level: 9 }))
    entries.push(entry)
    log(
      `  ${source.key.padEnd(24)} ${String(entry.stats.entities).padStart(6)} entities  ${String(entry.stats.rows).padStart(7)} rows`
    )
  }

  const manifest = buildDisciplineManifest(entries, date.toISOString())
  await writeFile(`${dir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`)
  log(`\nWrote ${entries.length} discipline reports to ${dir}`)
  return { dir, manifest }
}

/**
 * Loads all canonical rows. Callers may pass a filter to keep memory bounded,
 * for example section B headline rows, while every raw report is still fully
 * scanned and coverage-checked before filtered rows are accepted.
 */
export async function loadDisciplineRows(dir, { filter = () => true } = {}) {
  if (typeof filter !== 'function') throw new TypeError('discipline row filter must be a function')
  const rows = []
  const seen = new Map()

  for (const source of DISCIPLINE_SOURCES) {
    let text
    try {
      text = gunzipSync(await readFile(`${dir}/${source.file}`)).toString('utf8')
    } catch (err) {
      throw new Error(`${dir}/${source.file}: ${err.message}`)
    }
    const scanned = scanDisciplineReport(text, source, { collect: true, filter })
    validateCoverage(scanned.stats, source)
    for (const row of scanned.rows) {
      const key = `${row.level}:${row.id}:${row.year}:${row.section}:${row.heading}:${row.measure}`
      const encoded = JSON.stringify(row)
      if (seen.has(key) && seen.get(key) !== encoded) {
        throw new Error(`${dir}: conflicting duplicate ${key}`)
      }
      if (!seen.has(key)) {
        seen.set(key, encoded)
        rows.push(row)
      }
    }
  }
  return rows.sort(
    (a, b) =>
      a.year.localeCompare(b.year) ||
      a.level.localeCompare(b.level) ||
      a.id.localeCompare(b.id) ||
      a.section.localeCompare(b.section) ||
      a.heading.localeCompare(b.heading) ||
      a.measure.localeCompare(b.measure)
  )
}

function sameObject(actual, expected) {
  if (!actual || typeof actual !== 'object') return false
  const a = Object.keys(actual).sort()
  const e = Object.keys(expected).sort()
  return a.length === e.length && e.every((key, index) => a[index] === key && actual[key] === expected[key])
}

function sameRequest(actual, expected) {
  return actual?.method === expected.method && actual?.url === expected.url && sameObject(actual?.query, expected.query)
}

export async function verifyDisciplineSnapshot(dir) {
  const manifestPath = `${dir}/manifest.json`
  if (!existsSync(manifestPath)) {
    return { dir, checked: 0, problems: [`${dir}: no manifest.json — snapshot is incomplete`] }
  }

  let manifest
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch (err) {
    return { dir, checked: 0, problems: [`${manifestPath}: ${err.message}`] }
  }

  const problems = []
  if (manifest.schemaVersion !== 1) problems.push(`${manifestPath}: schemaVersion is not 1`)
  if (typeof manifest.fetchedAt !== 'string' || Number.isNaN(Date.parse(manifest.fetchedAt))) {
    problems.push(`${manifestPath}: fetchedAt is not a valid timestamp`)
  }
  if (manifest.source !== DISCIPLINE_LANDING_URL) problems.push(`${manifestPath}: unexpected source URL`)
  if (manifest.download !== DISCIPLINE_DOWNLOAD_URL) problems.push(`${manifestPath}: unexpected download URL`)
  if (manifest.definitions !== DISCIPLINE_DEFINITIONS_URL) problems.push(`${manifestPath}: unexpected definitions URL`)

  const described = Object.keys(manifest.files ?? {})
  if (described.length === 0) {
    return { dir, checked: 0, problems: [`${manifestPath}: no files described`], fetchedAt: manifest.fetchedAt ?? null }
  }
  for (const source of DISCIPLINE_SOURCES) {
    if (!described.includes(source.key)) problems.push(`${dir}: manifest does not describe ${source.key}`)
  }
  for (const key of described) {
    if (!SOURCE_BY_KEY.has(key)) problems.push(`${dir}: manifest describes unexpected source ${key}`)
  }

  let onDisk = []
  try {
    onDisk = (await readdir(dir)).filter((name) => name.endsWith('.csv.gz'))
  } catch (err) {
    return { dir, checked: 0, problems: [`${dir}: ${err.message}`], fetchedAt: manifest.fetchedAt ?? null }
  }
  const expectedFiles = new Set(DISCIPLINE_SOURCES.map((source) => source.file))
  for (const file of onDisk) {
    if (!expectedFiles.has(file)) problems.push(`${dir}: ${file} is not an expected discipline report`)
  }

  let checked = 0
  for (const source of DISCIPLINE_SOURCES) {
    const expected = manifest.files?.[source.key]
    if (!expected) continue
    const path = `${dir}/${source.file}`
    if (expected.file !== source.file) problems.push(`${source.key}: manifest file is ${expected.file}, expected ${source.file}`)
    if (expected.year !== source.year) problems.push(`${source.key}: manifest year is ${expected.year}, expected ${source.year}`)
    if (expected.level !== source.level) problems.push(`${source.key}: manifest level is ${expected.level}, expected ${source.level}`)
    if (!Number.isInteger(expected.rows) || expected.rows < 0) problems.push(`${source.key}: manifest rows is invalid`)
    if (!Number.isInteger(expected.entities) || expected.entities < 0) problems.push(`${source.key}: manifest entities is invalid`)
    if (!Number.isInteger(expected.bytes) || expected.bytes < 0) problems.push(`${source.key}: manifest bytes is invalid`)
    if (!/^[a-f0-9]{64}$/.test(String(expected.sha256))) problems.push(`${source.key}: manifest sha256 is invalid`)
    if (!/^[a-f0-9]{64}$/.test(String(expected.dimensionsSha256))) {
      problems.push(`${source.key}: manifest dimensionsSha256 is invalid`)
    }
    if (!sameRequest(expected.request, disciplineRequest(source))) {
      problems.push(`${source.key}: request provenance does not match the official TEA broker request`)
    }
    if (!existsSync(path)) {
      problems.push(`${path}: described in manifest but missing from disk`)
      continue
    }

    let body
    try {
      body = gunzipSync(await readFile(path))
    } catch (err) {
      problems.push(`${path}: cannot gunzip (${err.message})`)
      continue
    }
    checked++
    const actualSha = sha256(body)
    if (actualSha !== expected.sha256) {
      problems.push(`${source.key}: sha256 ${actualSha.slice(0, 12)}… != manifest ${String(expected.sha256).slice(0, 12)}…`)
    }
    if (body.length !== expected.bytes) problems.push(`${source.key}: ${body.length} bytes != manifest ${expected.bytes}`)

    try {
      const stats = inspectDisciplineReport(body.toString('utf8'), source)
      for (const field of ['rows', 'entities', 'dimensions', 'dimensionsSha256']) {
        if (stats[field] !== expected[field]) problems.push(`${source.key}: ${field} ${stats[field]} != manifest ${expected[field]}`)
      }
      for (const measure of ['students', 'actions', 'incidents']) {
        if (stats.measures[measure] !== expected.measures?.[measure]) {
          problems.push(`${source.key}: ${measure} rows ${stats.measures[measure]} != manifest ${expected.measures?.[measure]}`)
        }
      }
      for (const status of ['reported', 'suppressed', 'not-reported']) {
        if (stats.statuses[status] !== expected.statuses?.[status]) {
          problems.push(`${source.key}: ${status} rows ${stats.statuses[status]} != manifest ${expected.statuses?.[status]}`)
        }
      }
      if (JSON.stringify(stats.header) !== JSON.stringify(expected.header)) {
        problems.push(`${source.key}: parsed header does not match manifest`)
      }
      try {
        validateCoverage(stats, source)
      } catch (err) {
        problems.push(err.message)
      }
    } catch (err) {
      problems.push(`${source.key}: ${err.message}`)
    }
  }

  return { dir, checked, problems, fetchedAt: manifest.fetchedAt ?? null }
}

if (import.meta.url === `file://${process.argv[1]}`) await fetchDiscipline()
