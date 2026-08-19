// test/render/charts.test.js
//
// Charts are markup strings, readable with no JavaScript and no animation. Two
// families, tested separately because they promise different things:
//
//   The LINE charts are inline SVG. The properties that matter are structural: a
//   missing figure must produce no mark at all (never a point at zero, which
//   reads as a real result), and the score domain must land on letter-grade
//   boundaries.
//
//   The BAR charts are HTML lists, because SVG text is sized in user units and a
//   640-unit viewBox in a phone column rendered them at 5.3 CSS px. What is
//   tested here is that every figure is real text rather than a length — a
//   number a reader can select and a screen reader can read in order — and that
//   a missing figure produces no bar.
//
// In both families any TEA-supplied text must be escaped before it reaches the
// markup.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { trajectoryChart, scoreBars, stackedShare, comparisonChart, groupedBars, esc, SERIES } from '../../src/render/charts.js'

const count = (s, re) => (s.match(re) ?? []).length
const circles = (s) => count(s, /<circle/g)
const rects = (s) => count(s, /<rect/g)
/** Bars are <span>s with a width, so "how many bars" is "how many fills". */
const fills = (s) => count(s, /class="hbar-fill"/g)
/** The text a reader actually sees, with every tag and attribute removed. */
const visible = (s) =>
  s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&middot;/g, '·')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

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

const SVGS = () => [
  ['trajectoryChart', traj()],
  ['stackedShare', stackedShare([{ label: 'Hispanic', value: 60 }, { label: 'White', value: 40 }])],
  ['comparisonChart', cmpChart()],
]

const LISTS = () => [
  ['scoreBars', bars([{ label: 'Student Achievement', score: 88, grade: 'B' }])],
  ['groupedBars', grouped()],
]

const ALL = () => [...SVGS(), ...LISTS()]

describe('every chart primitive', () => {
  it('returns a markup string', () => {
    for (const [name, out] of ALL()) {
      expect(typeof out, name).toBe('string')
      expect(out.trimStart().startsWith('<'), `${name} did not start with a tag`).toBe(true)
    }
  })

  it('references colour through CSS custom properties rather than hard-coded hex', () => {
    expect(Object.values(SERIES).every((v) => v.startsWith('var(--'))).toBe(true)
    for (const [name, out] of ALL()) expect(out, name).not.toMatch(/#[0-9a-fA-F]{3,6}\b/)
  })

  it('needs no script or animation to be read', () => {
    for (const [name, out] of ALL()) {
      expect(out, name).not.toContain('<script')
      expect(out, name).not.toContain('<animate')
      expect(out, name).not.toMatch(/\son[a-z]+=/)
    }
  })
})

describe('the SVG charts', () => {
  it('close their own tag', () => {
    for (const [name, svg] of SVGS()) {
      expect(svg.trimStart().startsWith('<svg'), `${name} did not start with an svg tag`).toBe(true)
      expect(svg.trimEnd().endsWith('</svg>'), `${name} did not close its svg tag`).toBe(true)
    }
  })

  it('carries a viewBox so it scales without a fixed width', () => {
    for (const [name, svg] of SVGS()) expect(svg, name).toMatch(/viewBox="0 0 \d+(\.\d+)? \d+(\.\d+)?"/)
  })

  it('carries a text alternative, so the chart is not the only route to the content', () => {
    for (const [name, svg] of SVGS()) {
      expect(svg, name).toContain('role="img"')
      expect(svg, name).toMatch(/aria-label="[^"]+"/)
    }
  })

  // Text inside an SVG is measured in user units, so a 640-wide viewBox in a
  // 309px column renders it at 48%. The two line charts are the only SVGs left
  // carrying text, and both must stay tall enough that the stylesheet's enlarged
  // narrow-viewport type has somewhere to sit: at 2.67:1 the plot area on a phone
  // was 66px. Guarding the ratio here because it is the one number that decides
  // whether the phone rendering is a chart or a strip.
  it('keeps the line charts no wider than twice their height, so a phone gets a chart', () => {
    for (const [name, svg] of [['trajectoryChart', traj()], ['comparisonChart', cmpChart()]]) {
      const [, w, h] = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/).map(Number)
      expect(w / h, `${name} is ${(w / h).toFixed(2)}:1`).toBeLessThanOrEqual(2.05)
    }
  })
})

/* ---------------------------------------------------------- the bar lists -- */

describe('the HTML bar lists', () => {
  it('are lists of real text, not SVG', () => {
    for (const [name, html] of LISTS()) {
      expect(html, name).not.toContain('<svg')
      expect(html, name).toContain('<li class="hbar"')
    }
  })

  // The whole reason these two stopped being SVG: at 5.3 CSS px the label was
  // not readable, and a label drawn as a <text> node cannot wrap, cannot be
  // selected and cannot grow with the reader's own font size.
  it('prints every label and figure as document text', () => {
    const html = bars([
      { label: 'Student Achievement', score: 88, grade: 'B', markers: [{ key: 'peer', label: 'Similar', short: 'similar', value: 70 }] },
    ])
    const text = visible(html)
    expect(text).toContain('Student Achievement')
    expect(text).toContain('88')
    expect(text).toContain('B')
    expect(text).toContain('+18.0 vs similar')
  })

  it('states a length only as a custom property, never as a pixel width', () => {
    for (const [name, html] of LISTS()) {
      expect(html, name).toMatch(/style="--v:[\d.]+"/)
      expect(html, name).not.toMatch(/width:\s*\d/)
    }
  })

  it('hides the decorative track from assistive technology, since every figure is beside it', () => {
    for (const [name, html] of LISTS()) expect(html, name).toContain('<span class="hbar-track" aria-hidden="true">')
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

  it('breaks the line at a missing year instead of implying continuous reporting', () => {
    const svg = trajectoryChart({
      years: ['2020-21', '2021-22', '2022-23', '2023-24', '2024-25'],
      series: [{ key: 'entity', label: 'X', values: [70, 75, null, 80, 85] }],
    })
    const d = svg.match(/<path d="([^"]+)" class="line line-entity"/)?.[1] ?? ''
    expect(d.match(/M/g)).toHaveLength(2)
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
    const html = bars([
      { label: 'Student Achievement', score: 88, grade: 'B' },
      { label: 'Closing the Gaps', score: 71, grade: 'C' },
    ])
    expect(fills(html)).toBe(2)
    expect(visible(html)).toContain('88')
    expect(visible(html)).toContain('71')
  })

  it('says a figure is not reported rather than drawing a zero-length bar', () => {
    const html = bars([{ label: 'Academic Growth', score: null }])
    expect(fills(html)).toBe(0)
    expect(html).not.toContain('--v:')
    expect(visible(html)).toContain('Not reported')
  })

  it('draws a cohort tick only where the cohort has a figure', () => {
    const html = bars([
      {
        label: 'Student Achievement',
        score: 88,
        markers: [
          { key: 'peer', label: 'Similar student population', short: 'similar', value: 70 },
          { key: 'state', label: 'Texas average', short: 'state', value: null },
        ],
      },
    ])
    expect(count(html, /class="hbar-mark /g)).toBe(1)
    expect(html).toContain('data-mark="peer"')
    expect(html).not.toContain('data-mark="state"')
  })

  // A domain TEA published no score for still has a cohort average, and that
  // average is the comparison this site adds. Dropping the tick with the bar
  // would throw away the only figure on the row.
  it('keeps a cohort tick on a row the entity has no score for', () => {
    const html = bars([
      { label: 'Academic Growth', score: null, markers: [{ key: 'peer', label: 'Similar', short: 'similar', value: 74.5 }] },
    ])
    expect(fills(html)).toBe(0)
    expect(html).toContain('data-mark="peer"')
    // Not a delta — there is nothing to subtract from — but the cohort's level.
    expect(visible(html)).toContain('similar 74.5')
    expect(visible(html)).not.toMatch(/[+−]/)
  })

  it('names the cohort a delta is measured against', () => {
    const html = bars([
      { label: 'Student Achievement', score: 88, markers: [{ key: 'peer', label: 'Similar', short: 'similar', value: 70, n: 286 }] },
    ])
    expect(visible(html)).toContain('+18.0 vs similar')
    expect(visible(html)).toContain('286 reporting')
  })

  it('marks a shortfall with a minus rather than a bare number', () => {
    const html = bars([
      { label: 'Closing the Gaps', score: 60, markers: [{ key: 'peer', label: 'Similar', short: 'similar', value: 70 }] },
    ])
    expect(visible(html)).toContain('−10.0 vs similar')
  })

  // The SVG had room for one line of type under each bar, so a second cohort's
  // tick stood on the track with nothing saying what it was.
  it('states every cohort on the track in words, not just the first', () => {
    const html = bars([
      {
        label: 'Student Achievement',
        score: 79,
        markers: [
          { key: 'peer', label: 'Similar', short: 'similar', value: 74.5 },
          { key: 'state', label: 'Texas average', short: 'Texas', value: 80.1 },
        ],
      },
    ])
    const text = visible(html)
    expect(text).toContain('+4.5 vs similar')
    expect(text).toContain('−1.1 vs Texas')
  })

  it('gives each tick a dash as well as a hue, so the two are told apart without colour', () => {
    const html = bars([
      {
        label: 'Student Achievement',
        score: 79,
        markers: [
          { key: 'peer', label: 'Similar', short: 'similar', value: 74.5 },
          { key: 'state', label: 'Texas average', short: 'Texas', value: 80.1 },
        ],
      },
    ])
    expect(html).toMatch(/data-mark="state"[^>]*repeating-linear-gradient/)
  })

  it('escapes a row label containing a less-than sign', () => {
    const html = bars([{ label: 'A < B', score: 50, grade: '<b>' }])
    expect(html).toContain('A &lt; B')
    expect(html).toContain('&lt;b&gt;')
    expect(html).not.toContain('<b>')
  })

  it('escapes a cohort name before it reaches a title attribute', () => {
    const html = bars([
      { label: 'x', score: 50, markers: [{ key: 'peer', label: 'A" onerror="x', short: 'A" onerror="x', value: 40 }] },
    ])
    // The quote that would have closed title="…" and started a new attribute is
    // an entity, so the handler stays a string inside the title.
    expect(html).toContain('title="A&quot; onerror=&quot;x: 40"')
    expect(html).not.toMatch(/title="[^"]*"\s+onerror/)
  })

  it('carries a metric key when the caller supplies one, and omits it otherwise', () => {
    expect(bars([{ label: 'x', score: 50, key: 'domain:ach' }])).toContain('data-metric="domain:ach"')
    expect(bars([{ label: 'x', score: 50 }])).not.toContain('data-metric')
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
    // A dot per READING: two here, not three — the missing year gets none, so
    // a gap in the data never reads as a measurement.
    expect(circles(svg)).toBe(2)
  })

  it('marks every reading, not only the last one', () => {
    // Three bare lines let a reader see the shape but not where the actual
    // measurements fall. Five years of data is five dots per series.
    const svg = cmpChart({ series: [{ key: 'entity', values: [1, 2, 3, 4, 5] }] })
    expect(circles(svg)).toBe(5)
  })

  it('keeps the final reading the largest dot, since the prose quotes it', () => {
    const svg = cmpChart({ series: [{ key: 'entity', values: [1, 2, 3] }] })
    const radii = [...svg.matchAll(/<circle[^>]*r="([\d.]+)"/g)].map((m) => Number(m[1]))
    expect(radii).toHaveLength(3)
    expect(radii.at(-1)).toBeGreaterThan(radii[0])
  })

  it('breaks the line at a missing year instead of bridging the gap', () => {
    const svg = comparisonChart({
      years: ['2020-21', '2021-22', '2022-23', '2023-24', '2024-25'],
      series: [{ key: 'entity', values: [10_000, 11_000, null, 12_000, 13_000] }],
    })
    const d = svg.match(/<path d="([^"]+)" class="line line-entity"/)?.[1] ?? ''
    expect(d.match(/M/g)).toHaveLength(2)
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
    const html = grouped({
      series: [
        { key: 'l0', label: 'Approaches grade level', values: [80, 75] },
        { key: 'l1', label: 'Meets grade level', values: [55, 50] },
      ],
    })
    expect(fills(html)).toBe(4)
  })

  it('gives each subject its own heading, so the group name is a real heading', () => {
    const html = grouped()
    expect(html).toContain('<h4 class="hbar-group-label">Reading</h4>')
    expect(html).toContain('<h4 class="hbar-group-label">Mathematics</h4>')
    expect(count(html, /<ul class="hbars">/g)).toBe(2)
  })

  it('shows an em dash rather than a zero-length bar for a missing level', () => {
    const html = grouped({ series: [{ key: 'l0', label: 'Approaches', values: [80, null] }] })
    expect(fills(html)).toBe(1)
    expect(visible(html)).toContain('—')
    expect(visible(html)).toContain('Not reported')
  })

  it('draws a cohort tick and a signed gap only where a comparison exists', () => {
    const html = grouped({
      series: [{ key: 'l0', label: 'Approaches', values: [80, 75], compare: [70, null], compareN: [2106, null] }],
    })
    expect(count(html, /data-mark="peer"/g)).toBe(1)
    expect(visible(html)).toContain('+10 vs Similar schools')
    expect(visible(html)).toContain('2,106 reporting')
  })

  it('marks a shortfall against the cohort with a minus', () => {
    const html = grouped({ series: [{ key: 'l0', label: 'Approaches', values: [60, 75], compare: [70, 70] }] })
    expect(visible(html)).toContain('−10 vs')
  })

  it('marks an equal value as level rather than a positive gain', () => {
    const html = grouped({ series: [{ key: 'l0', label: 'Approaches', values: [70, 75], compare: [70, 70] }] })
    expect(visible(html)).toContain('±0 vs')
    expect(visible(html)).not.toContain('+0 vs')
  })

  // metrics.js keys this cell "staar:<subject>:<level>". Publishing that key on
  // the row is what lets the cohort switch find the row by name.
  it('publishes the metric key each row is about', () => {
    const html = grouped({ series: [{ key: 'l1', label: 'Meets', values: [55, 50] }] })
    expect(html).toContain('data-metric="staar:Reading:1"')
    expect(html).toContain('data-metric="staar:Mathematics:1"')
  })

  it('paints the three levels in the colours the legend names them with', () => {
    const html = grouped({
      series: [
        { key: 'l0', label: 'Approaches', values: [80, 75] },
        { key: 'l1', label: 'Meets', values: [55, 50] },
        { key: 'l2', label: 'Masters', values: [25, 20] },
      ],
    })
    // style.css .swatch-l0/.swatch-l1/.swatch-l2 -> --s0/--s2/--s3.
    for (const v of ['var(--s0)', 'var(--s2)', 'var(--s3)']) expect(html).toContain(`background:${v}`)
  })

  it('escapes a group label containing a less-than sign', () => {
    const html = grouped({ groups: ['Reading < Math', 'Science'], series: [{ key: 'l0', label: 'A', values: [80, 70] }] })
    expect(html).toContain('Reading &lt; Math')
    expect(html).not.toContain('Reading < Math')
  })

  it('escapes a series label containing a less-than sign', () => {
    const html = grouped({ series: [{ key: 'l0', label: '<em>Approaches</em>', values: [80, 70] }] })
    expect(html).toContain('&lt;em&gt;Approaches&lt;/em&gt;')
    expect(html).not.toContain('<em>')
  })

  it('grows with the number of groups rather than overlapping them', () => {
    const one = groupedBars({ groups: ['A'], series: [{ key: 'l0', label: 'A', values: [50] }] })
    const three = groupedBars({ groups: ['A', 'B', 'C'], series: [{ key: 'l0', label: 'A', values: [50, 50, 50] }] })
    expect(count(three, /class="hbar-group"/g)).toBe(3)
    expect(count(one, /class="hbar-group"/g)).toBe(1)
  })

  it('can keep the all-subjects overview open while disclosing subject detail', () => {
    const html = groupedBars({
      groups: ['All Subjects', 'Reading', 'Mathematics'],
      series: [{ key: 'l0', label: 'Approaches', values: [80, 75, 70] }],
      collapseAfterFirst: true,
    })
    expect(html).toContain('<div class="hbar-group"><h4 class="hbar-group-label">All Subjects</h4>')
    expect(html.match(/<details class="hbar-group hbar-group-disclosure">/g)).toHaveLength(2)
    expect(html).toContain('role="heading" aria-level="4">Reading</span>')
  })
})

/* --------------------------------------- cohort-switch enhancement contract --

   These are source-level assertions because site/app.js is a dependency-free
   browser script and the project deliberately has no simulated-DOM test stack.
   The regression was the selector contract itself: the renderer moved both bar
   families from SVG to keyed HTML lists while the enhancement kept querying the
   removed SVG classes. Keep the client on the current, explicit data hooks. */

describe('the cohort switch targets the current HTML bar contract', () => {
  const js = readFileSync(new URL('../../site/app.js', import.meta.url), 'utf8')

  it('finds both hbar families and identifies their rows by published metric key', () => {
    expect(js).toContain("document.querySelector('[data-bars=\"domain\"]')")
    expect(js).toContain("document.querySelector('[data-bars=\"staar\"]')")
    expect(js).toContain("root.querySelectorAll('.hbar[data-metric]')")
    expect(js).not.toMatch(/svg\.chart-bars|svg\.chart-grouped/)
  })

  it('moves the keyed mark and rewrites a keyed, visible delta description', () => {
    expect(js).toContain("mark.style.setProperty('--m'")
    expect(js).toContain('mark.dataset.mark = c.key')
    expect(js).toContain('delta.dataset.delta = cohort.key')
    expect(js).toContain('delta.textContent = comparisonText')
    expect(js).toContain('c.metricN?.[metric]')
  })

  it('remains a valid standalone browser script', () => {
    expect(() => new Function(js)).not.toThrow()
  })

  it('also restarts an interactively redrawn trajectory after a missing year', () => {
    expect(js).toContain("if (v == null) { open = false; return '' }")
  })
})

describe('pin comparisons extend the keyed bar contract', () => {
  const js = readFileSync(new URL('../../site/app.js', import.meta.url), 'utf8')

  it('lazy-loads one validated district bundle and caches it', () => {
    expect(js).toContain("if (!/^\\d{6}(?:\\d{3})?$/.test(rec.id))")
    expect(js).toContain('pinMetricAssets.has(districtId)')
    expect(js).toContain('fetch(`/data/pins/${districtId}.json`')
    expect(js).toContain("payload?.version !== 1")
  })

  it('publishes a visible value or an explicit not-reported label beside every matching bar', () => {
    expect(js).toContain("mark.className = 'hbar-mark hbar-mark-pin'")
    expect(js).toContain("sub.className = 'hbar-pin-sub'")
    expect(js).toContain("value === null ? 'not reported'")
    expect(js).toContain("mark.setAttribute('aria-hidden', 'true')")
  })

  it('keeps full current metrics out of sessionStorage', () => {
    expect(js).toContain('const storedPin = ({ id, name, label, level, hue, byYear })')
    expect(js).toContain('[...pinned.values()].map(storedPin)')
  })
})
