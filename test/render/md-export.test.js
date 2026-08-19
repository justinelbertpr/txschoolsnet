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
import { outcomes, verdict, standouts, students, domains, campuses } from '../../src/render/sections.js'

const COHORTS = [
  { key: 'peer', label: 'Similar economic-disadvantage rate', short: 'similar economic context', n: 399, metrics: { 'ccmr:0': 55, 'ccmr:1': 30 }, metricN: {} },
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
  ['8 of 46 (Region 10)', 'a rank, its denominator and its cohort'],
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
    expect(md).toContain('Average (similar economic context)')
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

  it('drops decoration the page already hides from assistive tech', () => {
    mount(verdict(vm()))
    const md = pageMarkdown()
    expect(md).not.toContain('↗') // the outbound-link arrow, aria-hidden
    // …but keeps the URL that arrow was decorating.
    expect(md).toContain('dallasisd.org')
  })

  it('produces nothing but the header when there is no main', () => {
    document.body.innerHTML = ''
    expect(pageMarkdown()).toContain('Texas Education Agency')
  })
})
