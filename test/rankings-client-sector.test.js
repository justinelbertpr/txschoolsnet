import { describe, expect, it } from 'vitest'
import { buildCsv, buildMetrics, columnsFor, describe as describeRanking, isSharedLink, readState, selectPool, writeQuery } from '../site/rankings.js'

const metrics = buildMetrics(['2025-26', '2024-25'])
const base = { metric: 'score.latest', level: 'district', scope: 'state', sector: 'traditional', aea: 'exclude', order: 'top', n: '50', sort: null, dir: null }
const rows = [
  { id: '1', level: 'district', name: 'Traditional ISD', isCharter: false, isAlt: false },
  { id: '2', level: 'district', name: 'Charter A', isCharter: true, isAlt: false },
  { id: '3', level: 'district', name: 'Charter B', isCharter: true, isAlt: true },
]

describe('interactive ranking sector filter', () => {
  it('defaults to traditional and persists explicit Charter and All selections in links', () => {
    expect(readState('', metrics).sector).toBe('traditional')
    expect(readState('?sector=charter', metrics).sector).toBe('charter')
    expect(readState('?sector=all', metrics).sector).toBe('all')
    expect(readState('?sector=private', metrics).sector).toBe('traditional')
    expect(writeQuery(base)).toBe('')
    expect(writeQuery({ ...base, sector: 'charter' })).toBe('?sector=charter')
    expect(isSharedLink('?sector=charter')).toBe(true)
  })

  it('forces charter rankings statewide in parsed state, filtering and shared links', () => {
    expect(readState('?sector=charter&scope=c.113', metrics)).toMatchObject({ sector: 'charter', scope: 'state' })
    expect(readState('?sector=charter&scope=r.10', metrics)).toMatchObject({ sector: 'charter', scope: 'state' })
    expect(writeQuery({ ...base, sector: 'charter', scope: 'c.113' })).toBe('?sector=charter')
    expect(selectPool(rows, { ...base, sector: 'charter', scope: 'c.113' }).pool).toEqual([rows[1]])
  })

  it('filters the pool by isCharter before applying the AEA choice', () => {
    expect(selectPool(rows, base)).toMatchObject({ total: 3, inScope: 3, sectorRemoved: 2, aeaRemoved: 0, pool: [rows[0]] })
    expect(selectPool(rows, { ...base, sector: 'charter' })).toMatchObject({ sectorRemoved: 1, aeaRemoved: 1, pool: [rows[1]] })
    expect(selectPool(rows, { ...base, sector: 'all', aea: 'include' })).toMatchObject({ sectorRemoved: 0, aeaRemoved: 0, pool: rows })
  })

  it('names the sector in visible population copy and CSV provenance', () => {
    const state = { ...base, sector: 'charter' }
    const metric = metrics[0]
    const description = describeRanking({
      state, metric, names: { regions: {}, counties: {} }, total: 3, inScope: 3,
      pool: 1, sectorRemoved: 1, aeaRemoved: 1, ranked: 1, missing: 0, tiedRows: 0, distinct: 1, shown: 1,
    })
    expect(description.headline).toContain('open-enrollment charter district')
    expect(description.lines.join(' ')).toContain('charter sector filter')
    const csv = buildCsv({ displayed: [], cols: [], description, state, metric, snapshot: '2026-08', url: 'https://txschools.net/rankings?sector=charter', ranked: 1, pool: 1, total: 3, inScope: 3, missing: 0 })
    expect(csv).toContain('sector=charter')
    expect(csv).toContain('open-enrollment charter district')
  })

  it('labels a charter county as administrative context', () => {
    const county = columnsFor(metrics[0], { ...base, sector: 'charter' }, { counties: {} })
      .find((col) => col.key === 'county')
    expect(county.label).toBe('Administrative county')
  })
})
