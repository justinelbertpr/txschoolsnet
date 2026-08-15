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
 * were dropped and the distinct set of ids that were dropped. A pure,
 * reusable primitive so every child table can be checked against `entities`
 * the same way, and so "drop rather than crash" is unit-testable without
 * going through the full build().
 */
export function dropOrphans(rows, knownIds) {
  const kept = []
  const dropped = []
  for (const r of rows) (knownIds.has(r.id) ? kept : dropped).push(r)
  return { rows: kept, dropped: dropped.length, droppedIds: [...new Set(dropped.map((r) => r.id))] }
}

/**
 * Asserts the *set* of dropped orphan ids, not merely a count.
 *
 * `ratings` carries one row per entity-year (see toRatings/explode), so the
 * same handful of orphan ids produces a row count that scales with however
 * many year labels TEA happens to publish this year. A row-count guard tied
 * to today's label count (4 ids x 6 labels = 24) breaks the next time TEA
 * adds a label — not because the orphan ids changed, but because arithmetic
 * did. Asserting the id set instead is invariant to that: the same four ids
 * dropping 24 rows this year and 28 next year both pass, while a genuinely
 * new or missing orphan id — the thing actually worth investigating — still
 * throws, naming exactly which id was unexpected or which went missing.
 */
export function assertOrphanIdSet(table, actualIds, expectedIds) {
  const actual = new Set(actualIds)
  const expected = new Set(expectedIds)
  const unexpected = [...actual].filter((id) => !expected.has(id))
  const missing = [...expected].filter((id) => !actual.has(id))
  if (unexpected.length > 0 || missing.length > 0) {
    const parts = []
    if (unexpected.length > 0) parts.push(`unexpected orphan ids: ${unexpected.join(', ')}`)
    if (missing.length > 0) parts.push(`expected orphan ids no longer dropped: ${missing.join(', ')}`)
    throw new Error(`${table}: orphan id set changed — ${parts.join('; ')} — investigate before proceeding`)
  }
}

// TEA's change_over_time and profile_tab exports both carry rows for these
// four campus ids, absent from districts.json/schools.json — TEA publishes
// historical rating and profile data for these campuses but no current
// accountability/directory record for them. Observed 2026-08.
export const KNOWN_ORPHAN_IDS = ['221801026', '227901029', '227901054', '227901157']

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

  // Rows for known-orphan campus ids are dropped at the source (rather than
  // crashing the build or weakening assertIntegrity below). What's asserted
  // is the *id set*, not a row count — see assertOrphanIdSet for why a count
  // is the wrong invariant for a table exploded across year labels.
  const ratingsDrop = dropOrphans(toRatings(cot), known)
  assertOrphanIdSet('ratings', ratingsDrop.droppedIds, KNOWN_ORPHAN_IDS)

  // profile_tab is one row per entity (toProfile is a plain .map, no
  // explode), so a dropped-row count and a dropped-id-set assertion carry
  // exactly the same information here — there is no year-label multiplier
  // to make a count fragile. A plain count is kept for that reason: it's
  // the simpler assertion and loses nothing over asserting the set.
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
