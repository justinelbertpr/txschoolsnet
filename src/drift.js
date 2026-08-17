// Upstream drift: has TEA changed any source file since this snapshot was taken?
//
// WHY THIS EXISTS. TEA overwrites its data files in place — there is no version
// in the URL and no changelog. That is the reason this project archives every
// fetch under data/raw/<YYYY-MM>/ with a manifest instead of re-fetching on
// demand. But it leaves a blind spot: if TEA quietly revises a file, nothing
// here notices. The site goes on serving figures that were true in August
// against an upstream that has since moved, and the first anyone knows is
// whenever a human happens to run `npm run fetch`.
//
// This closes the loop cheaply. src/fetch.js already records the ETag and
// Last-Modified that TEA served with every file, so a HEAD request is enough to
// ask "is this still the same object?" without downloading 52 MB to find out.
//
// WHAT A POSITIVE ACTUALLY MEANS. Drift here means "the bytes at that URL are
// not the bytes this snapshot was built from." It does NOT necessarily mean the
// numbers changed — TEA could have republished identical content, and a
// validator or a CDN can move an ETag on its own. So this reports, it does not
// act: the response is a human running `npm run fetch`, reviewing the diff, and
// deciding. Nothing downstream is automated off it, deliberately, because a
// pipeline that silently re-fetched would defeat the archive's whole purpose.
//
// HEAD only, never a fallback GET. schools.json alone is 13 MB; a server that
// refuses HEAD gets reported as indeterminate rather than quietly pulled in
// full on a schedule against a government host.

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { SOURCES, sourceUrl } from './sources.js'
import { snapshotDirs } from './verify.js'

/** Timeout per request. A .gov host being slow is not a reason to hang a job. */
export const TIMEOUT_MS = 15_000

/**
 * `W/"abc"` and `"abc"` are the same entity tag under a weak comparison, which
 * is the right comparison here: we are asking "same object?", not "byte-range
 * cacheable?". A proxy that adds or drops the weak marker should not read as a
 * TEA revision.
 */
export const normalizeEtag = (v) => (typeof v === 'string' ? v.replace(/^W\//, '').trim() : null)

/** unchanged | changed | unknown | unreachable — plus why, for the log. */
export function compare(stored, live) {
  if (live.error) return { state: 'unreachable', detail: live.error }

  const se = normalizeEtag(stored.etag)
  const le = normalizeEtag(live.etag)
  if (se && le) {
    return se === le
      ? { state: 'unchanged', detail: `etag ${le}` }
      : { state: 'changed', detail: `etag ${se} -> ${le}` }
  }

  // No ETag on one side or the other: Last-Modified is weaker (one-second
  // granularity, and a republish of identical bytes moves it) but it is a real
  // signal and better than declaring the check impossible.
  if (stored.lastModified && live.lastModified) {
    return stored.lastModified === live.lastModified
      ? { state: 'unchanged', detail: `last-modified ${live.lastModified}` }
      : { state: 'changed', detail: `last-modified ${stored.lastModified} -> ${live.lastModified}` }
  }

  return { state: 'unknown', detail: 'server sent neither a comparable etag nor last-modified' }
}

async function head(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return { error: `HTTP ${res.status}` }
    return { etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') }
  } catch (err) {
    return { error: err.name === 'TimeoutError' ? `no response in ${TIMEOUT_MS / 1000}s` : err.message }
  }
}

/** The newest snapshot — the one build.js actually builds from. */
export async function newestManifest() {
  const dirs = await snapshotDirs()
  for (const dir of [...dirs].reverse()) {
    if (existsSync(`${dir}/manifest.json`)) {
      return { dir, manifest: JSON.parse(await readFile(`${dir}/manifest.json`, 'utf8')) }
    }
  }
  return null
}

/** Sequential, matching src/fetch.js: 14 HEADs is not worth parallelising against a .gov host. */
export async function checkDrift({ probe = head } = {}) {
  const found = await newestManifest()
  if (!found) throw new Error('no complete snapshot under data/raw — run `npm run fetch`')

  const results = []
  for (const source of SOURCES) {
    const stored = found.manifest.files?.[source.name]
    if (!stored) {
      results.push({ name: source.name, state: 'unknown', detail: 'not described in the manifest' })
      continue
    }
    const live = await probe(sourceUrl(source.name))
    results.push({ name: source.name, ...compare(stored, live) })
  }
  return { dir: found.dir, fetchedAt: found.manifest.fetchedAt ?? null, results }
}

/* ------------------------------------------------------------------- cli --
   Exit codes are the interface for the scheduled workflow:
     0  every file still matches the snapshot
     1  at least one file changed upstream — someone should look
     2  the question could not be answered (host down, HEAD refused) */

if (import.meta.url === `file://${process.argv[1]}`) {
  const { dir, fetchedAt, results } = await checkDrift()
  console.log(`Comparing ${dir} (fetched ${fetchedAt}) against ${SOURCES.length} live TEA files\n`)

  const MARK = { unchanged: 'same', changed: 'CHANGED', unknown: '?', unreachable: '!' }
  for (const r of results) {
    console.log(`  ${String(MARK[r.state]).padEnd(8)} ${r.name.padEnd(30)} ${r.detail}`)
  }

  const changed = results.filter((r) => r.state === 'changed')
  const undetermined = results.filter((r) => r.state === 'unknown' || r.state === 'unreachable')

  if (changed.length) {
    console.error(
      `\nUPSTREAM DRIFT: ${changed.length} of ${results.length} file(s) changed at txschools.gov\n` +
        `since this snapshot was taken.\n\n` +
        `  ${changed.map((r) => r.name).join('\n  ')}\n\n` +
        `The site is still internally consistent — every published number still traces\n` +
        `to the committed bytes — but those bytes are no longer what TEA is serving.\n` +
        `Run \`npm run fetch\` to take a fresh snapshot, review the diff, and commit it\n` +
        `deliberately. Nothing here re-fetches on its own, by design.`
    )
    process.exit(1)
  }

  if (undetermined.length) {
    console.error(`\nCould not determine drift for ${undetermined.length} file(s) — see above.`)
    process.exit(2)
  }

  console.log(`\nAll ${results.length} files still match the snapshot.`)
}
