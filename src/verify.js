// Snapshot integrity: does what is committed under data/raw/ still hash to
// what the manifest says it hashed to when it was fetched?
//
// WHY THIS EXISTS. The provenance claim this project makes is specific: every
// published number traces back to the exact bytes TEA served on a given date.
// Until now that claim rested on a sha256 written once, at fetch time, and
// never checked again — so a truncated `git lfs` checkout, a corrupted object,
// a well-meaning hand-edit of a .json.gz, or a merge that resurrected half of
// an old snapshot would all produce a site that builds cleanly, tests green,
// and publishes numbers nobody can trace. This closes that: the hashes are now
// re-derived from the committed bytes and compared, and a mismatch fails the
// build rather than shipping.
//
// WHAT IS ACTUALLY HASHED, precisely, because getting this wrong would make
// the check meaningless. src/fetch.js does not store TEA's response bytes. It
// decodes each response to JSON, validates it, re-serialises with
// JSON.stringify, and stores gzip(that text) — and the manifest's sha256 is of
// THAT text, not of TEA's original body. So verification has to gunzip the
// stored file and hash the resulting string exactly as buildManifest does.
// Hashing the .gz itself would compare gzip output, which is not guaranteed
// byte-stable across zlib versions and would fail for the wrong reason.
//
// The three fields are checked together on purpose: sha256 catches any content
// change, `bytes` catches a truncation that somehow collides, and `rows`
// catches a structurally valid file that lost records — the partial-publication
// failure mode src/decode.js's minRows floor exists to catch at fetch time, and
// the one most likely to look like real data.

import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { SOURCES } from './sources.js'

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

/* ------------------------------------------------------------------- cli -- */

if (import.meta.url === `file://${process.argv[1]}`) {
  const { results, problems } = await verifyAll()

  for (const r of results) {
    const state = r.problems.length === 0 ? 'ok' : `${r.problems.length} PROBLEM(S)`
    console.log(`  ${r.dir.padEnd(22)} ${String(r.checked).padStart(2)} files  fetched ${r.fetchedAt ?? '—'}  ${state}`)
  }

  if (problems.length) {
    console.error(`\nSNAPSHOT VERIFICATION FAILED — ${problems.length} problem(s):\n`)
    for (const p of problems) console.error(`  ${p}`)
    console.error(
      '\nThe committed snapshot no longer matches the hashes recorded when it was\n' +
        'fetched, so the provenance chain is broken: numbers built from it can no\n' +
        'longer be traced to the bytes TEA served. Restore the files from git\n' +
        '(`git checkout -- data/raw`) or re-fetch (`npm run fetch`) before building.'
    )
    process.exit(1)
  }

  const files = results.reduce((n, r) => n + r.checked, 0)
  console.log(`\n${files} files across ${results.length} snapshot(s) match their manifest hashes.`)
}
