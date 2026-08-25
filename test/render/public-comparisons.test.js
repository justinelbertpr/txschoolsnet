import { describe, expect, it } from 'vitest'

import {
  buildPublicComparisonBundles,
  mergePublicComparisons,
  publicMetric,
} from '../../src/render/public-comparisons.js'

const entities = [
  { id: '000001', level: 'district' },
  { id: '000002', level: 'district' },
  { id: '000001001', districtId: '000001', level: 'campus' },
  { id: '000002001', districtId: '000002', level: 'campus' },
]

describe('supplemental public-data comparison bundles', () => {
  it('keeps source years and suppression gaps while building numeric metrics', () => {
    const bundles = buildPublicComparisonBundles({
      entities,
      finance: [
        { id: '000001', year: '2025', spendEntity: 12_000 },
        { id: '000002', year: '2025', spendEntity: 14_000 },
      ],
      enrollment: [
        { id: '000001', level: 'district', year: '2025-26', enrollment: 100 },
        { id: '000002', level: 'district', year: '2025-26', enrollment: null },
      ],
      transfers: [{
        id: '000001',
        history: [{ year: '2025-26', transfersIn: 20, transfersOut: 30, net: -10 }],
      }],
      educators: [
        { id: '000001', level: 'district', year: '2024-25', teacherTurnoverRate: 18.2 },
        { id: '000001001', level: 'campus', year: '2024-25', classSize: { grade1: 19.4 } },
      ],
      discipline: [{
        id: '000001',
        history: [{
          year: '2024-25',
          students: { ratePct: 4.2 },
          actions: { ratePer100: null, status: 'suppressed' },
        }],
        latest: {
          year: '2024-25',
          categories: { allDiscipline: { students: { ratePct: 4.2 }, actions: { ratePer100: null } } },
        },
      }],
      community: [{
        id: '000001', totalPopulation: 5000, schoolAgePopulation: 600,
        schoolAgePoverty: 120, schoolAgePovertyRate: 20,
      }],
      postsecondary: [{
        id: '000001', graduates: 50, enrolledPublic: 25, rate: 50, notFound: 20, notTrackable: 5,
      }],
      actionFlags: [{ id: '000001001', improvement: { kind: 'TSI' }, peg: null }],
    })

    const district = bundles.get('000001')
    expect(district[publicMetric.spending('2025')]).toBe(12_000)
    expect(district[publicMetric.enrollment('2025-26')]).toBe(100)
    expect(district[publicMetric.transferBalance('2025-26')]).toBe(-10)
    expect(district[publicMetric.turnover('2024-25')]).toBe(18.2)
    expect(district[publicMetric.disciplineStudents('2024-25')]).toBe(4.2)
    expect(district).not.toHaveProperty(publicMetric.disciplineActions('2024-25'))
    expect(district[publicMetric.communitySchoolAgePovertyRate]).toBe(20)
    expect(district[publicMetric.postsecondaryNotFoundRate]).toBe(40)
    expect(district[publicMetric.postsecondaryNotTrackableRate]).toBe(10)
    expect(district[publicMetric.districtCampusCount]).toBe(1)
    expect(district[publicMetric.districtImprovementShare]).toBe(100)
    expect(bundles.get('000002')[publicMetric.districtImprovementShare]).toBe(0)
    expect(bundles.get('000001001')[publicMetric.campusImprovement]).toBe(100)
    expect(bundles.get('000002001')[publicMetric.campusImprovement]).toBe(0)
    expect(bundles.get('000001001')[publicMetric.classSize('2024-25', 'grade1')]).toBe(19.4)
    expect(bundles.get('000002')).not.toHaveProperty(publicMetric.enrollment('2025-26'))
  })

  it('uses the existing cohort membership and publishes metric-specific coverage', () => {
    const bundles = buildPublicComparisonBundles({
      entities,
      finance: [
        { id: '000001', year: '2025', spendEntity: 12_000 },
        { id: '000002', year: '2025', spendEntity: 14_000 },
      ],
      enrollment: [
        { id: '000001', year: '2025-26', enrollment: 100 },
        { id: '000002', year: '2025-26', enrollment: null },
      ],
    })
    const result = mergePublicComparisons({
      entityId: '000001',
      own: { score: 80 },
      cohorts: [{ key: 'county', metrics: { score: 75 }, metricN: { score: 2 } }],
      cohortIds: { county: ['000001', '000002'] },
      bundles,
    })

    expect(result.own.score).toBe(80)
    expect(result.own[publicMetric.spending('2025')]).toBe(12_000)
    expect(result.cohorts[0].metrics[publicMetric.spending('2025')]).toBe(13_000)
    expect(result.cohorts[0].metricN[publicMetric.spending('2025')]).toBe(2)
    expect(result.cohorts[0].metrics[publicMetric.enrollment('2025-26')]).toBe(100)
    expect(result.cohorts[0].metricN[publicMetric.enrollment('2025-26')]).toBe(1)
  })

  it('does not leak metrics from another level onto the current page', () => {
    const bundles = buildPublicComparisonBundles({
      entities,
      transfers: [{ id: '000001', history: [{ year: '2025-26', transfersIn: 3, transfersOut: 4, net: -1 }] }],
    })
    const result = mergePublicComparisons({
      entityId: '000001001',
      cohorts: [{ key: 'state', metrics: {}, metricN: {} }],
      cohortIds: { state: ['000001001', '000002001'] },
      bundles,
    })
    expect(Object.keys(result.own)).not.toContain(publicMetric.transferBalance('2025-26'))
    expect(Object.keys(result.cohorts[0].metrics)).not.toContain(publicMetric.transferBalance('2025-26'))
  })
})
