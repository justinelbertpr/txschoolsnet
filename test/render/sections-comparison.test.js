import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import {
  actionNotices,
  campuses,
  community,
  discipline,
  enrollment,
  highlights,
  outcomes,
  postsecondary,
  spending,
  standouts,
  students,
  teachers,
  trajectory,
  transfers,
  verdict,
} from '../../src/render/sections.js'
import { publicMetric } from '../../src/render/public-comparisons.js'

const page = ({ metrics = {}, metricN = {}, own = {}, ...over } = {}) => ({
  id: '015917',
  name: 'Southside ISD',
  level: 'district',
  own,
  cohorts: [{
    key: 'county', label: 'Bexar County', short: 'county', n: 15, metrics, metricN,
  }],
  publicDataMeta: {},
  ...over,
})

const hook = (key) => `data-metric="${key}"`

const readoutValues = (html, key) => {
  const dom = new JSDOM(html)
  const card = dom.window.document.querySelector(`[data-comparison-readout][data-metric="${key}"]`)
  const values = card
    ? {
        entity: card.querySelector('[data-entity-value]')?.textContent,
        comparison: card.querySelector('[data-compare-value]')?.textContent,
        label: card.querySelector('.comparison-readout-label')?.textContent,
        hidden: card.hidden,
      }
    : null
  dom.window.close()
  return values
}

describe('supplemental sections use the page-wide selected comparison', () => {
  it('adds selected-group averages to enrollment and transfer histories without replacing entity facts', () => {
    const enrollmentKeys = {
      [publicMetric.enrollment('2024-25')]: 4_800,
      [publicMetric.enrollment('2025-26')]: 4_950,
    }
    const enrollmentHtml = enrollment(page({
      metrics: enrollmentKeys,
      metricN: Object.fromEntries(Object.keys(enrollmentKeys).map((key) => [key, 12])),
      own: {
        [publicMetric.enrollment('2024-25')]: 5_100,
        [publicMetric.enrollment('2025-26')]: 5_000,
      },
      enrollmentTrend: {
        points: [
          { year: '2024-25', enrollment: 5_100, change: null },
          { year: '2025-26', enrollment: 5_000, change: { delta: -100, pct: -1.96 } },
        ],
        latest: { year: '2025-26', enrollment: 5_000 },
        yoy: { fromYear: '2024-25', delta: -100, pct: -1.96 },
        sinceFirst: null,
      },
    }))
    expect(enrollmentHtml).toContain(hook(publicMetric.enrollment('2025-26')))
    expect(enrollmentHtml).toContain('Enrollment in')
    expect(enrollmentHtml).toContain('Bexar County')
    expect(enrollmentHtml).toContain("this district's own counts do not")
    expect(readoutValues(enrollmentHtml, publicMetric.enrollment('2025-26'))).toMatchObject({
      entity: '5,000', comparison: '4,950', hidden: false,
    })

    const transferMetrics = {
      [publicMetric.transfersIn('2025-26')]: 80,
      [publicMetric.transfersOut('2025-26')]: 110,
      [publicMetric.transferBalance('2025-26')]: -30,
    }
    const transferHtml = transfers(page({
      metrics: transferMetrics,
      own: {
        [publicMetric.transfersIn('2025-26')]: 106,
        [publicMetric.transfersOut('2025-26')]: 350,
        [publicMetric.transferBalance('2025-26')]: -244,
      },
      transferContext: {
        history: [{
          year: '2025-26', transfersIn: 106, transfersOut: 350, net: -244,
          coverage: { officialTotals: { in: 'reported', out: 'reported' } },
        }],
        current: {
          year: '2025-26', transfersIn: 106, transfersOut: 350, net: -244,
          coverage: {
            officialTotals: { in: 'reported', out: 'reported' },
            origins: {}, destinations: {},
          },
          topOrigins: [], topDestinations: [],
        },
      },
    }))
    expect(transferHtml).toContain(hook(publicMetric.transfersIn('2025-26')))
    expect(transferHtml).toContain(hook(publicMetric.transferBalance('2025-26')))
    expect(transferHtml).toContain('average reported counts, not rates')
    expect(transferHtml).toContain('−244')
    expect(readoutValues(transferHtml, publicMetric.transfersIn('2025-26'))).toMatchObject({
      entity: '106', comparison: '80',
    })
    expect(readoutValues(transferHtml, publicMetric.transfersOut('2025-26'))).toMatchObject({
      entity: '350', comparison: '110',
    })
    expect(readoutValues(transferHtml, publicMetric.transferBalance('2025-26'))).toMatchObject({
      entity: '−244', comparison: '−30',
    })
  })

  it('compares discipline on rates while keeping student and action counts separate', () => {
    const studentKey = publicMetric.disciplineStudents('2024-25')
    const actionKey = publicMetric.disciplineActions('2024-25')
    const categoryStudentKey = publicMetric.disciplineCategoryStudents('2024-25', 'allDiscipline')
    const categoryActionKey = publicMetric.disciplineCategoryActions('2024-25', 'allDiscipline')
    const datum = (count, extra = {}) => ({ count, status: 'reported', ...extra })
    const html = discipline(page({
      metrics: {
        [studentKey]: 5.2, [actionKey]: 7.4,
        [categoryStudentKey]: 5.2, [categoryActionKey]: 7.4,
      },
      own: {
        [studentKey]: 6, [actionKey]: 8.33,
        [categoryStudentKey]: 6, [categoryActionKey]: 8.33,
      },
      discipline: {
        history: [{
          year: '2024-25', cumulativeEnrollment: datum(1_200),
          students: datum(72, { ratePct: 6 }), actions: datum(100, { ratePer100: 8.33 }),
        }],
        current: {
          year: '2024-25', cumulativeEnrollment: datum(1_200),
          categories: [{
            key: 'allDiscipline', label: 'All discipline',
            students: datum(72, { ratePct: 6 }), actions: datum(100, { ratePer100: 8.33 }),
          }],
        },
      },
    }))
    expect(html).toContain(hook(studentKey))
    expect(html).toContain(hook(actionKey))
    expect(html).toContain(hook(categoryStudentKey))
    expect(html).toContain('Selected comparisons use rates, not raw counts')
    expect(html).toContain('Students, actions and incidents are different units')
    expect(readoutValues(html, studentKey)).toMatchObject({ entity: '6.0%', comparison: '5.2%' })
    expect(readoutValues(html, actionKey)).toMatchObject({ entity: '8.33', comparison: '7.4' })
  })

  it('adds neutral Census context and limited-scope postsecondary rates', () => {
    const povertyRate = publicMetric.communitySchoolAgePovertyRate
    const communityHtml = community(page({
      metrics: {
        [publicMetric.communityPopulation]: 72_000,
        [publicMetric.communitySchoolAge]: 11_000,
        [publicMetric.communitySchoolAgePoverty]: 2_200,
        [povertyRate]: 20,
      },
      own: {
        [publicMetric.communityPopulation]: 50_000,
        [publicMetric.communitySchoolAge]: 8_000,
        [publicMetric.communitySchoolAgePoverty]: 1_600,
        [povertyRate]: 20,
      },
      communityContext: {
        totalPopulation: 50_000, schoolAgePopulation: 8_000,
        schoolAgePoverty: 1_600, schoolAgePovertyRate: 20,
      },
    }))
    expect(communityHtml).toContain(hook(povertyRate))
    expect(communityHtml).toContain('neutral scale context')
    expect(communityHtml).not.toContain('cmp-up')
    expect(communityHtml).not.toContain('cmp-down')

    const rateKey = publicMetric.postsecondaryRate
    const postsecondaryHtml = postsecondary(page({
      metrics: {
        [publicMetric.postsecondaryGraduates]: 90,
        [publicMetric.postsecondaryEnrolled]: 38,
        [rateKey]: 42.2,
        [publicMetric.postsecondaryNotFoundRate]: 54.4,
        [publicMetric.postsecondaryNotTrackableRate]: 3.4,
      },
      own: {
        [publicMetric.postsecondaryGraduates]: 100,
        [publicMetric.postsecondaryEnrolled]: 42,
        [rateKey]: 42,
        [publicMetric.postsecondaryNotFoundRate]: 55,
        [publicMetric.postsecondaryNotTrackableRate]: 3,
      },
      postsecondaryOutcome: {
        graduateYear: '2023-24', fallTerm: 'Fall 2024', graduates: 100,
        enrolledPublic: 42, rate: 42, notFound: 55, notTrackable: 3, destinations: [],
      },
    }))
    expect(postsecondaryHtml).toContain(hook(rateKey))
    expect(postsecondaryHtml).toContain('limited Texas-public system')
    expect(postsecondaryHtml).not.toContain('cmp-up')
    expect(postsecondaryHtml).not.toContain('cmp-down')
  })

  it('updates turnover and each reported class-size category', () => {
    const turnoverKey = publicMetric.turnover('2024-25')
    const turnoverHtml = teachers(page({
      metrics: { [turnoverKey]: 17.1 }, own: { [turnoverKey]: 16.4 },
      teacherTurnover: {
        history: [{ year: '2024-25', ratePct: 16.4 }],
        latest: { year: '2024-25', ratePct: 16.4 },
      },
    }))
    expect(turnoverHtml).toContain(hook(turnoverKey))
    expect(turnoverHtml).toContain('Average turnover rate')

    const kindergartenKey = publicMetric.classSize('2024-25', 'kindergarten')
    const mathKey = publicMetric.classSize('2024-25', 'secondaryMath')
    const classHtml = teachers(page({
      level: 'campus', name: 'Southside High School',
      metrics: { [kindergartenKey]: 19.1, [mathKey]: 21.4 },
      own: { [kindergartenKey]: 18.4, [mathKey]: 22.1 },
      classSize: {
        year: '2024-25', reported: 2,
        categories: [
          { key: 'kindergarten', label: 'Kindergarten', studentsPerClass: 18.4 },
          { key: 'secondaryMath', label: 'Secondary math', studentsPerClass: 22.1 },
        ],
      },
    }))
    expect(classHtml).toContain(hook(kindergartenKey))
    expect(classHtml).toContain(hook(mathKey))
    expect(classHtml).toContain('only schools reporting that same grade or subject')
  })

  it('compares district size and notice prevalence without changing official statuses', () => {
    const campusCountKey = publicMetric.districtCampusCount
    const campusHtml = campuses(page({
      metrics: { [campusCountKey]: 11.2 }, own: { [campusCountKey]: 2 },
      campuses: [
        { slug: 'one-015917001', name: 'One', campusType: 'High School' },
        { slug: 'two-015917002', name: 'Two', campusType: 'Elementary School' },
      ],
    }))
    expect(campusHtml).toContain(hook(campusCountKey))
    expect(campusHtml).toContain("This district's school count and school-type mix remain its own facts")

    const improvementShare = publicMetric.districtImprovementShare
    const pegShare = publicMetric.districtPegShare
    const noticeHtml = actionNotices(page({
      metrics: { [improvementShare]: 12.5, [pegShare]: 4.2 },
      own: { [improvementShare]: 50, [pegShare]: 0 },
      actionNotices: [{
        id: '015917001', name: 'Southside High School', href: '/campus/southside-hs-015917001',
        improvement: { kind: 'TSI', reason: 'Special Education' }, peg: null,
      }],
    }))
    expect(noticeHtml).toContain(hook(improvementShare))
    expect(noticeHtml).toContain(hook(pegShare))
    expect(noticeHtml).toContain("changing the comparison never changes a campus's official status")
  })

  it('keeps a hidden hook when the default group is missing a metric another group reports', () => {
    const key = publicMetric.districtCampusCount
    const html = campuses(page({
      own: { [key]: 1 },
      cohorts: [
        { key: 'peer', label: 'Similar context', short: 'similar', n: 10, metrics: {}, metricN: {} },
        { key: 'state', label: 'Texas average', short: 'state', n: 1_019, metrics: { [key]: 6.4 }, metricN: { [key]: 1_019 } },
      ],
      campuses: [{ slug: 'one-015917001', name: 'One', campusType: 'High School' }],
    }))
    expect(html).toContain(hook(key))
    expect(html).toContain('data-format="count" hidden style="display:none"')
  })

  it('keeps statewide and similar-size comparison prose grammatical', () => {
    const key = publicMetric.enrollment('2025-26')
    const trend = {
      points: [
        { year: '2024-25', enrollment: 4_900, change: null },
        { year: '2025-26', enrollment: 5_000, change: { delta: 100, pct: 2.04 } },
      ],
      latest: { year: '2025-26', enrollment: 5_000 },
      yoy: { fromYear: '2024-25', delta: 100, pct: 2.04 },
      sinceFirst: null,
    }
    const stateHtml = enrollment(page({
      own: { [key]: 5_000 },
      cohorts: [{
        key: 'state', label: 'Texas average', short: 'state', n: 1_019,
        metrics: { [key]: 4_900 }, metricN: { [key]: 1_018 },
      }],
      enrollmentTrend: trend,
    }))
    expect(stateHtml).toContain('statewide cohort average across</span> <span data-compare-label>Texas</span>')
    expect(stateHtml).not.toContain('average for Texas average')

    const sizeHtml = enrollment(page({
      own: { [key]: 5_000 },
      cohorts: [{
        key: 'size', label: 'Similar size', short: 'similar-size group', n: 110,
        metrics: { [key]: 6_000 }, metricN: { [key]: 110 },
      }],
      enrollmentTrend: trend,
    }))
    expect(sizeHtml).toContain('average for</span> <span data-compare-label>similarly sized districts</span>')
    expect(sizeHtml).not.toContain('average for Similar size')

    const heroHtml = verdict(page({
      history: [{ year: '2025-26', rating: 'B', score: 83 }],
      cohorts: [{
        key: 'size', label: 'Similar size', short: 'similar-size group', n: 110,
        metrics: { score: 80.8 }, metricN: { score: 110 }, placements: {},
      }],
      county: 'Bexar', regionName: 'Region 20: San Antonio', enrollment: 6_093,
      multYear: 0, highlights: [], highlightsByCohort: { size: [] }, own: { score: 83 },
    }))
    expect(heroHtml).toContain('110 similarly sized rated districts')
    expect(heroHtml).not.toContain('rated districts in Similar size')
  })

  it('starts the trajectory chart and table with the page-wide selected cohort', () => {
    const html = trajectory(page({
      history: [
        { year: '2025-26', rating: 'B', score: 82 },
        { year: '2024-25', rating: 'C', score: 76 },
      ],
      comparisons: [
        { key: 'peer', label: 'Similar context', n: 187, byYear: { '2025-26': 55, '2024-25': 54 }, reportingNByYear: { '2025-26': 180, '2024-25': 175 } },
        { key: 'county', label: 'Bexar County', n: 15, byYear: { '2025-26': 77, '2024-25': 74 }, reportingNByYear: { '2025-26': 14, '2024-25': 12 } },
        { key: 'state', label: 'Texas average', n: 1_019, byYear: { '2025-26': 70, '2024-25': 69 }, reportingNByYear: { '2025-26': 1_000, '2024-25': 980 } },
      ],
    }))
    const tbody = html.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0] ?? ''
    expect(html).toContain('"defaults":["county","state"]')
    expect(html).toContain('data-lo="50"')
    expect(html).toContain('data-hi="90"')
    expect(html).toContain('<small>Bexar County</small>')
    expect(tbody).toContain('>77.0 <small class="trajectory-reporting">14 reporting</small>')
    expect(tbody).not.toContain('>55.0')
  })

  it('shows metric-specific reporting coverage for graduation and CCMR', () => {
    const html = outcomes(page({
      own: { 'grad:0': 91, 'grad:1': 1.8, 'ccmr:0': 78, 'ccmr:1': 22 },
      cohorts: [{
        key: 'county', label: 'Bexar County', short: 'county', n: 15,
        metrics: { 'grad:0': 89, 'grad:1': 2.4, 'ccmr:0': 75, 'ccmr:1': 18 },
        metricN: { 'grad:0': 14, 'grad:1': 13, 'ccmr:0': 15, 'ccmr:1': 12 },
      }],
      graduation: [
        { label: 'Four-Year Graduation Rate', value: 91 },
        { label: 'Dropout Rate', value: 1.8 },
      ],
      ccmr: [
        { label: 'College, career or military ready', value: 78 },
        { label: 'Earned an industry-based certification', value: 22 },
      ],
    }))
    expect(html).toContain("TEA's standard-accountability population")
    expect(html).toContain('14</span> rated districts reporting')
    expect(html).toContain('13</span> rated districts reporting')
    expect(html).toContain('data-metric="ccmr:1"')
    expect(html).toContain('12</span> rated districts reporting')
    expect(html).toContain('Reporting<small>selected comparison</small>')
    expect(html).toContain('full cohort membership, not the denominator of every average')
  })

  it('keeps original graduation and CCMR keys when earlier source rows are suppressed', () => {
    const html = outcomes(page({
      own: { 'grad:2': 93, 'ccmr:2': 44 },
      metrics: { 'grad:2': 90, 'ccmr:2': 40 },
      metricN: { 'grad:2': 12, 'ccmr:2': 11 },
      graduation: [{ key: 'grad:2', index: 2, label: 'Six-Year Graduation Rate', value: 93 }],
      ccmr: [{ key: 'ccmr:2', index: 2, label: 'Earned an associate degree', value: 44 }],
    }))
    expect(html).toContain('data-metric="grad:2"')
    expect(html).not.toContain('data-metric="grad:0"')
    expect(html).toContain('<tr data-metric="ccmr:2">')
    expect(html).not.toContain('<tr data-metric="ccmr:0">')
  })

  it('states per-category coverage for composition averages and keeps salary contextual', () => {
    const compositionHtml = students(page({
      profile: {
        total: 1_000, ecoDisPct: 60, engLrnPct: 20, specEdPct: 12,
        attendance: 94, absenteeism: 14,
      },
      raceShare: [45, 35],
      metrics: { 'race:0': 40, 'race:1': 38 },
      metricN: { 'race:0': 10, 'race:1': 12 },
    }))
    expect(compositionHtml).toContain('10&ndash;12 reporting, depending on category')
    expect(compositionHtml).toContain('15 in full cohort')
    expect(compositionHtml).toContain('data-pin-composition="race"')
    expect(compositionHtml).toContain('data-pin-composition-labels=')
    expect(compositionHtml).not.toContain('precomputed composition average is not available')

    const salaryHtml = teachers(page({
      profile: { avgSalary: 60_000, teachers: 80 },
      own: { avgSalary: 60_000, teachers: 80 },
      metrics: { avgSalary: 55_000, teachers: 75 },
      metricN: { avgSalary: 15, teachers: 15 },
    }))
    expect(salaryHtml).toContain('cmp cmp-neutral')
    expect(salaryHtml).toContain('data-neutral="1"')
    expect(salaryHtml).not.toContain('cmp-up')
    expect(salaryHtml).not.toContain('cmp-down')
    expect(salaryHtml).toContain('data-metric="teachers"')
  })

  it('keeps spending hooks and year-specific coverage when only a later cohort reports', () => {
    const key2024 = publicMetric.spending('2024')
    const key2025 = publicMetric.spending('2025')
    const html = spending(page({
      own: { [key2024]: 12_000, [key2025]: 12_500 },
      cohorts: [
        { key: 'peer', label: 'Similar context', short: 'similar', n: 10, metrics: {}, metricN: {} },
        {
          key: 'state', label: 'Texas average', short: 'state', n: 1_019,
          metrics: { [key2024]: 13_000, [key2025]: 13_500 },
          metricN: { [key2024]: 1_010, [key2025]: 1_005 },
        },
      ],
      finance: {
        years: ['2024', '2025'], spendEntity: [12_000, 12_500],
        spendPeer: [], spendState: [], vsPeer: null, vsState: null,
      },
    }))
    expect(html).toContain('Selected comparison average')
    expect(html).toContain('Reporting<small>selected comparison</small>')
    expect(html).toContain(`data-comparison-cell data-metric="${key2024}"`)
    expect(html).toContain(`data-comparison-readout data-metric="${key2025}"`)
    expect(html).toContain('hidden style="display:none"')
    expect(html).toContain('reporting count is year-specific and can vary')
    expect(readoutValues(html, key2025)).toMatchObject({
      entity: '$12,500', comparison: '—', hidden: true,
    })
  })

  it('labels the no-JS statewide spending line with its latest reporting n, not full membership', () => {
    const key = publicMetric.spending('2025')
    const html = spending(page({
      finance: {
        years: ['2025'], spendEntity: [12_000], spendPeer: [11_000], spendState: [11_500],
        vsPeer: 1_000, vsState: 500,
      },
      cohorts: [{
        key: 'state', label: 'Texas average', short: 'state', n: 1_019,
        metrics: { [key]: 11_700 }, metricN: { [key]: 981 },
      }],
      own: { [key]: 12_000 },
    }))
    expect(html).toContain('981 rated Texas districts reporting for 2025')
    expect(html).not.toContain('1,019 rated Texas districts')
    expect(readoutValues(html, key)).toMatchObject({
      entity: '$12,000', comparison: '$11,700', hidden: false,
    })
  })

  it('uses percentage-point campus notice flags and explains precomputed pin gaps', () => {
    const campusHtml = actionNotices(page({
      level: 'campus', name: 'Southside High School',
      own: { [publicMetric.campusImprovement]: 100, [publicMetric.campusPeg]: 0 },
      metrics: { [publicMetric.campusImprovement]: 12.5, [publicMetric.campusPeg]: 4.2 },
      metricN: { [publicMetric.campusImprovement]: 80, [publicMetric.campusPeg]: 80 },
      actionNotices: [{
        id: '015917001', name: 'Southside High School',
        improvement: { kind: 'TSI', supportLabel: 'Targeted support' }, peg: null,
      }],
    }))
    expect(campusHtml).toContain('12.5%')
    expect(campusHtml).toContain(hook(publicMetric.campusImprovement))
    expect(campusHtml).toContain('share of reporting schools')
    expect(campusHtml).not.toContain('0.1%')
    expect(readoutValues(campusHtml, publicMetric.campusImprovement)).toMatchObject({
      entity: 'Listed', comparison: '12.5%',
    })
    expect(readoutValues(campusHtml, publicMetric.campusPeg)).toMatchObject({
      entity: 'Not listed', comparison: '4.2%',
    })

    const card = {
      id: 'rank:attendance', kind: 'rank', metric: 'attendance', metrics: ['attendance'],
      label: 'Attendance', latestYear: '2025-26',
      evidence: [{
        kind: 'rank', period: 'current', metric: 'attendance', label: 'Attendance', fmt: 'pct',
        cohort: 'county', cohortLabel: 'Bexar County', rank: 1, of: 15, tied: 0,
        value: 98, lowerIsBetter: false,
      }],
    }
    expect(highlights(page({ highlightsByCohort: { county: [card] } }))).toContain('data-comparison-pin-unavailable')

    const placement = {
      metric: 'attendance', label: 'Attendance', cohort: 'county', cohortLabel: 'Bexar County',
      rank: 1, of: 15, tied: 0, value: 98, lowerIsBetter: false,
    }
    const standoutHtml = standouts(page({ standouts: [placement], ranks: [placement] }))
    expect(standoutHtml).toContain('Attendance')
    expect(standoutHtml).not.toContain('data-comparison-cohort')
    expect(standoutHtml).not.toContain('data-comparison-pin-unavailable')
  })
})
