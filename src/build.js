import { existsSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { toEntities } from './normalize/entities.js'
import { toRatings } from './normalize/ratings.js'
import { toProfile } from './normalize/profile.js'

/**
 * Picks the newest YYYY-MM directory name.
 *
 * `fetchAll` (src/fetch.js) writes each data file as it goes and writes
 * manifest.json LAST, so manifest.json's presence is the only reliable
 * signal that a snapshot finished — a directory can have the right file
 * names and still be a fetch that died partway through. Rather than have
 * this function stat the filesystem itself (which would make it impossible
 * to unit test without touching disk), it takes a `hasManifest` predicate:
 * build() supplies one backed by fs.existsSync, tests supply a fake. A
 * directory the predicate rejects is treated as if it doesn't exist, so a
 * newer-but-partial snapshot is passed over in favor of the newest complete
 * one — or, if none are complete, produces the same "no snapshot" error an
 * empty data/raw would.
 */
export function latestSnapshot(names, hasManifest = () => true) {
  const dirs = names.filter((n) => /^\d{4}-\d{2}$/.test(n) && hasManifest(n)).sort()
  if (dirs.length === 0) throw new Error('no snapshot found under data/raw — run `npm run fetch`')
  return dirs[dirs.length - 1]
}

export function assertIntegrity(entities, tables) {
  const known = new Set(entities.map((e) => e.id))
  for (const [table, rows] of Object.entries(tables)) {
    const orphans = rows.filter((r) => !known.has(r.id))
    if (orphans.length > 0) {
      const sample = [...new Set(orphans.map((o) => o.id))].slice(0, 3).join(', ')
      throw new Error(`${table}: ${orphans.length} orphan rows not in entities (e.g. ${sample})`)
    }
  }
}

export const toNdjson = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')

/**
 * Filters rows down to those whose id is in `knownIds`, reporting how many
 * were dropped. A pure, reusable primitive so every child table can be
 * checked against `entities` the same way, and so "drop rather than crash"
 * is unit-testable without going through the full build().
 */
export function dropOrphans(rows, knownIds) {
  const kept = rows.filter((r) => knownIds.has(r.id))
  return { rows: kept, dropped: rows.length - kept.length }
}

const readSource = async (dir, name) =>
  JSON.parse(gunzipSync(await readFile(`${dir}/${name}.json.gz`)).toString('utf8'))

export async function build() {
  const names = await readdir('data/raw')
  const hasManifest = (name) => existsSync(`data/raw/${name}/manifest.json`)
  const snapshot = latestSnapshot(names, hasManifest)
  const dir = `data/raw/${snapshot}`
  console.log(`Building from ${dir}`)

  const [districts, schools, cot, profileRaw] = await Promise.all([
    readSource(dir, 'districts'),
    readSource(dir, 'schools'),
    readSource(dir, 'change_over_time'),
    readSource(dir, 'profile_tab'),
  ])

  const entities = toEntities(districts, schools)
  const known = new Set(entities.map((e) => e.id))

  // TEA's change_over_time and profile_tab exports both carry rows for the
  // same four campus ids, absent from districts.json/schools.json — TEA
  // publishes historical rating and profile data for these campuses but no
  // current accountability/directory record for them. Observed 2026-08:
  // 221801026, 227901029, 227901054, 227901157. Dropped at the source
  // (rather than crashing the build or weakening assertIntegrity below),
  // with the exact drop count asserted so a future TEA export that changes
  // this gets investigated instead of silently absorbed.
  const ratingsDrop = dropOrphans(toRatings(cot), known)
  if (ratingsDrop.dropped !== 24) {
    throw new Error(
      `ratings: expected to drop exactly 24 orphan rows (the four known campus ids), dropped ${ratingsDrop.dropped} — investigate before proceeding`
    )
  }
  const profileDrop = dropOrphans(toProfile(profileRaw), known)
  if (profileDrop.dropped !== 4) {
    throw new Error(
      `profile: expected to drop exactly 4 orphan rows, dropped ${profileDrop.dropped} — investigate before proceeding`
    )
  }

  const ratings = ratingsDrop.rows
  const profile = profileDrop.rows

  assertIntegrity(entities, { ratings, profile })

  await mkdir('build', { recursive: true })
  const tables = { entities, ratings, profile }
  for (const [name, rows] of Object.entries(tables)) {
    await writeFile(`build/${name}.ndjson`, toNdjson(rows))
    console.log(`  ${name.padEnd(10)} ${String(rows.length).padStart(7)} rows`)
  }
  await writeFile('build/snapshot.txt', snapshot + '\n')
  return tables
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await build()
}
