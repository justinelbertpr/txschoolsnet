import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { snapshotDir, buildManifest, decodeAndValidate, invalidateManifest } from '../src/fetch.js'

describe('snapshotDir', () => {
  it('names the directory by year and month', () => {
    expect(snapshotDir(new Date('2026-08-15T00:00:00Z'))).toBe('data/raw/2026-08')
  })

  it('zero-pads single-digit months', () => {
    expect(snapshotDir(new Date('2027-01-09T00:00:00Z'))).toBe('data/raw/2027-01')
  })
})

describe('buildManifest', () => {
  const entries = [
    { name: 'districts', text: '[{"id":"001902"}]', rows: 1, etag: 'W/"abc"', lastModified: 'Fri, 14 Aug 2026 12:00:00 GMT' },
  ]

  it('records a sha256 of decompressed content', () => {
    const m = buildManifest(entries, '2026-08-15T00:00:00.000Z')
    expect(m.files.districts.sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('is stable for identical content', () => {
    const a = buildManifest(entries, '2026-08-15T00:00:00.000Z')
    const b = buildManifest(entries, '2026-09-01T00:00:00.000Z')
    expect(a.files.districts.sha256).toBe(b.files.districts.sha256)
  })

  it('carries server metadata and row counts', () => {
    const m = buildManifest(entries, '2026-08-15T00:00:00.000Z')
    expect(m.files.districts.etag).toBe('W/"abc"')
    expect(m.files.districts.rows).toBe(1)
    expect(m.fetchedAt).toBe('2026-08-15T00:00:00.000Z')
  })
})

describe('decodeAndValidate', () => {
  const source = { name: 'districts', minRows: 1 }

  it('names the source when the body is not JSON', () => {
    const buf = Buffer.from('<html>maintenance page</html>')
    expect(() => decodeAndValidate(source, buf)).toThrow(/^districts: /)
  })

  it('does not double-prefix a validateRows failure', () => {
    const buf = Buffer.from('[]') // valid JSON, but below minRows
    expect(() => decodeAndValidate(source, buf)).toThrow(
      'districts: got 0 rows, below floor 1',
    )
  })
})

// fetchAll itself does network I/O, so it isn't unit-tested directly.
// invalidateManifest is the piece of fetchAll's sequencing that matters —
// called after mkdir and before the fetch loop, it's what makes a re-fetch
// that dies partway through leave a directory latestSnapshot() (build.js)
// correctly rejects as incomplete, instead of one it accepts under a
// manifest describing bytes that are no longer all there.
describe('invalidateManifest', () => {
  const scratchDirs = []
  const scratchDir = async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tea-fetch-'))
    scratchDirs.push(dir)
    return dir
  }

  afterEach(async () => {
    await Promise.all(scratchDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
  })

  it('deletes an existing manifest.json, leaving the other snapshot files untouched', async () => {
    const dir = await scratchDir()
    await writeFile(join(dir, 'manifest.json'), '{"fetchedAt":"stale"}')
    await writeFile(join(dir, 'districts.json.gz'), 'stale-bytes')

    await invalidateManifest(dir)

    expect(await readdir(dir)).toEqual(['districts.json.gz'])
  })

  it('is a no-op when no manifest exists yet, e.g. a brand-new snapshot dir', async () => {
    const dir = await scratchDir()
    await mkdir(dir, { recursive: true }) // dir exists but is otherwise empty
    await expect(invalidateManifest(dir)).resolves.not.toThrow()
    expect(await readdir(dir)).toEqual([])
  })
})
