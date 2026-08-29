import { describe, expect, it } from 'vitest'

import { pinMetricPayloads } from '../src/pin-metrics.js'

const entities = [
  { id: '001902', level: 'district', districtId: '001902', isCharter: false, isAlt: false },
  { id: '001902001', level: 'campus', districtId: '001902', isCharter: false, isAlt: false },
  { id: '003801', level: 'district', districtId: '003801', isCharter: false, isAlt: true },
  { id: '003801001', level: 'campus', districtId: '003801', isCharter: false, isAlt: true },
  { id: '999999', level: 'district', districtId: '999999', isCharter: true, isAlt: false },
  { id: '999999001', level: 'campus', districtId: '999999', isCharter: true, isAlt: false },
]

const bundles = new Map([
  ['001902', { id: '001902', level: 'district', isCharter: false, isAlt: false, score: 89, domains: { achievement: 86 } }],
  ['001902001', {
    id: '001902001', level: 'campus', isCharter: false, isAlt: false, score: 92,
    subjects: ['Reading'], staar: [[91], [72], [35]], grad: [96.1, 97.2, 97.8, 0.4],
  }],
  ['003801', { id: '003801', level: 'district', isCharter: false, isAlt: true, score: 75, grad: [82, 84, 86, 5] }],
  ['003801001', { id: '003801001', level: 'campus', isCharter: false, isAlt: true, score: 78, grad: [81, 83, 85, 6] }],
  ['999999', { id: '999999', level: 'district', isCharter: true, isAlt: false, score: 100 }],
  ['999999001', {
    id: '999999001', level: 'campus', isCharter: true, isAlt: false, score: 88,
    subjects: ['Reading'], staar: [[84], [61], [29]],
  }],
])

const publicBundles = new Map([
  ['001902001', {
    'public:enrollment:2025-26': 420,
    'public:educators:class-size:2025-26:math': 18.4,
    'public:notices:improvement': 0,
  }],
  ['003801001', { 'public:enrollment:2025-26': 85 }],
  ['999999001', { 'public:enrollment:2025-26': 510 }],
])

describe('pinMetricPayloads', () => {
  it('publishes one payload per district with campus measures only', () => {
    const result = pinMetricPayloads({ entities, bundles, publicBundles, subjects: ['Reading'] })

    expect([...result.keys()]).toEqual(['001902', '003801', '999999'])
    expect(result.size).toBe(entities.filter((entity) => entity.level === 'district').length)
    expect(new Set([...result.values()].flatMap((payload) => Object.keys(payload.entities))))
      .toEqual(new Set(entities.filter((entity) => entity.level === 'campus').map((entity) => entity.id)))
    expect(result.get('999999')).toMatchObject({
      districtId: '999999',
      entities: {
        '999999001': {
          score: 88,
          'staar:Reading:0': 84,
          'public:enrollment:2025-26': 510,
        },
      },
    })
    expect(result.get('001902')).toMatchObject({
      version: 1,
      districtId: '001902',
      entities: {
        '001902001': {
          score: 92, 'staar:Reading:0': 91, 'staar:Reading:1': 72, 'staar:Reading:2': 35,
          'public:enrollment:2025-26': 420,
          'public:educators:class-size:2025-26:math': 18.4,
          'public:notices:improvement': 0,
        },
      },
    })
    expect(result.get('001902').entities).not.toHaveProperty('001902')
    expect(result.get('999999').entities).not.toHaveProperty('999999')
  })

  it('keeps campus payloads under a district-level system in the same sector', () => {
    const result = pinMetricPayloads({ entities, bundles, publicBundles, subjects: ['Reading'] })
    const byId = new Map(entities.map((entity) => [entity.id, entity]))

    for (const [districtId, payload] of result) {
      const district = byId.get(districtId)
      for (const campusId of Object.keys(payload.entities)) {
        const campus = byId.get(campusId)
        expect(campus.districtId).toBe(districtId)
        expect(campus.isCharter).toBe(district.isCharter)
      }
    }
  })

  it('keeps standard and alternative graduation populations separate', () => {
    const result = pinMetricPayloads({ entities, bundles, publicBundles, subjects: ['Reading'] })

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
