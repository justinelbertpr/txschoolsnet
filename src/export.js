import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { readFile, writeFile } from 'node:fs/promises'
import { preferredRatings } from './normalize/ratings.js'
import { resetDir } from './lib/reset-dir.js'

export const contentHash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 8)

const COLUMNS = ['id', 'level', 'name', 'regionId', 'countyId', 'isCharter', 'isAlt',
                 'enrollment', 'score', 'rating']

/** Column-oriented: repeated object keys dominate the payload at 10,230 rows. */
export function buildPayload(entities, ratings, profile) {
  const ecoDis = new Map(profile.map((p) => [p.id, p.ecoDisPct]))

  const cols = Object.fromEntries(COLUMNS.map((c) => [c, entities.map((e) => e[c] ?? null)]))
  cols.ecoDisPct = entities.map((e) => ecoDis.get(e.id) ?? null)

  // One row per entity-year, chosen by METHOD_PRECEDENCE (see ratings.js).
  const defaults = preferredRatings(ratings)

  const years = [...new Set(defaults.map((r) => r.year))].sort().reverse()
  const index = new Map(entities.map((e, i) => [e.id, i]))
  const yearIndex = new Map(years.map((y, i) => [y, i]))

  const scores = entities.map(() => years.map(() => null))
  const grades = entities.map(() => years.map(() => null))
  for (const r of defaults) {
    const i = index.get(r.id)
    const j = yearIndex.get(r.year)
    if (i === undefined || j === undefined) continue
    scores[i][j] = r.score
    grades[i][j] = r.rating
  }

  // The pre-refresh 2021-22 scoring, for the methodology-break overlay.
  const original = {}
  for (const r of ratings.filter((x) => x.method === 'original')) {
    original[r.year] ??= entities.map(() => null)
    const i = index.get(r.id)
    if (i !== undefined) original[r.year][i] = r.score
  }

  return { years, entities: cols, scores, grades, original }
}

const read = async (t) =>
  (await readFile(`build/${t}.ndjson`, 'utf8')).trim().split('\n').map((l) => JSON.parse(l))

export async function exportPayload() {
  const [entities, ratings, profile] = await Promise.all([read('entities'), read('ratings'), read('profile')])
  const text = JSON.stringify(buildPayload(entities, ratings, profile))
  const hash = contentHash(text)
  const file = `payload-${hash}.json`

  // Each run's payload gets a new content hash (payload-<hash>.json), so
  // without clearing the directory first (see resetDir), every prior run's
  // payload file stays on disk beside the new one — regenerated and
  // reachable, but stale and never linked from anywhere. Scoped to
  // site/data only.
  await resetDir('site/data')
  await writeFile(`site/data/${file}`, text)
  await writeFile('build/payload-name.txt', file + '\n')

  const raw = Buffer.byteLength(text)
  const gz = gzipSync(text).length
  console.log(`\n=== MEASUREMENT: payload (design §11) ===`)
  console.log(`  file      ${file}`)
  console.log(`  raw       ${(raw / 1e6).toFixed(2)} MB`)
  console.log(`  gzipped   ${(gz / 1e6).toFixed(2)} MB   <- what the client downloads`)
  console.log(`  budget    4.00 MB raw`)
  if (raw > 4e6) throw new Error(`payload ${(raw / 1e6).toFixed(2)} MB exceeds the 4 MB budget`)
  return { file, raw, gz }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await exportPayload()
}
