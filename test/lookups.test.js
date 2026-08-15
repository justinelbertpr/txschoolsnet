// test/lookups.test.js
import { describe, it, expect } from 'vitest'
import { buildLookups } from '../src/lookups.js'

const districts = [
  { id: '001902', region_id: '07', region: 'Region 07: Kilgore', county_id: '001', county: 'Anderson' },
  { id: '001903', region_id: '07', region: 'Region 07: Kilgore', county_id: '002', county: 'Andrews' },
  { id: '057905', region_id: '10', region: 'Region 10: Richardson', county_id: '057', county: 'Dallas' },
]

describe('buildLookups', () => {
  it('maps region id to name', () => {
    expect(buildLookups(districts).regions['07']).toBe('Region 07: Kilgore')
  })

  it('maps county id to name', () => {
    expect(buildLookups(districts).counties['057']).toBe('Dallas')
  })

  it('deduplicates repeated ids', () => {
    expect(Object.keys(buildLookups(districts).regions)).toHaveLength(2)
  })

  it('sorts keys so the output is stable across builds', () => {
    const keys = Object.keys(buildLookups(districts).counties)
    expect(keys).toEqual([...keys].sort())
  })

  it('ignores rows with a missing id', () => {
    expect(Object.keys(buildLookups([...districts, { id: 'x' }]).regions)).toHaveLength(2)
  })
})
