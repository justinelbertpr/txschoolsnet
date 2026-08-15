// test/render/charts.test.js
//
// Charts are inline SVG strings, readable with no JavaScript and no animation.
// The properties that matter are structural: a missing figure must produce no
// mark at all (never a point at zero, which reads as a real result), the score
// domain must land on letter-grade boundaries, and any TEA-supplied text must be
// escaped before it reaches the markup.

import { describe, it, expect } from 'vitest'
import { trajectoryChart, scoreBars, stackedShare, comparisonChart, groupedBars, esc, SERIES } from '../../src/render/charts.js'

const count = (s, re) => (s.match(re) ?? []).length
const circles = (s) => count(s, /<circle/g)
const rects = (s) => count(s, /<rect/g)

const traj = (over = {}) =>
  trajectoryChart({
    years: ['2023-24', '2024-25', '2025-26'],
    series: [{ key: 'entity', label: 'Dallas ISD', values: [72, 75, 78] }],
    ...over,
  })

const bars = (rows) => scoreBars(rows)

const grouped = (over = {}) =>
  groupedBars({
    groups: ['Reading', 'Mathematics'],
    series: [{ key: 'l0', label: 'Approaches grade level', values: [80, 75] }],
    ...over,
  })

const cmpChart = (over = {}) =>
  comparisonChart({
    years: ['2021-22', '2022-23', '2023-24'],
    series: [{ key: 'entity', values: [10_000, 11_000, 12_000] }],
    ...over,
  })

/* ------------------------------------------------------------- every chart -- */

const ALL = () => [
  ['trajectoryChart', traj()],
  ['scoreBars', bars([{ label: 'Student Achievement', score: 88, grade: 'B' }])],
  ['stackedShare', stackedShare([{ label: 'Hispanic', value: 60 }, { label: 'White', value: 40 }])],
  ['comparisonChart', cmpChart()],
  ['groupedBars', grouped()],
]

describe('every chart primitive', () => {
  it('returns an SVG string', () => {
    for (const [name, svg] of ALL()) {
      expect(typeof svg, name).toBe('string')
      expect(svg.trimStart().startsWith('<svg'), `${name} did not start with an svg tag`).toBe(true)
      expect(svg.trimEnd().endsWith('</svg>'), `${name} did not close its svg tag`).toBe(true)
    }
  })

  it('carries a viewBox so it scales without a fixed width', () => {
    for (const [name, svg] of ALL()) expect(svg, name).toMatch(/viewBox="0 0 \d+(\.\d+)? \d+(\.\d+)?"/)
  })

  it('carries a text alternative, so the chart is not the only route to the content', () => {
    for (const [name, svg] of ALL()) {
      expect(svg, name).toContain('role="img"')
      expect(svg, name).toMatch(/aria-label="[^"]+"/)
    }
  })

  it('references colour through CSS custom properties rather than hard-coded hex', () => {
    expect(Object.values(SERIES).every((v) => v.startsWith('var(--'))).toBe(true)
    for (const [name, svg] of ALL()) expect(svg, name).not.toMatch(/#[0-9a-fA-F]{3,6}\b/)
  })

  it('needs no script or animation to be read', () => {
    for (const [name, svg] of ALL()) {
      expect(svg, name).not.toContain('<script')
      expect(svg, name).not.toContain('<animate')
    }
  })
})

/* -------------------------------------------------------------- esc ------- */

describe('esc', () => {
  it('escapes every character that could break out of markup', () => {
    expect(esc(`<a href="x" class='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; class=&#39;y&#39;&gt;&amp;&lt;/a&gt;'
    )
  })

  it('coerces non-strings rather than throwing', () => {
    expect(esc(null)).toBe('null')
    expect(esc(42)).toBe('42')
  })
})

/* -------------------------------------------------------- trajectoryChart -- */

describe('trajectoryChart', () => {
  it('snaps the domain to the grade boundaries containing the data', () => {
    const svg = traj({ series: [{ key: 'entity', label: 'X', values: [72, 78] }], years: ['a', 'b'] })
    expect(svg).toContain('data-lo="60"')
    expect(svg).toContain('data-hi="90"')
  })

  it('widens the domain a band when the data sits near a boundary', () => {
    // 61 is within 4 points of 60 and 69 within 4 of 70, so both ends step out a
    // band: the data never sits flush against the frame.
    const svg = traj({ series: [{ key: 'entity', label: 'X', values: [61, 69] }], years: ['a', 'b'] })
    expect(svg).toContain('data-lo="50"')
    expect(svg).toContain('data-hi="80"')
  })

  it('never runs the domain past zero or a hundred', () => {
    const low = traj({ series: [{ key: 'entity', label: 'X', values: [1, 3] }], years: ['a', 'b'] })
    expect(low).toContain('data-lo="0"')
    const high = traj({ series: [{ key: 'entity', label: 'X', values: [97, 99] }], years: ['a', 'b'] })
    expect(high).toContain('data-hi="100"')
  })

  it('draws only the grade rules that fall inside the domain', () => {
    const svg = traj({ series: [{ key: 'entity', label: 'X', values: [72, 78] }], years: ['a', 'b'] })
    // Domain 60..90 contains the 60, 70, 80 and 90 rules but not 50.
    expect(count(svg, /class="band-label">\d+</g)).toBe(4)
    expect(svg).not.toContain('>50<')
  })

  it('draws no point for a missing year, rather than a point at zero', () => {
    const svg = traj({ series: [{ key: 'entity', label: 'X', values: [80, null, 82] }] })
    expect(circles(svg)).toBe(2)
    // A dot at zero would sit on the chart floor; the value 0 must appear nowhere.
    expect(svg).not.toMatch(/class="pt-label"[^>]*>0</)
  })

  it('draws no points at all when the entity reports nothing', () => {
    const svg = traj({
      series: [
        { key: 'entity', label: 'X', values: [null, null, null] },
        { key: 'state', label: 'Texas', values: [70, 71, 72] },
      ],
    })
    expect(circles(svg)).toBe(0)
  })

  it('labels each drawn point with its own value', () => {
    const svg = traj({ series: [{ key: 'entity', label: 'X', values: [72, 75, 78] }] })
    for (const v of [72, 75, 78]) expect(svg).toMatch(new RegExp(`class="pt-label"[^>]*>${v}<`))
  })

  it('omits a line that has fewer than two points to join', () => {
    const svg = traj({ series: [{ key: 'entity', label: 'X', values: [80, null, null] }] })
    expect(count(svg, /<path/g)).toBe(0)
    expect(circles(svg)).toBe(1) // the single reading is still shown
  })

  it('draws the entity line last, so it sits above its comparisons', () => {
    const svg = traj({
      series: [
        { key: 'entity', label: 'X', values: [72, 75, 78] },
        { key: 'state', label: 'Texas average', values: [70, 70, 70] },
      ],
    })
    expect(svg.indexOf('line-state')).toBeLessThan(svg.indexOf('line-entity'))
  })

  it('escapes a label containing a less-than sign', () => {
    const svg = traj({ series: [{ key: 'entity', label: '<script>alert(1)</script>', values: [72, 75, 78] }] })
    expect(svg).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(svg).not.toContain('<script>')
  })

  it('escapes a year label containing a less-than sign', () => {
    const svg = traj({ years: ['<b>', '2024-25', '2025-26'] })
    expect(svg).toContain('&lt;b&gt;')
    expect(svg).not.toContain('<b>')
  })

  it('centres a single year rather than dividing by zero', () => {
    const svg = trajectoryChart({ years: ['2025-26'], series: [{ key: 'entity', label: 'X', values: [80] }] })
    expect(svg).not.toContain('NaN')
    expect(circles(svg)).toBe(1)
  })

  it('publishes its geometry so the enhancement layer redraws on the same scale', () => {
    const svg = traj()
    expect(svg).toContain('data-chart="trajectory"')
    expect(svg).toMatch(/data-pad="\d+,\d+,\d+,\d+"/)
    expect(svg).toMatch(/data-w="\d+" data-h="\d+"/)
  })
})

/* --------------------------------------------------------------- scoreBars -- */

describe('scoreBars', () => {
  it('draws one bar per reported row', () => {
    const svg = bars([
      { label: 'Student Achievement', score: 88, grade: 'B' },
      { label: 'Closing the Gaps', score: 71, grade: 'C' },
    ])
    expect(rects(svg)).toBe(2)
    expect(svg).toContain('>88<')
    expect(svg).toContain('>71<')
  })

  it('says a figure is not reported rather than drawing a zero-length bar', () => {
    const svg = bars([{ label: 'Academic Growth', score: null }])
    expect(rects(svg)).toBe(0)
    expect(svg).toContain('Not reported')
  })

  it('draws a cohort tick only where the cohort has a figure', () => {
    const svg = bars([
      {
        label: 'Student Achievement',
        score: 88,
        markers: [
          { key: 'peer', label: 'Similar student population', short: 'similar', value: 70 },
          { key: 'state', label: 'Texas average', short: 'state', value: null },
        ],
      },
    ])
    expect(count(svg, /class="mark mark-/g)).toBe(1)
    expect(svg).toContain('mark-peer')
    expect(svg).not.toContain('mark-state')
  })

  it('names the cohort a delta is measured against', () => {
    const svg = bars([
      { label: 'Student Achievement', score: 88, markers: [{ key: 'peer', label: 'Similar', short: 'similar', value: 70 }] },
    ])
    expect(svg).toMatch(/\+18\.0 vs similar/)
  })

  it('marks a shortfall with a minus rather than a bare number', () => {
    const svg = bars([
      { label: 'Closing the Gaps', score: 60, markers: [{ key: 'peer', label: 'Similar', short: 'similar', value: 70 }] },
    ])
    expect(svg).toMatch(/−10\.0 vs similar/)
  })

  it('escapes a row label containing a less-than sign', () => {
    const svg = bars([{ label: 'A < B', score: 50, grade: '<b>' }])
    expect(svg).toContain('A &lt; B')
    expect(svg).toContain('&lt;b&gt;')
    expect(svg).not.toContain('<b>')
  })

  it('draws the letter-grade rules regardless of the rows', () => {
    expect(count(bars([{ label: 'x', score: 50 }]), /class="band"/g)).toBe(4)
  })
})

/* ------------------------------------------------------------ stackedShare -- */

describe('stackedShare', () => {
  it('draws one segment per part with a share above zero', () => {
    const svg = stackedShare([
      { label: 'Hispanic', value: 60 },
      { label: 'White', value: 40 },
      { label: 'Pacific Islander', value: 0 },
    ])
    expect(rects(svg)).toBe(2)
  })

  it('titles each segment with its label and share', () => {
    const svg = stackedShare([{ label: 'Hispanic', value: 60 }, { label: 'White', value: 40 }])
    expect(svg).toContain('<title>Hispanic: 60%</title>')
  })

  it('escapes a part label containing a less-than sign', () => {
    const svg = stackedShare([{ label: '<1 year', value: 10 }, { label: 'Rest', value: 90 }])
    expect(svg).toContain('&lt;1 year')
    expect(svg).not.toContain('<1 year')
  })

  it('emits an empty chart rather than throwing on no parts', () => {
    const svg = stackedShare([])
    expect(svg.startsWith('<svg')).toBe(true)
    expect(rects(svg)).toBe(0)
  })
})

/* ---------------------------------------------------------- comparisonChart */

describe('comparisonChart', () => {
  it('draws no point for a missing year, rather than a point at zero', () => {
    const svg = cmpChart({ series: [{ key: 'entity', values: [10_000, null, 12_000] }] })
    expect(svg).not.toContain('NaN')
    expect(circles(svg)).toBe(1) // one end-of-line dot, not one per year
  })

  it('omits a series with fewer than two reported years', () => {
    const svg = cmpChart({ series: [{ key: 'peer', values: [null, null, 12_000] }] })
    expect(count(svg, /<path/g)).toBe(0)
  })

  it('formats its axis with the caller-supplied formatter', () => {
    const svg = cmpChart({ fmt: (v) => `$${(v / 1000).toFixed(0)}k` })
    expect(svg).toMatch(/\$\d+k/)
  })

  it('escapes a year label containing a less-than sign', () => {
    const svg = cmpChart({ years: ['<x>', '2022-23', '2023-24'] })
    expect(svg).toContain('&lt;x&gt;')
    expect(svg).not.toContain('<x>')
  })

  it('survives a flat series without dividing by zero', () => {
    const svg = cmpChart({ series: [{ key: 'entity', values: [0, 0, 0] }] })
    expect(svg).not.toContain('NaN')
  })
})

/* -------------------------------------------------------------- groupedBars */

describe('groupedBars', () => {
  it('draws one bar per group per level', () => {
    const svg = grouped({
      series: [
        { key: 'l0', label: 'Approaches grade level', values: [80, 75] },
        { key: 'l1', label: 'Meets grade level', values: [55, 50] },
      ],
    })
    expect(rects(svg)).toBe(4)
  })

  it('shows an em dash rather than a zero-length bar for a missing level', () => {
    const svg = grouped({ series: [{ key: 'l0', label: 'Approaches', values: [80, null] }] })
    expect(rects(svg)).toBe(1)
    expect(svg).toContain('class="na-sm">—<')
  })

  it('draws a cohort tick and a signed gap only where a comparison exists', () => {
    const svg = grouped({
      series: [{ key: 'l0', label: 'Approaches', values: [80, 75], compare: [70, null] }],
    })
    expect(count(svg, /class="mark mark-peer"/g)).toBe(1)
    expect(svg).toMatch(/class="delta">\+10</)
  })

  it('marks a shortfall against the cohort with a minus', () => {
    const svg = grouped({ series: [{ key: 'l0', label: 'Approaches', values: [60, 75], compare: [70, 70] }] })
    expect(svg).toMatch(/class="delta">−10</)
  })

  it('escapes a group label containing a less-than sign', () => {
    const svg = grouped({ groups: ['Reading < Math', 'Science'] , series: [{ key: 'l0', label: 'A', values: [80, 70] }] })
    expect(svg).toContain('Reading &lt; Math')
    expect(svg).not.toContain('Reading < Math')
  })

  it('escapes a series label containing a less-than sign', () => {
    const svg = grouped({ series: [{ key: 'l0', label: '<em>Approaches</em>', values: [80, 70] }] })
    expect(svg).toContain('&lt;em&gt;Approaches&lt;/em&gt;')
    expect(svg).not.toContain('<em>')
  })

  it('grows its height with the number of groups rather than overlapping them', () => {
    const one = groupedBars({ groups: ['A'], series: [{ key: 'l0', label: 'A', values: [50] }] })
    const three = groupedBars({ groups: ['A', 'B', 'C'], series: [{ key: 'l0', label: 'A', values: [50, 50, 50] }] })
    const h = (s) => Number(s.match(/viewBox="0 0 \d+ (\d+(?:\.\d+)?)"/)[1])
    expect(h(three)).toBeGreaterThan(h(one))
  })
})
