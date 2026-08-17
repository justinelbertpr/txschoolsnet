import { describe, it, expect } from 'vitest'
import {
  BUCKETS,
  GRADES,
  MAP_PALETTES,
  NEUTRAL_RAMP,
  PERFORMANCE_RAMP,
  RAMP,
  bucketOf,
  bucketRanges,
  buildLayer,
  buildRatingLayer,
  decodeArcs,
  fitProjection,
  geoidsIn,
  mappableDistricts,
  pathData,
  quantileBreaks,
  hiFiPaths,
  renderMapPage,
  ringsOf,
} from '../../src/render/map.js'

/* --------------------------------------------------------------- fixtures */

// A square and a triangle sharing one edge, delta-encoded and quantized the way
// the archived file is, so decodeArcs has something real to undo.
const TOPO = {
  type: 'Topology',
  transform: { scale: [1, 1], translate: [0, 0] },
  arcs: [
    [[0, 0], [0, 10], [10, 0], [0, -10]], // 0: (0,0)->(0,10)->(10,10)->(10,0)
    [[10, 0], [-10, 0]], // 1: (10,0)->(0,0)
    [[10, 0], [0, 10], [-10, -10]], // 2: (10,0)->(20,0)->(20,10)->(10,0)
  ],
  objects: {
    d: {
      type: 'GeometryCollection',
      geometries: [
        { type: 'Polygon', arcs: [[0, 1]], properties: { GEOID: '4800001' } },
        { type: 'Polygon', arcs: [[2]], properties: { GEOID: '4800002' } },
      ],
    },
  },
  txschools: { teaToGeoid: { '000001': '4800001', '000002': '4800002' } },
}

const districts = [
  { teaId: '000001', geoid: '4800001', name: 'Alpha ISD', href: '/district/alpha-isd-000001' },
  { teaId: '000002', geoid: '4800002', name: 'Beta ISD', href: '/district/beta-isd-000002' },
]

const layerFor = (values) =>
  buildLayer({
    key: 'score',
    label: 'Overall score',
    fmt: 'points',
    dir: 'higher',
    values: new Map(values),
    order: districts.map((d) => d.teaId),
  })

const ratingFor = (r) =>
  buildRatingLayer({ ratings: new Map(r), order: districts.map((d) => d.teaId) })

/* --------------------------------------------------------------- topology */

describe('topology decoding', () => {
  it('turns delta-encoded arcs back into absolute coordinates', () => {
    const arcs = decodeArcs(TOPO)
    expect(arcs[0]).toEqual([[0, 0], [0, 10], [10, 10], [10, 0]])
    expect(arcs[1]).toEqual([[10, 0], [0, 0]])
  })

  it('applies the quantization transform', () => {
    const scaled = decodeArcs({ ...TOPO, transform: { scale: [2, 3], translate: [100, 200] } })
    expect(scaled[0][0]).toEqual([100, 200])
    expect(scaled[0][1]).toEqual([100, 230])
  })

  it('stitches a ring from several arcs without repeating the shared point', () => {
    const arcs = decodeArcs(TOPO)
    const rings = ringsOf(TOPO.objects.d.geometries[0], arcs)
    expect(rings).toHaveLength(1)
    // 4 points from arc 0, then arc 1 contributes only its second point.
    expect(rings[0]).toEqual([[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]])
  })

  it('reads a negative arc index as that arc reversed', () => {
    const arcs = decodeArcs(TOPO)
    const fwd = ringsOf({ type: 'Polygon', arcs: [[1]] }, arcs)[0]
    const rev = ringsOf({ type: 'Polygon', arcs: [[~1]] }, arcs)[0]
    expect(rev).toEqual([...fwd].reverse())
  })

  it('handles a MultiPolygon as several rings', () => {
    const arcs = decodeArcs(TOPO)
    const rings = ringsOf({ type: 'MultiPolygon', arcs: [[[0, 1]], [[2]]] }, arcs)
    expect(rings).toHaveLength(2)
  })
})

describe('projection', () => {
  const rings = [[[[0, 0], [0, 10], [20, 10], [20, 0]]]]

  it('fits the bounds to the requested width and flips Y for SVG', () => {
    const { width, height, project } = fitProjection(rings, 200)
    expect(width).toBe(200)
    expect(height).toBe(100) // 20x10 at 10x scale
    // North (y=10) must come out at the TOP of the SVG, which is y=0.
    expect(project([0, 10])).toEqual([0, 0])
    expect(project([0, 0])).toEqual([0, 100])
  })

  it('scales both axes identically, so an equal-area projection stays equal-area', () => {
    const { project } = fitProjection(rings, 200)
    const [x1] = project([10, 0])
    const [, y1] = project([0, 5])
    // 10 units east and 5 units north are 100px and 50px: the same k.
    expect(x1).toBe(100)
    expect(y1).toBe(50)
  })

  it('drops points that round onto the same pixel', () => {
    const { project } = fitProjection(rings, 200)
    // Three collinear points a hundredth of a unit apart collapse to one.
    const d = pathData([[[0, 0], [0.001, 0], [0.002, 0], [20, 0]]], project)
    expect(d.match(/[ML]/g)).toHaveLength(2)
  })
})

/* ---------------------------------------------------------------- buckets */

describe('buckets', () => {
  it('cuts values into five groups of roughly equal count', () => {
    const vals = Array.from({ length: 100 }, (_, i) => i)
    const breaks = quantileBreaks(vals)
    expect(breaks).toHaveLength(BUCKETS - 1)
    const counts = [0, 0, 0, 0, 0]
    for (const v of vals) counts[bucketOf(v, breaks)] += 1
    for (const c of counts) expect(c).toBeGreaterThanOrEqual(15)
  })

  it('gives a district with no figure no bucket at all, rather than the lowest', () => {
    const breaks = quantileBreaks([1, 2, 3, 4, 5])
    expect(bucketOf(null, breaks)).toBeNull()
    expect(bucketOf(undefined, breaks)).toBeNull()
    expect(bucketOf(NaN, breaks)).toBeNull()
    expect(bucketOf(0, breaks)).toBe(0)
  })

  it('survives a measure where every district reports the same figure', () => {
    const breaks = quantileBreaks([7, 7, 7, 7])
    expect(() => bucketOf(7, breaks)).not.toThrow()
    expect(bucketOf(7, breaks)).toBeGreaterThanOrEqual(0)
  })

  it('labels each bucket with its real value range, so shading cannot imply an even spread', () => {
    const vals = [0, 1, 2, 3, 4, 5, 6, 7, 8, 90]
    const ranges = bucketRanges(vals, quantileBreaks(vals), 'points')
    expect(ranges).toHaveLength(BUCKETS)
    expect(ranges.at(-1)).toMatch(/90/) // the outlier is visible in the legend
  })
})

/* ----------------------------------------------------------------- layers */

describe('layers', () => {
  it('indexes values by position in the district order, not by id', () => {
    const l = layerFor([['000001', 10], ['000002', 90]])
    expect(l.buckets).toHaveLength(districts.length)
    expect(l.counted).toBe(2)
  })

  it('leaves a district missing from the values with no bucket', () => {
    const l = layerFor([['000001', 10]])
    expect(l.buckets[1]).toBeNull()
    expect(l.counted).toBe(1)
  })

  it('maps higher-is-better values from low red to high green', () => {
    const l = layerFor([['000001', 10], ['000002', 90]])
    expect(l.palette).toBe(MAP_PALETTES.HIGHER)
    expect(l.buckets[0]).toBeGreaterThan(l.buckets[1])
    expect(l.ranges[0]).toMatch(/90/)
    expect(l.ranges.at(-1)).toMatch(/10/)
    expect(l.direction).toMatch(/Green marks the highest range; red marks the lowest/)
  })

  it('maps lower-is-better values from low green to high red', () => {
    const l = buildLayer({
      key: 'absenteeism', label: 'Chronically absent', fmt: 'pct', dir: 'lower',
      values: new Map([['000001', 5], ['000002', 25]]),
      order: districts.map((d) => d.teaId),
    })
    expect(l.palette).toBe(MAP_PALETTES.LOWER)
    expect(l.buckets[0]).toBeLessThan(l.buckets[1])
    expect(l.ranges[0]).toMatch(/5\.0%/)
    expect(l.ranges.at(-1)).toMatch(/25\.0%/)
    expect(l.direction).toMatch(/Green marks the lowest range; red marks the highest/)
  })

  it('uses a neutral sequential palette for dollar measures', () => {
    const l = buildLayer({
      key: 'spend', label: 'Per-student spending', fmt: 'usd', dir: 'higher',
      values: new Map([['000001', 10_000], ['000002', 20_000]]),
      order: districts.map((d) => d.teaId),
    })
    expect(l.palette).toBe(MAP_PALETTES.NEUTRAL)
    expect(l.buckets[0]).toBeLessThan(l.buckets[1])
    expect(l.direction).toMatch(/not a judgment of quality/)
  })

  it('keeps the rating layer categorical, one shade per letter', () => {
    const l = ratingFor([['000001', 'A'], ['000002', 'F']])
    expect(l.buckets).toEqual([0, GRADES.length - 1])
    expect(l.ranges).toEqual(GRADES)
    expect(l.palette).toBe(MAP_PALETTES.RATING)
  })

  it('gives an unrated district no shade rather than an F', () => {
    const l = ratingFor([['000001', 'A'], ['000002', 'Not Rated']])
    expect(l.buckets).toEqual([0, null])
    expect(l.counted).toBe(1)
  })
})

/* ------------------------------------------------------------- the mapping */

describe('which districts can be drawn', () => {
  it('keeps only the districts the archive holds a polygon for', () => {
    expect(geoidsIn(TOPO)).toEqual(new Set(['4800001', '4800002']))
    const withGhost = [...districts, { teaId: '000003', geoid: '4899999', name: 'Ghost ISD', href: '/x' }]
    expect(mappableDistricts(TOPO, withGhost).map((d) => d.teaId)).toEqual(['000001', '000002'])
  })
})

/* ------------------------------------------------------------------- page */

describe('renderMapPage', () => {
  const page = (over = {}) =>
    renderMapPage({
      topo: TOPO,
      districts,
      layers: [layerFor([['000001', 10], ['000002', 90]])],
      rating: ratingFor([['000001', 'A'], ['000002', 'C']]),
      snapshotDate: '15 August 2026',
      ...over,
    })

  it('draws one path per district, inside a link to its own page', () => {
    const html = page()
    // Scoped to the map's own <g>: the site chrome (menu and search icons)
    // contributes paths of its own, which is why a bare count of "<path" over
    // the whole document reads 3 too high.
    const from = html.indexOf('data-map-shapes')
    const shapes = html.slice(from, html.indexOf('</svg>', from))
    expect(shapes.match(/<path /g)).toHaveLength(districts.length)
    expect(html).toContain('href="/district/alpha-isd-000001"')
    expect(html).toContain('href="/district/beta-isd-000002"')
  })

  it('names every district for a screen reader, since a <path> has no text', () => {
    const html = page()
    expect(html).toContain('aria-label="Alpha ISD, rated A"')
    expect(html).toContain('<title>Alpha ISD — A</title>')
  })

  it('ships one layer already shaded, so the map works with no JavaScript', () => {
    const html = page()
    expect(html).toContain('data-b="0"') // Alpha, rated A
    expect(html).toContain('<select')
  })

  it('hides the layer picker until script reveals it', () => {
    // A control that cannot work without JS must not be offered without JS.
    expect(page()).toMatch(/data-map-controls hidden/)
  })

  it('refuses to render layers that do not line up with the drawn districts', () => {
    // The bug this guards: layers built from a LONGER district list still
    // render, and every district after the first gap gets its neighbour's
    // figure — a map that looks entirely normal and is entirely wrong.
    const wrong = buildLayer({
      key: 'score', label: 'Overall score', fmt: 'points', dir: 'higher',
      values: new Map([['000001', 10]]),
      order: ['000001', '000002', '000003'],
    })
    expect(() => page({ layers: [wrong] })).toThrow(/3 values for 2 drawn districts/)
  })

  it('states what it leaves out rather than quietly dropping it', () => {
    const html = page()
    expect(html).toContain('South Texas ISD')
    expect(html).toContain('no attendance boundary')
  })

  it('ships the measured traffic light, not the classic one', () => {
    // The site owner chose green-to-red, overriding rule 3, so what needs
    // guarding is no longer "is it single-hue" but WHICH green-to-red. The
    // classic ColorBrewer RdYlGn stops close to ΔE 9.7 on the B/D pair under
    // deuteranopia; the shipped ramp holds that pair at 18.5. Reaching for the
    // classic stops because they look more familiar would undo the only
    // mitigation the override left available, and would do it silently.
    //
    // This replaces a test that forbade five specific prototype hexes. Once the
    // ramp changed, none of those five appeared anywhere and it passed without
    // asserting anything — a green test guarding nothing, under a name that had
    // become false.
    expect(RAMP).toHaveLength(BUCKETS)
    expect(RAMP).toBe(PERFORMANCE_RAMP)
    expect(PERFORMANCE_RAMP).toEqual(['#0f5132', '#7cb342', '#ffe9a8', '#e8590c', '#7a0b16'])
    expect(NEUTRAL_RAMP).toEqual(['#dbebea', '#8ac4c9', '#3d95a2', '#155f70', '#082f39'])
    for (const classic of ['#1a9641', '#a6d96a', '#ffffbf', '#fdae61', '#d7191c']) {
      expect(RAMP).not.toContain(classic)
    }
  })

  it('keeps the browser palette and layer-switching contract wired to those stops', async () => {
    const { readFileSync } = await import('node:fs')
    const css = readFileSync(new URL('../../site/style.css', import.meta.url), 'utf8')
    const client = readFileSync(new URL('../../site/map.js', import.meta.url), 'utf8')
    PERFORMANCE_RAMP.forEach((stop, i) => expect(css).toContain(`--map-b${i}: ${stop};`))
    NEUTRAL_RAMP.forEach((stop, i) => expect(css).toContain(`--map-b${i}: ${stop};`))
    expect(css).toMatch(/\.map-svg :where\(\[data-map-shapes\]\) path\s*\{[^}]*fill:\s*var\(--line-2\)/)
    expect(css).toMatch(/\.map-svg :where\(\[data-map-shapes\]\) path:not\(\[data-b\]\)\s*\{\s*fill:\s*url\(#map-missing-pattern\)/)
    expect(css).toMatch(/\.map-no-data-key\[hidden\]\s*\{\s*display:\s*none/)
    expect(client).toMatch(/figure\.setAttribute\('data-map-palette', layer\.palette\)/)
    expect(client).toMatch(/missingKey\.hidden\s*=\s*missing === 0/)
  })

  it('inlines the low-fidelity geometry but projects from the high-fidelity bounds', () => {
    // A coarser copy of the same two shapes: fewer points, same extent.
    const lo = {
      ...TOPO,
      arcs: [[[0, 0], [0, 10], [10, -10]], [[10, 0], [-10, 0]], [[10, 0], [10, 10], [-10, -10]]],
    }
    const html = page({ topoLo: lo, hiFiHref: '/map-hi.json' })
    const hi = page()
    const dOf = (h) => h.slice(h.indexOf('data-map-shapes')).match(/ d="([^"]+)"/)[1]
    // Different geometry inline...
    expect(dOf(html)).not.toBe(dOf(hi))
    // ...but the SAME viewBox, so swapping one for the other cannot move the
    // map. This is the whole reason bounds come from the high fidelity.
    const vb = (h) => h.match(/viewBox="([^"]+)"/g).find((v) => !v.includes('0 0 32 32'))
    expect(vb(html)).toBe(vb(hi))
  })

  it('tells the client where the sharper geometry is, and only when there is one', () => {
    const withLo = JSON.parse(
      page({ topoLo: TOPO, hiFiHref: '/map-hi.json' })
        .match(/data-map-payload>(.*?)<\/script>/s)[1].replace(/\\u003c/g, '<')
    )
    expect(withLo.hiFi).toEqual({ href: '/map-hi.json', width: 900 })
    // No second fidelity: nothing to advertise, so the client never fetches.
    const single = JSON.parse(
      page().match(/data-map-payload>(.*?)<\/script>/s)[1].replace(/\\u003c/g, '<')
    )
    expect(single.hiFi).toBeNull()
  })

  it('pre-renders the high-fidelity paths on the same projection as the page', () => {
    const paths = hiFiPaths({ topo: TOPO, districts })
    expect(Object.keys(paths).sort()).toEqual(['4800001', '4800002'])
    // Identical to what the page inlines when there is no low-fidelity copy.
    const html = page()
    const inline = html.slice(html.indexOf('data-map-shapes')).match(/ d="([^"]+)"/)[1]
    expect(paths['4800001']).toBe(inline)
  })

  it('carries every layer in the payload, indexed the same way as the paths', () => {
    const html = page()
    const json = JSON.parse(html.match(/data-map-payload>(.*?)<\/script>/s)[1].replace(/\\u003c/g, '<'))
    expect(json.order).toEqual(['4800001', '4800002'])
    for (const l of json.layers) expect(l.buckets).toHaveLength(json.order.length)
    expect(json.layers[0].key).toBe('rating')
    expect(json.layers[0].palette).toBe(MAP_PALETTES.RATING)
  })

  it('labels missing values instead of leaving an unlabelled gray shape', () => {
    const html = page({ rating: ratingFor([['000001', 'A'], ['000002', 'Not Rated']]) })
    expect(html).toContain('aria-label="Beta ISD, overall rating not reported"')
    expect(html).toContain('<title>Beta ISD — not reported</title>')
    expect(html).toContain('map-swatch-missing')
    expect(html).toContain('id="map-missing-pattern"')
    expect(html).toMatch(/data-map-missing-key><span/)
    expect(html).toContain('1 of 2 districts has a published rating; 1 is shown as not reported.')
  })

  it('hides the not-reported key when the active layer has complete coverage', () => {
    const html = page()
    expect(html).toMatch(/data-map-missing-key hidden/)
    expect(html).toContain('2 of 2 districts have a published rating.')
    expect(html).not.toContain('shown as not reported')
  })
})
