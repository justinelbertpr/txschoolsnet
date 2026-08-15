import { describe, it, expect } from 'vitest'
import { toRatings, parseYear } from '../../src/normalize/ratings.js'

describe('parseYear', () => {
  it('splits the What If label into year plus method', () => {
    expect(parseYear('2021-22 What If')).toEqual({ year: '2021-22', method: 'what_if' })
  })

  it('treats a plain year as the original method', () => {
    expect(parseYear('2021-22')).toEqual({ year: '2021-22', method: 'original' })
  })

  it('treats post-refresh years as current methodology', () => {
    expect(parseYear('2025-26')).toEqual({ year: '2025-26', method: 'current' })
  })
})

describe('toRatings', () => {
  const rec = {
    id: '001902',
    academic_year: ['2025-26', '2021-22 What If', '2021-22'],
    overall_rating: ['B', 'B', 'A'],
    score: ['89', '87', '94'],
  }

  it('emits one row per year-method pair', () => {
    expect(toRatings([rec])).toHaveLength(3)
  })

  it('splits 2021-22 into two rows sharing a year', () => {
    const y = toRatings([rec]).filter((r) => r.year === '2021-22')
    expect(y).toHaveLength(2)
    expect(y.map((r) => r.method).sort()).toEqual(['original', 'what_if'])
  })

  it('records the methodology effect: same year, same score, different grade', () => {
    const y = toRatings([rec]).filter((r) => r.year === '2021-22')
    const original = y.find((r) => r.method === 'original')
    const whatIf = y.find((r) => r.method === 'what_if')
    expect(original.rating).toBe('A')
    expect(whatIf.rating).toBe('B')
  })

  it('coerces score to a number', () => {
    expect(toRatings([rec])[0].score).toBe(89)
  })

  it('nulls the score for Not Rated rather than emitting zero', () => {
    const nr = { id: 'x', academic_year: ['2025-26'], overall_rating: ['Not Rated'], score: [''] }
    expect(toRatings([nr])[0].score).toBeNull()
  })

  it('keeps Data Integrity Issues as a distinct rating', () => {
    const di = { id: 'x', academic_year: ['2025-26'], overall_rating: ['Data Integrity Issues'], score: [null] }
    expect(toRatings([di])[0].rating).toBe('Data Integrity Issues')
  })
})
