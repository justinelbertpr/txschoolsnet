// Official TEA 2026 accountability summary downloads. These are the bulk
// equivalents of the district/campus SAS report pages and retain every field
// exactly as published, including masking and status flags.

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { gzipSync, gunzipSync } from 'node:zlib'
import { parseCsv } from './enrollment.js'

export const ACCOUNTABILITY_ROOT = 'data/accountability'
export const ACCOUNTABILITY_LANDING_URL = 'https://rptsvr1.tea.texas.gov/perfreport/account/acct_download?year=2026'
export const ACCOUNTABILITY_MASKING_URL = 'https://rptsvr1.tea.texas.gov/perfreport/account/2026/masking.html'
export const ACCOUNTABILITY_BROKER_URL = 'https://rptsvr1.tea.texas.gov/cgi/sas/broker/'
export const ACCOUNTABILITY_KEYS = Object.freeze(['RATE', 'D1', 'D2', 'D3', 'FLAG', 'PE'])
export const ACCOUNTABILITY_MIN_ROWS = Object.freeze({ district: 1100, campus: 8500 })

export const ACCOUNTABILITY_SOURCES = Object.freeze([
  Object.freeze({ key: '2026-district-summary', file: '2026-district-summary.csv.gz', year: 2026, level: 'district', sumlev: 'D', idVariable: 'DISTRICT', nameVariable: 'DISTNAME', ratingVariable: 'D_RATING', minRows: ACCOUNTABILITY_MIN_ROWS.district }),
  Object.freeze({ key: '2026-campus-summary', file: '2026-campus-summary.csv.gz', year: 2026, level: 'campus', sumlev: 'C', idVariable: 'CAMPUS', nameVariable: 'CAMPNAME', ratingVariable: 'C_RATING', minRows: ACCOUNTABILITY_MIN_ROWS.campus }),
])
const SOURCE_BY_KEY = new Map(ACCOUNTABILITY_SOURCES.map((source) => [source.key, source]))
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

export function accountabilityRequest(source) {
  if (!SOURCE_BY_KEY.has(source?.key)) throw new Error(`unknown accountability source ${source?.key ?? source}`)
  return {
    method: 'GET',
    url: ACCOUNTABILITY_BROKER_URL,
    query: {
      _service: 'marykay', _program: 'perfrept.perfmast.sas', _debug: '0', ccyy: String(source.year),
      dsname: 'RATE', sumlev: source.sumlev, key: [...ACCOUNTABILITY_KEYS], datafmt: 'C',
      prgopt: 'reports/acct/dd/dd_get_data.sas',
    },
  }
}

export function accountabilityUrl(source) {
  const request = accountabilityRequest(source)
  const url = new URL(request.url)
  for (const [key, value] of Object.entries(request.query)) {
    for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, item)
  }
  return url.toString()
}

const requiredVariables = (source) => source.level === 'district'
  ? [source.idVariable, source.nameVariable, source.ratingVariable, 'DPETALLC', 'DPETLEPC', 'DPETECOC', 'DPETSPEC']
  : [source.idVariable, source.nameVariable, 'DISTRICT', 'DISTNAME', source.ratingVariable, 'CPETALLC', 'CPETLEPC', 'CPETECOC', 'CPETSPEC']

export function parseAccountabilitySummary(text, source) {
  if (typeof text !== 'string') throw new TypeError('accountability CSV input must be a string')
  if (/^\s*</.test(text)) throw new Error(`${source.key}: TEA response is HTML, not CSV`)
  const records = parseCsv(text).filter((record) => !record.every((cell) => String(cell).trim() === ''))
  if (records.length < 3) throw new Error(`${source.key}: CSV has no data rows`)
  const humanHeaders = records[0].map((value) => String(value).trim())
  const variables = records[1].map((value) => String(value).trim().toUpperCase())
  if (humanHeaders.length !== variables.length) throw new Error(`${source.key}: label and variable header widths differ`)
  if (new Set(variables).size !== variables.length || variables.some((value) => !value)) throw new Error(`${source.key}: variable headers must be nonempty and unique`)
  for (const variable of requiredVariables(source)) {
    if (!variables.includes(variable)) throw new Error(`${source.key}: CSV is missing required variable ${variable}`)
  }
  const idAt = variables.indexOf(source.idVariable)
  const idPattern = source.level === 'district' ? /^\d{6}$/ : /^\d{9}$/
  const rows = []
  const seen = new Map()
  for (let i = 2; i < records.length; i++) {
    const record = records[i]
    if (record.length !== variables.length) throw new Error(`${source.key}: CSV row ${i + 1} has ${record.length} columns; header has ${variables.length}`)
    const id = String(record[idAt]).trim()
    if (!idPattern.test(id)) throw new Error(`${source.key}: CSV row ${i + 1} has invalid ${source.idVariable} ${JSON.stringify(id)}`)
    const values = Object.fromEntries(variables.map((variable, index) => [variable, String(record[index]).trim()]))
    const encoded = JSON.stringify(values)
    if (seen.has(id) && seen.get(id) !== encoded) throw new Error(`${source.key}: conflicting duplicate ${id}`)
    if (!seen.has(id)) { seen.set(id, encoded); rows.push({ id, level: source.level, accountabilityYear: source.year, values }) }
  }
  return { humanHeaders, variables, rows }
}

function validateCoverage(parsed, source) {
  if (parsed.rows.length < source.minRows) throw new Error(`${source.key}: got ${parsed.rows.length} rows, below completeness floor ${source.minRows}`)
}

const retryable = (status) => [429, 500, 502, 503, 504].includes(status)
function retryDelay(response, attempt, random) {
  const retryAfter = response?.headers?.get?.('retry-after')
  if (retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter)) return Number(retryAfter) * 1000
  const base = response?.status === 429 ? 60000 : 5000
  return Math.min(300000, base * 2 ** (attempt - 1)) * (0.8 + random() * 0.4)
}

export async function fetchAccountabilitySource(source, { fetchImpl = fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), random = Math.random } = {}) {
  const url = accountabilityUrl(source)
  let lastError
  for (let attempt = 1; attempt <= 5; attempt++) {
    let response
    try {
      response = await fetchImpl(url, { headers: { Accept: 'text/csv,*/*;q=0.8', 'User-Agent': 'txschools.net accountability fetch (+https://txschools.net/about)' }, signal: AbortSignal.timeout(120000) })
      if (!response.ok) {
        const error = new Error(`${source.key}: HTTP ${response.status} from ${ACCOUNTABILITY_BROKER_URL}`)
        if (!retryable(response.status)) throw error
        lastError = error
      } else {
        const body = Buffer.from(await response.arrayBuffer())
        const parsed = parseAccountabilitySummary(body.toString('utf8'), source)
        validateCoverage(parsed, source)
        return { source, body, parsed, etag: response.headers?.get?.('etag') ?? null, lastModified: response.headers?.get?.('last-modified') ?? null }
      }
    } catch (error) {
      if (response && !retryable(response.status)) throw error
      lastError = error
    }
    if (attempt < 5) await sleep(retryDelay(response, attempt, random))
  }
  throw lastError
}

export function accountabilitySnapshotDir(date, root = ACCOUNTABILITY_ROOT) {
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) throw new TypeError('snapshot date must be a valid Date')
  return `${root}/${date.toISOString().slice(0, 10)}`
}

function isSnapshotName(name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) return false
  const date = new Date(`${name}T00:00:00.000Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === name
}

export function latestAccountabilitySnapshot(names, hasManifest = () => true) {
  const dirs = names.filter((name) => isSnapshotName(name) && hasManifest(name)).sort()
  if (!dirs.length) throw new Error('no complete accountability snapshot found under data/accountability — run `npm run fetch:accountability`')
  return dirs.at(-1)
}

export async function loadAccountabilityRows(dir) {
  const rows = []
  for (const source of ACCOUNTABILITY_SOURCES) {
    const body = gunzipSync(await readFile(`${dir}/${source.file}`)).toString('utf8')
    const parsed = parseAccountabilitySummary(body, source)
    validateCoverage(parsed, source)
    rows.push(...parsed.rows)
  }
  return rows.sort((a, b) => a.level.localeCompare(b.level) || a.id.localeCompare(b.id))
}

// TEA's 2026 download legend distinguishes two FERPA masks from values that
// are simply unavailable. Preserve that distinction in `status`; `raw` keeps
// the exact source token as a second, lossless check.
const datumState = (text) => {
  if (!text) return { value: null, status: 'not-reported', raw: null }
  if (text === '-1' || text === '*') return { value: null, status: 'masked-small', raw: text }
  if (text === '-3' || text === '**') return { value: null, status: 'masked-complementary', raw: text }
  if (/^(?:<\s*\d+|MASKED)$/i.test(text)) return { value: null, status: 'masked', raw: text }
  if (/^(?:-|--|[•·]|N\/?A)$/i.test(text)) return { value: null, status: 'not-available', raw: text }
  return null
}

function numericDatum(raw, { variable, integer = false, percent = false }) {
  const text = String(raw ?? '').trim()
  const state = datumState(text)
  if (state) return state
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(text)) throw new Error(`${variable}: invalid numeric value ${JSON.stringify(text)}`)
  const value = Number(text)
  if (!Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value)) || (percent && value > 100)) {
    throw new Error(`${variable}: out-of-range value ${JSON.stringify(text)}`)
  }
  return { value, status: 'reported', raw: text }
}

function flagDatum(raw, variable) {
  const text = String(raw ?? '').trim().toUpperCase()
  const state = datumState(text)
  if (state) return state
  if (text !== 'Y' && text !== 'N') throw new Error(`${variable}: invalid flag ${JSON.stringify(text)}`)
  return { value: text === 'Y', status: 'reported', raw: text }
}

function categoryDatum(raw, variable, allowed) {
  const text = String(raw ?? '').trim().toUpperCase()
  const state = datumState(text)
  if (state) return state
  if (!allowed.includes(text)) throw new Error(`${variable}: invalid category ${JSON.stringify(text)}`)
  return { value: text.toLowerCase().replace(/\s+/g, '-'), status: 'reported', raw: text }
}

const count = (values, variable) => numericDatum(values[variable], { variable, integer: true })
const percent = (values, variable) => numericDatum(values[variable], { variable, percent: true })

/**
 * The context-only fields present in TEA's bulk summary but absent from the
 * site's original JSON source. Every value carries source state: a reported
 * zero remains zero, while masking and non-reporting remain distinct nulls.
 */
export function normalizeAccountabilityContext(row) {
  if (!row || !['district', 'campus'].includes(row.level)) throw new Error('accountability context: invalid level')
  const v = row.values ?? {}
  const prefix = row.level === 'district' ? 'D' : 'C'
  const required = [
    `${prefix}PETALLC`, `${prefix}PETLEPC`, `${prefix}PETECOC`, `${prefix}PETSPEC`, `${prefix}PE0312C`,
    `${prefix}PETLEPP`, `${prefix}PETSPEP`, `${prefix}PE0312P`, `${prefix}PETECHC`, `${prefix}PETECHP`,
    `${prefix}PETPTEC`, `${prefix}PETPTEP`,
    ...(row.level === 'district'
      ? ['DFLRTF', 'DFLNEWDIST', 'DFLNEWCHARTDIST', 'DFLSUBG']
      : ['CPEMALLC', 'CPEMALLT', 'CPEMALLP', 'CFLCHART', 'CFLEEK', 'CFLNEWCAMP', 'CFLAEC', 'CFLAEATYPE', 'CFLG3NOTNEW', 'CFLDAEP', 'CFLJJ', 'CFLALTED', 'CFLRTF', 'CFLSUBG']),
  ]
  for (const variable of required) {
    if (!Object.hasOwn(v, variable)) throw new Error(`accountability context: missing documented variable ${variable}`)
  }
  const flags = row.level === 'district'
    ? {
        residentialTreatmentFacility: flagDatum(v.DFLRTF, 'DFLRTF'),
        newDistrict: flagDatum(v.DFLNEWDIST, 'DFLNEWDIST'),
        newCharterDistrict: flagDatum(v.DFLNEWCHARTDIST, 'DFLNEWCHARTDIST'),
        adultEducationHighSchoolCharterProgram: flagDatum(v.DFLSUBG, 'DFLSUBG'),
      }
    : {
        charterSchool: flagDatum(v.CFLCHART, 'CFLCHART'),
        earlyEducationOnly: flagDatum(v.CFLEEK, 'CFLEEK'),
        newCampus: flagDatum(v.CFLNEWCAMP, 'CFLNEWCAMP'),
        alternativeEducationCampus: flagDatum(v.CFLAEC, 'CFLAEC'),
        alternativeEducationType: categoryDatum(v.CFLAEATYPE, 'CFLAEATYPE', ['DROPOUT RECOVERY SCHOOL', 'RESIDENTIAL FACILITY']),
        firstYearWithGrade3OrHigherAndNotNew: flagDatum(v.CFLG3NOTNEW, 'CFLG3NOTNEW'),
        disciplinaryAlternativeEducationProgram: flagDatum(v.CFLDAEP, 'CFLDAEP'),
        juvenileJusticeAlternativeEducationProgram: flagDatum(v.CFLJJ, 'CFLJJ'),
        ratedUnderAlternativeEducationProcedures: flagDatum(v.CFLALTED, 'CFLALTED'),
        residentialTreatmentFacility: flagDatum(v.CFLRTF, 'CFLRTF'),
        adultEducationHighSchoolCharterProgram: flagDatum(v.CFLSUBG, 'CFLSUBG'),
      }
  return {
    id: row.id,
    level: row.level,
    year: '2025-26',
    students: {
      all: count(v, `${prefix}PETALLC`),
      emergentBilingual: count(v, `${prefix}PETLEPC`),
      economicallyDisadvantaged: count(v, `${prefix}PETECOC`),
      specialEducation: count(v, `${prefix}PETSPEC`),
      grades3to12: count(v, `${prefix}PE0312C`),
    },
    shares: {
      emergentBilingualPct: percent(v, `${prefix}PETLEPP`),
      specialEducationPct: percent(v, `${prefix}PETSPEP`),
      grades3to12Pct: percent(v, `${prefix}PE0312P`),
    },
    programs: {
      earlyCollegeHighSchool: { count: count(v, `${prefix}PETECHC`), sharePct: percent(v, `${prefix}PETECHP`) },
      pathwaysInTechnologyEarlyCollegeHighSchool: { count: count(v, `${prefix}PETPTEC`), sharePct: percent(v, `${prefix}PETPTEP`) },
    },
    mobility: row.level === 'campus' ? {
      year: '2024-25',
      mobileStudents: count(v, 'CPEMALLC'),
      denominatorStudents: count(v, 'CPEMALLT'),
      ratePct: percent(v, 'CPEMALLP'),
    } : null,
    flags,
  }
}

export async function loadAccountabilityContext(dir) {
  return (await loadAccountabilityRows(dir)).map(normalizeAccountabilityContext)
}

/** Newest complete snapshot, or null before this optional source is fetched. */
export async function latestAccountabilityArchive(root = ACCOUNTABILITY_ROOT) {
  if (!existsSync(root)) return null
  const names = await readdir(root)
  let snapshot
  try { snapshot = latestAccountabilitySnapshot(names, (name) => existsSync(`${root}/${name}/manifest.json`)) }
  catch { return null }
  const dir = `${root}/${snapshot}`
  const manifest = JSON.parse(await readFile(`${dir}/manifest.json`, 'utf8'))
  return { snapshot, dir, manifest }
}

export function buildAccountabilityManifest(entries, fetchedAt) {
  return { schemaVersion: 1, fetchedAt, source: ACCOUNTABILITY_LANDING_URL, masking: ACCOUNTABILITY_MASKING_URL,
    files: Object.fromEntries(entries.map(({ source, body, parsed, etag, lastModified }) => [source.key, {
      file: source.file, sha256: sha256(body), bytes: body.length, rows: parsed.rows.length, year: source.year, level: source.level,
      request: accountabilityRequest(source), humanHeaders: parsed.humanHeaders, variables: parsed.variables, etag: etag ?? null, lastModified: lastModified ?? null,
    }])) }
}

export async function fetchAccountability({ date = new Date(), root = ACCOUNTABILITY_ROOT, fetchImpl = fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), random = Math.random, log = console.log } = {}) {
  const dir = accountabilitySnapshotDir(date, root)
  await mkdir(dir, { recursive: true }); await rm(`${dir}/manifest.json`, { force: true })
  const entries = []
  for (let i = 0; i < ACCOUNTABILITY_SOURCES.length; i++) {
    const entry = await fetchAccountabilitySource(ACCOUNTABILITY_SOURCES[i], { fetchImpl, sleep, random })
    await writeFile(`${dir}/${entry.source.file}`, gzipSync(entry.body, { level: 9 })); entries.push(entry)
    log(`  ${entry.source.key.padEnd(28)} ${String(entry.parsed.rows.length).padStart(6)} rows`)
    if (i + 1 < ACCOUNTABILITY_SOURCES.length) await sleep(10000)
  }
  const manifest = buildAccountabilityManifest(entries, date.toISOString())
  await writeFile(`${dir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`)
  return { dir, manifest }
}

const sameRequest = (a, b) => JSON.stringify(a) === JSON.stringify(b)
export async function verifyAccountabilitySnapshot(dir) {
  const manifestPath = `${dir}/manifest.json`
  if (!existsSync(manifestPath)) return { dir, checked: 0, problems: [`${dir}: no manifest.json — snapshot is incomplete`] }
  let manifest
  try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')) } catch (error) { return { dir, checked: 0, problems: [`${manifestPath}: ${error.message}`] } }
  const problems = []; let checked = 0
  if (manifest.schemaVersion !== 1) problems.push(`${manifestPath}: schemaVersion is not 1`)
  if (manifest.source !== ACCOUNTABILITY_LANDING_URL || manifest.masking !== ACCOUNTABILITY_MASKING_URL) problems.push(`${manifestPath}: unexpected source provenance`)
  const described = Object.keys(manifest.files ?? {})
  for (const source of ACCOUNTABILITY_SOURCES) if (!described.includes(source.key)) problems.push(`${dir}: manifest does not describe ${source.key}`)
  for (const key of described) if (!SOURCE_BY_KEY.has(key)) problems.push(`${dir}: manifest describes unexpected source ${key}`)
  for (const file of (await readdir(dir)).filter((name) => name.endsWith('.csv.gz'))) if (!ACCOUNTABILITY_SOURCES.some((source) => source.file === file)) problems.push(`${dir}: unexpected ${file}`)
  for (const source of ACCOUNTABILITY_SOURCES) {
    const expected = manifest.files?.[source.key]; if (!expected) continue
    if (!sameRequest(expected.request, accountabilityRequest(source))) problems.push(`${source.key}: request provenance does not match official TEA request`)
    const path = `${dir}/${source.file}`; if (!existsSync(path)) { problems.push(`${path}: missing from disk`); continue }
    let body
    try { body = gunzipSync(await readFile(path)) } catch (error) { problems.push(`${path}: cannot gunzip (${error.message})`); continue }
    checked++
    if (sha256(body) !== expected.sha256) problems.push(`${source.key}: sha256 does not match manifest`)
    if (body.length !== expected.bytes) problems.push(`${source.key}: byte count does not match manifest`)
    try { const parsed = parseAccountabilitySummary(body.toString('utf8'), source); validateCoverage(parsed, source); if (parsed.rows.length !== expected.rows) problems.push(`${source.key}: row count does not match manifest`) } catch (error) { problems.push(`${source.key}: ${error.message}`) }
  }
  return { dir, checked, problems, fetchedAt: manifest.fetchedAt ?? null }
}

if (import.meta.url === `file://${process.argv[1]}`) await fetchAccountability()
