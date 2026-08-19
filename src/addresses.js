// Builds the address finder's local autocomplete dictionary from Census
// TIGER/Line ADDRFEAT files.
//
// This is deliberately a MANUAL snapshot step, like src/boundaries.js. The
// normal site build is offline: it reads the compact gzip shards committed in
// data/addresses/ and publishes them as ordinary same-origin JSON. A visitor's
// typed street therefore never goes to a commercial autocomplete service (or
// into a txschools.net URL), and keeping the feature working costs $0.
//
// ADDRFEAT contains street-address ranges, not a registry of occupied homes.
// The client uses those ranges only to suggest a plausible complete address;
// the existing Census geocoder remains the authority that matches the address
// to a school-district geography after an explicit submit.

import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync, gzipSync } from 'node:zlib'
import { promisify } from 'node:util'

const run = promisify(execFile)

export const ADDRESS_SOURCE_YEAR = '2025'
export const ADDRESS_SOURCE_URL = `https://www2.census.gov/geo/tiger/TIGER${ADDRESS_SOURCE_YEAR}/ADDRFEAT/`
export const ADDRESS_ARCHIVE_DIR = 'data/addresses'
export const ADDRESS_MANIFEST = `${ADDRESS_ARCHIVE_DIR}/manifest.json`
export const ADDRESS_PUBLIC_DIR = 'site/data/address-streets'

const EXPECTED_TEXAS_COUNTIES = 254
const REQUIRED_FIELDS = ['FULLNAME', 'LFROMHN', 'LTOHN', 'RFROMHN', 'RTOHN', 'ZIPL', 'ZIPR']
const UA = 'txschools.net address-index refresh (+https://txschools.net/about)'

const sha256 = (value) => createHash('sha256').update(value).digest('hex')

/** Must stay byte-for-byte equivalent to addressClientJs's normalizeStreet. */
export function normalizeStreet(value) {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim()
}

export function addressStreetShardKey(value) {
  const key = normalizeStreet(value).charAt(0)
  return /^[a-z0-9]$/.test(key) ? key : null
}

const cleanText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()
const validZip = (value) => /^\d{5}$/.test(String(value ?? '').trim())

function houseNumber(value) {
  const match = String(value ?? '').match(/\d+/)
  if (!match) return null
  const n = Number(match[0])
  return Number.isSafeInteger(n) && n >= 0 ? n : null
}

/**
 * Read the character fields needed from a dBASE file without adding a
 * shapefile dependency. TIGER DBFs are fixed-width and ASCII-compatible; the
 * geometry files in each archive are intentionally never extracted.
 */
export function parseAddressDbf(buffer) {
  const body = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? [])
  if (body.length < 33) throw new Error('ADDRFEAT DBF is too small')

  const recordCount = body.readUInt32LE(4)
  const headerBytes = body.readUInt16LE(8)
  const recordBytes = body.readUInt16LE(10)
  if (headerBytes < 33 || recordBytes < 2 || headerBytes > body.length) {
    throw new Error('ADDRFEAT DBF has an invalid header')
  }
  if (headerBytes + recordCount * recordBytes > body.length) {
    throw new Error('ADDRFEAT DBF is truncated')
  }

  const fields = []
  let position = 1 // record byte zero is the deletion marker
  for (let offset = 32; offset + 32 <= headerBytes && body[offset] !== 0x0d; offset += 32) {
    const name = body.subarray(offset, offset + 11).toString('ascii').replace(/\0.*$/, '')
    const length = body[offset + 16]
    if (!name || length < 1) throw new Error('ADDRFEAT DBF has an invalid field descriptor')
    fields.push({ name, length, position })
    position += length
  }
  if (position > recordBytes) throw new Error('ADDRFEAT DBF fields exceed its record width')

  const selected = fields.filter((field) => REQUIRED_FIELDS.includes(field.name))
  for (const name of REQUIRED_FIELDS) {
    if (!selected.some((field) => field.name === name)) throw new Error(`ADDRFEAT DBF is missing ${name}`)
  }

  const rows = []
  for (let index = 0; index < recordCount; index += 1) {
    const start = headerBytes + index * recordBytes
    if (body[start] === 0x2a) continue // deleted row
    const row = {}
    for (const field of selected) {
      row[field.name] = body.subarray(
        start + field.position,
        start + field.position + field.length,
      ).toString('latin1').trim()
    }
    rows.push(row)
  }
  return rows
}

function mergeSide(records, source, side) {
  const street = cleanText(source.FULLNAME)
  const normalized = normalizeStreet(street)
  const shard = addressStreetShardKey(normalized)
  const zip = cleanText(source[`ZIP${side}`])
  if (!street || street.length > 100 || !normalized || !shard || !validZip(zip)) return

  const from = houseNumber(source[`${side}FROMHN`])
  const to = houseNumber(source[`${side}TOHN`])
  const low = from === null && to === null ? null : Math.min(from ?? to, to ?? from)
  const high = from === null && to === null ? null : Math.max(from ?? to, to ?? from)
  const key = `${normalized}\u0000${zip}`
  const current = records.get(key)
  if (current) {
    current.count += 1
    if (low !== null) current.min = current.min === null ? low : Math.min(current.min, low)
    if (high !== null) current.max = current.max === null ? high : Math.max(current.max, high)
    return
  }
  records.set(key, { street, normalized, shard, zip, min: low, max: high, count: 1 })
}

/** Merge one county DBF into the statewide street+ZIP dictionary. */
export function addAddressDbf(records, dbf) {
  for (const row of parseAddressDbf(dbf)) {
    mergeSide(records, row, 'L')
    // Do not double-count a segment whose two sides publish the same range and
    // ZIP. Count is only a stable popularity tie-breaker, not a public metric.
    const same = row.ZIPL === row.ZIPR && row.LFROMHN === row.RFROMHN && row.LTOHN === row.RTOHN
    if (!same) mergeSide(records, row, 'R')
  }
  return records
}

/** Most common TEA postal-community label per ZIP, used only for readable UI. */
export function zipCities(rows = []) {
  const counts = new Map()
  for (const row of rows) {
    const zip = cleanText(row?.zip_5 ?? row?.zip)
    const city = cleanText(row?.city)
    if (!validZip(zip) || !city || city.length > 80) continue
    if (!counts.has(zip)) counts.set(zip, new Map())
    const byCity = counts.get(zip)
    byCity.set(city, (byCity.get(city) ?? 0) + 1)
  }
  const result = new Map()
  for (const [zip, byCity] of counts) {
    const winner = [...byCity].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
    if (winner) result.set(zip, winner[0])
  }
  return result
}

export function addressStreetShards(records, cities = new Map()) {
  const shards = new Map()
  for (const record of records.values()) {
    if (!shards.has(record.shard)) shards.set(record.shard, [])
    shards.get(record.shard).push([
      record.street,
      record.zip,
      cities.get(record.zip) ?? null,
      record.min,
      record.max,
      record.count,
    ])
  }
  for (const rows of shards.values()) {
    rows.sort((a, b) => normalizeStreet(a[0]).localeCompare(normalizeStreet(b[0])) ||
      a[1].localeCompare(b[1]) || String(a[2] ?? '').localeCompare(String(b[2] ?? '')))
  }
  return shards
}

async function latestTeaRows(root = 'data/raw') {
  let names = []
  try { names = await readdir(root) } catch { return { snapshot: null, rows: [] } }
  const snapshots = names.filter((name) => /^\d{4}-\d{2}$/.test(name)).sort().reverse()
  for (const snapshot of snapshots) {
    try {
      const files = await Promise.all(['schools', 'districts'].map(async (name) => {
        const gz = await readFile(`${root}/${snapshot}/${name}.json.gz`)
        const parsed = JSON.parse(gunzipSync(gz).toString('utf8'))
        return Array.isArray(parsed) ? parsed : []
      }))
      return { snapshot, rows: files.flat() }
    } catch {
      // A partially written snapshot is not a city source; try the previous one.
    }
  }
  return { snapshot: null, rows: [] }
}

async function fetchBuffer(url) {
  const response = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' } })
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

async function dbfFromZip(path) {
  const { stdout } = await run('unzip', ['-p', path, '*.dbf'], {
    encoding: 'buffer',
    maxBuffer: 256 * 1024 * 1024,
  })
  return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)
}

/** Manual network refresh; normal builds never call this. */
export async function fetchAddressStreets({
  sourceUrl = ADDRESS_SOURCE_URL,
  outputDir = ADDRESS_ARCHIVE_DIR,
  concurrency = 8,
  log = console.log,
} = {}) {
  const listing = (await fetchBuffer(sourceUrl)).toString('utf8')
  const archivePattern = new RegExp(`tl_${ADDRESS_SOURCE_YEAR}_48\\d{3}_addrfeat\\.zip`, 'g')
  const archives = [...new Set(listing.match(archivePattern) ?? [])].sort()
  if (archives.length !== EXPECTED_TEXAS_COUNTIES) {
    throw new Error(`Census listed ${archives.length} Texas ADDRFEAT archives; expected ${EXPECTED_TEXAS_COUNTIES}`)
  }

  const temp = await mkdtemp(join(tmpdir(), 'txschools-addresses-'))
  const records = new Map()
  const sources = new Array(archives.length)
  let cursor = 0
  let finished = 0
  try {
    const worker = async () => {
      while (true) {
        const index = cursor
        cursor += 1
        if (index >= archives.length) return
        const file = archives[index]
        const bytes = await fetchBuffer(new URL(file, sourceUrl).href)
        const zipPath = join(temp, file)
        await writeFile(zipPath, bytes)
        addAddressDbf(records, await dbfFromZip(zipPath))
        sources[index] = { file, bytes: bytes.length, sha256: sha256(bytes) }
        finished += 1
        if (finished % 25 === 0 || finished === archives.length) {
          log(`  ${finished}/${archives.length} counties; ${records.size.toLocaleString('en-US')} street/ZIP pairs`)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, Math.min(16, concurrency)) }, worker))
  } finally {
    await rm(temp, { recursive: true, force: true })
  }

  const tea = await latestTeaRows()
  const cities = zipCities(tea.rows)
  const shards = addressStreetShards(records, cities)
  const staged = await mkdtemp(join(tmpdir(), 'txschools-address-shards-'))
  const manifestShards = {}
  let outputBytes = 0
  let outputRows = 0
  for (const [key, rows] of [...shards].sort(([a], [b]) => a.localeCompare(b))) {
    const json = JSON.stringify({ v: 1, year: Number(ADDRESS_SOURCE_YEAR), rows })
    const gz = gzipSync(Buffer.from(json), { level: 9 })
    const file = `${key}.json.gz`
    await writeFile(join(staged, file), gz)
    manifestShards[key] = {
      file,
      rows: rows.length,
      bytes: gz.length,
      uncompressedBytes: Buffer.byteLength(json),
      sha256: sha256(gz),
    }
    outputBytes += gz.length
    outputRows += rows.length
  }

  const manifest = {
    v: 1,
    fetchedAt: new Date().toISOString(),
    describes: 'Texas street names, ZIPs, and broad address-range hints for same-origin autocomplete',
    source: sourceUrl,
    sourceYear: Number(ADDRESS_SOURCE_YEAR),
    sourceArchives: sources,
    teaCitySnapshot: tea.snapshot,
    counties: archives.length,
    streetZipPairs: outputRows,
    bytes: outputBytes,
    shards: manifestShards,
    note: 'Suggestions are not address validation. Census geocoding after explicit submit determines the district.',
  }
  await writeFile(join(staged, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  await rm(outputDir, { recursive: true, force: true })
  await mkdir(outputDir, { recursive: true })
  for (const name of await readdir(staged)) {
    await writeFile(join(outputDir, name), await readFile(join(staged, name)))
  }
  await rm(staged, { recursive: true, force: true })
  log(`wrote ${shards.size} shards: ${outputRows.toLocaleString('en-US')} rows, ${(outputBytes / 1048576).toFixed(1)} MiB gzip`)
  return manifest
}

/** Publish the committed gzip snapshot as fetchable same-origin JSON. */
export async function publishAddressStreetShards({
  sourceDir = ADDRESS_ARCHIVE_DIR,
  targetDir = ADDRESS_PUBLIC_DIR,
} = {}) {
  const manifest = JSON.parse(await readFile(join(sourceDir, 'manifest.json'), 'utf8'))
  if (manifest?.v !== 1 || !manifest.shards || typeof manifest.shards !== 'object') {
    throw new Error('address street manifest is missing or invalid; run npm run fetch:addresses')
  }
  await rm(targetDir, { recursive: true, force: true })
  await mkdir(targetDir, { recursive: true })
  let bytes = 0
  let rows = 0
  let files = 0
  for (const [key, meta] of Object.entries(manifest.shards).sort(([a], [b]) => a.localeCompare(b))) {
    if (!/^[a-z0-9]$/.test(key) || meta?.file !== `${key}.json.gz`) {
      throw new Error(`invalid address street shard ${key}`)
    }
    const gz = await readFile(join(sourceDir, meta.file))
    if (sha256(gz) !== meta.sha256) throw new Error(`address street shard ${key} failed its checksum`)
    const json = gunzipSync(gz)
    const parsed = JSON.parse(json.toString('utf8'))
    if (parsed?.v !== 1 || !Array.isArray(parsed.rows) || parsed.rows.length !== meta.rows) {
      throw new Error(`address street shard ${key} does not match its manifest`)
    }
    await writeFile(join(targetDir, `${key}.json`), json)
    bytes += json.length
    rows += parsed.rows.length
    files += 1
  }
  return { files, rows, bytes }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fetchAddressStreets().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
