import { describe, it, expect } from 'vitest'
import { toRatings, parseYear, preferredRatings } from '../../src/normalize/ratings.js'

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

  it('trims stray whitespace rather than treating it as a new year', () => {
    expect(parseYear('2025-26 ')).toEqual({ year: '2025-26', method: 'current' })
    expect(parseYear(' 2021-22 What If ')).toEqual({ year: '2021-22', method: 'what_if' })
  })

  it('throws naming an unrecognized label instead of inventing a phantom year', () => {
    expect(() => parseYear('2021-22 (Revised)')).toThrow(/2021-22 \(Revised\)/)
  })

  it('parses all six real TEA academic_year labels observed in the 2026-08 snapshot', () => {
    const labels = ['2021-22', '2021-22 What If', '2022-23', '2023-24', '2024-25', '2025-26']
    for (const label of labels) {
      expect(() => parseYear(label)).not.toThrow()
    }
    expect(parseYear('2021-22')).toEqual({ year: '2021-22', method: 'original' })
    expect(parseYear('2021-22 What If')).toEqual({ year: '2021-22', method: 'what_if' })
    expect(parseYear('2022-23')).toEqual({ year: '2022-23', method: 'current' })
    expect(parseYear('2023-24')).toEqual({ year: '2023-24', method: 'current' })
    expect(parseYear('2024-25')).toEqual({ year: '2024-25', method: 'current' })
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

describe('preferredRatings', () => {
  // Real Cayuga ISD (001902) values: A/94 under the original methodology,
  // B/87 for the same year re-scored under the post-2023 rules.
  const cayugaOriginal = { id: '001902', year: '2021-22', method: 'original', rating: 'A', score: 94 }
  const cayugaWhatIf = { id: '001902', year: '2021-22', method: 'what_if', rating: 'B', score: 87 }
  const cayugaCurrent = { id: '001902', year: '2025-26', method: 'current', rating: 'B', score: 89 }

  it('prefers what_if over original for the same entity-year', () => {
    const result = preferredRatings([cayugaOriginal, cayugaWhatIf])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ rating: 'B', score: 87 })
  })

  it('keeps a current row as-is for a year with only one method', () => {
    expect(preferredRatings([cayugaCurrent])).toEqual([cayugaCurrent])
  })

  it('emits exactly one row per id|year pair', () => {
    const rows = preferredRatings([cayugaOriginal, cayugaWhatIf, cayugaCurrent])
    const keys = rows.map((r) => `${r.id}|${r.year}`)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.sort()).toEqual(['001902|2021-22', '001902|2025-26'])
  })

  it('is independent of input order', () => {
    const forward = preferredRatings([cayugaOriginal, cayugaWhatIf])
    const backward = preferredRatings([cayugaWhatIf, cayugaOriginal])
    expect(backward).toEqual(forward)
  })

  it('does not let an unrecognized method win over a known one', () => {
    const mystery = { id: '001902', year: '2021-22', method: 'mystery', rating: 'Z', score: 1 }
    expect(preferredRatings([mystery, cayugaWhatIf])).toEqual([cayugaWhatIf])
    expect(preferredRatings([cayugaWhatIf, mystery])).toEqual([cayugaWhatIf])
  })

  it('keeps an unrecognized method row when it is the only row for that entity-year', () => {
    const mystery = { id: '001902', year: '2021-22', method: 'mystery', rating: 'Z', score: 1 }
    expect(() => preferredRatings([mystery])).not.toThrow()
    expect(preferredRatings([mystery])).toEqual([mystery])
  })
})
