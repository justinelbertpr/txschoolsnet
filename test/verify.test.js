// The verifier's only job is to fail when the committed snapshot no longer
// matches its manifest, so every test here is a corruption it must catch. A
// verifier tested only against a good snapshot proves nothing: it would pass
// with its comparisons deleted.
//
// The pairing with buildManifest is deliberate — fixtures are built by the SAME
// function src/fetch.js writes manifests with, so if the hashing rule there
// ever changes (a different encoding, hashing the .gz instead of the text)
// these fail rather than silently verifying against a stale convention.

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { buildManifest } from '../src/fetch.js'
import { verifyFile, verifySnapshot, verifyAll, hashText } from '../src/verify.js'
import { SOURCES } from '../src/sources.js'

const rows = (n, seed = 0) => Array.from({ length: n }, (_, i) => ({ id: String(seed + i).padStart(6, '0') }))
const textOf = (n, seed) => JSON.stringify(rows(n, seed))

/** A complete, self-consistent snapshot of every SOURCE, as fetch.js would write it. */
async function makeSnapshot(root, { dir = '2026-08', count = 3 } = {}) {
  const path = join(root, dir)
  await mkdir(path, { recursive: true })
  const entries = SOURCES.map((s, i) => ({
    name: s.name,
    text: textOf(count, i * 100),
    rows: count,
    etag: `"tag-${s.name}"`,
    lastModified: 'Fri, 14 Aug 2026 19:42:54 GMT',
  }))
  for (const e of entries) await writeFile(join(path, `${e.name}.json.gz`), gzipSync(e.text))
  const manifest = buildManifest(entries, '2026-08-15T16:19:29.181Z')
  await writeFile(join(path, 'manifest.json'), JSON.stringify(manifest, null, 2))
  return { path, manifest, entries }
}

const tmps = []
const scratch = async () => {
  const d = await mkdtemp(join(tmpdir(), 'verify-'))
  tmps.push(d)
  return d
}
afterEach(async () => {
  while (tmps.length) await rm(tmps.pop(), { recursive: true, force: true })
})

/* ------------------------------------------------------------ verifyFile -- */

describe('verifyFile', () => {
  const text = textOf(3)
  const expected = { sha256: hashText(text), bytes: Buffer.byteLength(text), rows: 3 }

  it('passes a file that matches its manifest entry', () => {
    expect(verifyFile('districts', gzipSync(text), expected)).toEqual([])
  })

  it('hashes the DECOMPRESSED text, matching buildManifest — not the .gz', () => {
    // gzip output is not byte-stable across zlib versions, so a verifier that
    // hashed the archive would fail for reasons that have nothing to do with
    // the data. Same text, deliberately different compression level.
    expect(verifyFile('districts', gzipSync(text, { level: 1 }), expected)).toEqual([])
    expect(verifyFile('districts', gzipSync(text, { level: 9 }), expected)).toEqual([])
  })

  it('catches a single changed character', () => {
    const problems = verifyFile('districts', gzipSync(text.replace('000000', '000001')), expected)
    expect(problems.some((p) => p.includes('sha256'))).toBe(true)
  })

  it('catches silently dropped rows — valid JSON, fewer records', () => {
    const problems = verifyFile('districts', gzipSync(textOf(2)), expected)
    expect(problems.some((p) => p.includes('rows'))).toBe(true)
    expect(problems.some((p) => p.includes('sha256'))).toBe(true)
  })

  it('reports a byte-count mismatch alongside the hash', () => {
    const problems = verifyFile('districts', gzipSync(text + ' '), expected)
    expect(problems.some((p) => p.includes('bytes'))).toBe(true)
  })

  it('reports rather than throws on a file that is not gzip at all', () => {
    const problems = verifyFile('districts', Buffer.from('not gzip'), expected)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/cannot gunzip/)
  })

  it('reports rather than throws on gzipped non-JSON', () => {
    const problems = verifyFile('districts', gzipSync('<html>maintenance</html>'), expected)
    expect(problems.some((p) => p.includes('not valid JSON'))).toBe(true)
  })
})

/* -------------------------------------------------------- verifySnapshot -- */

describe('verifySnapshot', () => {
  it('passes a snapshot written by buildManifest', async () => {
    const root = await scratch()
    const { path } = await makeSnapshot(root)
    const r = await verifySnapshot(path)
    expect(r.problems).toEqual([])
    expect(r.checked).toBe(SOURCES.length)
  })

  it('catches a file the manifest describes but disk does not have', async () => {
    const root = await scratch()
    const { path } = await makeSnapshot(root)
    await rm(join(path, 'schools.json.gz'))
    const r = await verifySnapshot(path)
    expect(r.problems.some((p) => p.includes('missing from disk'))).toBe(true)
  })

  it('catches a file on disk the manifest does not describe', async () => {
    // The shape a half-finished re-fetch leaves behind, and the one a loop over
    // the manifest alone would walk straight past.
    const root = await scratch()
    const { path } = await makeSnapshot(root)
    await writeFile(join(path, 'rogue.json.gz'), gzipSync('[]'))
    const r = await verifySnapshot(path)
    expect(r.problems.some((p) => p.includes('not in the manifest'))).toBe(true)
  })

  it('catches a source this project needs that the manifest never described', async () => {
    const root = await scratch()
    const { path, manifest } = await makeSnapshot(root)
    delete manifest.files.districts
    await writeFile(join(path, 'manifest.json'), JSON.stringify(manifest))
    const r = await verifySnapshot(path)
    expect(r.problems.some((p) => p.includes('does not describe districts'))).toBe(true)
  })

  it('treats a missing manifest as an incomplete snapshot, not corruption', async () => {
    const root = await scratch()
    const { path } = await makeSnapshot(root)
    await rm(join(path, 'manifest.json'))
    const r = await verifySnapshot(path)
    expect(r.problems).toHaveLength(1)
    expect(r.problems[0]).toMatch(/incomplete/)
  })
})

/* ------------------------------------------------------------- verifyAll -- */

describe('verifyAll', () => {
  it('checks every snapshot in the archive, not just the newest', async () => {
    // The provenance claim covers the whole archive: an older snapshot going
    // bad silently invalidates "every number traces to the bytes TEA served".
    const root = await scratch()
    await makeSnapshot(root, { dir: '2026-08' })
    const old = await makeSnapshot(root, { dir: '2025-08' })
    await writeFile(join(old.path, 'districts.json.gz'), gzipSync(textOf(99)))

    const { results, problems } = await verifyAll(root)
    expect(results).toHaveLength(2)
    expect(problems.some((p) => p.includes('2025-08'))).toBe(true)
    expect(problems.some((p) => p.includes('2026-08'))).toBe(false)
  })

  it('says so when there is no snapshot at all', async () => {
    const { problems } = await verifyAll(join(await scratch(), 'nope'))
    expect(problems[0]).toMatch(/no snapshot found/)
  })
})

/* ------------------------------------------------- the committed snapshot -- */

describe('the snapshot committed to this repository', () => {
  it('still hashes to what its manifest recorded at fetch time', async () => {
    // The regression this whole module exists for. If this fails, the working
    // tree's data/raw no longer matches the bytes TEA served, and nothing built
    // from it can be traced — restore from git or re-fetch before shipping.
    const { problems } = await verifyAll()
    expect(problems).toEqual([])
  })
})
