// test/render/sections.test.js
//
// Every section is (vm) => html | null. That null is the whole design: a district
// with no finance file, or a campus TEA declined to rate, needs no special case
// anywhere, because the section simply vanishes. The first suite below is
// therefore the load-bearing one — if a section starts returning an empty shell
// instead of null, missing data becomes visible as an empty heading.
//
// The second load-bearing property is claimSentence: a rank published without its
// denominator, its cohort, or its tie count is a boast, not a fact.

import { describe, it, expect } from 'vitest'
import {
  SECTIONS, HERO_ID, HERO_LABEL, claimSentence, verdict, trajectory, domains, outcomes,
  students, spending, teachers, campuses, standouts, source,
} from '../../src/render/sections.js'

/** A view model with every optional source absent. */
const empty = (over = {}) => ({
  id: '057905',
  name: 'Dallas ISD',
  level: 'district',
  county: 'Dallas',
  regionId: '10',
  regionName: 'Region 10',
  slug: 'dallas-isd-057905',
  snapshotDate: '15 August 2026',
  isCharter: false,
  isAlt: false,
  enrollment: null,
  multYear: 0,
  notRated: false,
  history: [],
  stateByYear: {},
  stateAvg: null,
  peerByYear: null,
  peerAvg: null,
  peerN: 0,
  comparisons: [],
  rank: 0,
  rankOf: 0,
  regionRank: 0,
  regionRankOf: 0,
  domains: [],
  profile: null,
  raceShare: null,
  staffYears: null,
  staar: null,
  graduation: null,
  ccmr: null,
  finance: null,
  campuses: null,
  cohorts: [],
  own: {},
  ranks: [],
  standouts: [],
  ...over,
})

const COHORTS = [
  { key: 'peer', label: 'Similar student population', short: 'similar', n: 294, metrics: { 'domain:achievement': 70, 'staar:Reading:0': 68, 'ccmr:0': 55, ecoDis: 60, absenteeism: 15, avgSalary: 57_000 } },
  { key: 'state', label: 'Texas average', short: 'state', n: 1_207, metrics: { 'domain:achievement': 72 } },
]

/* --------------------------------------------------- absence needs no case -- */

const OPTIONAL = [
  ['trajectory', trajectory],
  ['domains', domains],
  ['outcomes', outcomes],
  ['students', students],
  ['spending', spending],
  ['teachers', teachers],
  ['campuses', campuses],
  ['standouts', standouts],
]

describe('a section with no data', () => {
  it('returns null rather than an empty heading', () => {
    for (const [name, fn] of OPTIONAL) expect(fn(empty()), `${name} did not return null`).toBeNull()
  })

  it('lets the whole page compose from an entity with nothing but a name', () => {
    const rendered = SECTIONS.map((fn) => fn(empty())).filter(Boolean)
    // Only the verdict and the provenance note survive, and neither needs data.
    expect(rendered).toHaveLength(2)
    expect(rendered.join('')).toContain('Dallas ISD')
  })

  it('lists the sections in page order, verdict first and source last', () => {
    expect(SECTIONS[0]).toBe(verdict)
    expect(SECTIONS.at(-1)).toBe(source)
    expect(new Set(SECTIONS).size).toBe(SECTIONS.length)
  })

  it('returns null for each specific absence, one source at a time', () => {
    expect(trajectory(empty({ history: null }))).toBeNull()
    expect(domains(empty({ domains: null }))).toBeNull()
    expect(outcomes(empty({ staar: { subjects: [] }, graduation: [], ccmr: [] }))).toBeNull()
    expect(students(empty({ profile: null }))).toBeNull()
    expect(spending(empty({ finance: { years: [] } }))).toBeNull()
    expect(teachers(empty({ profile: { avgSalary: null } }))).toBeNull()
    expect(campuses(empty({ campuses: [] }))).toBeNull()
    expect(standouts(empty({ standouts: [] }))).toBeNull()
  })

  it('renders each section once its own source arrives, and no other', () => {
    const one = (over) => OPTIONAL.filter(([, fn]) => fn(empty(over)) !== null).map(([n]) => n)

    expect(one({ history: [{ year: '2025-26', rating: 'B', score: 88 }] })).toEqual(['trajectory'])
    expect(one({ domains: [{ domain: 'achievement', label: 'Student Achievement', score: 88, grade: 'B', toNextGrade: 2 }] })).toEqual(['domains'])
    expect(one({ profile: { total: 1000, ecoDisPct: 60, engLrnPct: 20, specEdPct: 10, attendance: 94, absenteeism: 15, avgSalary: null } })).toEqual(['students'])
    expect(one({ campuses: [{ slug: 'a-1', name: 'A', rating: 'B', score: 80, enrollment: 100, campusType: 'High School' }] })).toEqual(['campuses'])
  })
})

/* ------------------------------------------------------------------ verdict */

describe('verdict', () => {
  it('always renders, because the name and place never depend on TEA data', () => {
    const html = verdict(empty())
    expect(html).toContain('<h1>Dallas ISD</h1>')
    expect(html).toContain('Dallas County')
  })

  it('states the change since the first year on record', () => {
    const html = verdict(empty({ history: [{ year: '2025-26', rating: 'B', score: 88 }, { year: '2023-24', rating: 'C', score: 79 }] }))
    // The verdict rewrite (2026-08) moved "up"/"down" inside the <strong> with
    // the point count, so the whole clause is emphasised as one claim rather
    // than the number alone.
    expect(html).toMatch(/is <strong>up 9 points<\/strong> since 2023-24/)
  })

  it('says unchanged rather than up zero points', () => {
    const html = verdict(empty({ history: [{ year: '2025-26', score: 80 }, { year: '2023-24', score: 80 }] }))
    expect(html).toContain('unchanged since 2023-24')
  })

  it('states the denominator with every rank it claims', () => {
    const html = verdict(empty({ history: [{ year: '2025-26', score: 88 }], rank: 12, rankOf: 1207, regionRank: 3, regionRankOf: 87 }))
    expect(html).toContain('12th of 1,207')
    expect(html).toContain('3rd of 87')
  })

  it('names the cohort behind the peer comparison, with its n', () => {
    const html = verdict(empty({ history: [{ year: '2025-26', score: 88 }], peerAvg: 70, peerN: 294 }))
    expect(html).toContain('294')
    expect(html).toMatch(/economically disadvantaged/)
  })

  it('warns about consecutive unacceptable years, and names the intervention threshold', () => {
    const two = verdict(empty({ multYear: 2 }))
    expect(two).toContain('<strong>2 consecutive years</strong> rated unacceptable')
    expect(two).not.toContain('state intervention')

    const one = verdict(empty({ multYear: 1 }))
    expect(one).toContain('<strong>1 consecutive year</strong>') // singular

    expect(verdict(empty({ multYear: 3 }))).toContain('state intervention')
    expect(verdict(empty())).not.toContain('rated unacceptable')
  })

  it('explains a Not Rated entity instead of implying a failure', () => {
    expect(verdict(empty({ notRated: true }))).toContain('TEA did not issue an overall rating')
    expect(verdict(empty())).not.toContain('TEA did not issue an overall rating')
  })

  it('escapes the entity name', () => {
    expect(verdict(empty({ name: 'A <b>B</b> ISD' }))).toContain('A &lt;b&gt;B&lt;/b&gt; ISD')
  })

  /* The cohort switch moved to the rail. What is asserted here is that it left
     the hero and that nothing it was sitting next to left with it — the verdict
     and the intervention alert are the reasons the hero exists. */

  it('no longer carries the cohort switch, which the rail now owns', () => {
    const html = verdict(empty({ cohorts: COHORTS, own: { ecoDis: 88 } }))
    expect(html).not.toContain('cohort-bar')
    expect(html).not.toContain('chip-cohort')
    expect(html).not.toContain('data-cohorts')
    expect(html).not.toContain('data-own')
  })

  it('keeps the verdict card and the intervention alert', () => {
    const html = verdict(empty({ cohorts: COHORTS, multYear: 3, history: [{ year: '2025-26', rating: 'F', score: 55 }] }))
    expect(html).toContain('<div class="verdict">')
    expect(html).toContain('class="alert"')
    expect(html).toContain('state intervention')
  })

  // The hero is the one section whose heading is an <h1>, so the rail cannot
  // read a label off it. It declares one instead, and an id to link to; without
  // both, "On this page" would start at the second section.
  it('carries an id and a rail label, so the section index can point at it', () => {
    const html = verdict(empty())
    expect(html).toContain(`id="${HERO_ID}"`)
    expect(html).toContain(`data-rail-label="${HERO_LABEL}"`)
    expect(HERO_LABEL).not.toBe('Dallas ISD')
  })

  it('gives every section that renders an id, so no rail link is a dead anchor', () => {
    const full = empty({
      history: [{ year: '2025-26', rating: 'B', score: 88 }],
      domains: [{ domain: 'achievement', label: 'Student Achievement', score: 88, grade: 'B', toNextGrade: 2 }],
      profile: { total: 100, ecoDisPct: 60, engLrnPct: 5, specEdPct: 5, attendance: 95, absenteeism: 10, avgSalary: 60_000 },
      campuses: [{ slug: 'a-1', name: 'A', rating: 'B', score: 80, enrollment: 100, campusType: 'High School' }],
    })
    for (const html of SECTIONS.map((fn) => fn(full)).filter(Boolean)) {
      expect(html.match(/<section\b[^>]*\sid="[^"]+"/), html.slice(0, 80)).not.toBeNull()
    }
  })
})

/* --------------------------------------------------------------- trajectory */

describe('trajectory', () => {
  const vm = empty({
    history: [
      { year: '2025-26', rating: 'B', score: 88 },
      { year: '2024-25', rating: 'C', score: 79 },
    ],
    stateByYear: { '2025-26': 72.4, '2024-25': 71.1 },
    peerByYear: { '2025-26': 70.2, '2024-25': 69.0 },
    comparisons: [
      { key: 'state', label: 'Texas average', n: 1207, byYear: { '2025-26': 72.4, '2024-25': 71.1 } },
      { key: 'peer', label: 'Similar student population', n: 294, byYear: { '2025-26': 70.2, '2024-25': 69.0 }, note: 'Within 10 points' },
    ],
  })

  it('draws the chart AND the table, so the figures survive without SVG', () => {
    const html = trajectory(vm)
    expect(html).toContain('<svg')
    expect(html).toContain('<table')
    expect(html).toContain('>88<')
    expect(html).toContain('>79<')
  })

  it('states an n on every comparison chip', () => {
    const html = trajectory(vm)
    expect(html).toContain('1,207')
    expect(html).toContain('294')
  })

  it('embeds the comparison payload with < escaped, so it cannot close the script tag', () => {
    const html = trajectory(vm)
    expect(html).toContain('data-trajectory')
    const payload = html.slice(html.indexOf('data-trajectory'), html.indexOf('</script>'))
    expect(payload).not.toContain('</script')
    expect(payload).not.toMatch(/[^\\]<[a-z/]/i)
  })

  // The footnote is now conditional: 657 pages used to explain a methodology
  // refresh for a year they had no row for. These fixtures therefore carry a
  // 2021-22 row, and the negative case asserts the footnote stays away without one.
  const withRefreshYear = (over = {}) =>
    empty({
      ...vm,
      history: [...vm.history, { year: '2021-22', rating: 'C', score: 74 }],
      ...over,
    })

  it('explains the 2021-22 methodology refresh when that year is on the page', () => {
    expect(trajectory(withRefreshYear())).toContain('refreshed methodology')
  })

  it('omits the refresh footnote when the page has no 2021-22 row', () => {
    expect(trajectory(vm)).not.toContain('refreshed methodology')
  })

  it('reports the original score where TEA published one', () => {
    const html = trajectory(withRefreshYear({ originalScore: 61, originalRating: 'D' }))
    expect(html).toContain('<strong>61</strong>')
    expect(html).toContain('<strong>D</strong>')
  })
})

/* ------------------------------------------------------------------ domains */

describe('domains', () => {
  const vm = empty({
    domains: [
      { domain: 'achievement', label: 'Student Achievement', score: 88, grade: 'B', toNextGrade: 2 },
      { domain: 'gaps', label: 'Closing the Gaps', score: null, grade: null, toNextGrade: null },
    ],
    cohorts: COHORTS,
  })

  it('shows a domain TEA did not rate rather than dropping it', () => {
    const html = domains(vm)
    expect(html).toContain('Closing the Gaps')
    expect(html).toContain('Not rated')
  })

  it('names the closest domain to a higher grade, with the next letter', () => {
    expect(domains(vm)).toMatch(/Closest to moving up: <strong>Student Achievement<\/strong>, 2 points below A/)
  })

  it('says point, singular, when one point away', () => {
    const one = domains(empty({ domains: [{ domain: 'gaps', label: 'Closing the Gaps', score: 89, grade: 'B', toNextGrade: 1 }] }))
    expect(one).toContain('1 point below A')
  })

  it('states the n of every cohort in the legend', () => {
    expect(domains(vm)).toContain('Similar student population (294)')
    expect(domains(vm)).toContain('Texas average (1,207)')
  })

  it('renders without any cohort at all', () => {
    const html = domains(empty({ domains: vm.domains }))
    expect(html).toContain('Student Achievement')
    expect(html).not.toContain('<ul class="legend">')
  })
})

/* ----------------------------------------------------------------- outcomes */

describe('outcomes', () => {
  it('renders on STAAR alone', () => {
    const html = outcomes(empty({
      staar: { subjects: ['Reading'], levels: [[80], [55], [30]] },
      cohorts: COHORTS,
    }))
    expect(html).toContain('STAAR performance')
    expect(html).not.toContain('Graduation')
    expect(html).toContain('a comparison TEA does not publish')
  })

  it('renders on graduation alone, and labels completion for an AEA entity', () => {
    const grad = [{ label: 'Four-Year Graduation Rate', value: 94.1 }, { label: 'Dropout Rate', value: 1.2 }]
    expect(outcomes(empty({ graduation: grad }))).toContain('<h3>Graduation</h3>')
    expect(outcomes(empty({ isAlt: true, graduation: grad }))).toContain('<h3>Completion</h3>')
  })

  it('renders on CCMR alone, naming the cohort column and showing the gap', () => {
    const html = outcomes(empty({
      ccmr: [{ label: 'College, career or military ready', value: '61%' }],
      cohorts: COHORTS,
      own: { 'ccmr:0': 61 },
    }))
    expect(html).toContain('similar') // the cohort's short name heads the column
    expect(html).toContain('55.0%')
    expect(html).toMatch(/cmp-up">\+6\.0/)
  })

  it('shows an em dash for a gap it cannot compute, rather than zero', () => {
    const html = outcomes(empty({ ccmr: [{ label: 'X', value: '61%' }], cohorts: COHORTS, own: {} }))
    expect(html).toContain('<td class="num">—</td>')
    expect(html).not.toMatch(/cmp-(up|down)">.0\.0/)
  })
})

/* ----------------------------------------------------------------- students */

describe('students', () => {
  const profile = { total: 138_000, ecoDisPct: 88.4, engLrnPct: 40.2, specEdPct: 11.9, attendance: 92.1, absenteeism: 22.6 }

  it('states each share with its comparison against the active cohort', () => {
    const html = students(empty({ profile, cohorts: COHORTS, own: { ecoDis: 88.4, absenteeism: 22.6 } }))
    expect(html).toContain('88.4%')
    // Demographics are context, not performance. A school serving MORE
    // economically disadvantaged students is not thereby doing better or worse,
    // and this assertion previously demanded the green "up" treatment — encoding
    // the defect it should have caught.
    expect(html).toMatch(/cmp-neutral[^>]*data-metric="ecoDis"/)
    expect(html).not.toMatch(/cmp-up[^>]*data-metric="ecoDis"/)
    expect(html).toContain('vs similar')
  })

  it('treats a HIGH chronic-absence figure as worse, not better', () => {
    const html = students(empty({ profile, cohorts: COHORTS, own: { absenteeism: 22.6 } }))
    const chip = html.slice(html.indexOf('data-metric="absenteeism"') - 60, html.indexOf('data-metric="absenteeism"') + 60)
    expect(chip).toContain('cmp-down')
    expect(chip).toContain('data-invert="1"')
  })

  it('draws demographics only where TEA reported a share above zero', () => {
    const html = students(empty({ profile, raceShare: [10, 60, 30, 0, 0, 0, 0] }))
    expect(html).toContain('Student demographics')
    expect(html).toContain('African American 10%')
    expect(html).not.toContain('Pacific Islander')
  })

  it('omits the demographic chart when TEA reported nothing', () => {
    expect(students(empty({ profile }))).not.toContain('Student demographics')
  })
})

/* ------------------------------------------------------------------ spending */

describe('spending', () => {
  const fin = {
    years: ['2022-23', '2023-24'],
    spendEntity: [10_000, 12_000],
    spendPeer: [10_500, 12_500],
    spendState: [11_000, 13_000],
    vsPeer: -500,
    vsState: -1_000,
  }

  it('states the gap against the peer group and the state in dollars', () => {
    const html = spending(empty({ finance: fin }))
    expect(html).toContain('<strong>$500 less</strong>')
    expect(html).toContain('<strong>$1,000 less</strong>')
  })

  it('says plainly that TEA published no peer figure, rather than showing nothing', () => {
    const html = spending(empty({ finance: { ...fin, spendPeer: [null, null], vsPeer: null, vsState: null } }))
    expect(html).toContain('does not include peer-group spending')
    expect(html).toContain('Not reported by TEA for this entity: peer')
  })

  it('names TEA as the source of the peer group, not this site', () => {
    expect(spending(empty({ finance: fin }))).toContain("TEA's own peer group")
  })
})

/* ------------------------------------------------------------------ teachers */

describe('teachers', () => {
  it('renders on salary alone', () => {
    const html = teachers(empty({ profile: { avgSalary: 61_500 } }))
    expect(html).toContain('$61,500')
    expect(html).not.toContain('Teaching experience')
  })

  it('adds experience only where TEA reported it', () => {
    const html = teachers(empty({ profile: { avgSalary: 61_500 }, staffYears: [5, 30, 25, 20, 15, 5] }))
    expect(html).toContain('Teaching experience')
    expect(html).toContain('Beginning 5%')
  })
})

/* ------------------------------------------------------------------ campuses */

describe('campuses', () => {
  it('links every campus by its slugged URL and states the count', () => {
    const html = campuses(empty({
      campuses: [
        { slug: 'a-h-s-001902001', name: 'A H S', campusType: 'High School', rating: 'B', score: 88, enrollment: 400 },
        { slug: 'b-el-001902101', name: 'B El', campusType: null, rating: null, score: null, enrollment: null },
      ],
    }))
    expect(html).toContain('href="/campus/a-h-s-001902001"')
    expect(html).toContain('2 schools in this district')
    expect(html).toContain('<td>—</td>') // an unreported campus type
  })
})

/* -------------------------------------------------------------- claimSentence */

const vmFor = (over = {}) => empty({ name: 'Cayuga ISD', ...over })

const rank = (over = {}) => ({
  metric: 'score', label: 'Overall score', fmt: 'points',
  cohort: 'state', cohortLabel: 'Texas average', cohortShort: 'state',
  rank: 2, of: 1207, pctile: 100, value: 98, tied: 0, lowerIsBetter: false,
  ...over,
})

describe('claimSentence', () => {
  it('states the rank, the denominator, the cohort and the metric', () => {
    const s = claimSentence(vmFor(), rank())
    expect(s).toContain('Cayuga ISD ranks 2nd of 1207 Texas districts')
    expect(s).toContain('Overall score')
    expect(s).toContain('txschools.net')
  })

  it('never states a rank without its n', () => {
    for (const r of [rank({ rank: 1 }), rank({ rank: 11 }), rank({ rank: 23 }), rank({ cohort: 'peer' })]) {
      expect(claimSentence(vmFor(), r)).toMatch(new RegExp(`ranks \\d+(st|nd|rd|th) of ${r.of}\\b`))
    }
  })

  it('names the peer cohort by what defines it, not by a label', () => {
    const s = claimSentence(vmFor(), rank({ cohort: 'peer', cohortLabel: 'Similar student population' }))
    expect(s).toContain('districts serving a similar share of economically disadvantaged students')
  })

  it('names a region or county cohort by its own label', () => {
    expect(claimSentence(vmFor(), rank({ cohort: 'region', cohortLabel: 'Region 10' }))).toContain('districts in Region 10')
    expect(claimSentence(vmFor(), rank({ cohort: 'county', cohortLabel: 'Dallas County' }))).toContain('districts in Dallas County')
  })

  it('says schools, not districts, for a campus', () => {
    const s = claimSentence(vmFor({ level: 'campus' }), rank())
    expect(s).toContain('Texas schools')
    expect(s).not.toContain('districts')
  })

  it('states the tie count, so a shared ceiling is never read as a sole placement', () => {
    const s = claimSentence(vmFor(), rank({ rank: 1, of: 1084, tied: 213, label: 'Four-Year Graduation Rate' }))
    expect(s).toContain('tied with 213 others')
    expect(s).toContain('1st of 1084')
  })

  it('says one other, singular, for a single tie', () => {
    expect(claimSentence(vmFor(), rank({ tied: 1 }))).toContain('tied with 1 other.')
  })

  it('adds no tie clause at all when the placement is sole', () => {
    expect(claimSentence(vmFor(), rank({ tied: 0 }))).not.toContain('tied')
  })

  it('says lowest, not highest, for a metric where less is better', () => {
    expect(claimSentence(vmFor(), rank({ metric: 'absenteeism', label: 'Chronically absent', lowerIsBetter: true }))).toContain('(lowest,')
    expect(claimSentence(vmFor(), rank())).toContain('(highest,')
  })

  it('gets the ordinal suffix right for the awkward numbers', () => {
    const at = (n) => claimSentence(vmFor(), rank({ rank: n })).match(/ranks (\d+\w\w) /)[1]
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(at)).toEqual(
      ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th']
    )
  })
})

/* ---------------------------------------------------------------- standouts */

describe('standouts', () => {
  const vm = empty({
    standouts: [
      rank({ rank: 2, of: 1207, tied: 0 }),
      rank({ metric: 'grad:0', label: 'Four-Year Graduation Rate', rank: 1, of: 1084, tied: 213, cohort: 'peer', cohortLabel: 'Similar student population' }),
    ],
    ranks: Array.from({ length: 87 }, () => rank()),
  })

  it('shows the denominator beside every rank', () => {
    const html = standouts(vm)
    expect(html).toContain('of 1,207')
    expect(html).toContain('of 1,084')
  })

  it('shows the tie count on a shared placement', () => {
    expect(standouts(vm)).toContain('tied with 213')
  })

  it('says outright that this is a selection, not a summary', () => {
    const html = standouts(vm)
    expect(html).toContain('These are selected high placements, not a summary')
    expect(html).toContain('a rank without an n is a boast')
  })

  it('states how many rankings the selection was drawn from', () => {
    expect(standouts(vm)).toContain('Out of 87 rankings')
  })

  it('offers a copyable claim that carries its own cohort and denominator', () => {
    const html = standouts(vm)
    const claim = html.match(/data-claim="([^"]+)"/)[1]
    expect(claim).toContain('of 1207')
    expect(claim).toContain('Source: txschools.net')
    expect(html).toContain('aria-label="Copy this statement"')
  })

  it('marks a lower-is-better placement so first does not read as highest', () => {
    const html = standouts(empty({ ...vm, standouts: [rank({ metric: 'absenteeism', label: 'Chronically absent', lowerIsBetter: true })] }))
    expect(html).toContain('(lowest is best)')
  })
})

/* ------------------------------------------------------------------- source */

describe('source', () => {
  it('always renders, and points at TEA as the origin of every figure', () => {
    const html = source(empty())
    expect(html).toContain('Texas Education Agency')
    expect(html).toContain('txschools.gov')
    expect(html).toContain('15 August 2026')
  })

  it('offers the per-entity downloads at the settled URLs', () => {
    const html = source(empty())
    expect(html).toContain('href="/data/entity/057905.csv"')
    expect(html).toContain('href="/data/entity/057905.json"')
    expect(html).toContain('href="/download"')
  })

  it('marks the outbound TEA link nofollow', () => {
    expect(source(empty())).toContain('rel="nofollow"')
  })
})
