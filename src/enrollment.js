// Official enrollment history from TEA's PEIMS Student Program and Special
// Populations report. The txschools.gov accountability export carries only a
// current enrollment figure; this report is the official October PEIMS
// snapshot and exposes the same "ALL ENROLLMENT" count for districts and
// campuses across years.
//
// The broker responses are archived byte-for-byte (inside gzip) rather than
// rewritten as JSON. That keeps the provenance claim simple: the sha256 in the
// manifest describes exactly what TEA returned, and parseEnrollmentReport is
// the one deterministic normalization step used at fetch, verify, and build
// time.

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { gzipSync, gunzipSync } from 'node:zlib'

export const ENROLLMENT_ROOT = 'data/enrollment'
export const ENROLLMENT_LANDING_URL = 'https://rptsvr1.tea.texas.gov/adhocrpt/adspr.html'
export const ENROLLMENT_DEFINITIONS_URL =
  'https://rptsvr1.tea.texas.gov/adhocrpt/Standard_Reports/About/About_StudentProgram.html'
export const ENROLLMENT_BROKER_URL = 'https://rptsvr1.tea.texas.gov/cgi/sas/broker'

export const ENROLLMENT_YEARS = Object.freeze([
  Object.freeze({ year: '2021-22', schoolYear: '22' }),
  Object.freeze({ year: '2022-23', schoolYear: '23' }),
  Object.freeze({ year: '2023-24', schoolYear: '24' }),
  Object.freeze({ year: '2024-25', schoolYear: '25' }),
  Object.freeze({ year: '2025-26', schoolYear: '26' }),
])

// Floors are deliberately below the observed 2025-26 responses (1,202
// districts and 9,113 campuses), while still making a partial TEA response
// impossible to mistake for a complete snapshot.
export const ENROLLMENT_MIN_ROWS = Object.freeze({ district: 1100, campus: 8500 })

export const ENROLLMENT_SOURCES = Object.freeze(
  ENROLLMENT_YEARS.flatMap(({ year, schoolYear }) =>
    ['district', 'campus'].map((level) =>
      Object.freeze({
        key: `${year}-${level}`,
        file: `${year}-${level}.csv.gz`,
        year,
        schoolYear,
        level,
        report: level === 'district' ? 'StateDistrict' : 'StateCampus',
        minRows: ENROLLMENT_MIN_ROWS[level],
      })
    )
  )
)

const SOURCE_BY_KEY = new Map(ENROLLMENT_SOURCES.map((source) => [source.key, source]))

const sha256 = (value) => createHash('sha256').update(value).digest('hex')

function expectedLongYear(year) {
  const match = /^(\d{4})-(\d{2})$/.exec(year)
  if (!match) throw new Error(`invalid academic year ${JSON.stringify(year)}; expected YYYY-YY`)
  const start = Number(match[1])
  const end = Number(match[2])
  if ((start + 1) % 100 !== end) {
    throw new Error(`invalid academic year ${JSON.stringify(year)}; years must be consecutive`)
  }
  return `${start}-${start + 1}`
}

function expectedIdHeader(level) {
  if (level === 'district') return 'DISTRICT NUMBER'
  if (level === 'campus') return 'CAMPUS NUMBER'
  throw new Error(`invalid enrollment level ${JSON.stringify(level)}; expected district or campus`)
}

const cleanHeader = (value) => String(value).trim().replace(/\s+/g, ' ').toUpperCase()

/**
 * RFC 4180-style CSV parser with explicit failures for malformed quoting.
 *
 * TEA puts six human-readable preamble lines before the quoted CSV header, so
 * a line-splitter is not enough. Quoted commas, escaped quotes, and embedded
 * newlines are all handled here without ever coercing a field to a number —
 * particularly important for zero-padded district and campus identifiers.
 */
export function parseCsv(text) {
  if (typeof text !== 'string') throw new TypeError('CSV input must be a string')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)

  const records = []
  let record = []
  let field = ''
  let state = 'plain'
  let line = 1

  const endField = () => {
    record.push(field)
    field = ''
    state = 'plain'
  }
  const endRecord = () => {
    endField()
    records.push(record)
    record = []
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
        endRecord()
        line++
      } else if (ch === '\r') {
        endRecord()
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
      endRecord()
      line++
    } else if (ch === '\r') {
      endRecord()
      if (text[i + 1] === '\n') i++
      line++
    } else {
      field += ch
    }
  }

  if (state === 'quoted') throw new Error(`CSV line ${line}: unterminated quoted field`)
  if (field.length > 0 || record.length > 0 || state === 'after-quote') endRecord()
  return records
}

function enrollmentValue(raw, rowNumber) {
  const value = String(raw).trim()
  // TEA uses both machine sentinels and human-readable bounds for FERPA
  // suppression. A bound is not a count: never turn "<10" into 0, 9, or a
  // midpoint. It remains missing all the way through the page and downloads.
  if (
    value === '' ||
    value === '-999' ||
    value === '-9999999' ||
    /^(?:N\/?A|NOT AVAILABLE|-|\*)$/i.test(value) ||
    /^<\s*\d+$/.test(value)
  ) return null
  if (/^-\d+$/.test(value)) {
    throw new Error(`CSV row ${rowNumber}: unexpected negative ALL ENROLLMENT ${JSON.stringify(value)}`)
  }
  if (!/^\d+$/.test(value)) {
    throw new Error(`CSV row ${rowNumber}: invalid ALL ENROLLMENT ${JSON.stringify(value)}`)
  }
  const count = Number(value)
  if (!Number.isSafeInteger(count)) {
    throw new Error(`CSV row ${rowNumber}: ALL ENROLLMENT is outside the safe integer range`)
  }
  return count
}

/**
 * Converts one TEA report to canonical rows:
 *   { id: '001902', level: 'district', year: '2021-22', enrollment: 574 }
 *
 * Identical duplicate entity/year rows are collapsed. A duplicate carrying a
 * different count is a hard failure because selecting either value would
 * invent a resolution the source does not provide.
 */
export function parseEnrollmentReport(text, { year, level }) {
  const longYear = expectedLongYear(year)
  const idHeader = expectedIdHeader(level)
  const required = ['YEAR', 'AGGREGATION LEVEL', idHeader, 'ALL ENROLLMENT']
  const records = parseCsv(text)

  const headerCandidates = records
    .map((record, index) => ({ index, header: record.map(cleanHeader) }))
    .filter(({ header }) => required.every((name) => header.includes(name)))

  if (headerCandidates.length === 0) {
    throw new Error(`${year} ${level}: CSV header is missing ${required.join(', ')}`)
  }
  if (headerCandidates.length > 1) {
    throw new Error(`${year} ${level}: CSV contains more than one matching header row`)
  }

  const { index: headerIndex, header } = headerCandidates[0]
  for (const name of required) {
    if (header.filter((cell) => cell === name).length !== 1) {
      throw new Error(`${year} ${level}: CSV header must contain ${name} exactly once`)
    }
  }

  const at = Object.fromEntries(required.map((name) => [name, header.indexOf(name)]))
  const expectedLevel = level.toUpperCase()
  const idLength = level === 'district' ? 6 : 9
  const rows = []
  const seen = new Map()

  for (let i = headerIndex + 1; i < records.length; i++) {
    const record = records[i]
    if (record.every((cell) => String(cell).trim() === '')) continue
    const rowNumber = i + 1

    // TEA appends two plain-English FERPA notes after the CSV data. They are
    // part of the archived response but not table rows. Match their exact
    // opening text rather than skipping every short record; an actually
    // truncated data row must still fail below.
    const footer = record.length === 1 ? String(record[0]).trim() : ''
    if (
      footer.startsWith("'-999' and ranges (e.g. <10 and <20) indicate counts are not available") ||
      footer.startsWith('Masked numbers are typically small although larger numbers may be masked')
    ) continue

    if (record.length !== header.length) {
      throw new Error(
        `${year} ${level}: CSV row ${rowNumber} has ${record.length} columns; header has ${header.length}`
      )
    }

    const reportedYear = String(record[at.YEAR]).trim()
    if (reportedYear !== longYear) {
      throw new Error(
        `${year} ${level}: CSV row ${rowNumber} reports year ${JSON.stringify(reportedYear)}, expected ${longYear}`
      )
    }

    const reportedLevel = cleanHeader(record[at['AGGREGATION LEVEL']])
    if (reportedLevel !== expectedLevel) {
      throw new Error(
        `${year} ${level}: CSV row ${rowNumber} has aggregation level ${JSON.stringify(reportedLevel)}, expected ${expectedLevel}`
      )
    }

    const id = String(record[at[idHeader]]).trim()
    if (!new RegExp(`^\\d{${idLength}}$`).test(id)) {
      throw new Error(
        `${year} ${level}: CSV row ${rowNumber} has invalid ${idHeader} ${JSON.stringify(id)}; expected ${idLength} digits`
      )
    }

    const enrollment = enrollmentValue(record[at['ALL ENROLLMENT']], rowNumber)
    const key = `${level}:${id}:${year}`
    if (seen.has(key)) {
      const previous = seen.get(key)
      if (previous !== enrollment) {
        throw new Error(
          `${year} ${level}: conflicting duplicate ${id} has ALL ENROLLMENT ${previous ?? 'missing'} and ${enrollment ?? 'missing'}`
        )
      }
      continue
    }

    seen.set(key, enrollment)
    rows.push({ id, level, year, enrollment })
  }

  if (rows.length === 0) throw new Error(`${year} ${level}: report contains no data rows`)
  return rows
}

export function enrollmentRequest(source) {
  const canonical = SOURCE_BY_KEY.get(source?.key)
  if (!canonical) throw new Error(`unknown enrollment source ${source?.key ?? '—'}`)
  return {
    method: 'POST',
    url: ENROLLMENT_BROKER_URL,
    form: {
      _service: 'marykay',
      _program: 'adhoc.std_driver1.sas',
      RptClass: 'StudPgm',
      _debug: '0',
      SchoolYr: canonical.schoolYear,
      report: canonical.report,
      format: 'csv',
    },
  }
}

export function enrollmentSnapshotDir(date, root = ENROLLMENT_ROOT) {
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) throw new TypeError('snapshot date must be a valid Date')
  return `${root}/${date.toISOString().slice(0, 10)}`
}

function isSnapshotName(name) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(name)
  if (!match) return false
  const date = new Date(`${name}T00:00:00.000Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === name
}

/** Picks the newest complete YYYY-MM-DD directory, skipping partial fetches. */
export function latestEnrollmentSnapshot(names, hasManifest = () => true) {
  const dirs = names.filter((name) => isSnapshotName(name) && hasManifest(name)).sort()
  if (dirs.length === 0) {
    throw new Error('no complete enrollment snapshot found under data/enrollment — run `npm run fetch:enrollment`')
  }
  return dirs[dirs.length - 1]
}

function validateCoverage(rows, source) {
  if (rows.length < source.minRows) {
    throw new Error(
      `${source.key}: got ${rows.length} rows, below completeness floor ${source.minRows}`
    )
  }
}

export function buildEnrollmentManifest(entries, fetchedAt) {
  const files = {}
  for (const entry of entries) {
    const body = Buffer.isBuffer(entry.body) ? entry.body : Buffer.from(entry.body)
    files[entry.source.key] = {
      file: entry.source.file,
      sha256: sha256(body),
      bytes: body.length,
      rows: entry.rows,
      year: entry.source.year,
      level: entry.source.level,
      request: enrollmentRequest(entry.source),
      etag: entry.etag ?? null,
      lastModified: entry.lastModified ?? null,
    }
  }
  return {
    schemaVersion: 1,
    fetchedAt,
    source: ENROLLMENT_LANDING_URL,
    definitions: ENROLLMENT_DEFINITIONS_URL,
    files,
  }
}

async function fetchEnrollmentSource(source, fetchImpl) {
  const request = enrollmentRequest(source)
  const response = await fetchImpl(request.url, {
    method: request.method,
    headers: {
      Accept: 'text/csv,*/*;q=0.8',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'txschools.net enrollment fetch (+https://txschools.net/about)',
    },
    body: new URLSearchParams(request.form),
  })
  if (!response.ok) throw new Error(`${source.key}: HTTP ${response.status} from ${request.url}`)

  const body = Buffer.from(await response.arrayBuffer())
  let rows
  try {
    rows = parseEnrollmentReport(body.toString('utf8'), source)
    validateCoverage(rows, source)
  } catch (err) {
    throw new Error(`${source.key}: ${err.message}`)
  }

  return {
    source,
    body,
    rows: rows.length,
    etag: response.headers?.get?.('etag') ?? null,
    lastModified: response.headers?.get?.('last-modified') ?? null,
  }
}

/**
 * Fetches all ten reports and writes manifest.json only after every response
 * has parsed and passed its row floor. A failed or interrupted run therefore
 * leaves a directory latestEnrollmentSnapshot will refuse to select.
 */
export async function fetchEnrollment({
  date = new Date(),
  root = ENROLLMENT_ROOT,
  fetchImpl = fetch,
  log = console.log,
} = {}) {
  const dir = enrollmentSnapshotDir(date, root)
  await mkdir(dir, { recursive: true })
  await rm(`${dir}/manifest.json`, { force: true })

  const entries = []
  for (const source of ENROLLMENT_SOURCES) {
    const entry = await fetchEnrollmentSource(source, fetchImpl)
    await writeFile(`${dir}/${source.file}`, gzipSync(entry.body, { level: 9 }))
    entries.push(entry)
    log(`  ${source.key.padEnd(24)} ${String(entry.rows).padStart(6)} rows`)
  }

  const manifest = buildEnrollmentManifest(entries, date.toISOString())
  await writeFile(`${dir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`)
  log(`\nWrote ${entries.length} enrollment reports to ${dir}`)
  return { dir, manifest }
}

/** Reads and normalizes all ten reports in one complete snapshot directory. */
export async function loadEnrollmentRows(dir) {
  const rows = []
  const seen = new Map()

  for (const source of ENROLLMENT_SOURCES) {
    let text
    try {
      text = gunzipSync(await readFile(`${dir}/${source.file}`)).toString('utf8')
    } catch (err) {
      throw new Error(`${dir}/${source.file}: ${err.message}`)
    }

    const parsed = parseEnrollmentReport(text, source)
    validateCoverage(parsed, source)
    for (const row of parsed) {
      const key = `${row.level}:${row.id}:${row.year}`
      if (seen.has(key) && seen.get(key) !== row.enrollment) {
        throw new Error(
          `${dir}: conflicting duplicate ${key} has ALL ENROLLMENT ${seen.get(key) ?? 'missing'} and ${row.enrollment ?? 'missing'}`
        )
      }
      if (!seen.has(key)) {
        seen.set(key, row.enrollment)
        rows.push(row)
      }
    }
  }

  return rows.sort(
    (a, b) => a.year.localeCompare(b.year) || a.level.localeCompare(b.level) || a.id.localeCompare(b.id)
  )
}

function sameRequest(actual, expected) {
  if (actual?.method !== expected.method || actual?.url !== expected.url) return false
  const a = actual?.form ?? {}
  const e = expected.form
  const aKeys = Object.keys(a).sort()
  const eKeys = Object.keys(e).sort()
  return aKeys.length === eKeys.length && eKeys.every((key, index) => aKeys[index] === key && a[key] === e[key])
}

/**
 * Re-validates one committed snapshot, including raw response hashes, row
 * counts, source/request provenance, the expected ten-file set, and report
 * semantics. It returns every finding rather than throwing at the first one.
 */
export async function verifyEnrollmentSnapshot(dir) {
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
  if (manifest.source !== ENROLLMENT_LANDING_URL) problems.push(`${manifestPath}: unexpected source URL`)
  if (manifest.definitions !== ENROLLMENT_DEFINITIONS_URL) problems.push(`${manifestPath}: unexpected definitions URL`)
  const described = Object.keys(manifest.files ?? {})
  if (described.length === 0) {
    return { dir, checked: 0, problems: [`${manifestPath}: no files described`], fetchedAt: manifest.fetchedAt ?? null }
  }

  for (const source of ENROLLMENT_SOURCES) {
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
  const expectedFiles = new Set(ENROLLMENT_SOURCES.map((source) => source.file))
  for (const file of onDisk) {
    if (!expectedFiles.has(file)) problems.push(`${dir}: ${file} is on disk but is not an expected enrollment report`)
  }

  let checked = 0
  for (const source of ENROLLMENT_SOURCES) {
    const expected = manifest.files?.[source.key]
    if (!expected) continue
    const path = `${dir}/${source.file}`

    if (expected.file !== source.file) problems.push(`${source.key}: manifest file is ${expected.file}, expected ${source.file}`)
    if (expected.year !== source.year) problems.push(`${source.key}: manifest year is ${expected.year}, expected ${source.year}`)
    if (expected.level !== source.level) problems.push(`${source.key}: manifest level is ${expected.level}, expected ${source.level}`)
    if (!Number.isInteger(expected.rows) || expected.rows < 0) problems.push(`${source.key}: manifest rows is invalid`)
    if (!Number.isInteger(expected.bytes) || expected.bytes < 0) problems.push(`${source.key}: manifest bytes is invalid`)
    if (!/^[a-f0-9]{64}$/.test(String(expected.sha256))) problems.push(`${source.key}: manifest sha256 is invalid`)
    if (!sameRequest(expected.request, enrollmentRequest(source))) {
      problems.push(`${source.key}: manifest request provenance does not match the official TEA broker request`)
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
    if (body.length !== expected.bytes) {
      problems.push(`${source.key}: ${body.length} bytes != manifest ${expected.bytes}`)
    }

    try {
      const rows = parseEnrollmentReport(body.toString('utf8'), source)
      if (rows.length !== expected.rows) {
        problems.push(`${source.key}: ${rows.length} rows != manifest ${expected.rows}`)
      }
      try {
        validateCoverage(rows, source)
      } catch (err) {
        problems.push(err.message)
      }
    } catch (err) {
      problems.push(`${source.key}: ${err.message}`)
    }
  }

  return { dir, checked, problems, fetchedAt: manifest.fetchedAt ?? null }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await fetchEnrollment()
}
