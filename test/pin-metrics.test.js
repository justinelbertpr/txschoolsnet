import { describe, expect, it } from 'vitest'

import { pinMetricPayloads } from '../src/pin-metrics.js'

const entities = [
  { id: '001902', level: 'district', districtId: '001902', isAlt: false },
  { id: '001902001', level: 'campus', districtId: '001902', isAlt: false },
  { id: '003801', level: 'district', districtId: '003801', isAlt: true },
  { id: '003801001', level: 'campus', districtId: '003801', isAlt: true },
]

const bundles = new Map([
  ['001902', { id: '001902', level: 'district', isAlt: false, score: 89, domains: { achievement: 86 } }],
  ['001902001', {
    id: '001902001', level: 'campus', isAlt: false, score: 92,
    subjects: ['Reading'], staar: [[91], [72], [35]], grad: [96.1, 97.2, 97.8, 0.4],
  }],
  ['003801', { id: '003801', level: 'district', isAlt: true, score: 75, grad: [82, 84, 86, 5] }],
  ['003801001', { id: '003801001', level: 'campus', isAlt: true, score: 78, grad: [81, 83, 85, 6] }],
  // Present in the source map but intentionally absent from the published
  // entity set (the production build excludes charters before this helper).
  ['999999', { id: '999999', level: 'district', isCharter: true, score: 100 }],
])

describe('pinMetricPayloads', () => {
  it('publishes one payload per district with campus measures only', () => {
    const result = pinMetricPayloads({ entities, bundles, subjects: ['Reading'] })

    expect([...result.keys()]).toEqual(['001902', '003801'])
    expect(result.size).toBe(entities.filter((entity) => entity.level === 'district').length)
    expect(new Set([...result.values()].flatMap((payload) => Object.keys(payload.entities))))
      .toEqual(new Set(entities.filter((entity) => entity.level === 'campus').map((entity) => entity.id)))
    expect(JSON.stringify([...result.values()])).not.toContain('999999')
    expect(result.get('001902')).toMatchObject({
      version: 1,
      districtId: '001902',
      entities: {
        '001902001': { score: 92, 'staar:Reading:0': 91, 'staar:Reading:1': 72, 'staar:Reading:2': 35 },
      },
    })
    expect(result.get('001902').entities).not.toHaveProperty('001902')
  })

  it('keeps standard and alternative graduation populations separate', () => {
    const result = pinMetricPayloads({ entities, bundles, subjects: ['Reading'] })

    expect(result.get('001902').entities['001902001']['grad:0']).toBe(96.1)
    expect(result.get('003801').entities['003801001']['grad:0']).toBe(81)
  })

  it('fails rather than silently dropping a campus whose district is absent', () => {
    expect(() => pinMetricPayloads({
      entities: [{ id: '999999001', level: 'campus', districtId: '999999' }],
      bundles: new Map([['999999001', { id: '999999001', score: 80 }]]),
    })).toThrow(/district 999999 is not published/)
  })
})
