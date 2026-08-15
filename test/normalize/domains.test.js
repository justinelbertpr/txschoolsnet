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

  it('attaches the cut score to every year of a domain', () => {
    const rows = toDomains([overview]).filter((r) => r.domain === 'achievement')
    expect(rows.every((r) => r.cutScore === 77)).toBe(true)
  })

  it('exposes the margin above the cut score', () => {
    const r = toDomains([overview]).find((x) => x.domain === 'gaps' && x.year === '2025-26')
    expect(r.score).toBe(88)
    expect(r.cutScore).toBe(75)
    expect(r.margin).toBe(13)
  })

  it('nulls a missing score rather than emitting zero', () => {
    const rows = toDomains([{ ...overview, ach_score: ['', '88', '89'] }])
    expect(rows.find((r) => r.domain === 'achievement' && r.year === '2023-24').score).toBeNull()
  })

  it('nulls the margin when either side is missing', () => {
    const rows = toDomains([{ ...overview, ach_min: '' }])
    expect(rows.find((r) => r.domain === 'achievement').margin).toBeNull()
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
