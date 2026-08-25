// Snapshot integrity for every committed data archive.
//
// WHY THIS EXISTS. A sha256 written only at fetch time proves nothing later: a
// truncated checkout, corrupt object, well-meaning hand edit, or partial merge
// could otherwise build and publish cleanly. `npm run verify` re-derives every
// archive's checks before the site is built and reports all findings together.
//
// STORAGE RULES ARE SOURCE-SPECIFIC. The original accountability fetch does
// not retain HTTP response bytes: src/fetch.js validates each response,
// JSON.stringify's it, stores gzip(that text), and hashes that decompressed
// text. Its verifier below must mirror that exact convention; hashing gzip
// output would be wrong because compression is not byte-stable. Supplemental
// archives retain different combinations of broker bytes, XLSX/PDF inputs and
// normalized rows, so their own source modules validate the matching manifest
// semantics. verifyArchive enumerates snapshots but never substitutes one
// generic hashing rule for those specialized checks.
//
// For accountability, sha256, decompressed byte count and parsed row count are
// checked together. The row count catches a structurally valid file that lost
// records—the partial-publication failure most likely to resemble real data.

import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { SOURCES } from './sources.js'
import { ENROLLMENT_ROOT, verifyEnrollmentSnapshot } from './enrollment.js'
import { ACTION_ROOT, verifyActionSnapshot } from './action-flags.js'
import { COMMUNITY_ROOT, verifyCommunitySnapshot } from './community.js'
import { POSTSECONDARY_ROOT, verifyPostsecondarySnapshot } from './postsecondary.js'
import { TRANSFER_ROOT, verifyTransferSnapshot } from './transfers.js'
import { EDUCATOR_ROOT, verifyEducatorSnapshot } from './educators.js'
import { DISCIPLINE_ROOT, verifyDisciplineSnapshot } from './discipline.js'

export const RAW_DIR = 'data/raw'

/** Mirrors buildManifest (src/fetch.js): hash the decompressed TEXT, not the .gz. */
export const hashText = (text) => createHash('sha256').update(text).digest('hex')

/**
 * Verifies one file against its manifest entry. Returns a list of problems;
 * empty means it verified. Never throws for a data problem — a corrupt file is
 * a finding to report alongside the others, not a reason to stop looking.
 */
export function verifyFile(name, gz, expected) {
  const problems = []

  let text
  try {
    text = gunzipSync(gz).toString('utf8')
  } catch (err) {
    return [`${name}: cannot gunzip (${err.message})`]
  }

  const sha256 = hashText(text)
  if (sha256 !== expected.sha256) {
    problems.push(`${name}: sha256 ${sha256.slice(0, 12)}… != manifest ${String(expected.sha256).slice(0, 12)}…`)
  }

  const bytes = Buffer.byteLength(text)
  if (bytes !== expected.bytes) {
    problems.push(`${name}: ${bytes} bytes != manifest ${expected.bytes}`)
  }

  // Parsed rather than counted with a regex: the row count is the figure the
  // rest of the pipeline reasons about, so it should be read the way the
  // pipeline reads it.
  let rows
  try {
    rows = JSON.parse(text)
  } catch (err) {
    problems.push(`${name}: stored text is not valid JSON (${err.message})`)
    return problems
  }
  if (!Array.isArray(rows)) problems.push(`${name}: stored JSON is ${typeof rows}, expected an array`)
  else if (rows.length !== expected.rows) problems.push(`${name}: ${rows.length} rows != manifest ${expected.rows}`)

  return problems
}

/**
 * Verifies one snapshot directory.
 *
 * Beyond per-file integrity this asserts the manifest and the directory agree
 * in BOTH directions: every source this project knows about is described, and
 * every .json.gz present is described. A file on disk that no manifest entry
 * covers is the shape a half-finished re-fetch leaves behind, and it is exactly
 * the case a per-file loop over the manifest would walk straight past.
 */
export async function verifySnapshot(dir) {
  const problems = []
  const manifestPath = `${dir}/manifest.json`

  if (!existsSync(manifestPath)) {
    // build.js treats a missing manifest as "incomplete snapshot" and skips the
    // directory, so this is a real finding but a different one from corruption.
    return { dir, checked: 0, problems: [`${dir}: no manifest.json — snapshot is incomplete`] }
  }

  let manifest
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch (err) {
    return { dir, checked: 0, problems: [`${dir}/manifest.json: ${err.message}`] }
  }

  const described = Object.keys(manifest.files ?? {})
  if (described.length === 0) return { dir, checked: 0, problems: [`${dir}/manifest.json: no files described`] }

  for (const source of SOURCES) {
    if (!described.includes(source.name)) problems.push(`${dir}: manifest does not describe ${source.name}`)
  }

  const onDisk = (await readdir(dir)).filter((f) => f.endsWith('.json.gz')).map((f) => f.replace(/\.json\.gz$/, ''))
  for (const name of onDisk) {
    if (!described.includes(name)) problems.push(`${dir}: ${name}.json.gz is on disk but not in the manifest`)
  }

  let checked = 0
  for (const [name, expected] of Object.entries(manifest.files)) {
    const path = `${dir}/${name}.json.gz`
    if (!existsSync(path)) {
      problems.push(`${dir}: ${name}.json.gz is in the manifest but missing from disk`)
      continue
    }
    problems.push(...verifyFile(`${dir}/${name}`, await readFile(path), expected))
    checked++
  }

  return { dir, checked, problems, fetchedAt: manifest.fetchedAt ?? null }
}

/** Every snapshot under data/raw, newest last. The whole archive is the claim. */
export async function snapshotDirs(root = RAW_DIR) {
  if (!existsSync(root)) return []
  const names = await readdir(root, { withFileTypes: true })
  return names.filter((d) => d.isDirectory()).map((d) => `${root}/${d.name}`).sort()
}

export async function verifyAll(root = RAW_DIR) {
  const dirs = await snapshotDirs(root)
  if (dirs.length === 0) return { results: [], problems: [`no snapshot found under ${root} — run \`npm run fetch\``] }
  const results = []
  for (const dir of dirs) results.push(await verifySnapshot(dir))
  return { results, problems: results.flatMap((r) => r.problems) }
}

/**
 * Applies one archive's source-specific verifier to every committed snapshot.
 *
 * Supplemental products do not share a storage schema: some manifests hash
 * raw broker response bytes, some hash XLSX/PDF inputs, and some also replay a
 * deterministic normalization. Keeping that knowledge in each source module
 * avoids a dangerous generic "hash the gzip" rule that would be wrong for
 * several archives. This helper only owns complete-archive enumeration and
 * combines all findings so one corrupt source cannot hide another.
 */
export async function verifyArchive(root, { label, refresh, verifySnapshot }) {
  if (typeof verifySnapshot !== 'function') throw new TypeError('verifyArchive requires verifySnapshot')
  const missing = `no ${label} snapshot found under ${root} — ${refresh}`
  if (!existsSync(root)) return { results: [], problems: [missing] }

  let dirs
  try {
    dirs = await snapshotDirs(root)
  } catch (error) {
    return { results: [], problems: [`${root}: ${error.message}`] }
  }
  if (dirs.length === 0) return { results: [], problems: [missing] }

  const results = []
  for (const dir of dirs) {
    try {
      results.push(await verifySnapshot(dir))
    } catch (error) {
      // A source verifier should normally return findings rather than throw,
      // but a damaged directory must not abort checks of the remaining data.
      results.push({ dir, checked: 0, problems: [`${dir}: verification failed (${error.message})`] })
    }
  }
  return { results, problems: results.flatMap((result) => result.problems) }
}

/** The separate PEIMS enrollment archive follows the same manifest-last rule. */
export async function verifyAllEnrollment(root = ENROLLMENT_ROOT) {
  return verifyArchive(root, {
    label: 'enrollment',
    refresh: 'run `npm run fetch:enrollment`',
    verifySnapshot: verifyEnrollmentSnapshot,
  })
}

export async function verifyAllActionFlags(root = ACTION_ROOT) {
  return verifyArchive(root, {
    label: 'action-flags',
    refresh: 'follow the reviewed action-flags refresh procedure in README.md',
    verifySnapshot: verifyActionSnapshot,
  })
}

export async function verifyAllCommunity(root = COMMUNITY_ROOT) {
  return verifyArchive(root, {
    label: 'community',
    refresh: 'run `npm run fetch:community`',
    verifySnapshot: verifyCommunitySnapshot,
  })
}

export async function verifyAllPostsecondary(root = POSTSECONDARY_ROOT) {
  return verifyArchive(root, {
    label: 'postsecondary',
    refresh: 'run `npm run fetch:postsecondary`',
    verifySnapshot: verifyPostsecondarySnapshot,
  })
}

export async function verifyAllTransfers(root = TRANSFER_ROOT) {
  return verifyArchive(root, {
    label: 'transfers',
    refresh: 'run `npm run fetch:transfers`',
    verifySnapshot: verifyTransferSnapshot,
  })
}

export async function verifyAllEducators(root = EDUCATOR_ROOT) {
  return verifyArchive(root, {
    label: 'educators',
    refresh: 'run `npm run fetch:educators`',
    verifySnapshot: verifyEducatorSnapshot,
  })
}

export async function verifyAllDiscipline(root = DISCIPLINE_ROOT) {
  return verifyArchive(root, {
    label: 'discipline',
    refresh: 'run `npm run fetch:discipline`',
    verifySnapshot: verifyDisciplineSnapshot,
  })
}

/** All non-accountability data archives, verified sequentially to bound memory. */
export async function verifyAllSupplemental() {
  const archives = []
  for (const verify of [
    verifyAllEnrollment,
    verifyAllActionFlags,
    verifyAllCommunity,
    verifyAllPostsecondary,
    verifyAllTransfers,
    verifyAllEducators,
    verifyAllDiscipline,
  ]) {
    archives.push(await verify())
  }
  return {
    results: archives.flatMap((archive) => archive.results),
    problems: archives.flatMap((archive) => archive.problems),
  }
}

/* ------------------------------------------------------------------- cli -- */

if (import.meta.url === `file://${process.argv[1]}`) {
  const current = await verifyAll()
  const supplemental = await verifyAllSupplemental()
  const results = [...current.results, ...supplemental.results]
  const problems = [...current.problems, ...supplemental.problems]

  for (const r of results) {
    const state = r.problems.length === 0 ? 'ok' : `${r.problems.length} PROBLEM(S)`
    console.log(`  ${r.dir.padEnd(42)} ${String(r.checked).padStart(3)} files  fetched ${r.fetchedAt ?? '—'}  ${state}`)
  }

  if (problems.length) {
    console.error(`\nSNAPSHOT VERIFICATION FAILED — ${problems.length} problem(s):\n`)
    for (const p of problems) console.error(`  ${p}`)
    console.error(
      '\nAt least one committed archive no longer matches its recorded source bytes or\n' +
        'normalization. Restore the named archive from git, or run its documented\n' +
        'refresh command in README.md before building. Action flags require a\n' +
        'reviewed PDF-extraction refresh and are intentionally not auto-fetched.'
    )
    process.exit(1)
  }

  const files = results.reduce((n, r) => n + r.checked, 0)
  console.log(`\n${files} files across ${results.length} snapshot(s) match their manifest hashes.`)
}
