import { describe, expect, it } from 'vitest'
import { mergeActionFlags, parseImprovementSheets, parsePegText } from '../src/action-flags.js'

const header = [
  'Region', 'District Number', 'District Name', 'Campus Number', 'Campus Name',
  'Support Label', 'Identification Reason', 'Track Year', 'Title I Status',
]

describe('actionable campus notices', () => {
  it('parses exact ids and keeps the official support label and reason', () => {
    const filler = Array.from({ length: 101 }, (_, i) => {
      const district = String(100000 + i).padStart(6, '0')
      return ['', district, 'DISTRICT', `${district}001`, 'SCHOOL', 'TSI', 'Special Education', '0', 'Title I']
    })
    const rows = parseImprovementSheets({ CSI: [header, ...filler], TSI: [header], ATS: [header] })
    expect(rows[0]).toMatchObject({ id: '100000001', districtId: '100000', kind: 'CSI', titleI: true })
    expect(rows[0].reason).toBe('Special Education')
  })

  it('rejects duplicate campuses and a shifted district id', () => {
    const base = ['', '101919', 'SPRING ISD', '101919001', 'SPRING H S', 'TSI', 'White', '0', '']
    expect(() => parseImprovementSheets({ CSI: [header, ...Array(101).fill(base)], TSI: [header], ATS: [header] })).toThrow(/more than one sheet/)
    const bad = [...base]
    bad[1] = '101920'
    expect(() => parseImprovementSheets({ CSI: [header, bad, ...Array.from({ length: 100 }, (_, i) => ['', String(200000 + i), 'D', `${200000 + i}001`, 'S', 'CSI', 'Low performance', '1', ''])], TSI: [header], ATS: [header] })).toThrow(/does not belong/)
  })

  it('reads only the final 2026-27 PEG ids and merges statuses', () => {
    const ids = Array.from({ length: 101 }, (_, i) => String(101000000 + i))
    const peg = parsePegText(`2026-2027 Public Education Grant List\nFinal\n${ids.join('\n')}`)
    expect(peg).toHaveLength(101)
    const merged = mergeActionFlags({ improvement: [{ id: ids[0], kind: 'CSI' }], peg })
    expect(merged.find((row) => row.id === ids[0])).toMatchObject({ improvement: { kind: 'CSI' }, peg: { final: true } })
    expect(() => parsePegText(`Preliminary\n${ids.join('\n')}`)).toThrow(/not the final/)
  })
})
