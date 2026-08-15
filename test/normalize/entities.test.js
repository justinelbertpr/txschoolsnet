import { describe, it, expect } from 'vitest'
import { toEntity } from '../../src/normalize/entities.js'

const district = {
  id: '001902', district_id: '001902', district_name: 'Cayuga ISD',
  region_id: '07', county_id: '001', county: 'Anderson',
  entity_type: 'Traditional', campus_type: '', alt_standards: 'No',
  enrollment: 574, name: 'Cayuga ISD', rating: 'B', score: 89,
  latitude: 31.922964, longitude: -95.923871, mult_year: '0', paired_id: '',
}

const charterCampus = {
  ...district, id: '001902001', name: 'Cayuga HS',
  entity_type: 'Charter', campus_type: 'High School', alt_standards: 'Yes',
  mult_year: '2', paired_id: '001902002',
}

// Traditional campus whose name does NOT contain "ISD" — a name-based
// isCharter heuristic would wrongly call this a charter.
const traditionalCampus = {
  ...district, id: '001902001', name: 'Cayuga HS',
  entity_type: 'Traditional', campus_type: 'High School',
}

// Converse: entity_type is Charter but the name DOES contain "ISD" — a
// name-based heuristic would wrongly call this traditional.
const charterWithIsdName = {
  ...district, id: '001902099', name: 'Cayuga ISD',
  entity_type: 'Charter',
}

describe('toEntity', () => {
  it('marks level from the source file', () => {
    expect(toEntity(district, 'district').level).toBe('district')
    expect(toEntity(charterCampus, 'campus').level).toBe('campus')
  })

  it('derives isCharter from entity_type, never from the name', () => {
    expect(toEntity(district, 'district').isCharter).toBe(false)
    expect(toEntity(charterCampus, 'campus').isCharter).toBe(true)
    // Traditional campus with no "ISD" in its name must NOT be a charter.
    expect(toEntity(traditionalCampus, 'campus').isCharter).toBe(false)
    // Charter entity whose name contains "ISD" must still be a charter.
    expect(toEntity(charterWithIsdName, 'district').isCharter).toBe(true)
  })

  it('derives isAlt from alt_standards', () => {
    expect(toEntity(district, 'district').isAlt).toBe(false)
    expect(toEntity(charterCampus, 'campus').isAlt).toBe(true)
  })

  it('keeps ids, region and county as zero-padded strings', () => {
    const e = toEntity(district, 'district')
    expect(e.id).toBe('001902')
    expect(e.regionId).toBe('07')
    expect(e.countyId).toBe('001')
  })

  it('coerces score and enrollment to numbers, mult_year to a number', () => {
    const e = toEntity(district, 'district')
    expect(e.score).toBe(89)
    expect(e.enrollment).toBe(574)
    expect(e.multYear).toBe(0)
    expect(toEntity(charterCampus, 'campus').multYear).toBe(2)
  })

  it('normalises empty strings to null', () => {
    expect(toEntity(district, 'district').pairedId).toBeNull()
    expect(toEntity(charterCampus, 'campus').pairedId).toBe('001902002')
  })

  it('nulls a non-numeric score rather than emitting NaN', () => {
    expect(toEntity({ ...district, score: '' }, 'district').score).toBeNull()
  })
})
