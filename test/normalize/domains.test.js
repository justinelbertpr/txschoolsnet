// test/normalize/domains.test.js
import { describe, it, expect } from 'vitest'
import { toDomains, DOMAIN_LABELS } from '../../src/normalize/domains.js'

const overview = {
  id: '001902',
  school_year: ['2023-24', '2024-25', '2025-26'],
  ach_score: ['86', '88', '89'], ach_min: '77',
  prog_score: ['85', '86', '90'], prog_min: '76',
  ctg_score: ['84', '89', '88'], ctg_min: '75',
  proga_score: ['73', '84', '81'], proga_min: '64',
  progb_score: ['85', '86', '90'], progb_min: '76',
}

describe('toDomains', () => {
  it('emits one row per entity, year and domain', () => {
    const rows = toDomains([overview])
    expect(rows.filter((r) => r.domain === 'achievement')).toHaveLength(3)
    expect(new Set(rows.map((r) => r.domain))).toEqual(
      new Set(['achievement', 'progress', 'gaps', 'progress_growth', 'progress_relative'])
    )
  })

  it('coerces scores to numbers', () => {
    const r = toDomains([overview]).find((x) => x.domain === 'achievement' && x.year === '2025-26')
    expect(r.score).toBe(89)
  })

  it('grades a score of 89 as B, one point short of an A', () => {
    const r = toDomains([overview]).find((x) => x.domain === 'achievement' && x.year === '2025-26')
    expect(r.score).toBe(89)
    expect(r.grade).toBe('B')
    expect(r.toNextGrade).toBe(1)
  })

  it('grades a score of 90 as A, with nothing further to reach', () => {
    const rows = toDomains([{ id: 'x', school_year: ['2025-26'], ach_score: ['90'] }])
    const r = rows.find((x) => x.domain === 'achievement')
    expect(r.grade).toBe('A')
    expect(r.toNextGrade).toBeNull()
  })

  it('nulls a missing score rather than emitting zero', () => {
    const rows = toDomains([{ ...overview, ach_score: ['', '88', '89'] }])
    expect(rows.find((r) => r.domain === 'achievement' && r.year === '2023-24').score).toBeNull()
  })

  it('nulls both grade and toNextGrade when the score is missing', () => {
    const rows = toDomains([{ ...overview, ach_score: ['', '88', '89'] }])
    const r = rows.find((x) => x.domain === 'achievement' && x.year === '2023-24')
    expect(r.grade).toBeNull()
    expect(r.toNextGrade).toBeNull()
  })

  it('grades a score of 59 as F, one point short of a D', () => {
    const rows = toDomains([{ id: 'x', school_year: ['2025-26'], ach_score: ['59'] }])
    const r = rows.find((x) => x.domain === 'achievement')
    expect(r.grade).toBe('F')
    expect(r.toNextGrade).toBe(1)
  })

  it('labels every domain for display', () => {
    expect(DOMAIN_LABELS.achievement).toBe('Student Achievement')
    expect(Object.keys(DOMAIN_LABELS)).toHaveLength(5)
  })

  it('skips a domain absent from the record', () => {
    const rows = toDomains([{ id: 'x', school_year: ['2025-26'], ach_score: ['80'], ach_min: '70' }])
    expect(rows).toHaveLength(1)
    expect(rows[0].domain).toBe('achievement')
  })
})
