import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { mkdir, writeFile } from 'node:fs/promises'
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

async function fetchOne(source) {
  const url = sourceUrl(source.name)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${source.name}: HTTP ${res.status} from ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const rows = validateRows(source.name, decodeBody(buf), source.minRows)
  return {
    name: source.name,
    text: JSON.stringify(rows),
    rows: rows.length,
    etag: res.headers.get('etag'),
    lastModified: res.headers.get('last-modified'),
  }
}

export async function fetchAll(date = new Date()) {
  const dir = snapshotDir(date)
  await mkdir(dir, { recursive: true })

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
