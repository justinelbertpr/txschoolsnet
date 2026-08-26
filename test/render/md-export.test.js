/**
 * @vitest-environment jsdom
 *
 * test/render/md-export.test.js
 *
 * site/md.js turns the rendered page into Markdown for someone who is going to
 * paste it into an AI tool. It is the one part of this site whose input is the
 * DOM rather than a view model, which makes it the one part that can silently
 * rot: change a wrapper in sections.js and the export keeps "working" while
 * quietly emitting less, or emitting nonsense.
 *
 * So the fixtures below are not hand-written HTML. They are the real output of
 * the real section renderers, parsed into a real DOM. A markup change in
 * sections.js that the converter cannot read fails HERE, in the same run that
 * renders it — which is the only place the two halves ever meet.
 *
 * The recurring defect class this guards is token welding. textContent
 * concatenates adjacent elements with no separator, so `+7<small> pts</small>`
 * becomes "+7pts" and `<span>1</span><span>of 19</span>` becomes "1of 19".
 * Every fixture below is checked against that whole class, not just the
 * instances that were found by reading the output once.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  outcomes,
  verdict,
  standouts,
  students,
  domains,
  campuses,
  enrollment,
  transfers,
  discipline,
  actionNotices,
  community,
  postsecondary,
  teachers,
} from '../../src/render/sections.js'

const COHORTS = [
  {
    key: 'region',
    label: 'Region 10',
    short: 'region',
    n: 46,
    metrics: { score: 81.6, 'ccmr:0': 55, 'ccmr:1': 30 },
    metricN: { score: 46 },
    placements: { score: { metric: 'score', cohort: 'region', rank: 8, of: 46, tied: 0 } },
  },
]

const vm = (over = {}) => ({
  id: '057905',
  name: 'Dallas ISD',
  level: 'district',
  county: 'Dallas',
  regionId: '10',
  regionName: 'Region 10',
  slug: 'dallas-isd-057905',
  snapshotDate: '15 August 2026',
  isAlt: false,
  enrollment: 140000,
  multYear: 0,
  notRated: false,
  history: [{ year: '2025-26', rating: 'B', score: 88 }, { year: '2021-22', rating: 'B', score: 81 }],
  stateByYear: {},
  peerByYear: null,
  peerAvg: 81.6,
  peerN: 399,
  rank: 0,
  rankOf: 0,
  regionRank: 8,
  regionRankOf: 46,
  domains: [],
  profile: null,
  raceShare: null,
  staar: null,
  graduation: null,
  ccmr: null,
  cohorts: COHORTS,
  own: {},
  ranks: [],
  standouts: [],
  website: 'www.dallasisd.org',
  ...over,
})

/** Render sections into a real document, the way a built page carries them. */
const mount = (...sections) => {
  document.head.innerHTML =
    '<meta name="txs:snapshot" content="15 August 2026">' +
    '<link rel="canonical" href="https://txschools.net/district/dallas-isd-057905">'
  document.body.innerHTML = `<main>${sections.filter(Boolean).join('\n')}</main>`
}

let pageMarkdown
beforeAll(async () => {
  // Imported after jsdom exists, because the module mounts its button on load.
  mount(verdict(vm()))
  ;({ pageMarkdown } = await import('../../site/md.js'))
})

/* A regex over the finished text can only catch welds whose two halves differ
   in character class — "+7pts", "8of 46", "schoolsName". It is blind to
   "88/1002025-26" and "Achievement87", where digits meet digits or a word meets
   a number, which is half of the welds this converter actually produced. So it
   is used as a cheap backstop under a name that says what it really covers, and
   every shape is ALSO pinned by an exact expected string in the tests below.
   Measured: this catches 4 of the 8 welds found in the real district page. */
const WELDED_ACROSS_CHAR_CLASSES = /\d(?:pts|%[A-Za-z]|of )|[a-z](?:[A-Z][a-z]{3})/

/** Every welded shape the real page produced, with its correct separation. */
const SEPARATIONS = [
  ['88/100 (2025-26)', 'a value, its scale and its year'],
  ['+7 pts (since 2021-22)', 'a delta and its unit'],
  ['8 of 46 (among reporting districts)', 'a rank, its denominator and its cohort'],
]

describe('the Markdown export', () => {
  it('leads with provenance before any figure', () => {
    mount(verdict(vm()))
    const md = pageMarkdown()
    const head = md.slice(0, md.indexOf('##', 3))
    expect(md).toMatch(/^# Dallas ISD/)
    expect(md).toContain('Texas Education Agency')
    expect(md).toContain('archived snapshot of 15 August 2026')
    expect(md).toContain('https://txschools.net/district/dallas-isd-057905')
    // The disclaimer is the reason this header exists: handed figures with no
    // publisher, a model will name one.
    expect(md).toContain('**not** operated by, endorsed by, or connected to')
    expect(head).not.toMatch(/\| ---/) // no table has begun yet
  })

  it('names the entity once, not twice', () => {
    mount(verdict(vm()))
    expect(pageMarkdown().match(/^# Dallas ISD$/gm)).toHaveLength(1)
  })

  it.each(SEPARATIONS)('keeps %s apart — %s', (expected) => {
    mount(verdict(vm()))
    expect(pageMarkdown()).toContain(expected)
  })

  it('separates a domain score from its grade and its deltas', () => {
    mount(domains(vm({
      domains: [{ domain: 'achievement', label: 'Student Achievement', score: 87, grade: 'B', toNextGrade: 3 }],
      own: { 'domain:achievement': 87 },
    })))
    const md = pageMarkdown()
    // The bar's label, value and delta are three sibling spans; welded they
    // read "Student Achievement87 B+5.1", which no regex over the result sees.
    expect(md).toMatch(/- \*\*Student Achievement:\*\* 87 B/)
    expect(md).not.toContain('Achievement87')
  })

  it('keeps the evidence, years, comparator and denominator in the positive-signal summary', () => {
    mount(verdict(vm({
      highlights: [{
        id: 'gain:domain:gaps', kind: 'gain', metric: 'domain:gaps', metrics: ['domain:gaps'],
        label: 'Closing the Gaps', latestYear: '2025-26', previousYear: '2024-25',
        evidence: [
          { kind: 'change', metric: 'domain:gaps', label: 'Closing the Gaps', fmt: 'points', fromValue: 63, toValue: 77, delta: 14, previousYear: '2024-25', latestYear: '2025-26' },
          { kind: 'benchmark', metric: 'domain:gaps', label: 'Closing the Gaps', fmt: 'points', cohort: 'peer', cohortLabel: 'Similar economic-disadvantage rate', cohortN: 217, metricN: 217, coverage: 1, value: 77, benchmark: 74.7, advantage: 2.3, lowerIsBetter: false },
          { kind: 'rank', period: 'change', metric: 'domain:gaps', label: 'Closing the Gaps', fmt: 'points', cohort: 'region', cohortLabel: 'Region 04: Houston', rank: 1, of: 46, tied: 0, value: 14, lowerIsBetter: false },
        ],
      }],
    })))
    const md = pageMarkdown()
    expect(md).toContain('## Strengths and momentum')
    expect(md).toContain('### Closing the Gaps rose 14 points')
    expect(md).toContain('63 to 77 2024-25 to 2025-26')
    expect(md).toContain('2.3 points above the 74.7 average among 217 districts')
    expect(md).toContain('1st of 46 districts in Region 04: Houston reporting both years for one-year gain')
    expect(md).toContain('Selected positive signals, not a summary of performance')
  })

  it('separates a disclosure label from the gloss beside it', () => {
    mount(campuses(vm({
      campuses: [{ name: 'Sample HS', slug: 'sample-hs-1', type: 'High School', rating: 'A', score: 94, enrollment: 100 }],
    })))
    const md = pageMarkdown()
    expect(md).not.toMatch(/schools[A-Z]/) // "…50 schoolsName, type, rating…"
    expect(md).toMatch(/\*\*[^*]+ — [^*]+\*\*/) // label — gloss
  })

  it('has no weld a regex can see, in any fixture', () => {
    mount(verdict(vm()), outcomes(vm({
      ccmr: [{ label: 'Total credit for CCMR criteria', value: '61%' }],
      own: { 'ccmr:0': 61 },
    })))
    expect(pageMarkdown()).not.toMatch(WELDED_ACROSS_CHAR_CLASSES)
  })

  it('carries the CCMR breakdown as a table, with the unit and the cohort in the header', () => {
    mount(outcomes(vm({
      ccmr: [
        { label: 'Total credit for CCMR criteria', value: '61%' },
        { label: 'Earned an industry-based certification', value: '30%' },
      ],
      own: { 'ccmr:0': 61, 'ccmr:1': 30 },
    })))
    const md = pageMarkdown()
    expect(md).toContain('| --- |')
    expect(md).toContain('Average (region)')
    expect(md).toContain('Difference (percentage points)')
    expect(md).toContain('Earned an industry-based certification')
    expect(md).toContain('a bigger share is better')
    expect(md).not.toMatch(WELDED_ACROSS_CHAR_CLASSES)
  })

  it('quotes the citable sentence a ranking already carries rather than rebuilding it', () => {
    mount(standouts(vm({
      standouts: [{
        metric: 'ccmr:0',
        label: 'College, career or military ready',
        rank: 1,
        of: 19,
        tied: 2,
        cohortKey: 'county',
        cohortLabel: 'Dallas County',
        lowerIsBetter: false,
      }],
      ranks: [],
    })))
    const md = pageMarkdown()
    // Asserted unconditionally: guarding this on the claim existing would let
    // the test pass silently the day standouts() stops emitting one, which is
    // precisely the regression worth catching.
    const claim = document.querySelector('[data-claim]')?.dataset.claim
    expect(claim).toBeTruthy()
    expect(md).toContain(claim)
    expect(md).not.toMatch(/^- \d+of /m) // the welded fragments it replaced
  })

  it('exports every stable ranking bucket instead of only one selected cohort', () => {
    mount(standouts(vm({
      standouts: [
        {
          metric: 'ccmr:0', label: 'College ready', rank: 1, of: 19, tied: 0,
          cohort: 'county', cohortLabel: 'Dallas County', lowerIsBetter: false,
        },
        {
          metric: 'score', label: 'Overall score', rank: 7, of: 1_019, tied: 0,
          cohort: 'state', cohortLabel: 'Texas average', lowerIsBetter: false,
        },
      ],
      ranks: [],
    })))
    const claims = [...document.querySelectorAll('.standout .copy')].map((button) => button.dataset.claim)
    const md = pageMarkdown()
    expect(claims).toHaveLength(2)
    for (const claim of claims) expect(md).toContain(claim)
    expect(md).toContain('### #1 rankings')
    expect(md).toContain('### #4–10 rankings')
  })

  it('keeps chart values that live only in SVG titles, and drops series names', () => {
    mount(students(vm({
      profile: { total: 140000, ecoDisPct: 55.3, engLrnPct: 22.2, specEdPct: 17.2, attendance: 93.3, absenteeism: 20 },
      raceShare: [18, 44.6, 25.1, 0.7, 7.3, 0.1, 4.2],
    })))
    const md = pageMarkdown()
    // A stacked composition chart is the only copy of this breakdown on the
    // page — there is no table under it — so dropping every <svg> lost it.
    expect(md).toMatch(/- Hispanic: 44\.6%/)
    // A heading with nothing under it is the symptom that regression produced.
    expect(md).not.toMatch(/### Student demographics\n\n##/)
  })

  it('does not mistake a region name containing a colon for an SVG data value', () => {
    mount(`<section><h2>Rating trajectory</h2>
      <svg class="chart chart-line"><path><title>Region 20: San Antonio</title></path></svg>
      <table><thead><tr><th>Year</th><th>Score</th></tr></thead><tbody><tr><td>2025-26</td><td>81</td></tr></tbody></table>
    </section>`)
    const md = pageMarkdown()
    expect(md).toContain('| 2025-26 | 81 |')
    expect(md).not.toContain('Region 20: San Antonio')
  })

  it('drops decoration the page already hides from assistive tech', () => {
    mount(verdict(vm()))
    const md = pageMarkdown()
    expect(md).not.toContain('↗') // the outbound-link arrow, aria-hidden
    // …but keeps the URL that arrow was decorating.
    expect(md).toContain('dallasisd.org')
  })

  it('includes every supplemental district section with its definitions, source links and caveats', () => {
    const rich = vm({
      enrollmentReported: [
        { year: '2024-25', enrollment: 1_000 },
        { year: '2025-26', enrollment: 1_100 },
      ],
      enrollmentTrend: {
        points: [
          { year: '2024-25', enrollment: 1_000, change: null },
          { year: '2025-26', enrollment: 1_100, change: { delta: 100, pct: 10, fromYear: '2024-25' } },
        ],
        latest: { year: '2025-26', enrollment: 1_100 },
        yoy: { delta: 100, pct: 10, fromYear: '2024-25' },
        sinceFirst: { delta: 100, pct: 10, fromYear: '2024-25' },
      },
      enrollmentSourceUrl: 'https://tea.example/enrollment',
      enrollmentSnapshotDate: '24 August 2026',
      transferContext: {
        netLabel: 'Transfers in minus transfers out (arithmetic context only; not a quality measure)',
        history: [{
          year: '2025-26', transfersIn: 10, transfersOut: 25, net: -15,
          coverage: {
            officialTotals: { in: 'reported', out: 'reported' },
            origins: { published: 2, reported: 1, masked: 1 },
            destinations: { published: 3, reported: 2, masked: 1 },
          },
        }],
        current: {
          year: '2025-26', transfersIn: 10, transfersOut: 25, net: -15,
          coverage: {
            officialTotals: { in: 'reported', out: 'reported' },
            origins: { published: 2, reported: 1, masked: 1 },
            destinations: { published: 3, reported: 2, masked: 1 },
          },
          topOrigins: [{ id: '001902', name: 'Cayuga ISD', transfers: 7 }],
          topDestinations: [{ id: '101919', name: 'Spring ISD', transfers: 9 }],
        },
      },
      teacherTurnover: {
        unit: 'percent',
        history: [{ year: '2025-26', ratePct: 12.3 }],
        latest: { year: '2025-26', ratePct: 12.3 },
      },
      discipline: {
        history: [{
          year: '2025-26',
          cumulativeEnrollment: { count: 1_100, status: 'reported', mask: null },
          students: { count: 40, status: 'reported', mask: null, ratePct: 3.6 },
          actions: { count: 52, status: 'reported', mask: null, ratePer100: 4.73 },
        }],
        current: {
          year: '2025-26',
          cumulativeEnrollment: { count: 1_100, status: 'reported', mask: null },
          categories: [{
            key: 'allDiscipline', label: 'All discipline',
            students: { count: 40, status: 'reported', mask: null, ratePct: 3.6 },
            actions: { count: 52, status: 'reported', mask: null, ratePer100: 4.73 },
          }],
        },
      },
      actionNotices: [{
        id: '057905001', name: 'Sample High School', href: '/school/sample-high-school-057905001',
        improvement: { kind: 'TSI', year: '2026', reason: 'Special Education' },
        peg: { schoolYear: '2026-27' },
      }],
      communityContext: {
        year: 2024, totalPopulation: 2_000, schoolAgePopulation: 300,
        schoolAgePoverty: 60, schoolAgePovertyRate: 20,
      },
      postsecondaryOutcome: {
        graduateYear: '2023-24', fallTerm: 'Fall 2024', graduates: 50,
        enrolledPublic: 20, rate: 40, notFound: 29, notTrackable: 1,
        destinations: [{ institution: 'Texas State University', students: 8 }],
      },
      publicDataMeta: {
        transfers: { source: 'https://tea.example/transfers', fetchedAt: '24 August 2026' },
        educators: { source: 'https://tea.example/tapr', fetchedAt: '24 August 2026' },
        discipline: { source: 'https://tea.example/discipline', fetchedAt: '24 August 2026' },
        actionFlags: {
          sources: {
            improvement: 'https://tea.example/improvement',
            pegProgram: 'https://tea.example/peg',
          },
          fetchedAt: '24 August 2026',
        },
        community: { landing: 'https://census.example/saipe', fetchedAt: '24 August 2026' },
        postsecondary: { landing: 'https://thecb.example/outcomes', fetchedAt: '24 August 2026' },
      },
    })

    mount(
      verdict(rich),
      enrollment(rich),
      transfers(rich),
      discipline(rich),
      actionNotices(rich),
      community(rich),
      postsecondary(rich),
      teachers(rich)
    )
    const md = pageMarkdown()

    for (const heading of [
      'Enrollment over time',
      'Students crossing district lines',
      'Discipline and removal from class',
      'Official improvement and transfer notices',
      'Community around the district',
      'After high school: the following fall',
      'Teachers',
    ]) expect(md).toContain(`## ${heading}`)

    // Definitions and cautions must travel with the figures, not just appear on
    // the visual page that the model never sees.
    expect(md).toContain('Enrollment growth or decline is not a measure of school quality')
    expect(md).toContain('These are movement counts, not a measure of family satisfaction or school quality')
    expect(md).toContain('Arithmetic context only')
    expect(md).toContain('The categories overlap, so they must not be added together')
    expect(md).toContain('not the students enrolled by the district')
    expect(md).toContain('“Not found” does not mean a graduate did not continue their education')
    expect(md).toContain('“Not trackable” is not an outcome')
    expect(md).toContain('it is not a campus-level measure')

    // The structured lists used for transfer flows and college destinations
    // used to weld the value onto the name ("1019199").
    expect(md).toContain('- Spring ISD 101919 — 9 students')
    expect(md).toContain('- Texas State University — 8 students')
    expect(md).not.toContain('1019199')
    expect(md).toContain('Special Education · Final 2026-27 PEG list')

    // All publisher links are present both in the source header and beside the
    // section where their definitions and limitations are explained.
    for (const href of [
      'https://tea.example/enrollment',
      'https://tea.example/transfers',
      'https://tea.example/discipline',
      'https://tea.example/improvement',
      'https://tea.example/peg',
      'https://census.example/saipe',
      'https://thecb.example/outcomes',
      'https://tea.example/tapr',
    ]) expect(md).toContain(href)
    expect(md.indexOf('Supplemental sources on this page')).toBeLessThan(md.indexOf('## Enrollment over time'))
  })

  it('keeps campus notice years and actual class-size definitions', () => {
    const campus = vm({
      id: '057905001',
      name: 'Sample High School',
      level: 'campus',
      actionNotices: [{
        id: '057905001', name: 'Sample High School',
        improvement: { kind: 'TSI', supportLabel: 'Targeted Support', reason: 'Special Education', trackYear: 2 },
        peg: { schoolYear: '2026-27' },
      }],
      classSize: {
        year: '2025-26', reported: 2,
        categories: [
          { key: 'english', label: 'English/language arts', studentsPerClass: 18.4 },
          { key: 'math', label: 'Mathematics', studentsPerClass: 17.2 },
        ],
      },
      publicDataMeta: {
        actionFlags: {
          sources: { improvement: 'https://tea.example/improvement', pegProgram: 'https://tea.example/peg' },
          fetchedAt: '24 August 2026',
        },
        educators: { source: 'https://tea.example/tapr', fetchedAt: '24 August 2026' },
      },
    })
    mount(verdict(campus), actionNotices(campus), teachers(campus))
    const md = pageMarkdown()

    // These dates are section data. A global `.eyebrow` skip used to erase
    // both of them while correctly removing only the hero's eyebrow.
    expect(md).toContain('2026 federal improvement status')
    expect(md).toContain('2026-27 school year')
    expect(md).toContain('### Average students in a class')
    expect(md).toContain('not the student-to-teacher ratio')
    expect(md).toContain('not combined into a made-up campus-wide average')
  })

  it('records the active page-wide comparison at copy time', () => {
    mount(verdict(vm()))
    document.body.insertAdjacentHTML('afterbegin', `<aside class="rail">
      <div class="cohort-bar">
        <button class="chip chip-cohort" aria-pressed="false">Similar economic-disadvantage rate<span class="chip-n">187</span></button>
        <button class="chip chip-cohort" aria-pressed="true">Bexar County<span class="chip-n">15</span></button>
      </div>
    </aside>`)
    const md = pageMarkdown()
    expect(md).toContain('**Selected page-wide comparison:** Bexar County (15 members in the comparison cohort)')
    expect(md.indexOf('Selected page-wide comparison')).toBeLessThan(md.indexOf('Official website'))
  })

  it('exports only the currently visible precomputed comparison group', () => {
    mount(`<section><h2>Comparison evidence</h2>
      <div data-comparison-cohort="peer"><p>Visible peer evidence</p></div>
      <div data-comparison-cohort="county" hidden><p>Stale county evidence</p></div>
    </section>`)
    const md = pageMarkdown()
    expect(md).toContain('Visible peer evidence')
    expect(md).not.toContain('Stale county evidence')
  })

  it('does not resurrect hidden table columns or rows', () => {
    mount(`<section><h2>Trajectory</h2><table>
      <thead><tr><th>Year</th><th>Selected county</th><th hidden>Redundant Texas</th></tr></thead>
      <tbody>
        <tr><th>2025-26</th><td>81</td><td hidden>84</td></tr>
        <tr hidden><th>Hidden year</th><td>70</td><td>71</td></tr>
      </tbody>
    </table></section>`)
    const md = pageMarkdown()
    expect(md).toContain('| Year | Selected county |')
    expect(md).toContain('| 2025-26 | 81 |')
    expect(md).not.toContain('Redundant Texas')
    expect(md).not.toContain('Hidden year')
  })

  it('exports only the visible cohort rows inside the hero fact list', () => {
    const county = {
      key: 'county', label: 'Dallas County', short: 'county', n: 15,
      metrics: { score: 84 }, metricN: { score: 14 },
      placements: { score: { metric: 'score', cohort: 'county', rank: 3, of: 14, tied: 0 } },
    }
    mount(verdict(vm({ cohorts: [...COHORTS, county] })))

    let md = pageMarkdown()
    expect(md).toContain('**Score vs region:**')
    expect(md).toContain('**Region 10 placement:**')
    expect(md).not.toContain('**Score vs county:**')
    expect(md).not.toContain('**Dallas County placement:**')

    document.querySelectorAll('[data-comparison-cohort]').forEach((group) => {
      group.hidden = group.dataset.comparisonCohort !== 'county'
    })
    md = pageMarkdown()
    expect(md).toContain('**Score vs county:**')
    expect(md).toContain('**Dallas County placement:**')
    expect(md).not.toContain('**Score vs region:**')
    expect(md).not.toContain('**Region 10 placement:**')
  })

  it('does not resurrect a hidden stale comparison chip as a stat annotation', () => {
    mount(`<section><h2>Attendance</h2><dl class="stats"><div>
      <dt>Attendance rate</dt>
      <dd>93.0% <span class="cmp" hidden>+2.0 pts vs the old comparison</span></dd>
    </div></dl></section>`)
    const md = pageMarkdown()
    expect(md).toContain('- **Attendance rate:** 93.0%')
    expect(md).not.toContain('old comparison')
  })

  it('produces nothing but the header when there is no main', () => {
    document.body.innerHTML = ''
    expect(pageMarkdown()).toContain('Texas Education Agency')
  })
})
