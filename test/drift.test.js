// Never hits the network. checkDrift takes its probe by injection precisely so
// this suite can exercise every branch — including a TEA outage and a refused
// HEAD — without a test run depending on a government host being up, and
// without this project quietly HEAD-ing txschools.gov 14 times per `npm test`.

import { describe, it, expect } from 'vitest'
import { compare, normalizeEtag, checkDrift, newestManifest } from '../src/drift.js'
import { SOURCES } from '../src/sources.js'

const LM_OLD = 'Fri, 14 Aug 2026 19:42:54 GMT'
const LM_NEW = 'Mon, 01 Sep 2026 08:00:00 GMT'

describe('normalizeEtag', () => {
  it('strips the weak marker so W/"x" and "x" compare equal', () => {
    expect(normalizeEtag('W/"x"')).toBe('"x"')
    expect(normalizeEtag('"x"')).toBe('"x"')
  })

  it('returns null for a missing header rather than a string', () => {
    expect(normalizeEtag(null)).toBeNull()
    expect(normalizeEtag(undefined)).toBeNull()
  })
})

describe('compare', () => {
  it('reads an identical etag as unchanged', () => {
    expect(compare({ etag: '"a"' }, { etag: '"a"' }).state).toBe('unchanged')
  })

  it('does not report drift merely because a proxy added the weak marker', () => {
    expect(compare({ etag: '"a"' }, { etag: 'W/"a"' }).state).toBe('unchanged')
  })

  it('reports a changed etag as drift, and says what it was', () => {
    const r = compare({ etag: '"a"' }, { etag: '"b"' })
    expect(r.state).toBe('changed')
    expect(r.detail).toContain('"a"')
    expect(r.detail).toContain('"b"')
  })

  it('prefers the etag over last-modified when both are available', () => {
    // Same object, but a republish moved Last-Modified. The etag is the
    // stronger signal and should win rather than raising a false alarm.
    expect(compare({ etag: '"a"', lastModified: LM_OLD }, { etag: '"a"', lastModified: LM_NEW }).state)
      .toBe('unchanged')
  })

  it('falls back to last-modified when either side has no etag', () => {
    expect(compare({ etag: null, lastModified: LM_OLD }, { etag: null, lastModified: LM_OLD }).state).toBe('unchanged')
    expect(compare({ etag: null, lastModified: LM_OLD }, { etag: null, lastModified: LM_NEW }).state).toBe('changed')
  })

  it('says unknown — never "unchanged" — when nothing is comparable', () => {
    // The dangerous default. Silence here would read as "verified" when in
    // fact the question was never answered.
    expect(compare({ etag: null, lastModified: null }, { etag: null, lastModified: null }).state).toBe('unknown')
  })

  it('separates an unreachable host from an unchanged file', () => {
    expect(compare({ etag: '"a"' }, { error: 'HTTP 503' }).state).toBe('unreachable')
  })
})

describe('checkDrift', () => {
  /** Echoes each file's own stored validators back, so nothing reads as drift. */
  const quiet = (manifest) => async (url) => {
    const name = url.split('/').pop().replace('.json', '')
    const f = manifest.files[name]
    return { etag: f.etag, lastModified: f.lastModified }
  }

  it('checks every source and reports all unchanged against the real manifest', async () => {
    const { manifest } = await newestManifest()
    const { results } = await checkDrift({ probe: quiet(manifest) })
    expect(results).toHaveLength(SOURCES.length)
    expect(results.every((r) => r.state === 'unchanged')).toBe(true)
  })

  it('singles out the one file that moved', async () => {
    const { manifest } = await newestManifest()
    const base = quiet(manifest)
    const probe = async (url) =>
      url.includes('finance_school') ? { etag: '"moved"', lastModified: LM_NEW } : base(url)

    const { results } = await checkDrift({ probe })
    const changed = results.filter((r) => r.state === 'changed')
    expect(changed).toHaveLength(1)
    expect(changed[0].name).toBe('finance_school')
  })

  it('reports an outage as unreachable rather than as unchanged', async () => {
    const { results } = await checkDrift({ probe: async () => ({ error: 'HTTP 503' }) })
    expect(results.every((r) => r.state === 'unreachable')).toBe(true)
  })

  it('reports a refused HEAD without falling back to a 13 MB GET', async () => {
    const { results } = await checkDrift({ probe: async () => ({ error: 'HTTP 405' }) })
    expect(results.every((r) => r.state === 'unreachable')).toBe(true)
  })
})
