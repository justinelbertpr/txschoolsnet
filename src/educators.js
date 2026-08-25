// Official educator context from the Texas Education Agency's Texas Academic
// Performance Reports (TAPR). TEA publishes teacher turnover at the district
// level, not the campus level. It publishes actual average class size for
// campuses as twelve separate grade/subject measures; this module deliberately
// does not manufacture a single campus-wide average from those values.
//
// Each broker response is archived byte-for-byte inside gzip. The manifest
// records the exact request and the SHA-256 of the uncompressed response, so
// parsing and provenance can be re-verified without contacting TEA.

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { gzipSync, gunzipSync } from 'node:zlib'
import { parseCsv } from './enrollment.js'

export const EDUCATOR_ROOT = 'data/educators'
export const EDUCATOR_BROKER_URL = 'https://rptsvr1.tea.texas.gov/cgi/sas/broker'
export const EDUCATOR_LANDING_URL =
  'https://tea.texas.gov/texas-schools/accountability/academic-accountability/performance-reporting/texas-academic-performance-reports'
export const EDUCATOR_CURRENT_DOWNLOAD_URL =
  'https://rptsvr1.tea.texas.gov/perfreport/tapr/tapr_dd_download.html?year=2025'
export const EDUCATOR_GLOSSARY_URL =
  'https://tea.texas.gov/texas-schools/accountability/academic-accountability/performance-reporting/2024-25-comprehensive-tapr-glossary.pdf'

export const EDUCATOR_YEARS = Object.freeze([
  Object.freeze({ year: '2020-21', endYear: '2021', endpoint: 'legacy' }),
  Object.freeze({ year: '2021-22', endYear: '2022', endpoint: 'legacy' }),
  Object.freeze({ year: '2022-23', endYear: '2023', endpoint: 'legacy' }),
  Object.freeze({ year: '2023-24', endYear: '2024', endpoint: 'current' }),
  Object.freeze({ year: '2024-25', endYear: '2025', endpoint: 'current' }),
])

export const CLASS_SIZE_FIELDS = Object.freeze({
  kindergarten: 'CPCTGKGA',
  grade1: 'CPCTG01A',
  grade2: 'CPCTG02A',
  grade3: 'CPCTG03A',
  grade4: 'CPCTG04A',
  grade5: 'CPCTG05A',
  grade6: 'CPCTG06A',
  secondaryEnglish: 'CPCTENGA',
  secondaryLanguagesOtherThanEnglish: 'CPCTFLAA',
  secondaryMath: 'CPCTMATA',
  secondaryScience: 'CPCTSCIA',
  secondarySocialStudies: 'CPCTSOCA',
})

const CURRENT_CLASS_SIZE_KEY = Object.values(CLASS_SIZE_FIELDS)
  .map((field) => field.slice(2))
  .join('|')

const sourcePage = ({ endYear, endpoint }) =>
  endpoint === 'legacy'
    ? `https://rptsvr1.tea.texas.gov/perfreport/tapr/${endYear}/xplore/DownloadSelData.html`
    : `https://rptsvr1.tea.texas.gov/perfreport/tapr/tapr_dd_download.html?year=${endYear}`

const dictionaryPage = ({ endYear, endpoint }, level) => {
  if (endpoint === 'legacy') {
    const page = level === 'district' ? 'dstaf.html' : 'cstud.html'
    return `https://rptsvr1.tea.texas.gov/perfreport/tapr/${endYear}/xplore/${page}`
  }
  return `https://rptsvr1.tea.texas.gov/cgi/sas/broker?_service=marykay&_program=perfrept.perfmast.sas&_debug=0&ccyy=${endYear}&sumlev=${level === 'district' ? 'D' : 'C'}&dsname=${level === 'district' ? 'STAF' : 'STUD'}&dd=${level === 'district' ? 'staff' : 'student'}&prgopt=reports/tapr/dd/dd_tapr_dictionary.sas`
}

// Floors are below all observed official responses while still rejecting an
// individual district, county, or partial statewide download. "reported"
// means a turnover rate or at least one of the twelve class-size values is
// numeric; alternative and very small campuses legitimately report none.
export const EDUCATOR_MIN_ROWS = Object.freeze({ district: 1000, campus: 8000 })
export const EDUCATOR_MIN_REPORTED_ROWS = Object.freeze({ district: 850, campus: 4500 })

export const EDUCATOR_SOURCES = Object.freeze(
  EDUCATOR_YEARS.flatMap((schoolYear) =>
    [
      {
        ...schoolYear,
        key: `${schoolYear.year}-district-turnover`,
        file: `${schoolYear.year}-district-turnover.csv.gz`,
        level: 'district',
        measure: 'teacher-turnover',
      },
      {
        ...schoolYear,
        key: `${schoolYear.year}-campus-class-size`,
        file: `${schoolYear.year}-campus-class-size.csv.gz`,
        level: 'campus',
        measure: 'class-size',
      },
    ].map((source) =>
      Object.freeze({
        ...source,
        minRows: EDUCATOR_MIN_ROWS[source.level],
        minReportedRows: EDUCATOR_MIN_REPORTED_ROWS[source.level],
        sourcePage: sourcePage(source),
        dictionary: dictionaryPage(source, source.level),
        glossary: `https://rptsvr1.tea.texas.gov/perfreport/tapr/${source.endYear}/glossary.pdf`,
        masking: `https://rptsvr1.tea.texas.gov/perfreport/tapr/${source.endYear}/masking.html`,
      })
    )
  )
)

const SOURCE_BY_KEY = new Map(EDUCATOR_SOURCES.map((source) => [source.key, source]))
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const cleanHeader = (value) => String(value).trim().replace(/^\ufeff/, '').toUpperCase()

function canonicalSource(source) {
  const canonical = SOURCE_BY_KEY.get(source?.key)
  if (canonical) return canonical
  if (source && /^\d{4}-\d{2}$/.test(source.year) && ['district', 'campus'].includes(source.level)) {
    const measure = source.measure ?? (source.level === 'district' ? 'teacher-turnover' : 'class-size')
    return { ...source, measure }
  }
  throw new Error(`unknown educator source ${source?.key ?? '—'}`)
}

function legacyRequest(source) {
  const district = source.level === 'district'
  const dsname = district ? 'DSTAF' : 'CSTUD'
  return {
    method: 'GET',
    url: `${EDUCATOR_BROKER_URL}/${dsname}`,
    query: {
      _service: 'marykay',
      year4: source.endYear,
      year2: source.endYear.slice(-2),
      prgopt: `${source.endYear}/xplore/getdata.sas`,
      _program: 'perfrept.perfmast.sas',
      dsname,
      sumlev: district ? 'D' : 'C',
      _debug: '0',
      format: 'XLS',
      [district ? 'dist0' : 'camp0']: '999999',
      _saveas: dsname,
      datafmt: 'C',
      key: district ? 'MISC ' : 'PCT ',
    },
  }
}

function currentRequest(source) {
  const district = source.level === 'district'
  return {
    method: 'POST',
    url: `${EDUCATOR_BROKER_URL}/`,
    form: {
      _service: 'marykay',
      _program: 'perfrept.perfmast.sas',
      _debug: '0',
      tapr: district ? 'all_d' : 'all_c',
      ccyy: source.endYear,
      dsname: district ? 'STAF' : 'STUD',
      sumlev: district ? 'D' : 'C',
      level: district ? 'District' : 'Campus',
      id: '',
      prgopt: 'reports/tapr/dd/dd_tapr_step_7.sas',
      key: district ? 'STURN' : CURRENT_CLASS_SIZE_KEY,
      datafmt: 'csv',
    },
  }
}

/** Exact public TEA request used for one archived response. */
export function educatorRequest(source) {
  const canonical = canonicalSource(source)
  if (!canonical.endYear || !['legacy', 'current'].includes(canonical.endpoint)) {
    throw new Error(`${canonical.year} ${canonical.level}: endYear and endpoint are required for a request`)
  }
  return canonical.endpoint === 'legacy' ? legacyRequest(canonical) : currentRequest(canonical)
}

function requiredHeaders(source) {
  if (source.level === 'district') return ['DISTRICT', 'DPSTURNR']
  return ['CAMPUS', ...Object.values(CLASS_SIZE_FIELDS)]
}

function reportedValue(raw, { field, rowNumber, max = null }) {
  const value = String(raw).trim()
  // TAPR selected-data files use -1 for small-group masking, -2 for a
  // statistically improbable/out-of-range profile value, and -3 for a
  // complementary masked group. None is a measurement. Newer reports also
  // use the familiar symbols and human-readable missing-value strings.
  if (
    value === '' ||
    value === '.' ||
    value === '-' ||
    value === '•' ||
    value === '*' ||
    value === '-1' ||
    value === '-2' ||
    value === '-3' ||
    value === '-999' ||
    value === '-9999999' ||
    /^(?:N\/?A|NOT AVAILABLE|MASKED)$/i.test(value) ||
    /^<\s*\d+(?:\.\d+)?$/.test(value)
  ) return null
  if (/^-\d/.test(value)) {
    throw new Error(`CSV row ${rowNumber}: unexpected negative ${field} ${JSON.stringify(value)}`)
  }
  if (!/^\d+(?:\.\d+)?$/.test(value)) {
    throw new Error(`CSV row ${rowNumber}: invalid ${field} ${JSON.stringify(value)}`)
  }
  const number = Number(value)
  if (!Number.isFinite(number) || (max !== null && number > max)) {
    throw new Error(`CSV row ${rowNumber}: ${field} ${JSON.stringify(value)} is outside the expected range`)
  }
  return number
}

function entityId(raw, level, rowNumber) {
  const width = level === 'district' ? 6 : 9
  // The legacy TAPR "CSV" protects leading zeroes with a leading apostrophe;
  // current TAPR omits it. Both preserve the official identifier exactly.
  const value = String(raw).trim()
  if (!new RegExp(`^'?\\d{${width}}$`).test(value)) {
    throw new Error(`CSV row ${rowNumber}: invalid ${level} id ${JSON.stringify(value)}; expected ${width} digits`)
  }
  return value.startsWith("'") ? value.slice(1) : value
}

function rowSignature(row) {
  return JSON.stringify(row)
}

/**
 * Parses either a legacy selected-data response or the current TAPR download.
 * Current files have a human-readable header above the variable-code header;
 * the parser finds the unique code header rather than relying on line numbers.
 */
export function parseEducatorReport(text, sourceInput) {
  if (typeof text !== 'string') throw new TypeError('educator CSV input must be a string')
  const source = canonicalSource(sourceInput)
  const required = requiredHeaders(source)
  const records = parseCsv(text)
  const candidates = records
    .map((record, index) => ({ index, header: record.map(cleanHeader) }))
    .filter(({ header }) => required.every((name) => header.includes(name)))

  if (candidates.length === 0) {
    throw new Error(`${source.year} ${source.level}: CSV header is missing ${required.join(', ')}`)
  }
  if (candidates.length > 1) {
    throw new Error(`${source.year} ${source.level}: CSV contains more than one matching header row`)
  }

  const { index: headerIndex, header } = candidates[0]
  for (const name of required) {
    if (header.filter((cell) => cell === name).length !== 1) {
      throw new Error(`${source.year} ${source.level}: CSV header must contain ${name} exactly once`)
    }
  }
  const at = Object.fromEntries(required.map((name) => [name, header.indexOf(name)]))
  const rows = []
  const seen = new Map()

  for (let index = headerIndex + 1; index < records.length; index++) {
    const record = records[index]
    if (record.every((cell) => String(cell).trim() === '')) continue
    const rowNumber = index + 1
    if (record.length !== header.length) {
      throw new Error(
        `${source.year} ${source.level}: CSV row ${rowNumber} has ${record.length} columns; header has ${header.length}`
      )
    }

    const idColumn = source.level === 'district' ? 'DISTRICT' : 'CAMPUS'
    const id = entityId(record[at[idColumn]], source.level, rowNumber)
    let row
    if (source.level === 'district') {
      row = {
        id,
        level: 'district',
        year: source.year,
        teacherTurnoverRate: reportedValue(record[at.DPSTURNR], {
          field: 'teacher turnover rate',
          rowNumber,
          max: 100,
        }),
      }
    } else {
      const classSize = {}
      for (const [name, field] of Object.entries(CLASS_SIZE_FIELDS)) {
        classSize[name] = reportedValue(record[at[field]], {
          field: `${name} average class size`,
          rowNumber,
          max: 1000,
        })
      }
      row = { id, districtId: id.slice(0, 6), level: 'campus', year: source.year, classSize }
    }

    const key = `${row.level}:${row.id}:${row.year}`
    const signature = rowSignature(row)
    if (seen.has(key)) {
      if (seen.get(key) !== signature) {
        throw new Error(`${source.year} ${source.level}: conflicting duplicate ${id}`)
      }
      continue
    }
    seen.set(key, signature)
    rows.push(row)
  }

  if (rows.length === 0) throw new Error(`${source.year} ${source.level}: report contains no data rows`)
  return rows
}

function isReported(row) {
  if (row.level === 'district') return row.teacherTurnoverRate !== null
  return Object.values(row.classSize).some((value) => value !== null)
}

function validateCoverage(rows, source) {
  if (rows.length < source.minRows) {
    throw new Error(`${source.key}: got ${rows.length} rows, below completeness floor ${source.minRows}`)
  }
  const reportedRows = rows.filter(isReported).length
  if (reportedRows < source.minReportedRows) {
    throw new Error(
      `${source.key}: got ${reportedRows} rows with reported data, below completeness floor ${source.minReportedRows}`
    )
  }
  return reportedRows
}

export function educatorSnapshotDir(date, root = EDUCATOR_ROOT) {
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) throw new TypeError('snapshot date must be a valid Date')
  return `${root}/${date.toISOString().slice(0, 10)}`
}

function isSnapshotName(name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) return false
  const date = new Date(`${name}T00:00:00.000Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === name
}

export function latestEducatorSnapshot(names, hasManifest = () => true) {
  const dirs = names.filter((name) => isSnapshotName(name) && hasManifest(name)).sort()
  if (dirs.length === 0) {
    throw new Error('no complete educator snapshot found under data/educators — run the educator fetch')
  }
  return dirs[dirs.length - 1]
}

export function buildEducatorManifest(entries, fetchedAt) {
  const files = {}
  for (const entry of entries) {
    const body = Buffer.isBuffer(entry.body) ? entry.body : Buffer.from(entry.body)
    files[entry.source.key] = {
      file: entry.source.file,
      sha256: sha256(body),
      bytes: body.length,
      rows: entry.rows,
      reportedRows: entry.reportedRows,
      year: entry.source.year,
      level: entry.source.level,
      measure: entry.source.measure,
      sourcePage: entry.source.sourcePage,
      dictionary: entry.source.dictionary,
      glossary: entry.source.glossary,
      masking: entry.source.masking,
      request: educatorRequest(entry.source),
      contentType: entry.contentType ?? null,
      etag: entry.etag ?? null,
      lastModified: entry.lastModified ?? null,
    }
  }
  return {
    schemaVersion: 1,
    fetchedAt,
    source: EDUCATOR_LANDING_URL,
    currentDownload: EDUCATOR_CURRENT_DOWNLOAD_URL,
    glossary: EDUCATOR_GLOSSARY_URL,
    scope: {
      teacherTurnover: 'District only; TEA does not publish this rate on campus profiles.',
      classSize: 'Campus, twelve grade/subject averages; no synthetic campus-wide average.',
    },
    files,
  }
}

async function fetchSource(source, fetchImpl) {
  const request = educatorRequest(source)
  const headers = {
    Accept: 'text/csv,*/*;q=0.8',
    'User-Agent': 'txschools.net educator-data fetch (+https://txschools.net/about)',
  }
  let url = request.url
  let options
  if (request.method === 'GET') {
    url = `${url}?${new URLSearchParams(request.query)}`
    options = { method: 'GET', headers }
  } else {
    options = {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(request.form),
    }
  }
  const response = await fetchImpl(url, options)
  if (!response.ok) throw new Error(`${source.key}: HTTP ${response.status} from ${request.url}`)
  const body = Buffer.from(await response.arrayBuffer())
  let rows
  let reportedRows
  try {
    rows = parseEducatorReport(body.toString('utf8'), source)
    reportedRows = validateCoverage(rows, source)
  } catch (error) {
    throw new Error(`${source.key}: ${error.message}`)
  }
  return {
    source,
    body,
    rows: rows.length,
    reportedRows,
    contentType: response.headers?.get?.('content-type') ?? null,
    etag: response.headers?.get?.('etag') ?? null,
    lastModified: response.headers?.get?.('last-modified') ?? null,
  }
}

/** Fetches all ten reports and writes the manifest only after all validate. */
export async function fetchEducators({
  date = new Date(),
  root = EDUCATOR_ROOT,
  fetchImpl = fetch,
  log = console.log,
} = {}) {
  const dir = educatorSnapshotDir(date, root)
  await mkdir(dir, { recursive: true })
  await rm(`${dir}/manifest.json`, { force: true })

  const entries = []
  for (const source of EDUCATOR_SOURCES) {
    const entry = await fetchSource(source, fetchImpl)
    await writeFile(`${dir}/${source.file}`, gzipSync(entry.body, { level: 9 }))
    entries.push(entry)
    log(
      `  ${source.key.padEnd(35)} ${String(entry.rows).padStart(6)} rows (${entry.reportedRows} reported)`
    )
  }
  const manifest = buildEducatorManifest(entries, date.toISOString())
  await writeFile(`${dir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`)
  log(`\nWrote ${entries.length} educator reports to ${dir}`)
  return { dir, manifest }
}

export async function loadEducatorRows(dir) {
  const rows = []
  const seen = new Map()
  for (const source of EDUCATOR_SOURCES) {
    let body
    try {
      body = gunzipSync(await readFile(`${dir}/${source.file}`))
    } catch (error) {
      throw new Error(`${dir}/${source.file}: ${error.message}`)
    }
    const parsed = parseEducatorReport(body.toString('utf8'), source)
    validateCoverage(parsed, source)
    for (const row of parsed) {
      const key = `${row.level}:${row.id}:${row.year}`
      const signature = rowSignature(row)
      if (seen.has(key) && seen.get(key) !== signature) {
        throw new Error(`${dir}: conflicting duplicate ${key}`)
      }
      if (!seen.has(key)) {
        seen.set(key, signature)
        rows.push(row)
      }
    }
  }
  return rows.sort(
    (a, b) => a.year.localeCompare(b.year) || a.level.localeCompare(b.level) || a.id.localeCompare(b.id)
  )
}

function sameObject(actual, expected) {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false
  const aKeys = Object.keys(actual).sort()
  const eKeys = Object.keys(expected).sort()
  return aKeys.length === eKeys.length && eKeys.every((key, index) => aKeys[index] === key && actual[key] === expected[key])
}

function sameRequest(actual, expected) {
  if (actual?.method !== expected.method || actual?.url !== expected.url) return false
  if (expected.method === 'GET') return sameObject(actual.query, expected.query)
  return sameObject(actual.form, expected.form)
}

/** Re-validates hashes, exact request provenance, schemas, and coverage. */
export async function verifyEducatorSnapshot(dir) {
  const manifestPath = `${dir}/manifest.json`
  if (!existsSync(manifestPath)) {
    return { dir, checked: 0, problems: [`${dir}: no manifest.json — snapshot is incomplete`] }
  }
  let manifest
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch (error) {
    return { dir, checked: 0, problems: [`${manifestPath}: ${error.message}`] }
  }

  const problems = []
  if (manifest.schemaVersion !== 1) problems.push(`${manifestPath}: schemaVersion is not 1`)
  if (typeof manifest.fetchedAt !== 'string' || Number.isNaN(Date.parse(manifest.fetchedAt))) {
    problems.push(`${manifestPath}: fetchedAt is not a valid timestamp`)
  }
  if (manifest.source !== EDUCATOR_LANDING_URL) problems.push(`${manifestPath}: unexpected source URL`)
  if (manifest.currentDownload !== EDUCATOR_CURRENT_DOWNLOAD_URL) {
    problems.push(`${manifestPath}: unexpected current download URL`)
  }
  if (manifest.glossary !== EDUCATOR_GLOSSARY_URL) problems.push(`${manifestPath}: unexpected glossary URL`)

  const described = Object.keys(manifest.files ?? {})
  for (const source of EDUCATOR_SOURCES) {
    if (!described.includes(source.key)) problems.push(`${dir}: manifest does not describe ${source.key}`)
  }
  for (const key of described) {
    if (!SOURCE_BY_KEY.has(key)) problems.push(`${dir}: manifest describes unexpected source ${key}`)
  }

  let onDisk = []
  try {
    onDisk = (await readdir(dir)).filter((name) => name.endsWith('.csv.gz'))
  } catch (error) {
    return { dir, checked: 0, problems: [`${dir}: ${error.message}`], fetchedAt: manifest.fetchedAt ?? null }
  }
  const expectedFiles = new Set(EDUCATOR_SOURCES.map((source) => source.file))
  for (const file of onDisk) {
    if (!expectedFiles.has(file)) problems.push(`${dir}: ${file} is not an expected educator report`)
  }

  let checked = 0
  for (const source of EDUCATOR_SOURCES) {
    const expected = manifest.files?.[source.key]
    if (!expected) continue
    const path = `${dir}/${source.file}`
    if (expected.file !== source.file) problems.push(`${source.key}: unexpected manifest file ${expected.file}`)
    if (expected.year !== source.year) problems.push(`${source.key}: unexpected manifest year ${expected.year}`)
    if (expected.level !== source.level) problems.push(`${source.key}: unexpected manifest level ${expected.level}`)
    if (expected.measure !== source.measure) problems.push(`${source.key}: unexpected manifest measure ${expected.measure}`)
    if (expected.sourcePage !== source.sourcePage) problems.push(`${source.key}: unexpected source page`)
    if (expected.dictionary !== source.dictionary) problems.push(`${source.key}: unexpected dictionary URL`)
    if (expected.glossary !== source.glossary) problems.push(`${source.key}: unexpected glossary URL`)
    if (expected.masking !== source.masking) problems.push(`${source.key}: unexpected masking URL`)
    if (!Number.isInteger(expected.rows) || expected.rows < 0) problems.push(`${source.key}: manifest rows is invalid`)
    if (!Number.isInteger(expected.reportedRows) || expected.reportedRows < 0) {
      problems.push(`${source.key}: manifest reportedRows is invalid`)
    }
    if (!Number.isInteger(expected.bytes) || expected.bytes < 0) problems.push(`${source.key}: manifest bytes is invalid`)
    if (!/^[a-f0-9]{64}$/.test(String(expected.sha256))) problems.push(`${source.key}: manifest sha256 is invalid`)
    if (!sameRequest(expected.request, educatorRequest(source))) {
      problems.push(`${source.key}: request provenance does not match the official TAPR request`)
    }
    if (!existsSync(path)) {
      problems.push(`${path}: described in manifest but missing from disk`)
      continue
    }

    let body
    try {
      body = gunzipSync(await readFile(path))
    } catch (error) {
      problems.push(`${path}: cannot gunzip (${error.message})`)
      continue
    }
    checked++
    const actualSha = sha256(body)
    if (actualSha !== expected.sha256) {
      problems.push(`${source.key}: sha256 ${actualSha.slice(0, 12)}… != manifest ${String(expected.sha256).slice(0, 12)}…`)
    }
    if (body.length !== expected.bytes) problems.push(`${source.key}: ${body.length} bytes != manifest ${expected.bytes}`)

    try {
      const rows = parseEducatorReport(body.toString('utf8'), source)
      if (rows.length !== expected.rows) problems.push(`${source.key}: ${rows.length} rows != manifest ${expected.rows}`)
      const reportedRows = validateCoverage(rows, source)
      if (reportedRows !== expected.reportedRows) {
        problems.push(`${source.key}: ${reportedRows} reported rows != manifest ${expected.reportedRows}`)
      }
    } catch (error) {
      problems.push(`${source.key}: ${error.message}`)
    }
  }
  return { dir, checked, problems, fetchedAt: manifest.fetchedAt ?? null }
}

if (import.meta.url === `file://${process.argv[1]}`) await fetchEducators()
