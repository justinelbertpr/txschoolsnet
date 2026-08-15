import { describe, it, expect } from 'vitest'
import { snapshotDir, buildManifest, decodeAndValidate } from '../src/fetch.js'

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
