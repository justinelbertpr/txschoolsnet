import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { SOURCES, sourceUrl } from './sources.js'
import { decodeBody, validateRows } from './decode.js'

export function snapshotDir(date) {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `data/raw/${y}-${m}`
}

export function buildManifest(entries, fetchedAt) {
  const files = {}
  for (const e of entries) {
    files[e.name] = {
      sha256: createHash('sha256').update(e.text).digest('hex'),
      bytes: Buffer.byteLength(e.text),
      rows: e.rows,
      etag: e.etag ?? null,
      lastModified: e.lastModified ?? null,
    }
  }
  return { fetchedAt, source: 'https://txschools.gov/data', files }
}

// Decoding a non-JSON body (a maintenance page, HTML interstitial, WAF
// challenge served with HTTP 200) is the failure decodeBody can't name —
// it's a pure function with no knowledge of which source it's decoding.
// validateRows already prefixes its own errors with source.name, so only
// the decodeBody call is wrapped here, keeping every failure path naming
// the source exactly once.
export function decodeAndValidate(source, buf) {
  let decoded
  try {
    decoded = decodeBody(buf)
  } catch (err) {
    throw new Error(`${source.name}: ${err.message}`)
  }
  return validateRows(source.name, decoded, source.minRows)
}

async function fetchOne(source) {
  const url = sourceUrl(source.name)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${source.name}: HTTP ${res.status} from ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const rows = decodeAndValidate(source, buf)
  return {
    name: source.name,
    text: JSON.stringify(rows),
    rows: rows.length,
    etag: res.headers.get('etag'),
    lastModified: res.headers.get('last-modified'),
  }
}

/**
 * Deletes dir/manifest.json if present.
 *
 * manifest.json's presence is what latestSnapshot() (build.js) treats as
 * "this snapshot is complete." Calling this before fetchAll's fetch loop
 * means a re-fetch that dies partway through leaves a directory that's
 * correctly detected as incomplete, rather than an existing complete
 * snapshot silently mutating into a mix of new and stale files under a
 * manifest that still describes the old bytes.
 */
export async function invalidateManifest(dir) {
  await rm(`${dir}/manifest.json`, { force: true })
}

export async function fetchAll(date = new Date()) {
  const dir = snapshotDir(date)
  await mkdir(dir, { recursive: true })
  await invalidateManifest(dir)

  const entries = []
  for (const source of SOURCES) {
    const entry = await fetchOne(source)
    await writeFile(`${dir}/${entry.name}.json.gz`, gzipSync(entry.text))
    console.log(`  ${entry.name.padEnd(30)} ${String(entry.rows).padStart(6)} rows`)
    entries.push(entry)
  }

  const manifest = buildManifest(entries, date.toISOString())
  await writeFile(`${dir}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`\nWrote ${entries.length} files to ${dir}`)
  return { dir, manifest }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await fetchAll()
}
