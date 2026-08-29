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
  SECTIONS, HERO_ID, HERO_LABEL, claimSentence, verdict, trajectory, changeRankings, domains, outcomes,
  students, accountabilityContext, enrollment, transfers, discipline, actionNotices, community, postsecondary, spending, teachers, campuses, highlights, standouts, source, rankingHref, rankingPositions, boardPageOf,
  rankedBoard, officialWebsiteHref,
} from '../../src/render/sections.js'
import { PAGE_ROWS } from '../../src/render/rankings-page.js'

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
  enrollmentHistory: [],
  enrollmentTrend: null,
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
  highlights: [],
  ...over,
})

const COHORTS = [
  { key: 'peer', label: 'Similar student population', short: 'similar', n: 294, metrics: { 'domain:achievement': 70, 'staar:Reading:0': 68, 'ccmr:0': 55, ecoDis: 60, absenteeism: 15, avgSalary: 57_000 }, metricN: { 'domain:achievement': 286, 'staar:Reading:0': 280 } },
  { key: 'state', label: 'Texas average', short: 'state', n: 1_207, metrics: { 'domain:achievement': 72 }, metricN: { 'domain:achievement': 1_199 } },
]

/* --------------------------------------------------- absence needs no case -- */

const OPTIONAL = [
  ['trajectory', trajectory],
  ['changeRankings', changeRankings],
  ['domains', domains],
  ['outcomes', outcomes],
  ['students', students],
  ['accountabilityContext', accountabilityContext],
  ['enrollment', enrollment],
  ['transfers', transfers],
  ['discipline', discipline],
  ['actionNotices', actionNotices],
  ['community', community],
  ['postsecondary', postsecondary],
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
    expect(accountabilityContext(empty({ accountabilityContext: null }))).toBeNull()
    expect(enrollment(empty({ enrollmentTrend: { points: [{ year: '2025-26', enrollment: 100 }] } }))).toBeNull()
    expect(transfers(empty({ transferContext: null }))).toBeNull()
    expect(discipline(empty({ discipline: null }))).toBeNull()
    expect(actionNotices(empty({ actionNotices: [] }))).toBeNull()
    expect(community(empty({ communityContext: null }))).toBeNull()
    expect(postsecondary(empty({ postsecondaryOutcome: null }))).toBeNull()
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
    expect(one({ enrollmentTrend: {
      points: [{ year: '2024-25', enrollment: 900 }, { year: '2025-26', enrollment: 1_000 }],
      latest: { year: '2025-26', enrollment: 1_000 },
      yoy: { fromYear: '2024-25', toYear: '2025-26', from: 900, to: 1_000, delta: 100, pct: 11.111 },
      sinceFirst: null,
    } })).toEqual(['enrollment'])
    expect(one({ campuses: [{ slug: 'a-1', name: 'A', rating: 'B', score: 80, enrollment: 100, campusType: 'High School' }] })).toEqual(['campuses'])
  })
})

describe('accountability-summary context', () => {
  const datum = (value, status = 'reported', raw = value == null ? null : String(value)) => ({ value, status, raw })
  const context = {
    id: '001902001', level: 'campus', year: '2025-26',
    students: { all: datum(195), economicallyDisadvantaged: datum(85), emergentBilingual: datum(0), specialEducation: datum(null, 'masked-small', '*') },
    programs: {
      earlyCollegeHighSchool: { count: datum(0) },
      pathwaysInTechnologyEarlyCollegeHighSchool: { count: datum(null, 'not-reported', null) },
    },
    mobility: { year: '2024-25', mobileStudents: datum(20), denominatorStudents: datum(203), ratePct: datum(9.9) },
  }

  it('shows reported zero, masking, and the separate mobility denominator without estimates', () => {
    const html = accountabilityContext(empty({
      level: 'campus', accountabilityContext: context,
      publicDataMeta: { accountability: { fetchedAt: '29 August 2026', masking: 'https://example.test/masking' } },
    }))
    expect(html).toContain('Emergent bilingual students</dt><dd>0</dd>')
    expect(html).toContain('Students in this TEA accountability summary</dt><dd>195</dd>')
    expect(html).toContain('Special education students</dt><dd>Masked — small number (*)</dd>')
    expect(html).toContain('Mobile students</dt><dd>20</dd>')
    expect(html).toContain('Students in TEA mobility denominator</dt><dd>203</dd>')
    expect(html).toContain('TEA-published mobility rate</dt><dd>9.9%</dd>')
    expect(html).not.toContain('Early college pathways')
    expect(html).not.toMatch(/data-(?:comparison|rank|cohort)/)
    expect(html).toContain('Context only')
    expect(html).toContain('separate publication from the fall PEIMS enrollment')
  })

  it('shows an Early College or P-TECH count only when it is positive or masked', () => {
    const relevant = structuredClone(context)
    relevant.programs.earlyCollegeHighSchool.count = datum(12)
    relevant.programs.earlyCollegeHighSchool.sharePct = datum(6.2)
    relevant.flags = {
      newCampus: datum(true),
      charterSchool: datum(false),
      alternativeEducationType: datum('Residential treatment facility'),
    }
    const html = accountabilityContext(empty({ accountabilityContext: relevant }))
    expect(html).toContain('Early college pathways')
    expect(html).toContain('Early College High School</dt><dd>12')
    expect(html).toContain('TEA-published share: 6.2%')
    expect(html).toContain('New campus compared with last year’s fall enrollment')
    expect(html).toContain('Residential treatment facility')
    expect(html).not.toContain('Charter school')
  })
})

/* ------------------------------------------------------------------ verdict */

describe('verdict', () => {
  it('always renders, because the name and place never depend on TEA data', () => {
    const html = verdict(empty())
    expect(html).toContain('<section class="hero hero-entity"')
    expect(html).toContain('<div class="entity-intro">')
    expect(html).toContain('<h1>Dallas ISD</h1>')
    expect(html).toContain('Dallas County')
  })

  it('labels an online campus and does not present its mailing city as a physical location', () => {
    const html = verdict(empty({
      level: 'campus', isCharter: true, isOnline: true,
      districtName: 'Statewide Charter System', city: 'Austin', county: 'Travis',
    }))
    expect(html).toContain('Open-enrollment charter campus &middot; Online school')
    expect(html).toContain('Statewide Charter System')
    expect(html).not.toContain('Austin')
  })

  it('labels a charter system city as administrative rather than geographic coverage', () => {
    const html = verdict(empty({ isCharter: true, city: 'Dallas', county: 'Dallas' }))
    expect(html).toContain('Administrative office: Dallas')
    expect(html).not.toContain('Dallas County')
  })

  it('states the change since the first year on record', () => {
    const html = verdict(empty({ history: [{ year: '2025-26', rating: 'B', score: 88 }, { year: '2023-24', rating: 'C', score: 79 }] }))
    // The verdict rewrite (2026-08) moved "up"/"down" inside the <strong> with
    // the point count, so the whole clause is emphasised as one claim rather
    // than the number alone.
    expect(html).toMatch(/is <strong>up 9 points<\/strong> since 2023-24/)
    expect(html).toContain('The available rating history is moving up.')
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
    expect(html).toContain('above comparable districts in a similar economic context')
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

  it('makes the official district site a clear enrollment action', () => {
    const html = verdict(empty({ website: 'www.dallasisd.org' }))
    expect(html).toContain('href="https://www.dallasisd.org/"')
    expect(html).toContain('<strong>Official district website</strong>')
    expect(html).toContain('Enrollment, registration and eligibility')
    expect(html).toContain('rel="external nofollow"')
  })

  it('uses school-specific official-site wording on a campus page', () => {
    const html = verdict(empty({ level: 'campus', website: 'schools.example.org/campus' }))
    expect(html).toContain('<strong>Official school website</strong>')
    expect(html).toContain('School information and family resources')
    expect(html).not.toContain('Enrollment, registration and eligibility')
  })

  it('omits the action when TEA did not publish a safe website', () => {
    expect(verdict(empty({ website: null }))).not.toContain('class="enroll')
    expect(verdict(empty({ website: 'javascript:alert(1)' }))).not.toContain('class="enroll')
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

/* ----------------------------------------------------------- highlights -- */

describe('strengths and momentum', () => {
  const spring = [
    {
      id: 'gain:score', kind: 'gain', metric: 'score', metrics: ['score'], label: 'Overall score',
      latestYear: '2025-26', previousYear: '2024-25',
      evidence: [
        { kind: 'change', metric: 'score', label: 'Overall score', fmt: 'points', fromValue: 65, toValue: 76, delta: 11, previousYear: '2024-25', latestYear: '2025-26' },
        { kind: 'rank', period: 'change', metric: 'score', label: 'Overall score', fmt: 'points', cohort: 'region', cohortLabel: 'Region 04: Houston', rank: 1, of: 46, tied: 0, value: 11, lowerIsBetter: false },
      ],
    },
    {
      id: 'gain:domain:gaps', kind: 'gain', metric: 'domain:gaps', metrics: ['domain:gaps'], label: 'Closing the Gaps',
      latestYear: '2025-26', previousYear: '2024-25',
      evidence: [
        { kind: 'change', metric: 'domain:gaps', label: 'Closing the Gaps', fmt: 'points', fromValue: 63, toValue: 77, delta: 14, previousYear: '2024-25', latestYear: '2025-26' },
        { kind: 'benchmark', metric: 'domain:gaps', label: 'Closing the Gaps', fmt: 'points', cohort: 'peer', cohortLabel: 'Similar economic-disadvantage rate', cohortN: 217, metricN: 217, coverage: 1, value: 77, benchmark: 74.7, advantage: 2.3, lowerIsBetter: false },
        { kind: 'rank', period: 'change', metric: 'domain:gaps', label: 'Closing the Gaps', fmt: 'points', cohort: 'region', cohortLabel: 'Region 04: Houston', rank: 1, of: 46, tied: 0, value: 14, lowerIsBetter: false },
      ],
    },
    {
      id: 'subject:math:peer', kind: 'subject-benchmark', metric: null,
      metrics: ['staar:Math:1', 'staar:Math:2'], label: 'Math — Meets and Masters', latestYear: '2025-26',
      evidence: [
        { kind: 'benchmark', metric: 'staar:Math:1', label: 'Math — Meets', fmt: 'pct', cohort: 'peer', cohortLabel: 'Similar economic-disadvantage rate', cohortN: 217, metricN: 217, coverage: 1, value: 35, benchmark: 33.8, advantage: 1.2, lowerIsBetter: false },
        { kind: 'benchmark', metric: 'staar:Math:2', label: 'Math — Masters', fmt: 'pct', cohort: 'peer', cohortLabel: 'Similar economic-disadvantage rate', cohortN: 217, metricN: 217, coverage: 1, value: 13, benchmark: 11.5, advantage: 1.5, lowerIsBetter: false },
      ],
    },
  ]

  it('renders no compliment when no rule finds supporting evidence', () => {
    expect(highlights(empty())).toBeNull()
    expect(verdict(empty())).not.toContain('Strengths and momentum')
  })

  it('puts Spring-style gains and peer results immediately inside the rating hero', () => {
    const html = verdict(empty({ name: 'Spring ISD', highlights: spring }))
    expect(html.indexOf('At a glance')).toBeLessThan(html.indexOf('Strengths and momentum'))
    expect(html.indexOf('Strengths and momentum')).toBeLessThan(html.indexOf('Read the full rating context'))
    expect(html).toContain('Overall score rose 11 points')
    expect(html).toContain('65 to 76')
    expect(html).toContain('Closing the Gaps rose 14 points')
    expect(html).toContain('2.3 points above')
    expect(html).toContain('217 districts with a similar economic-disadvantage rate')
    expect(html).toContain('Math above similar-context averages at Meets and Masters')
    expect(html).toContain('35%')
    expect(html).toContain('33.8% avg')
    expect(html).toContain('13%')
    expect(html).toContain('11.5% avg')
    // The selector must not silently rewrite these peer facts as statewide wins.
    expect(html).not.toContain('Math above Texas')
    expect(html).not.toContain('Closing the Gaps above the Texas')
    expect(html).toContain('aria-label="See the full Overall score measure"')
    expect(html).toContain('aria-label="See the full Closing the Gaps measure"')
    expect(html).toContain('aria-label="See the full Math — Meets and Masters measure"')
  })

  it('states a change placement with its period, scope, denominator and tie', () => {
    const tied = structuredClone(spring[0])
    tied.evidence[1] = { ...tied.evidence[1], cohort: 'state', rank: 2, of: 100, tied: 1, cohortLabel: 'Texas' }
    const html = highlights(empty({ highlights: [tied] }))
    expect(html).toContain('Tied for 2nd of 100 Texas districts reporting both years for one-year gain')
    expect(html).toContain('2 districts share that change')
  })

  it('writes a statewide current placement as a population, not “in Texas average”', () => {
    const card = {
      id: 'rank:attendance', kind: 'rank', metric: 'attendance', metrics: ['attendance'],
      label: 'Attendance', latestYear: '2025-26',
      evidence: [{ kind: 'rank', period: 'current', metric: 'attendance', label: 'Attendance', fmt: 'pct', cohort: 'state', cohortLabel: 'Texas average', rank: 2, of: 1_019, tied: 0, value: 98, lowerIsBetter: false }],
    }
    const html = highlights(empty({ highlights: [card] }))
    expect(html).toContain('<strong>98%</strong>')
    expect(html).toContain('2nd of 1,019 Texas districts reporting this measure')
    expect(html).toContain('2025-26')
    expect(html).toContain('of 1,019 Texas districts reporting this measure')
    expect(html).not.toContain('in Texas average')
  })

  it('keeps statewide charter-system and charter-campus placements inside their own sectors', () => {
    const card = {
      id: 'rank:attendance', kind: 'rank', metric: 'attendance', metrics: ['attendance'],
      label: 'Attendance', latestYear: '2025-26',
      evidence: [{ kind: 'rank', period: 'current', metric: 'attendance', label: 'Attendance', fmt: 'pct', cohort: 'state', cohortLabel: 'Texas charter average', rank: 2, of: 179, tied: 0, value: 98, lowerIsBetter: false }],
    }
    const system = highlights(empty({ isCharter: true, highlights: [card] }))
    expect(system).toContain('Texas charter school systems reporting this measure')
    expect(system).not.toContain('Texas districts reporting this measure')

    const campus = highlights(empty({ level: 'campus', isCharter: true, highlights: [card] }))
    expect(campus).toContain('Texas charter campuses reporting this measure')
    expect(campus).not.toContain('Texas schools reporting this measure')
  })

  it('keeps the value, tie and direction visible for a lower-is-better rank', () => {
    const card = {
      id: 'rank:grad:3', kind: 'rank', metric: 'grad:3', metrics: ['grad:3'],
      label: 'Dropout Rate', latestYear: '2025-26',
      evidence: [{ kind: 'rank', period: 'current', metric: 'grad:3', label: 'Dropout Rate', fmt: 'pct', cohort: 'state', cohortLabel: 'Texas average', rank: 2, of: 981, tied: 1, value: 0.2, lowerIsBetter: true }],
    }
    const html = highlights(empty({ highlights: [card] }))
    expect(html).toContain('<strong>0.2%</strong>')
    expect(html).toContain('Tied for 2nd-lowest of 981 Texas districts reporting this measure')
    expect(html).toContain('2 share this value')
    expect(html).toContain('2025-26')
  })

  it('states separate reporting counts when Meets and Masters coverage differs', () => {
    const card = structuredClone(spring[2])
    card.evidence[1].metricN = 205
    const html = highlights(empty({ highlights: [card] }))
    expect(html).toContain('217 districts reporting Meets and 205 reporting Masters')
  })

  it('labels the block as selected evidence rather than an overall verdict', () => {
    const html = highlights(empty({ highlights: spring }))
    expect(html).toContain('Selected positive signals, not a summary of performance')
    expect(html).toContain('same rules choose them on every page')
    expect(html).toContain('Demographics, staffing and spending cannot become academic')
  })
})

describe('officialWebsiteHref', () => {
  it('adds https to the bare hosts TEA usually publishes', () => {
    expect(officialWebsiteHref(' www.cayugaisd.com/path ')).toBe('https://www.cayugaisd.com/path')
  })

  it('does not double-prefix the fully qualified URLs TEA sometimes publishes', () => {
    expect(officialWebsiteHref('https://www.fortbendisd.gov/')).toBe('https://www.fortbendisd.gov/')
    expect(officialWebsiteHref('http://district.example.org')).toBe('http://district.example.org/')
  })

  it('rejects non-web schemes, credentials and malformed values', () => {
    expect(officialWebsiteHref('javascript:alert(1)')).toBeNull()
    expect(officialWebsiteHref('https://district.example.org@malicious.example')).toBeNull()
    expect(officialWebsiteHref('not a website')).toBeNull()
    expect(officialWebsiteHref('')).toBeNull()
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
      { key: 'state', label: 'Texas average', n: 1207, byYear: { '2025-26': 72.4, '2024-25': 71.1 }, reportingNByYear: { '2025-26': 1201, '2024-25': 1188 } },
      { key: 'peer', label: 'Similar student population', n: 294, byYear: { '2025-26': 70.2, '2024-25': 69.0 }, reportingNByYear: { '2025-26': 290, '2024-25': 275 }, note: 'Within 10 points' },
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

  it('states the year-specific reporting n beside each trajectory average', () => {
    const html = trajectory(vm)
    expect(html).toContain('290 reporting')
    expect(html).toContain('1,201 reporting')
    expect(html).toContain('"reportingNs":[275,290]')
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

  it('states the selected cohort n in the legend without a stale second marker', () => {
    expect(domains(vm)).toContain('Similar student population (294 in cohort)')
    expect(domains(vm)).not.toContain('Texas average (1,207 in cohort)')
    expect(domains(vm)).toContain('286 reporting')
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

  // The criteria used to sit behind <details>, which published one CCMR figure
  // and hid the eleven that explain it. Asserted on the rendered table rather
  // than on the absence of the old <summary> text, so the test still fails if
  // the breakdown is re-hidden behind a disclosure worded any other way.
  it('shows the criteria breakdown outright rather than behind a disclosure', () => {
    const html = outcomes(empty({
      ccmr: [{ label: 'College, career or military ready', value: '61%' }],
      cohorts: COHORTS,
      own: { 'ccmr:0': 61 },
    }))
    const table = html.slice(html.indexOf('CCMR criteria'))
    expect(table).toContain('<table')
    expect(html.slice(0, html.indexOf('CCMR criteria'))).not.toContain('<details')
  })

  // "Gap" over a column of bare signed numbers never said gap against what, in
  // what unit, or which direction was good. Each of those three is asserted
  // separately so a rewrite that drops one of them fails on that one.
  it('says what the difference is measured against, in what unit, and which way is better', () => {
    const html = outcomes(empty({
      ccmr: [{ label: 'College, career or military ready', value: '61%' }],
      cohorts: COHORTS,
      own: { 'ccmr:0': 61 },
    }))
    expect(html).not.toMatch(/<th[^>]*>Gap</) // the header that answered none of the three
    expect(html).toContain('percentage points') // the unit
    expect(html).toMatch(/Average<small>/) // the column is an average, and of whom
    expect(html).toContain('a bigger share is better') // the direction
    expect(html).toContain('data-ccmr-comparison>the average for</span>')
    expect(html).toMatch(/data-ccmr-cohort>[^<]+</) // the cohort, named in full
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

  it('keeps a hidden neutral hook when only another cohort reports a context metric', () => {
    const html = students(empty({
      profile,
      cohorts: [
        { key: 'peer', label: 'Similar context', short: 'similar', n: 20, metrics: {}, metricN: {} },
        { key: 'state', label: 'Texas average', short: 'state', n: 100, metrics: { ecoDis: 60 }, metricN: { ecoDis: 100 } },
      ],
      own: { ecoDis: 88.4 },
    }))
    expect(html).toMatch(/cmp cmp-neutral[^>]*data-metric="ecoDis"[^>]*hidden style="display:none"/)
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

/* ------------------------------------------------------------ enrollment */

describe('enrollment over time', () => {
  const points = [
    { year: '2023-24', enrollment: 30_000, change: null },
    {
      year: '2024-25', enrollment: 31_000,
      change: { fromYear: '2023-24', toYear: '2024-25', from: 30_000, to: 31_000, delta: 1_000, pct: 3.333 },
    },
    {
      year: '2025-26', enrollment: 30_500,
      change: { fromYear: '2024-25', toYear: '2025-26', from: 31_000, to: 30_500, delta: -500, pct: -1.6129 },
    },
  ]
  const trend = {
    points,
    latest: points[2],
    previous: points[1],
    yoy: points[2].change,
    contiguous: true,
    sinceFirst: { fromYear: '2023-24', toYear: '2025-26', from: 30_000, to: 30_500, delta: 500, pct: 1.6667 },
  }

  it('sits immediately after student context and before the campus list', () => {
    expect(SECTIONS.indexOf(accountabilityContext)).toBe(SECTIONS.indexOf(students) + 1)
    expect(SECTIONS.indexOf(enrollment)).toBe(SECTIONS.indexOf(accountabilityContext) + 1)
    expect(SECTIONS.indexOf(enrollment)).toBeLessThan(SECTIONS.indexOf(campuses))
  })

  it('states the latest adjacent-year change and longer contiguous change exactly', () => {
    const html = enrollment(empty({ enrollmentTrend: trend }))
    expect(html).toContain('Enrollment over time')
    expect(html).toContain('<strong>30,500 students</strong>')
    expect(html).toContain('a decrease of 500 (1.6%) from 2024–25')
    expect(html).toContain('Change from 2024–25')
    expect(html).toContain('−500')
    expect(html).toContain('Change since 2023–24')
    expect(html).toContain('+500')
  })

  it('keeps the exact five-year-style figures visible in an accessible table with supplementary bars', () => {
    const html = enrollment(empty({ enrollmentTrend: trend }))
    expect(html).toContain('aria-label="Student enrollment by school year for Dallas ISD"')
    expect(html).toContain('class="data scroll enrollment-table"')
    expect(html).toContain('2023–24')
    expect(html).toContain('30,000')
    expect(html).toContain('style="--enrollment-width:98.39%"')
    expect(html).toContain('class="enrollment-bar" aria-hidden="true"')
    expect(html).not.toContain('<details')
  })

  it('uses neutral language and never turns growth or decline into a performance verdict', () => {
    const html = enrollment(empty({ enrollmentTrend: trend }))
    expect(html).toContain('Enrollment growth or decline is not a measure of school quality')
    expect(html).not.toMatch(/cmp-(up|down)/)
    expect(html).not.toMatch(/ranks?|best|worst/i)
  })

  it('leaves a missing school year visible and declines to compare across it', () => {
    const sparse = {
      points: [
        { year: '2023-24', enrollment: 1_000, change: null },
        { year: '2025-26', enrollment: 1_200, change: null },
      ],
      latest: { year: '2025-26', enrollment: 1_200 },
      previous: null,
      yoy: null,
      contiguous: false,
      sinceFirst: null,
    }
    const html = enrollment(empty({
      enrollmentTrend: sparse,
      enrollmentReported: [
        { year: '2023-24', enrollment: 1_000 },
        { year: '2024-25', enrollment: null },
        { year: '2025-26', enrollment: 1_200 },
      ],
    }))
    expect(html).toContain('no year-over-year change is calculated')
    expect(html).toContain('2024–25')
    expect(html).toContain('Not reported')
    expect(html).toContain('Not available')
    expect(html).toContain('No adjacent prior year')
    expect(html).not.toContain('+200')
  })

  it('labels a suppressed current report instead of presenting an older count as current', () => {
    const sparse = {
      points: [
        { year: '2022-23', enrollment: 10, change: null },
        { year: '2024-25', enrollment: 12, change: null },
      ],
      latest: { year: '2024-25', enrollment: 12 },
      previous: null,
      yoy: null,
      contiguous: false,
      sinceFirst: null,
    }
    const html = enrollment(empty({
      enrollmentTrend: sparse,
      enrollmentReported: [
        { year: '2022-23', enrollment: 10 },
        { year: '2023-24', enrollment: null },
        { year: '2024-25', enrollment: 12 },
        { year: '2025-26', enrollment: null },
      ],
    }))
    expect(html).toContain('did not publish an enrollment count for <strong>2025–26</strong>')
    expect(html).toContain('latest available PEIMS count is <strong>12 students</strong>')
    expect(html).toContain('Latest available PEIMS enrollment')
    expect(html).not.toContain('Change from 2024–25')
  })

  it('shows an absolute increase from zero without inventing an infinite percentage', () => {
    const zero = {
      points: [
        { year: '2024-25', enrollment: 0, change: null },
        {
          year: '2025-26', enrollment: 25,
          change: { fromYear: '2024-25', toYear: '2025-26', from: 0, to: 25, delta: 25, pct: null },
        },
      ],
      latest: { year: '2025-26', enrollment: 25 },
      yoy: { fromYear: '2024-25', toYear: '2025-26', from: 0, to: 25, delta: 25, pct: null },
      sinceFirst: null,
    }
    const html = enrollment(empty({ enrollmentTrend: zero }))
    expect(html).toContain('an increase of 25 from 2024–25')
    expect(html).toContain('Percentage not calculated from a zero base')
    expect(html).not.toMatch(/Infinity|NaN/)
  })

  it('names the official source and cautions against guessing at causes', () => {
    const html = enrollment(empty({ enrollmentTrend: trend }))
    expect(html).toContain('TEA PEIMS Student Program and Special Populations Reports')
    expect(html).toContain('Attendance-zone changes')
    expect(html).toContain('not why')
  })

  it('labels a statewide charter comparison as the Texas charter average and names its sector', () => {
    const key = 'public:enrollment:2025-26'
    const charterTrend = {
      points: [
        { year: '2024-25', enrollment: 900, change: null },
        { year: '2025-26', enrollment: 1_000, change: { fromYear: '2024-25', toYear: '2025-26', from: 900, to: 1_000, delta: 100, pct: 11.1 } },
      ],
      latest: { year: '2025-26', enrollment: 1_000 },
      previous: { year: '2024-25', enrollment: 900 },
      yoy: { fromYear: '2024-25', toYear: '2025-26', from: 900, to: 1_000, delta: 100, pct: 11.1 },
      contiguous: true,
      sinceFirst: null,
    }
    const render = (level, n) => enrollment(empty({
      level,
      isCharter: true,
      enrollmentTrend: charterTrend,
      own: { [key]: 1_000 },
      cohorts: [{ key: 'state', label: 'Texas charter average', short: 'state', n, metrics: { [key]: 850 }, metricN: { [key]: n - 2 } }],
    }))

    const system = render('district', 179)
    expect(system).toContain('Texas charter average for</span> <span data-compare-label>charter school systems')
    expect(system).toContain('177</span> rated charter school systems reporting')
    expect(system).toContain('average enrollment among reporting charter school systems')
    expect(system).not.toContain('rated districts reporting')

    const campus = render('campus', 965)
    expect(campus).toContain('Texas charter average for</span> <span data-compare-label>charter campuses')
    expect(campus).toContain('963</span> rated charter campuses reporting')
    expect(campus).toContain('average enrollment among reporting charter campuses')
    expect(campus).not.toContain('rated schools reporting')
  })
})

/* ----------------------------------------------- public context modules */

describe('district transfer flows', () => {
  const transferContext = {
    netLabel: 'Transfers in minus transfers out (arithmetic context only; not a quality measure)',
    history: [
      { year: '2024-25', transfersIn: 120, transfersOut: 300, net: -180 },
      { year: '2025-26', transfersIn: 106, transfersOut: 350, net: -244 },
    ],
    current: {
      year: '2025-26', transfersIn: 106, transfersOut: 350, net: -244,
      coverage: {
        origins: { published: 4, reported: 3, masked: 1 },
        destinations: { published: 5, reported: 3, masked: 2 },
      },
      topOrigins: [{ id: '101902', name: 'Aldine ISD', transfers: 27 }],
      topDestinations: [{ id: '101915', name: 'Klein ISD', transfers: 40 }],
    },
  }

  it('uses official totals and labels the net as arithmetic rather than quality', () => {
    const html = transfers(empty({ transferContext }))
    expect(html).toContain('Students crossing district lines')
    expect(html).toContain('>106<')
    expect(html).toContain('>350<')
    expect(html).toContain('−244')
    expect(html).toContain('Arithmetic context only')
    expect(html).toContain('not a measure of family satisfaction or school quality')
  })

  it('names reported flows while disclosing masked counterpart counts', () => {
    const html = transfers(empty({ transferContext }))
    expect(html).toContain('Aldine ISD')
    expect(html).toContain('Klein ISD')
    expect(html).toContain('published 3 of 4 counterpart counts and masked 1')
    expect(html).toContain('does not add masked detail cells')
  })

  it('does not invent campus totals from heavily masked detail rows', () => {
    expect(transfers(empty({ level: 'campus', transferContext }))).toBeNull()
  })

  it('shows charter transfer-ins without inventing a resident population, transfers out or a balance', () => {
    const charterContext = {
      ...transferContext,
      history: transferContext.history.map((point) => ({
        ...point,
        transfersOut: null,
        net: null,
        coverage: { officialTotals: { in: 'reported', out: 'not_reported' } },
      })),
      current: {
        ...transferContext.current,
        transfersOut: null,
        net: null,
        coverage: {
          ...transferContext.current.coverage,
          officialTotals: { in: 'reported', out: 'not_reported' },
        },
        topDestinations: [],
      },
    }
    const html = transfers(empty({
      isCharter: true,
      name: 'Example Charter',
      transferContext: charterContext,
    }))

    expect(html).toContain('Students entering this charter system')
    expect(html).toContain('Largest reported resident-district origins')
    expect(html).toContain('does not publish a transfers-out total')
    expect(html).toContain('net transfer balance cannot be calculated')
    expect(html).not.toContain('Transfers in minus transfers out')
    expect(html).not.toContain('Largest reported destinations')
  })

  it('distinguishes an official masked total from a total TEA did not report', () => {
    const masked = {
      ...transferContext,
      history: [
        {
          year: '2024-25', transfersIn: null, transfersOut: 10, net: null,
          coverage: { officialTotals: { in: 'not_reported', out: 'reported' } },
        },
        {
          year: '2025-26', transfersIn: null, transfersOut: 12, net: null,
          coverage: { officialTotals: { in: 'masked', out: 'reported' } },
        },
      ],
      current: {
        year: '2025-26', transfersIn: null, transfersOut: 12, net: null,
        coverage: {
          officialTotals: { in: 'masked', out: 'reported' },
          origins: { published: 0, reported: 0, masked: 0 },
          destinations: { published: 0, reported: 0, masked: 0 },
        },
        topOrigins: [], topDestinations: [],
      },
    }
    const html = transfers(empty({ transferContext: masked }))
    expect(html).toContain('Suppressed')
    expect(html).toContain('Not reported')
  })

  it('keeps the history visible when both latest totals are masked', () => {
    const maskedLatest = {
      ...transferContext,
      history: [
        {
          year: '2024-25', transfersIn: 20, transfersOut: 30, net: -10,
          coverage: { officialTotals: { in: 'reported', out: 'reported' } },
        },
        {
          year: '2025-26', transfersIn: null, transfersOut: null, net: null,
          coverage: { officialTotals: { in: 'masked', out: 'masked' } },
        },
      ],
      current: {
        year: '2025-26', transfersIn: null, transfersOut: null, net: null,
        coverage: {
          officialTotals: { in: 'masked', out: 'masked' },
          origins: { published: 0, reported: 0, masked: 0 },
          destinations: { published: 0, reported: 0, masked: 0 },
        },
        topOrigins: [], topDestinations: [],
      },
    }
    const html = transfers(empty({ transferContext: maskedLatest }))
    expect(html).toContain('2024–25')
    expect(html).toContain('>20<')
    expect(html).toContain('Suppressed')
  })
})

describe('discipline and removals from class', () => {
  const datum = (count, rateKey, rate) => ({
    count,
    status: count == null ? 'suppressed' : 'reported',
    mask: count == null ? '-999' : null,
    [rateKey]: rate,
  })
  const context = {
    history: [
      {
        year: '2020-21', cumulativeEnrollment: datum(1_000),
        students: datum(50, 'ratePct', 5), actions: datum(70, 'ratePer100', 7),
      },
      {
        year: '2024-25', cumulativeEnrollment: datum(1_200),
        students: datum(72, 'ratePct', 6), actions: datum(100, 'ratePer100', 8.33),
      },
    ],
    current: {
      year: '2024-25', cumulativeEnrollment: datum(1_200),
      categories: [
        { key: 'allDiscipline', label: 'All discipline', students: datum(72, 'ratePct', 6), actions: datum(100, 'ratePer100', 8.33) },
        { key: 'expulsions', label: 'Expulsions', students: datum(null, 'ratePct', null), actions: datum(null, 'ratePer100', null) },
      ],
    },
  }

  it('keeps students and actions separate and uses cumulative year-end enrollment', () => {
    const html = discipline(empty({ discipline: context }))
    expect(html).toContain('Students in TEA’s all-discipline count')
    expect(html).toContain('6.0% of cumulative year-end enrollment')
    expect(html).toContain('8.33 per 100 students')
    expect(html).toContain('Students, actions and incidents are different units')
    expect(html).toContain('must not be added together')
    expect(html).toContain('not the October enrollment')
  })

  it('preserves suppressed categories and the pandemic comparison warning', () => {
    const html = discipline(empty({ discipline: context }))
    expect(html).toContain('Expulsions')
    expect(html).toContain('Suppressed')
    expect(html).toContain('TEA suppression code -999')
    expect(html).toContain('Use 2020–21 cautiously')
    expect(html).not.toContain('NaN')
  })
})

describe('official improvement and transfer notices', () => {
  const improvement = {
    id: '101919001', name: 'Spring High School', href: '/campus/spring-h-s-101919001',
    improvement: {
      kind: 'TSI', supportLabel: 'TSI', reason: 'Special Education', trackYear: 1, titleI: true,
    },
    peg: null,
  }

  it('prints the exact official support label and reason on a campus page', () => {
    const html = actionNotices(empty({ level: 'campus', actionNotices: [improvement] }))
    expect(html).toContain('Targeted Support and Improvement')
    expect(html).toContain('<strong>Official support label:</strong> TSI')
    expect(html).toContain('<strong>Identification reason:</strong> Special Education')
    expect(html).toContain('TEA track year 1')
    expect(html).not.toContain('Public Education Grant transfer eligibility')
  })

  it('describes PEG as a request right, never guaranteed admission', () => {
    const html = actionNotices(empty({
      level: 'campus',
      actionNotices: [{ ...improvement, improvement: null, peg: { schoolYear: '2026-27', final: true } }],
    }))
    expect(html).toContain('may request a transfer')
    expect(html).toContain('A request is not guaranteed')
    expect(html).toContain('transportation is not automatically provided')
  })

  it('aggregates campus notices on a district page without assigning them to the district rating', () => {
    const html = actionNotices(empty({
      actionNotices: [improvement, { ...improvement, id: '101919002', name: 'Westfield High School', href: '/campus/westfield-h-s-101919002', improvement: null, peg: { schoolYear: '2026-27' } }],
    }))
    expect(html).toContain('Campuses identified for federal improvement support')
    expect(html).toContain('<dd>1<p class="stat-note">2026 TEA list')
    expect(html).toContain('Spring High School')
    expect(html).toContain('Westfield High School')
    expect(html).toContain('specific campuses')
  })
})

describe('community context', () => {
  const context = {
    year: 2024, totalPopulation: 50_000, schoolAgePopulation: 8_000,
    schoolAgePoverty: 1_600, schoolAgePovertyRate: 20,
  }

  it('separates resident Census estimates from enrolled students', () => {
    const html = community(empty({ communityContext: context }))
    expect(html).toContain('50,000')
    expect(html).toContain('1,600 of 8,000')
    expect(html).toContain('residents inside the geographic district, not the students enrolled')
    expect(html).toContain('never a school-quality measure')
  })

  it('never puts district-boundary estimates on a campus page', () => {
    expect(community(empty({ level: 'campus', communityContext: context }))).toBeNull()
  })
})

describe('following-fall postsecondary outcomes', () => {
  const outcome = {
    graduateYear: '2023-24', fallTerm: 'Fall 2024', graduates: 100,
    enrolledPublic: 42, rate: 42, notFound: 55, notTrackable: 3,
    destinations: [{ institution: 'Texas State University', students: 10 }],
  }

  it('shows the denominator and the limited Texas-public scope', () => {
    const html = postsecondary(empty({ postsecondaryOutcome: outcome }))
    expect(html).toContain('Graduates in the report')
    expect(html).toContain('Class of 2023–24')
    expect(html).toContain('42.0% of graduates')
    expect(html).toContain('Texas State University')
    expect(html).toContain('includes only districts or campuses with more than 25 graduates')
  })

  it('does not turn not-found records into a claim that graduates skipped college', () => {
    const html = postsecondary(empty({ postsecondaryOutcome: outcome }))
    expect(html).toContain('“Not found” does not mean a graduate did not continue their education')
    expect(html).toContain('private or out-of-state college')
    expect(html).toContain('“Not trackable” is not an outcome')
    expect(html).toContain('non-standard identifier')
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
    const html = spending(empty({ finance: { ...fin, spendPeer: [null, null], vsPeer: null } }))
    expect(html).not.toContain('<span class="swatch swatch-tea"')
    expect(html).toContain('Not reported by TEA for this entity: TEA peer group')
    expect(html).toContain('<strong>$1,000 less</strong>') // the valid state comparison remains
  })

  it('never invents a $0 state gap when TEA published only a peer comparison', () => {
    const html = spending(empty({ finance: { ...fin, spendState: [null, null], vsState: null } }))
    expect(html).toContain('<strong>$500 less</strong>')
    expect(html).not.toContain('$0 less')
    expect(html).not.toContain('<span class="swatch swatch-state"')
  })

  it('provides the exact yearly figures in a disclosure and labels nominal dollars', () => {
    const html = spending(empty({ finance: fin }))
    expect(html).toContain('<summary>View yearly spending figures</summary>')
    expect(html).toContain('$12,500')
    expect(html).toContain('not adjusted for inflation')
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

  it('shows five years of district turnover without pretending it is a campus measure', () => {
    const html = teachers(empty({
      teacherTurnover: {
        history: [{ year: '2023-24', ratePct: 18.2 }, { year: '2024-25', ratePct: 16.4 }],
        latest: { year: '2024-25', ratePct: 16.4 },
      },
    }))
    expect(html).toContain('Teacher turnover over time')
    expect(html).toContain('16.4% teacher turnover rate')
    expect(html).toContain('prior fall')
    expect(html).toContain('not a campus-level measure')
  })

  it('shows actual campus class-size categories without inventing one campus average', () => {
    const html = teachers(empty({
      level: 'campus', profile: null,
      classSize: {
        year: '2024-25', reported: 2,
        categories: [
          { key: 'kindergarten', label: 'Kindergarten', studentsPerClass: 18.4 },
          { key: 'secondaryMath', label: 'Secondary math', studentsPerClass: 22.1 },
          { key: 'grade6', label: 'Grade 6', studentsPerClass: null },
        ],
      },
    }))
    expect(html).toContain('Teachers and actual class size')
    expect(html).toContain('Kindergarten')
    expect(html).toContain('18.4')
    expect(html).toContain('not the student-to-teacher ratio')
    expect(html).toContain('not combined into a made-up campus-wide average')
    expect(html).not.toContain('Grade 6')
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
    expect(html).toContain('<dt>High School</dt><dd>1</dd>')
    expect(html).toContain('<summary><span>Browse all 2 schools</span>')
    expect(html).toContain('class="tbl-scroll" tabindex="0" role="region" aria-label="Schools in this district"')
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
    expect(s).toContain('Cayuga ISD ranks 2nd for Overall score among the 1207 Texas districts')
    expect(s).toContain('txschools.net')
  })

  it('names the measure before it says "it", so a pasted sentence is self-contained', () => {
    // The bug: "...of 19 districts in Harris County that report this measure
    // for College, career or military ready" — the reference came before the
    // name, so the sentence read as a rank with no measure attached.
    const s = claimSentence(vmFor(), rank({ label: 'College, career or military ready' }))
    expect(s).not.toContain('this measure')
    expect(s.indexOf('College, career or military ready')).toBeLessThan(s.indexOf('that report it'))
  })

  it('keeps the denominator qualifier, which is what makes the n mean something', () => {
    // The n counts who reports THIS measure, not who exists — dropping the
    // qualifier would quietly turn it into a different, larger claim.
    expect(claimSentence(vmFor(), rank())).toContain('that report it')
  })

  it('never states a rank without its n', () => {
    for (const r of [rank({ rank: 1 }), rank({ rank: 11 }), rank({ rank: 23 }), rank({ cohort: 'peer' })]) {
      expect(claimSentence(vmFor(), r)).toMatch(new RegExp(`ranks \\d+(st|nd|rd|th) for .+ among the ${r.of}\\b`))
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

  it('makes copied charter claims explicitly sector-specific', () => {
    const system = claimSentence(vmFor({ isCharter: true }), rank({ cohortLabel: 'Texas charter average', of: 179 }))
    expect(system).toContain('among the 179 Texas charter school systems')
    expect(system).not.toContain('Texas districts')

    const campus = claimSentence(
      vmFor({ level: 'campus', isCharter: true }),
      rank({ cohortLabel: 'Texas charter average', of: 965 })
    )
    expect(campus).toContain('among the 965 Texas charter campuses')
    expect(campus).not.toContain('Texas schools')

    const peer = claimSentence(vmFor({ isCharter: true }), rank({ cohort: 'peer', of: 40 }))
    expect(peer).toContain('charter school systems serving a similar share of economically disadvantaged students')
  })

  it('states the tie count, so a shared ceiling is never read as a sole placement', () => {
    const s = claimSentence(vmFor(), rank({ rank: 1, of: 1084, tied: 213, label: 'Four-Year Graduation Rate' }))
    expect(s).toContain('tied with 213 others')
    expect(s).toContain('1st for Four-Year Graduation Rate among the 1084')
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
    expect(html).toContain('Each measure appears')
    expect(html).toContain('Very large ties are left out')
    expect(html).toContain('tie that does appear is labeled')
    // The warning tells the reader how to read the section; it does not
    // lecture them about what a rank without an n would be.
    expect(html).not.toContain('is a boast')
  })

  it('states how many rankings the selection was drawn from', () => {
    const html = standouts(vm)
    expect(html).toContain('Out of 87 rankings')
    expect(html).toContain('Each measure appears once')
  })

  it('shows every strength bucket at once and never follows the comparison control', () => {
    const html = standouts(empty({
      ranks: Array.from({ length: 200 }, () => rank()),
      standouts: [
        rank({ metric: 'first', label: 'First place', rank: 1 }),
        rank({ metric: 'third', label: 'Third place', rank: 3 }),
        rank({ metric: 'seventh', label: 'Seventh place', rank: 7 }),
        rank({ metric: 'percentile', label: 'Top five percent', rank: 24, of: 1_000, pctile: 97 }),
      ],
    }))
    expect(html).toContain('#1 rankings')
    expect(html).toContain('#2–3 rankings')
    expect(html).toContain('#4–10 rankings')
    expect(html).toContain('Other top-5% rankings')
    expect(html).toContain('does not change when you change Compare against')
    expect(html).not.toContain('data-comparison-cohort')
    expect(html).not.toContain('data-comparison-pin-unavailable')
    expect(html.match(/class="standout-metric"/g)).toHaveLength(4)
  })

  it('omits empty buckets instead of printing comparison-specific empty states', () => {
    const html = standouts(empty({ standouts: [rank({ rank: 1 })], ranks: [rank({ rank: 1 })] }))
    expect(html).toContain('#1 rankings')
    expect(html).not.toContain('#2–3 rankings')
    expect(html).not.toContain('No distinctive top placement')
  })

  it('offers a copyable claim that carries its own cohort and denominator', () => {
    const html = standouts(vm)
    const claims = [...html.matchAll(/data-claim="([^"]+)"/g)].map((match) => match[1])
    expect(claims.some((claim) => claim.includes('among the 1207'))).toBe(true)
    expect(claims.every((claim) => claim.includes('Source: txschools.net'))).toBe(true)
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

/* ------------------------------------------------- links to the rankings -- */
//
// A rank is a claim about a population, and until the ranked lists existed the
// reader had no way to see that population: "Ranks 400th of 1,184 Texas
// districts" named 1,183 other districts and linked none of them.
//
// These sections construct no ranking URLs. `vm.rankingLinks` is a map the build
// step hands in, holding only hrefs of pages that were actually written, so the
// property under test is as much what is NOT linked as what is.

describe('ranking links', () => {
  // Both ends of every board are in the index now, keyed { top, bottom }, each
  // an { href, title } — not a bare href — because rankedBoard has to choose
  // between them (see the 'rankedBoard chooses the end that lists the entity'
  // block below) and a caller labels its link with the board's own title
  // rather than composing a completeness claim.
  const board = (href, title) => ({ href, title })
  const LINKS = {
    state: {
      score: {
        top: board('/rankings/texas-districts/overall-score-highest', 'Texas school districts with the highest overall score'),
        bottom: board('/rankings/texas-districts/overall-score-lowest', 'Texas school districts with the lowest overall score'),
      },
      absenteeism: {
        top: board('/rankings/texas-districts/chronically-absent-highest', 'Texas school districts with the highest chronically absent share'),
        bottom: board('/rankings/texas-districts/chronically-absent-lowest', 'Texas school districts with the lowest chronically absent share'),
      },
    },
    region: {
      score: {
        top: board('/rankings/region-10-districts/overall-score-highest', 'Region 10 school districts with the highest overall score'),
        bottom: board('/rankings/region-10-districts/overall-score-lowest', 'Region 10 school districts with the lowest overall score'),
      },
    },
    county: null,
  }

  const placed = (over = {}) => ({
    metric: 'score', label: 'Overall score', cohort: 'state', cohortLabel: 'Texas average',
    rank: 3, of: 1_184, tied: 0, lowerIsBetter: false, ...over,
  })

  const ranked = (over = {}) =>
    empty({ history: [{ year: '2025-26', rating: 'B', score: 85 }], rank: 400, rankOf: 1_184, regionRank: 35, regionRankOf: 110, ...over })

  it('links the statewide and the region placement to the lists they came from', () => {
    const html = verdict(ranked({ rankingLinks: LINKS }))
    expect(html).toContain('<a href="/rankings/texas-districts/overall-score-highest"')
    expect(html).toContain('<a href="/rankings/region-10-districts/overall-score-highest"')
  })

  it('keeps the whole claim inside the link, denominator included', () => {
    const html = verdict(ranked({ rankingLinks: LINKS }))
    expect(html).toMatch(/>400th of 1,184 Texas districts<\/a>/)
    expect(html).toMatch(/>35th of 110 in Region 10<\/a>/)
  })

  it('renders the rank exactly as before when no ranking was built', () => {
    const html = verdict(ranked())
    expect(html).toContain('400th of 1,184 Texas districts')
    expect(html).not.toContain('/rankings')
  })

  it('still renders an entity TEA gave no rank, rather than ordinal-ing a null', () => {
    expect(verdict(ranked({ rank: null, regionRank: null, rankingLinks: LINKS }))).not.toContain('summary-rank')
  })

  // Was: 'Every Texas district ranked by overall score'. That claim is false
  // once a board is a slice — see the truncation block below — so the
  // aria-label is now the linked board's own title, read off the index.
  it("labels the link with the board's own title, not a composed completeness claim", () => {
    const html = verdict(ranked({ rankingLinks: LINKS }))
    expect(html).toContain('aria-label="Texas school districts with the highest overall score"')
    expect(html).toContain('aria-label="Region 10 school districts with the highest overall score"')
    expect(html).not.toContain('Every Texas district ranked by overall score')
  })

  it('links a standout to its own full ranking', () => {
    const html = standouts(empty({ rankingLinks: LINKS, ranks: [placed()], standouts: [placed()] }))
    expect(html).toContain('href="/rankings/texas-districts/overall-score-highest"')
    expect(html).toContain('aria-label="Full ranking: Overall score, Texas average"')
  })

  it('leaves a peer-band placement unlinked, because no static page can exist for one', () => {
    // The band is defined relative to THIS entity's economically disadvantaged
    // share, so there is no list to point at. Borrowing the statewide one would
    // link a population the placement was never measured against.
    const peer = placed({ cohort: 'peer', cohortLabel: 'Similar student population' })
    const html = standouts(empty({ rankingLinks: LINKS, ranks: [peer], standouts: [peer] }))
    expect(html).not.toContain('full ranking')
  })

  it('leaves a placement unlinked when its metric got no ranking at that scope', () => {
    const county = placed({ cohort: 'county', cohortLabel: 'Dallas County' })
    const salary = placed({ metric: 'avgSalary', label: 'Average teacher salary' })
    const html = standouts(empty({ rankingLinks: LINKS, ranks: [county, salary], standouts: [county, salary] }))
    expect(html).not.toContain('full ranking')
  })

  it('offers the unselected rankings, so "a selection, not a summary" is checkable', () => {
    const vm = empty({ rankingsIndex: '/rankings', ranks: [placed()], standouts: [placed()] })
    expect(standouts(vm)).toContain('<a href="/rankings">Every ranking this site publishes</a>')
    expect(standouts(empty({ ranks: [placed()], standouts: [placed()] }))).not.toContain('/rankings')
  })

  it('reads a link only through the lookup, never by building a URL', () => {
    expect(rankingHref(empty({ rankingLinks: LINKS }), 'score', 'state', 3, 1_184)).toBe(LINKS.state.score.top.href)
    expect(rankingHref(empty({ rankingLinks: LINKS }), 'ccmr:0', 'state', 3, 1_184)).toBeNull()
    expect(rankingHref(empty({ rankingLinks: LINKS }), 'score', 'county', 3, 1_184)).toBeNull()
    expect(rankingHref(empty(), 'score', 'state', 3, 1_184)).toBeNull()
  })
})

/* --------------------------------------------------- paged boards (#1) -- */
//
// rankings-page.js splits a long ordering across pages of PAGE_ROWS rows
// (boardPages) rather than truncating it: overall-score-highest for campuses
// runs to sixteen pages covering all ~7,600, not a 1,500-row slice of them.
//
// Two defects are pinned here, one historical and one its direct successor.
// Before ANY of this existed, every entity page linked the 'highest'/'top' end
// regardless of where the entity placed, so ~82% of campus pages sent the
// reader to a table that did not contain their own school. Paging fixes the
// half of that caused by rows going unprinted — but linking a board's FIRST
// page for a campus ranked 6,000th reproduces the identical symptom, so what
// these assert is the page, not merely the board.

describe('rankingPositions: where a rank sits in each end of an ordering', () => {
  const OF = 8_475 // roughly the statewide rated-campus population for score

  it('reads goodness rank as position from the top for a higher-is-better metric', () => {
    expect(rankingPositions(1, OF)).toEqual({ top: 1, bottom: OF })
    expect(rankingPositions(OF, OF)).toEqual({ top: OF, bottom: 1 })
    expect(rankingPositions(1_200, OF)).toEqual({ top: 1_200, bottom: OF - 1_200 + 1 })
  })

  it('reverses the two for a lower-is-better metric', () => {
    // Chronic absence: rank 1 (the best result) is the SMALLEST value, so it
    // sits at the very end of the 'top' (highest-value-first) ordering and at
    // the front of 'bottom' — the opposite of a higher-is-better metric like
    // score. Getting this backwards would link the wrong page, and on a
    // sixteen-page board a wrong page is a wrong answer.
    expect(rankingPositions(1, OF, true)).toEqual({ top: OF, bottom: 1 })
    expect(rankingPositions(OF, OF, true)).toEqual({ top: 1, bottom: OF })
  })

  it('treats a missing or nonsensical rank as unresolvable, not as a guess', () => {
    expect(rankingPositions(null, OF)).toBeNull()
    expect(rankingPositions(5, null)).toBeNull()
    expect(rankingPositions(0, OF)).toBeNull()
    expect(rankingPositions(OF + 1, OF)).toBeNull()
  })
})

describe('boardPageOf: which page of a board holds a given position', () => {
  it('counts pages of PAGE_ROWS rows, 1-based', () => {
    expect(boardPageOf(1, 17)).toBe(1)
    expect(boardPageOf(PAGE_ROWS, 17)).toBe(1) // the last row of page 1
    expect(boardPageOf(PAGE_ROWS + 1, 17)).toBe(2) // the first row of page 2
    expect(boardPageOf(6_000, 17)).toBe(Math.ceil(6_000 / PAGE_ROWS))
  })

  it('never names a page past the end of what the build actually wrote', () => {
    // `pos` comes from the entity's own cohort population and `pages` from the
    // board's. If those ever disagree the link has to land on a page that
    // exists — a 404 in the middle of an entity page is worse than an
    // off-by-one landing.
    expect(boardPageOf(9_999, 2)).toBe(2)
    expect(boardPageOf(1, 1)).toBe(1)
  })
})

describe('rankedBoard / the verdict rank line on a paged board', () => {
  const OF = 8_475
  const PAGES = Math.ceil(OF / PAGE_ROWS)
  const CAMPUS_LINKS = {
    state: {
      score: {
        top: {
          href: '/rankings/texas-campuses/overall-score-highest',
          title: 'Texas campuses with the highest overall score',
          pages: PAGES,
        },
      },
    },
  }

  const campus = (over = {}) =>
    empty({
      level: 'campus',
      history: [{ year: '2025-26', rating: 'B', score: 85 }],
      rank: 1_200, rankOf: OF, regionRank: 0, regionRankOf: 0,
      rankingLinks: CAMPUS_LINKS,
      ...over,
    })

  it('links the page of the published board that holds this campus, not its first', () => {
    const html = verdict(campus({ rank: 6_000, rankOf: OF }))
    expect(html).toContain(`href="/rankings/texas-campuses/overall-score-highest-page-${Math.ceil(6_000 / PAGE_ROWS)}"`)
  })

  it('links the bare board href, with no suffix, for a campus on page 1', () => {
    const html = verdict(campus({ rank: 12, rankOf: OF }))
    expect(html).toContain('href="/rankings/texas-campuses/overall-score-highest"')
    expect(html).not.toContain('overall-score-highest-page-')
  })

  it('links a board for the middle band too — every ranked row is now printed', () => {
    // This exact case used to print no link at all, because the row fell in
    // the unpublished middle of a truncated ordering. It is now on a real
    // page, and the link says which.
    const middle = Math.round(OF / 2)
    const html = verdict(campus({ rank: middle, rankOf: OF }))
    expect(html).toContain(`/rankings/texas-campuses/overall-score-highest-page-${Math.ceil(middle / PAGE_ROWS)}`)
    expect(html).toContain(`${middle.toLocaleString('en-US')}th of ${OF.toLocaleString('en-US')} Texas schools`)
  })

  it('links nothing when the only end that would list this entity was never built', () => {
    // Rule 3: the worse-performing end of an ordering is not published. A
    // cohort whose index carries neither end has no board to point at, and
    // that stays the correct answer under paging.
    expect(rankedBoard(campus({ rankingLinks: { state: { score: {} } } }), 'score', 'state', 5, OF)).toBeNull()
    expect(rankedBoard(campus({ rankingLinks: null }), 'score', 'state', 5, OF)).toBeNull()
  })

  it("rankedBoard returns the board's own title, its end and its page", () => {
    const found = rankedBoard(campus(), 'score', 'state', 6_000, OF)
    expect(found.title).toBe('Texas campuses with the highest overall score')
    expect(found.end).toBe('top')
    expect(found.page).toBe(Math.ceil(6_000 / PAGE_ROWS))
    expect(found.href).toBe(`/rankings/texas-campuses/overall-score-highest-page-${found.page}`)
  })

  it('picks the bottom end when that is the one the catalogue published', () => {
    const links = {
      state: {
        score: {
          bottom: {
            href: '/rankings/texas-campuses/overall-score-lowest',
            title: 'Texas campuses with the lowest overall score',
            pages: PAGES,
          },
        },
      },
    }
    // Goodness rank 8,000 of 8,475 is 476th from the bottom — page 1 of the
    // 'bottom' ordering, NOT page 16 as it would be counted from the top.
    const found = rankedBoard(campus({ rankingLinks: links }), 'score', 'state', 8_000, OF)
    expect(found.end).toBe('bottom')
    expect(found.page).toBe(Math.ceil((OF - 8_000 + 1) / PAGE_ROWS))
  })
})

describe('standouts on a paged board', () => {
  const OF = 8_475
  const PAGES = Math.ceil(OF / PAGE_ROWS)
  const CAMPUS_LINKS = {
    state: {
      'domain:achievement': {
        top: {
          href: '/rankings/texas-campuses/achievement-highest',
          title: 'Texas campuses with the highest achievement domain score',
          pages: PAGES,
        },
      },
    },
  }
  const placement = (over = {}) => ({
    metric: 'domain:achievement', label: 'Student Achievement', cohort: 'state', cohortLabel: 'Texas average',
    rank: 5, of: OF, tied: 0, lowerIsBetter: false, ...over,
  })
  const render = (p) =>
    standouts(empty({ level: 'campus', rankingLinks: CAMPUS_LINKS, ranks: [p], standouts: [p] }))

  it('calls the ranking "full" now that a board prints every ranked row', () => {
    const html = render(placement())
    expect(html).toContain('full ranking')
    expect(html).not.toContain('1,500 shown')
    expect(html).toContain('aria-label="Full ranking: Student Achievement, Texas average"')
  })

  it('says which page, when the link does not land on the first one', () => {
    // "full ranking" pointing silently at page 9 of 16 would read as a promise
    // the destination breaks the moment the reader arrives mid-ordering.
    const html = render(placement({ rank: 4_238 }))
    const page = Math.ceil(4_238 / PAGE_ROWS)
    expect(html).toContain(`full ranking (page ${page.toLocaleString('en-US')})`)
    expect(html).toContain(`/rankings/texas-campuses/achievement-highest-page-${page}`)
    expect(html).toContain(`aria-label="Texas campuses with the highest achievement domain score, page ${page}"`)
  })

  it('links a standout in the middle band, which used to carry no link at all', () => {
    const html = render(placement({ rank: Math.round(OF / 2) }))
    expect(html).toContain('/rankings/texas-campuses/achievement-highest-page-')
  })
})
