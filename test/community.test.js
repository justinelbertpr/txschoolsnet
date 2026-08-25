import { describe, expect, it } from 'vitest'
import { parseCommunityText } from '../src/community.js'

const record = ({ id = '07380', name = 'Abbott Independent School District', total = 1124, children = 189, poverty = 16 } = {}) =>
  `48 ${id} ${name.padEnd(72)} ${String(total).padStart(8)} ${String(children).padStart(8)} ${String(poverty).padStart(8)} sd24-tx.txt 17FEB2026`

describe('Census school-district community context', () => {
  it('parses fixed-width GEOIDs, counts and a transparent derived rate', () => {
    const text = Array.from({ length: 901 }, (_, i) => record({ id: String(10000 + i), children: 200, poverty: 25 })).join('\n')
    const rows = parseCommunityText(text)
    expect(rows[0]).toMatchObject({ geoid: '4810000', year: 2024, schoolAgePopulation: 200, schoolAgePoverty: 25, schoolAgePovertyRate: 12.5 })
  })

  it('rejects truncation, duplicates and impossible poverty counts', () => {
    expect(() => parseCommunityText('48 short')).toThrow(/truncated/)
    const one = record({ id: '10000' })
    expect(() => parseCommunityText(`${one}\n${one}\n${Array.from({ length: 900 }, (_, i) => record({ id: String(11000 + i) })).join('\n')}`)).toThrow(/duplicate/)
    expect(() => parseCommunityText(`${record({ children: 10, poverty: 11 })}\n${Array.from({ length: 900 }, (_, i) => record({ id: String(12000 + i) })).join('\n')}`)).toThrow(/exceeds/)
  })
})
