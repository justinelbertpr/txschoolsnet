import { describe, it, expect } from 'vitest'
import { explode } from '../src/explode.js'

const rec = {
  id: '001902',
  academic_year: ['2025-26', '2024-25'],
  overall_rating: ['B', 'B'],
  score: ['89', '88'],
}

describe('explode', () => {
  it('produces one row per array index', () => {
    const rows = explode(rec, { academic_year: 'year', overall_rating: 'rating', score: 'score' })
    expect(rows).toEqual([
      { id: '001902', year: '2025-26', rating: 'B', score: '89' },
      { id: '001902', year: '2024-25', rating: 'B', score: '88' },
    ])
  })

  it('carries extra scalar columns onto every row', () => {
    const rows = explode(rec, { academic_year: 'year' }, { level: 'district' })
    expect(rows.every((r) => r.level === 'district')).toBe(true)
  })

  it('throws when arrays disagree in length', () => {
    const bad = { id: 'x', academic_year: ['a', 'b'], score: ['1'] }
    expect(() => explode(bad, { academic_year: 'year', score: 'score' })).toThrow(/x.*length mismatch.*score/i)
  })

  it('returns no rows for empty arrays', () => {
    expect(explode({ id: 'x', academic_year: [] }, { academic_year: 'year' })).toEqual([])
  })

  it('returns no rows when a mapped key is absent', () => {
    expect(explode({ id: 'x' }, { academic_year: 'year' })).toEqual([])
  })

  it('preserves nulls rather than coercing them', () => {
    const rows = explode({ id: 'x', score: [null] }, { score: 'score' })
    expect(rows[0].score).toBeNull()
  })
})
