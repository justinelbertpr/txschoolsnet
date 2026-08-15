import { describe, it, expect } from 'vitest'
import { buildPayload, contentHash } from '../src/export.js'

const entities = [
  { id: '001902', level: 'district', name: 'Cayuga ISD', regionId: '07', countyId: '001',
    isCharter: false, isAlt: false, enrollment: 574, score: 89, rating: 'B' },
]
const ratings = [
  { id: '001902', year: '2025-26', method: 'current', rating: 'B', score: 89 },
  { id: '001902', year: '2021-22', method: 'what_if', rating: 'B', score: 87 },
  { id: '001902', year: '2021-22', method: 'original', rating: 'A', score: 94 },
]
const profile = [{ id: '001902', ecoDisPct: 52.6 }]

describe('buildPayload', () => {
  it('is column-oriented, not an array of objects', () => {
    const p = buildPayload(entities, ratings, profile)
    expect(Array.isArray(p.entities.id)).toBe(true)
    expect(p.entities.id[0]).toBe('001902')
  })

  it('keeps every column the same length', () => {
    const cols = Object.values(buildPayload(entities, ratings, profile).entities)
    expect(new Set(cols.map((c) => c.length)).size).toBe(1)
  })

  it('joins eco-dis onto the entity row', () => {
    expect(buildPayload(entities, ratings, profile).entities.ecoDisPct[0]).toBe(52.6)
  })

  it('lists years once, most recent first', () => {
    expect(buildPayload(entities, ratings, profile).years).toEqual(['2025-26', '2021-22'])
  })

  it('indexes scores by entity and year for the default methodology', () => {
    const p = buildPayload(entities, ratings, profile)
    expect(p.scores[0]).toEqual([89, 87])
  })

  it('exposes the original 2021-22 methodology separately', () => {
    expect(buildPayload(entities, ratings, profile).original['2021-22'][0]).toBe(94)
  })
})

describe('contentHash', () => {
  it('is stable for identical content', () => {
    expect(contentHash('{"a":1}')).toBe(contentHash('{"a":1}'))
  })

  it('differs for different content', () => {
    expect(contentHash('{"a":1}')).not.toBe(contentHash('{"a":2}'))
  })

  it('is short enough for a filename', () => {
    expect(contentHash('{"a":1}')).toMatch(/^[a-f0-9]{8}$/)
  })
})
