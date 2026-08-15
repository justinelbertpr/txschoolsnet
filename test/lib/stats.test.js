import { describe, it, expect } from 'vitest'
import { mean, weightedMean, median } from '../../src/lib/stats.js'

describe('mean', () => {
  it('averages numbers', () => {
    expect(mean([1, 2, 3])).toBe(2)
  })

  it('excludes nulls instead of counting them as zero', () => {
    expect(mean([1, null, 3])).toBe(2)
  })

  it('returns null for an empty or all-null input', () => {
    expect(mean([])).toBeNull()
    expect(mean([null, null])).toBeNull()
  })
})

describe('weightedMean', () => {
  it('weights each value', () => {
    expect(weightedMean([{ v: 100, w: 3 }, { v: 0, w: 1 }])).toBe(75)
  })

  it('skips pairs with a null value or a zero weight', () => {
    expect(weightedMean([{ v: 100, w: 3 }, { v: null, w: 99 }, { v: 50, w: 0 }])).toBe(100)
  })

  it('returns null when no weight remains', () => {
    expect(weightedMean([{ v: 1, w: 0 }])).toBeNull()
  })
})

describe('median', () => {
  it('takes the middle of an odd-length set', () => {
    expect(median([3, 1, 2])).toBe(2)
  })

  it('averages the middle pair of an even-length set', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })

  it('excludes nulls', () => {
    expect(median([1, null, 3])).toBe(2)
  })

  it('does not mutate its input', () => {
    const xs = [3, 1, 2]
    median(xs)
    expect(xs).toEqual([3, 1, 2])
  })
})
