import { describe, it, expect } from 'vitest'
import { toProfile } from '../../src/normalize/profile.js'

const rec = {
  id: '001902', Total: 574, Eco_Dis: 52.6, Spec_Ed: 15.2, Eng_Lrn: 1.2,
  Attendance: 95.8, Absenteeism: 8.7, Avg_Salary: 65465, School_Year: '2025-26',
}

describe('toProfile', () => {
  it('maps eco-dis to a number', () => {
    expect(toProfile([rec])[0].ecoDisPct).toBe(52.6)
  })

  it('carries enrollment, attendance and salary', () => {
    const p = toProfile([rec])[0]
    expect(p.total).toBe(574)
    expect(p.attendance).toBe(95.8)
    expect(p.avgSalary).toBe(65465)
  })

  it('nulls a missing eco-dis rather than defaulting to zero', () => {
    expect(toProfile([{ id: 'x', Eco_Dis: null }])[0].ecoDisPct).toBeNull()
  })

  it('nulls a non-numeric eco-dis', () => {
    expect(toProfile([{ id: 'x', Eco_Dis: '.' }])[0].ecoDisPct).toBeNull()
  })
})
