// test/normalize/finance.test.js
import { describe, it, expect } from 'vitest'
import { toFinance, financeAlignment } from '../../src/normalize/finance.js'

const rec = {
  id: '001902',
  year: ['2018', '2019', '2020'],
  expenditure_district: [14725, 15931, 16938],
  expenditure_peer: [13378, 14225, 15250],
  expenditure_state: [13054, 13108, 14058],
  revenue_district: [15091, 16519, 18420],
  revenue_peer: [12862, 13889, 14724],
  revenue_state: [11729, 12022, 12500],
}

describe('toFinance', () => {
  it('emits one row per entity-year', () => {
    expect(toFinance([rec])).toHaveLength(3)
  })

  it('carries per-pupil spend for entity, peer and state', () => {
    const r = toFinance([rec]).find((x) => x.year === '2020')
    expect(r.spendEntity).toBe(16938)
    expect(r.spendPeer).toBe(15250)
    expect(r.spendState).toBe(14058)
  })

  it('carries per-pupil revenue', () => {
    const r = toFinance([rec]).find((x) => x.year === '2018')
    expect(r.revenueEntity).toBe(15091)
  })

  it('keeps the year as a string', () => {
    expect(toFinance([rec])[0].year).toBe('2018')
  })

  it('nulls a missing figure rather than emitting zero', () => {
    const rows = toFinance([{ ...rec, expenditure_peer: [null, 14225, 15250] }])
    expect(rows.find((r) => r.year === '2018').spendPeer).toBeNull()
  })

  it('returns nothing for a record with no year array', () => {
    expect(toFinance([{ id: 'x' }])).toEqual([])
  })

  it('nulls only the misaligned series, keeping the rest of the entity intact', () => {
    const short = { ...rec, expenditure_peer: [13378, 14225] } // 2 vs year's 3
    const rows = toFinance([short])
    expect(rows.every((r) => r.spendPeer === null)).toBe(true)
    expect(rows.find((r) => r.year === '2020').spendEntity).toBe(16938)
    expect(rows.find((r) => r.year === '2020').revenueEntity).toBe(18420)
  })

  it('is unaffected when every series is aligned with year', () => {
    const rows = toFinance([rec])
    expect(rows.every((r) => r.spendPeer !== null)).toBe(true)
    expect(rows).toHaveLength(3)
  })
})

describe('financeAlignment', () => {
  it('is empty when every series matches the length of year', () => {
    expect(financeAlignment([rec])).toEqual([])
  })

  it('names the entity and the series for a length mismatch', () => {
    const short = { ...rec, expenditure_peer: [13378, 14225] }
    expect(financeAlignment([short])).toEqual([{ entityId: '001902', series: 'expenditure_peer' }])
  })

  it('reports every misaligned series for one entity', () => {
    const short = { ...rec, expenditure_peer: [13378, 14225], revenue_peer: [12862, 13889] }
    const report = financeAlignment([short])
    expect(report).toHaveLength(2)
    expect(report.map((r) => r.series).sort()).toEqual(['expenditure_peer', 'revenue_peer'])
  })
})
