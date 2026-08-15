import { rm, mkdir } from 'node:fs/promises'

/**
 * Removes `path` (recursively, if it exists) and recreates it empty.
 *
 * Used to clear generated output before regenerating it. Without this, a
 * `npm run site` run that follows an earlier one only ever adds files: a
 * campus page whose source row is now gone (the campus closed) or a
 * previous run's content-hashed payload survives on disk forever, orphaned
 * from the sitemap/manifest but still live at its URL. CI always runs from
 * a fresh checkout so it never sees this — it's a local-run trap.
 *
 * Callers must scope `path` to the specific generated subdirectory (e.g.
 * 'site/district'), never to a directory that also holds hand-authored
 * files.
 */
export async function resetDir(path) {
  await rm(path, { recursive: true, force: true })
  await mkdir(path, { recursive: true })
}
