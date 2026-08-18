/**
 * test/render/spending-chart.test.js
 *
 * "Spending per student" is drawn on the server and REDRAWN on the client, by
 * site/app.js:initSpendChart, whenever a pinned district is added to it. Two
 * renderers, one chart.
 *
 * That is only safe while both compute the same geometry and the same y-domain.
 * If they drift, nothing throws and no test of either half fails on its own —
 * the pinned line is simply plotted against a slightly different axis from the
 * three lines beside it, which looks like data rather than like a bug. So the
 * constants are exported from charts.js and asserted here against the literals
 * app.js carries, because app.js is loaded by the browser and cannot import
 * from a build module.
 */

import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { CMP_GEOM, cmpDomain, comparisonChart } from '../../src/render/charts.js'
import { spending } from '../../src/render/sections.js'

const app = readFileSync('site/app.js', 'utf8')

const vm = (over = {}) => ({
  level: 'district',
  name: 'Klein ISD',
  finance: {
    years: ['2018', '2019', '2020'],
    spendEntity: [12935, 12174, 10934],
    spendPeer: [12916, 12976, 13500],
    spendState: [13054, 13108, 13600],
    vsPeer: -1644,
    vsState: -2233,
  },
  ...over,
})

describe('the spending chart’s two renderers', () => {
  it('agrees on the plot geometry', () => {
    // The numbers app.js redraws with, lifted from its source rather than
    // trusted to a comment.
    const block = app.slice(app.indexOf('function initSpendChart'))
    const w = Number(block.match(/const W = (\d+)/)[1])
    const h = Number(block.match(/W = \d+, H = (\d+)/)[1])
    const pad = Object.fromEntries(
      [...block.match(/PAD = \{([^}]*)\}/)[1].matchAll(/(\w+):\s*(\d+)/g)].map((m) => [m[1], Number(m[2])])
    )
    expect({ w, h, pad }).toEqual(CMP_GEOM)
  })

  it('agrees on the y-domain rule', () => {
    // 0.9 below and 1.05 above — the numbers that decide where every point
    // lands. A pinned line computed on a different pair is drawn on a
    // different axis.
    const block = app.slice(app.indexOf('function initSpendChart'))
    // Anchored, not toContain: `* 0.9` is a substring of `* 0.95`, so the
    // obvious spelling of this test passed on a client that had drifted to a
    // different lower bound — which is exactly the drift it exists to catch.
    expect(block).toMatch(/\* 0\.9\b/)
    expect(block).toMatch(/\* 1\.05\b/)
    const { lo, hi } = cmpDomain([100, 200])
    expect(lo).toBeCloseTo(90)
    expect(hi).toBeCloseTo(210)
  })

  it('publishes the values the client needs to redraw', () => {
    const html = spending(vm())
    const island = html.match(/<script type="application\/json" data-spending>([\s\S]*?)<\/script>/)
    expect(island).not.toBeNull()
    const data = JSON.parse(island[1])
    expect(data.years).toEqual(['2018', '2019', '2020'])
    // Every series the server drew, labelled — the client rebuilds all of them,
    // not just the pinned one, because the scale may have moved.
    expect(data.series.map((s) => s.key)).toEqual(['entity', 'tea', 'state'])
    expect(data.series[0]).toEqual({ key: 'entity', label: 'Klein ISD', values: [12935, 12174, 10934] })
  })

  it('gives the client a layer to replace rather than loose siblings', () => {
    const svg = comparisonChart({ years: ['2018'], series: [{ key: 'entity', values: [1] }] })
    for (const g of ['cmp-grid', 'cmp-lines', 'cmp-x']) expect(svg).toContain(`class="${g}"`)
  })

  it('publishes nothing where there is no chart', () => {
    // Campuses have no finance file, so the section — and its island — vanish.
    expect(spending(vm({ finance: null }))).toBeNull()
  })
})
