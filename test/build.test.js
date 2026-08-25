import { describe, it, expect } from 'vitest'
import {
  assertIntegrity,
  toNdjson,
  latestSnapshot,
  dropOrphans,
  assertOrphanIdSet,
  excludeCharters,
  mergeEnrollmentHistory,
  DISCIPLINE_HEADLINES,
  isDisciplineSummaryRow,
  summarizeDisciplineRows,
  KNOWN_ORPHAN_IDS,
} from '../src/build.js'

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

describe('excludeCharters', () => {
  // Requirement 4: this site publishes traditional public school districts
  // and campuses only. Charters are dropped at the single point every
  // entity enters the pipeline (build()), so nothing downstream — the
  // entity count, the payload, rankings, search, the sitemap — has to know
  // to filter them a second time.
  it('drops every entity flagged isCharter, keeps the rest unchanged', () => {
    const entities = [
      { id: 'a', name: 'Traditional ISD', isCharter: false },
      { id: 'b', name: 'Charter Academy', isCharter: true },
      { id: 'c', name: 'Another Traditional ISD', isCharter: false },
    ]
    expect(excludeCharters(entities)).toEqual([
      { id: 'a', name: 'Traditional ISD', isCharter: false },
      { id: 'c', name: 'Another Traditional ISD', isCharter: false },
    ])
  })

  it('returns every entity when none are charters', () => {
    const entities = [{ id: 'a', isCharter: false }, { id: 'b', isCharter: false }]
    expect(excludeCharters(entities)).toEqual(entities)
  })

  it('returns an empty list when every entity is a charter', () => {
    expect(excludeCharters([{ id: 'a', isCharter: true }])).toEqual([])
  })
})

describe('mergeEnrollmentHistory', () => {
  const entities = [
    { id: '001902', level: 'district', enrollment: 570 },
    { id: '001902001', level: 'campus', enrollment: 120 },
  ]
  const profile = [
    { id: '001902', total: 570, schoolYear: '2025-26' },
    { id: '001902001', total: 120, schoolYear: '2025-26' },
  ]
  const enrollmentRows = [
    { id: '001902', level: 'district', year: '2024-25', enrollment: 600 },
    { id: '001902001', level: 'campus', year: '2024-25', enrollment: 130 },
    { id: '001902', level: 'district', year: '2025-26', enrollment: 574 },
    { id: '001902001', level: 'campus', year: '2025-26', enrollment: 118 },
    // A campus that closed before the current txschools.gov snapshot is an
    // ordinary property of history, not one of the current-export anomalies.
    { id: '999999999', level: 'campus', year: '2024-25', enrollment: 42 },
  ]

  it('makes the latest PEIMS value canonical everywhere and retains history for current ids', () => {
    const result = mergeEnrollmentHistory({ entities, profile, enrollmentRows })
    expect(result.latestYear).toBe('2025-26')
    expect(result.entities.map((row) => row.enrollment)).toEqual([574, 118])
    expect(result.profile.map((row) => [row.total, row.schoolYear])).toEqual([
      [574, '2025-26'],
      [118, '2025-26'],
    ])
    expect(result.enrollment).toHaveLength(4)
    expect(result.changed).toBe(2)
  })

  it('drops retired historical ids without applying the current-snapshot orphan invariant', () => {
    const result = mergeEnrollmentHistory({ entities, profile, enrollmentRows })
    expect(result.dropped).toBe(1)
    expect(result.droppedIds).toEqual(['999999999'])
  })

  it('fails rather than silently mixing sources when a current entity has no latest PEIMS count', () => {
    const incomplete = enrollmentRows.filter((row) => row.id !== '001902001' || row.year !== '2025-26')
    expect(() => mergeEnrollmentHistory({ entities, profile, enrollmentRows: incomplete })).toThrow(
      /1 current entities are absent from the 2025-26 PEIMS report/i
    )
  })

  it('preserves the existing current count when PEIMS suppresses the latest value', () => {
    const masked = enrollmentRows.map((row) =>
      row.id === '001902001' && row.year === '2025-26' ? { ...row, enrollment: null } : row
    )
    const result = mergeEnrollmentHistory({ entities, profile, enrollmentRows: masked })
    expect(result.entities.find((row) => row.id === '001902001').enrollment).toBe(120)
    expect(result.profile.find((row) => row.id === '001902001').total).toBe(120)
    expect(result.enrollment.find((row) => row.id === '001902001' && row.year === '2025-26').enrollment).toBe(null)
    expect(result.maskedCurrent).toBe(1)
  })

  it('rejects a district/campus level mismatch', () => {
    const mismatched = enrollmentRows.map((row) =>
      row.id === '001902' && row.year === '2025-26' ? { ...row, level: 'campus' } : row
    )
    expect(() => mergeEnrollmentHistory({ entities, profile, enrollmentRows: mismatched })).toThrow(
      /001902 is district.*campus/i
    )
  })
})

const disciplineRow = (overrides = {}) => ({
  id: '001902',
  level: 'district',
  year: '2024-25',
  section: 'B-DISCIPLINE DATA',
  heading: 'ALL DISCIPLINE',
  measure: 'students',
  count: 10,
  status: 'reported',
  mask: null,
  ...overrides,
})

const disciplineEnrollment = (overrides = {}) =>
  disciplineRow({
    section: 'A-ENROLLMENT',
    heading: 'CUMULATIVE YEAR END ENROLLMENT',
    measure: 'students',
    count: 200,
    ...overrides,
  })

describe('summarizeDisciplineRows', () => {
  it('keeps a five-year ALL DISCIPLINE history with students and actions as distinct measures', () => {
    const years = ['2020-21', '2021-22', '2022-23', '2023-24', '2024-25']
    const source = years.flatMap((year, index) => [
      disciplineEnrollment({ year, count: 200 + index * 10 }),
      disciplineRow({ year, measure: 'students', count: 10 + index }),
      disciplineRow({ year, measure: 'actions', count: 15 + index * 2 }),
    ])
    const result = summarizeDisciplineRows(source)
    expect(result.years).toEqual(years)
    expect(result.latestYear).toBe('2024-25')
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].history).toHaveLength(5)
    expect(result.rows[0].history[0]).toEqual({
      year: '2020-21',
      cumulativeEnrollment: { count: 200, status: 'reported', mask: null },
      students: { count: 10, status: 'reported', mask: null, ratePct: 5 },
      actions: { count: 15, status: 'reported', mask: null, ratePer100: 7.5 },
    })
    expect(result.rows[0].latest.categories.allDiscipline.students).toHaveProperty('ratePct')
    expect(result.rows[0].latest.categories.allDiscipline.actions).toHaveProperty('ratePer100')
    expect(result.rows[0].latest.categories.allDiscipline.actions).not.toHaveProperty('ratePct')
  })

  it('calculates rates only from the same entity-year reported cumulative enrollment', () => {
    const result = summarizeDisciplineRows([
      // This denominator belongs to another district and cannot be borrowed.
      disciplineEnrollment({ id: '999999', count: 100 }),
      disciplineRow({ count: 25 }),
      disciplineRow({ measure: 'actions', count: 30 }),
    ])
    const row = result.rows.find((item) => item.id === '001902')
    expect(row.history[0].cumulativeEnrollment).toEqual({
      count: null,
      status: 'not-reported',
      mask: null,
    })
    expect(row.history[0].students.ratePct).toBeNull()
    expect(row.history[0].actions.ratePer100).toBeNull()
  })

  it('retains masks and unavailable values rather than turning them into zeroes', () => {
    const [row] = summarizeDisciplineRows([
      disciplineEnrollment({ count: null, status: 'suppressed', mask: '-1' }),
      disciplineRow({ count: 10 }),
      disciplineRow({ measure: 'actions', count: null, status: 'suppressed', mask: '-3' }),
    ]).rows
    expect(row.history[0].cumulativeEnrollment).toEqual({
      count: null,
      status: 'suppressed',
      mask: '-1',
    })
    expect(row.history[0].students).toMatchObject({ count: 10, status: 'reported', ratePct: null })
    expect(row.history[0].actions).toEqual({
      count: null,
      status: 'suppressed',
      mask: '-3',
      ratePer100: null,
    })
    expect(row.latest.categories.expulsions.students).toEqual({
      count: null,
      status: 'not-reported',
      mask: null,
      ratePct: null,
    })
  })

  it('uses TEA headline values directly and never sums overlapping categories', () => {
    const [row] = summarizeDisciplineRows([
      disciplineEnrollment(),
      disciplineRow({ count: 10 }),
      disciplineRow({ measure: 'actions', count: 12 }),
      disciplineRow({ heading: 'IN SCHOOL SUSPENSIONS', count: 8 }),
      disciplineRow({ heading: 'OUT OF SCHOOL SUSPENSIONS', count: 9 }),
      // A Section B incident dimension is not a student or action headline.
      disciplineRow({ measure: 'incidents', count: 99 }),
    ]).rows
    expect(Object.keys(row.latest.categories)).toHaveLength(DISCIPLINE_HEADLINES.length)
    expect(row.latest.categories.allDiscipline.students.count).toBe(10)
    expect(row.latest.categories.inSchoolSuspensions.students.count).toBe(8)
    expect(row.latest.categories.outOfSchoolSuspensions.students.count).toBe(9)
    expect(row.latest.categories.allDiscipline.students.count).not.toBe(17)
  })

  it('does not present stale entity data as the current year', () => {
    const result = summarizeDisciplineRows([
      disciplineEnrollment({ id: '001902', year: '2023-24' }),
      disciplineRow({ id: '001902', year: '2023-24' }),
      disciplineEnrollment({ id: '999999', year: '2024-25' }),
      disciplineRow({ id: '999999', year: '2024-25' }),
    ])
    expect(result.latestYear).toBe('2024-25')
    expect(result.rows.find((row) => row.id === '001902').latest).toBeNull()
    expect(result.rows.find((row) => row.id === '001902').history).toHaveLength(1)
  })

  it('selects only Section B rows plus the exact Section A denominator', () => {
    expect(isDisciplineSummaryRow(disciplineRow())).toBe(true)
    expect(isDisciplineSummaryRow(disciplineEnrollment())).toBe(true)
    expect(isDisciplineSummaryRow(disciplineRow({ measure: 'incidents' }))).toBe(false)
    expect(isDisciplineSummaryRow(disciplineRow({ heading: 'A FUTURE HEADING' }))).toBe(false)
    expect(isDisciplineSummaryRow(disciplineEnrollment({ heading: 'FALL ENROLLMENT' }))).toBe(false)
  })
})
