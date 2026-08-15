import { describe, it, expect } from 'vitest'
import { assertIntegrity, toNdjson, latestSnapshot, dropOrphans, assertOrphanIdSet, KNOWN_ORPHAN_IDS } from '../src/build.js'

describe('assertIntegrity', () => {
  const entities = [{ id: 'a' }, { id: 'b' }]

  it('passes when every child id exists in entities', () => {
    expect(() => assertIntegrity(entities, { ratings: [{ id: 'a' }, { id: 'b' }] })).not.toThrow()
  })

  it('throws naming the table and the orphan id', () => {
    expect(() => assertIntegrity(entities, { ratings: [{ id: 'zzz' }] })).toThrow(/ratings.*zzz/i)
  })

  it('reports the orphan count rather than only the first', () => {
    expect(() => assertIntegrity(entities, { ratings: [{ id: 'y' }, { id: 'z' }] })).toThrow(/2 orphan/i)
  })
})

describe('toNdjson', () => {
  it('writes one JSON object per line with a trailing newline', () => {
    expect(toNdjson([{ id: 'a' }, { id: 'b' }])).toBe('{"id":"a"}\n{"id":"b"}\n')
  })

  it('returns an empty string for no rows', () => {
    expect(toNdjson([])).toBe('')
  })
})

describe('latestSnapshot', () => {
  it('picks the newest directory by name', () => {
    expect(latestSnapshot(['2026-08', '2027-01', '2026-12'])).toBe('2027-01')
  })

  it('throws when no snapshot exists', () => {
    expect(() => latestSnapshot([])).toThrow(/no snapshot/i)
  })

  // Requirement 1: a partial snapshot (fetchAll writes manifest.json last, so
  // its absence means the fetch died partway through) must not be mistaken
  // for a usable snapshot just because its directory name sorts newest.
  // latestSnapshot takes a `hasManifest` predicate rather than doing its own
  // fs I/O, so this is testable without touching disk: a fake predicate
  // marks '2026-09' as manifest-less and '2026-08' as complete, and the
  // newer-but-partial directory must be passed over in favor of the older
  // complete one.
  it('rejects a snapshot directory that has no manifest.json, falling back to the newest complete one', () => {
    const hasManifest = (name) => name !== '2026-09'
    expect(latestSnapshot(['2026-08', '2026-09'], hasManifest)).toBe('2026-08')
  })

  it('throws when the only candidate snapshot lacks a manifest.json', () => {
    const hasManifest = () => false
    expect(() => latestSnapshot(['2026-08'], hasManifest)).toThrow(/no snapshot/i)
  })
})

describe('dropOrphans', () => {
  // Requirement 2: profile_tab (and, as it turns out, change_over_time) carry
  // rows for a handful of campus ids absent from districts.json/schools.json.
  // The build must drop those rows at the source rather than let them reach
  // assertIntegrity and crash the whole build.
  it('drops a row whose id is not in entities, rather than crashing the build', () => {
    const known = new Set(['a', 'b'])
    const result = dropOrphans([{ id: 'a' }, { id: 'ghost' }, { id: 'b' }], known)
    expect(result.rows).toEqual([{ id: 'a' }, { id: 'b' }])
    expect(result.dropped).toBe(1)
  })

  it('reports zero dropped and returns every row when there are no orphans', () => {
    const known = new Set(['a', 'b'])
    const result = dropOrphans([{ id: 'a' }, { id: 'b' }], known)
    expect(result.rows).toEqual([{ id: 'a' }, { id: 'b' }])
    expect(result.dropped).toBe(0)
  })

  it('reports the distinct set of dropped ids, not just a count', () => {
    const known = new Set(['a'])
    // 'ghost' dropped twice (e.g. two year-label rows for the same orphan
    // campus) must appear once in droppedIds, even though dropped counts both.
    const result = dropOrphans([{ id: 'a' }, { id: 'ghost' }, { id: 'ghost' }], known)
    expect(result.dropped).toBe(2)
    expect(result.droppedIds).toEqual(['ghost'])
  })
})

describe('assertOrphanIdSet', () => {
  // Requirement 3: the guard must track *which* ids were dropped, not how
  // many rows that produced — a row count tied to today's year-label count
  // (4 known orphan ids x 6 labels = 24) breaks the moment TEA adds a 7th
  // label, even though the orphan ids themselves haven't changed.
  it('passes when the dropped ids are exactly the known four, regardless of row count', () => {
    // Same four ids, but as if TEA had published a 7th year label (28 rows
    // instead of 24) — the id set is unchanged, so this must not throw.
    const sevenLabelsWorthOfRows = KNOWN_ORPHAN_IDS.flatMap((id) => Array(7).fill({ id }))
    expect(() =>
      assertOrphanIdSet('ratings', [...new Set(sevenLabelsWorthOfRows.map((r) => r.id))], KNOWN_ORPHAN_IDS)
    ).not.toThrow()
  })

  it('throws naming an unknown orphan id', () => {
    expect(() =>
      assertOrphanIdSet('ratings', [...KNOWN_ORPHAN_IDS, '999999999'], KNOWN_ORPHAN_IDS)
    ).toThrow(/unexpected orphan ids: 999999999/)
  })

  it('throws naming a missing orphan id', () => {
    const threeOfFour = KNOWN_ORPHAN_IDS.slice(0, 3)
    expect(() => assertOrphanIdSet('ratings', threeOfFour, KNOWN_ORPHAN_IDS)).toThrow(
      new RegExp(`expected orphan ids no longer dropped: ${KNOWN_ORPHAN_IDS[3]}`)
    )
  })
})
