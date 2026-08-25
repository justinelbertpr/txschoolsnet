import { describe, expect, it } from 'vitest'
import { parsePostsecondaryRows } from '../src/postsecondary.js'

const rowsFor = (n, level = 'district') => {
  const header = level === 'district'
    ? ['County', 'District', 'Code', 'Institution', 'Students']
    : ['County', 'District', 'Name', 'Code', 'Institution', 'Students']
  const rows = [header]
  for (let i = 0; i < n; i++) {
    const code = String(1902 + i)
    const lead = level === 'district' ? ['COUNTY', 'DISTRICT', code] : ['COUNTY', 'DISTRICT', 'SCHOOL', `${code}001`]
    rows.push([...lead, 'TEXAS STATE UNIVERSITY (003615)', '10'])
    rows.push([...lead, 'Other Public 2-yr Institution (2)', '5'])
    rows.push([...lead, 'Not found', '14'])
    rows.push([...lead, 'Not trackable', '1'])
    rows.push([...lead, 'Total high school graduates', '30'])
  }
  return rows
}

describe('THECB following-fall outcomes', () => {
  it('keeps the denominator and separates Texas-public enrollment from not-found records', () => {
    const parsed = parsePostsecondaryRows(rowsFor(800), { level: 'district' })
    expect(parsed[0]).toMatchObject({
      id: '001902', level: 'district', graduates: 30, enrolledPublic: 15,
      rate: 50, notFound: 14, notTrackable: 1,
    })
    expect(parsed[0].destinations).toEqual([{ institution: 'TEXAS STATE UNIVERSITY (003615)', students: 10 }])
  })

  it('pads campus ids and rejects arithmetic that does not reconcile', () => {
    const rows = rowsFor(1200, 'campus')
    const parsed = parsePostsecondaryRows(rows, { level: 'campus' })
    expect(parsed[0].id).toBe('001902001')
    rows[1].at(-1)
    rows[1][5] = '11'
    expect(() => parsePostsecondaryRows(rows, { level: 'campus' })).toThrow(/destinations/)
  })
})
