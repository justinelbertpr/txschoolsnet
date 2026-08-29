// The statewide map: one polygon per school district, shaded by whichever
// measure the reader picks.
//
// ------------------------------------------------------------------ ENCODING
//
// Performance layers use green for the stronger end and red for the weaker
// end, at the site owner's explicit instruction. Which numeric end receives
// which colour follows the metric's declared direction; resource measures
// use a neutral single-hue scale because more dollars are not inherently
// better or worse. Transfer balance is a signed exception: net outflow is the
// weaker/red side and net inflow the stronger/green side, centred on zero.
// site/style.css records the map as a deliberate exception to the site's
// otherwise neutral grade treatment.
//
// The measurements are on RAMP below. The short version: the classic
// green-amber-red ramp fails not on its adjacent pairs but on B/D, which close
// to ΔE 9.7 under deuteranopia — and B/D is a non-adjacent pair, so the
// four-adjacent-pair test this file used to apply would have passed it. The
// ramp that ships holds that same pair at 18.5, bought by deepening A well
// below B and F well below D.
//
// It is still less safe than a single hue, and the letter is what carries the
// meaning: it is in the key, in every district's accessible name, and in the
// hover readout. The reader can also switch any class off, which is a
// two-colour view and therefore exact regardless of colour vision.
//
// ----------------------------------------------------------------- NO SCRIPT
//
// The page ships one layer already drawn, server-side, in the HTML. With
// JavaScript off that map is complete and every district links to its own page;
// only the layer PICKER needs script, and it is the same SSR-plus-enhancement
// split the rankings tool uses. What a reader without JS loses is the ability
// to change measure, not the map.
//
// -------------------------------------------------------------------- SCOPE
//
// Geographic districts are polygons. Open-enrollment charter campuses are a
// separate point overlay: they are places, not resident-assignment territories,
// and the map never manufactures a polygon for a charter school system.

import mapshaper from 'mapshaper'
import { esc, num, pct, section, shell, usd, SITE_ORIGIN } from './shell.js'
import { HIGHER, LOWER } from './metrics.js'

export const MAP_HREF = '/map'
export const MAP_FILE = 'map.html'

/** How many shades a continuous measure is cut into. */
export const BUCKETS = 5

/**
 * Green through red, at the site owner's explicit instruction, overriding the
 * single-hue ramp this page shipped with and the "never colour-code a grade"
 * line in site/style.css rule 3. The override is recorded there too, so the
 * stylesheet does not assert one thing while the map does another.
 *
 * Given the decision, this is the best-separating traffic light I could
 * measure rather than the obvious one. Brettel/Viénot simulation, CIE76, worst
 * of ALL TEN pairs (not just the four adjacent ones — any two classes can
 * share a border on a choropleth, so the adjacent-only test the earlier note
 * used would have passed a ramp that fails in practice):
 *
 *                              adjacent ΔE            worst of all ten
 *                       norm  prot  deut  trit        under deuteranopia
 *   ColorBrewer RdYlGn  34.1  26.2  24.8  20.9         9.7   B/D collide
 *   THIS RAMP           46.1  30.6  30.5  33.4        18.5   B/D, ~2x better
 *   teal (was shipping) 19.9  16.9  19.8  20.2        19.8
 *
 * The failure mode is unchanged in kind — B and D are the pair that closes
 * under deuteranopia, as they do in every green-to-red ramp, because yellow
 * must be light and that forces B and D to similar lightness. It is roughly
 * twice as far apart here as in the classic ramp, bought by deepening A well
 * below B and F well below D. It is still not as safe as a single hue, and the
 * letter remains the real encoding: it is in the legend, in every district's
 * accessible name, and in the hover readout.
 */
/**
 * Palette semantics are data, not an inference the browser makes from a label.
 *
 * `rating`, `higher` and `lower` all use the measured good-to-bad traffic-light
 * ramp. Their bucket ORDER differs: higher-is-better measures reverse their
 * numeric quantiles before they reach the palette, while lower-is-better
 * measures and A-to-F ratings already run from strongest to weakest.
 *
 * Dollar measures are `neutral`. More spending or higher pay is not inherently
 * a better or worse result, so those layers use a single-hue sequential ramp
 * and say explicitly that the colour is not a quality judgment.
 */
export const MAP_PALETTES = Object.freeze({
  RATING: 'rating',
  HIGHER: 'higher',
  LOWER: 'lower',
  NEUTRAL: 'neutral',
  DIVERGING: 'diverging',
})

export const PERFORMANCE_RAMP = ['#0f5132', '#7cb342', '#ffe9a8', '#e8590c', '#7a0b16']
export const NEUTRAL_RAMP = ['#dbebea', '#8ac4c9', '#3d95a2', '#155f70', '#082f39']
// Transfer balance is directional by editorial policy: a net outflow is the
// weaker/red end and a net inflow is the stronger/green end. Reuse the map's
// measured performance ramp in numeric order (negative to positive) so its
// color-vision separation does not regress.
export const DIVERGING_RAMP = ['#7a0b16', '#e8590c', '#ffe9a8', '#7cb342', '#0f5132']
// Kept as the public name used by the existing palette regression test.
export const RAMP = PERFORMANCE_RAMP

export function mapPaletteFor({ fmt, dir }) {
  if (fmt === 'usd') return MAP_PALETTES.NEUTRAL
  if (dir === HIGHER) return MAP_PALETTES.HIGHER
  if (dir === LOWER) return MAP_PALETTES.LOWER
  throw new Error(`map: metric direction must be ${HIGHER} or ${LOWER}, got ${JSON.stringify(dir)}`)
}

export function mapDirectionNote(palette) {
  if (palette === MAP_PALETTES.RATING) {
    return 'A is the strongest result and F is the weakest. Green marks A; red marks F.'
  }
  if (palette === MAP_PALETTES.HIGHER) {
    return 'Higher values are better for this measure. Green marks the highest range; red marks the lowest.'
  }
  if (palette === MAP_PALETTES.LOWER) {
    return 'Lower values are better for this measure. Green marks the lowest range; red marks the highest.'
  }
  if (palette === MAP_PALETTES.NEUTRAL) {
    return 'Darker teal marks a higher dollar amount. Color is not a judgment of quality.'
  }
  if (palette === MAP_PALETTES.DIVERGING) {
    return 'Green marks more transfers in than out; red marks more transfers out than in. Darker shades mark the largest balances in each direction. The pale middle means no net difference. This layer treats net outflow as the weaker transfer balance, but the totals do not explain why students transfer or independently rate school quality.'
  }
  throw new Error(`map: unknown palette ${JSON.stringify(palette)}`)
}

/** Districts TEA rates but NCES draws no polygon for. */
export const NO_SHAPE_NOTE =
  'Four rated districts have no boundary to draw: South Texas ISD is a magnet district with no ' +
  'contiguous territory, Vysehrad ISD is folded into a neighbour by the Census, and Texas Tech ' +
  'University K-12 and University of Texas at Austin HS enroll from across the state.'

const finite = (v) => typeof v === 'number' && Number.isFinite(v)

export const TEXAS_ALBERS =
  '+proj=aea +lat_1=27.5 +lat_2=35 +lat_0=31.25 +lon_0=-99 +datum=NAD83'

/** Project TEA longitude/latitude points into the same Albers plane as TIGER. */
export const isOnlineSchool = (campus) =>
  campus?.isOnline === true || String(campus?.onlineSchool ?? '').trim().toLowerCase() === 'yes'

export function projectCharterCampuses(campuses = []) {
  const from = mapshaper.internal.parseCrsString('wgs84')
  const to = mapshaper.internal.parseCrsString(TEXAS_ALBERS)
  const project = mapshaper.internal.getProjTransform(from, to)
  return (campuses ?? [])
    .filter((campus) => campus?.isCharter && !isOnlineSchool(campus) && finite(campus.lat) && finite(campus.lon))
    .map((campus) => ({ ...campus, point: project(campus.lon, campus.lat) }))
    .filter((campus) => campus.point.every(finite))
}

/* ------------------------------------------------------------- topology -- */

/**
 * TopoJSON to absolute rings.
 *
 * The archived file is quantized and delta-encoded (that is most of why it is
 * 176 KB rather than 1.8 MB), so every arc has to be walked once to turn deltas
 * back into coordinates. Written out rather than pulled from the topojson
 * package: it is twenty lines, it runs once per build, and this repo has four
 * runtime dependencies and a reason for each.
 */
export function decodeArcs(topo) {
  const { scale = [1, 1], translate = [0, 0] } = topo.transform ?? {}
  return topo.arcs.map((arc) => {
    let x = 0
    let y = 0
    return arc.map(([dx, dy]) => {
      x += dx
      y += dy
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]]
    })
  })
}

/** A geometry's arc indices to rings. A negative index means "that arc, reversed". */
export function ringsOf(geometry, arcs) {
  const one = (idxs) => {
    const pts = []
    for (const i of idxs) {
      const arc = i < 0 ? [...arcs[~i]].reverse() : arcs[i]
      // Arcs share endpoints, so every arc after the first repeats the last
      // point of the one before it.
      pts.push(...(pts.length ? arc.slice(1) : arc))
    }
    return pts
  }
  if (geometry.type === 'Polygon') return geometry.arcs.map(one)
  if (geometry.type === 'MultiPolygon') return geometry.arcs.flatMap((p) => p.map(one))
  return []
}

/**
 * Fit every ring into a viewBox, flipping Y.
 *
 * The archived coordinates are Albers metres, where Y grows north; SVG's Y grows
 * down. Scale is the SAME on both axes — an equal-area projection stretched
 * unequally is no longer equal-area, and the whole reason for choosing Albers
 * (see src/boundaries.js) is that a reader judges "how much of Texas is rated D"
 * by how much of the picture is that shade.
 */
export function fitProjection(allRings, width) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const rings of allRings) {
    for (const ring of rings) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  const w = maxX - minX
  const h = maxY - minY
  const k = width / w
  const height = Math.round(h * k)
  return {
    width,
    height,
    project: ([x, y]) => [(x - minX) * k, (maxY - y) * k],
  }
}

/** Rings to an SVG path, rounded to whole pixels at render width. */
export function pathData(rings, project, precision = 1) {
  const r = (n) => Number(n.toFixed(precision))
  return rings
    .map((ring) => {
      let d = ''
      let px = null
      let py = null
      for (const pt of ring) {
        const [x, y] = project(pt).map(r)
        // Consecutive points that round to the same pixel are dropped: at
        // 900px wide a great many do, and each one is ~8 wasted bytes x 1,017
        // districts.
        if (x === px && y === py) continue
        d += d ? `L${x} ${y}` : `M${x} ${y}`
        px = x
        py = y
      }
      return d ? `${d}Z` : ''
    })
    .join('')
}

/** GEOID -> rings, for one parsed topology. */
export function ringsByGeoid(topo) {
  const arcs = decodeArcs(topo)
  const out = new Map()
  for (const o of Object.values(topo.objects ?? {})) {
    for (const g of o.geometries ?? []) out.set(String(g.properties?.GEOID ?? ''), ringsOf(g, arcs))
  }
  return out
}

/**
 * The high-fidelity path for every drawn district, as { geoid: "M…Z" }.
 *
 * Pre-rendered server-side rather than shipping the TopoJSON and decoding it in
 * the browser: the client then needs no topology code at all, and the swap is
 * one setAttribute per district. Uses the SAME projection the page was built
 * with — which is why fitProjection reads the high-fidelity bounds even though
 * the inline paths are the low-fidelity ones.
 */
export function hiFiPaths({ topo, districts, width = 900 }) {
  const byGeoid = ringsByGeoid(topo)
  const drawn = districts.filter((d) => byGeoid.has(d.geoid))
  const { project } = fitProjection(drawn.map((d) => byGeoid.get(d.geoid)), width)
  const out = {}
  for (const d of drawn) out[d.geoid] = pathData(byGeoid.get(d.geoid), project)
  return out
}

/* --------------------------------------------------------------- buckets -- */

/**
 * Quantile breaks: each shade holds about a fifth of the districts.
 *
 * Equal-interval breaks would be easier to explain but useless on these
 * measures — 478 of 1,015 districts are rated B, and attendance runs 88% to
 * 97% with almost everything in the top fifth of that span, so equal intervals
 * paint the state one colour and hide every difference the reader came for.
 * Quantiles guarantee the map has five visible groups; the legend prints the
 * real value range of each so the shading can never imply an even spread.
 */
export function quantileBreaks(values, n = BUCKETS) {
  const sorted = values.filter(finite).sort((a, b) => a - b)
  if (!sorted.length) return []
  const breaks = []
  for (let i = 1; i < n; i += 1) {
    const at = (sorted.length * i) / n
    const lo = Math.floor(at)
    breaks.push(lo >= sorted.length ? sorted.at(-1) : sorted[lo])
  }
  return breaks
}

/** Which bucket a value falls in, 0 = lowest. */
export const bucketOf = (v, breaks) => {
  if (!finite(v)) return null
  let i = 0
  while (i < breaks.length && v >= breaks[i]) i += 1
  return i
}

/** The value ranges each bucket covers, for the legend. */
export function bucketRanges(values, breaks, fmt) {
  const fin = values.filter(finite).sort((a, b) => a - b)
  if (!fin.length) return []
  const edges = [fin[0], ...breaks, fin.at(-1)]
  const out = []
  for (let i = 0; i < BUCKETS; i += 1) {
    const lo = edges[i]
    const hi = edges[i + 1]
    out.push(lo == null || hi == null ? '' : `${fmtValue(lo, fmt)}–${fmtValue(hi, fmt)}`)
  }
  return out
}

export const fmtValue = (v, fmt) => {
  if (!finite(v)) return '—'
  if (fmt === 'pct') return pct(v)
  if (fmt === 'usd') return usd(v)
  return num(Math.round(v * 10) / 10)
}

/**
 * The GEOIDs the archive actually holds a polygon for.
 *
 * Not every district in the id crosswalk has a shape: the crosswalk is NCES's
 * full district list and the geometry is the Census's, and the two disagree
 * about a handful of districts. Which means "has an NCES id" and "can be drawn"
 * are different questions, and the SAME answer has to drive both the layer
 * values and the paths — see the alignment check in renderMapPage for what
 * happens when it does not.
 */
export const geoidsIn = (topo) =>
  new Set(
    Object.values(topo.objects ?? {})
      .flatMap((o) => o.geometries ?? [])
      .map((g) => String(g.properties?.GEOID ?? ''))
  )

/** The districts this map can draw, in the one order everything else indexes by. */
export const mappableDistricts = (topo, districts) => {
  const have = geoidsIn(topo)
  return districts.filter((d) => have.has(String(d.geoid)))
}

/* ---------------------------------------------------------------- layers -- */

/**
 * One layer per measure, as the page and its payload both want it.
 *
 * `values` arrives keyed by TEA district id; everything downstream is indexed
 * by POSITION in `order`, because the payload repeats once per district per
 * measure and an id per entry would roughly triple it.
 */
export function buildLayer({ key, label, fmt, dir, values, order }) {
  const vals = order.map((id) => {
    const v = values.get(id)
    return finite(v) ? v : null
  })
  const breaks = quantileBreaks(vals)
  const palette = mapPaletteFor({ fmt, dir })
  const ascendingRanges = bucketRanges(vals, breaks, fmt)
  const ascendingBuckets = vals.map((v) => bucketOf(v, breaks))

  // data-b is a SEMANTIC palette position for evaluative layers: 0 is the
  // strongest/green end and 4 is the weakest/red end. Numeric quantiles are
  // low-to-high, so only a higher-is-better measure needs to be reversed.
  // Neutral dollar layers stay low-to-high because their separate sequential
  // palette runs from light (less) to dark (more), without a good/bad claim.
  const reverse = palette === MAP_PALETTES.HIGHER
  const ranges = reverse ? [...ascendingRanges].reverse() : ascendingRanges
  const buckets = ascendingBuckets.map((b) => (b == null || !reverse ? b : BUCKETS - 1 - b))
  return {
    key,
    label,
    fmt,
    dir,
    palette,
    direction: mapDirectionNote(palette),
    breaks,
    ranges,
    buckets,
    counted: vals.filter(finite).length,
  }
}

const magnitudeRange = (values, suffix, fallback) => {
  const magnitudes = values.filter(finite).map(Math.abs).sort((a, b) => a - b)
  if (!magnitudes.length) return fallback
  const lo = num(magnitudes[0])
  const hi = num(magnitudes.at(-1))
  return `${lo === hi ? lo : `${lo}–${hi}`} ${suffix}`
}

/**
 * A signed, zero-centred layer for arithmetic balances such as transfers in
 * minus transfers out.
 *
 * Ordinary map measures use five statewide quantiles. That is wrong for a
 * balance: a future year with mostly negative values could paint the "least
 * negative" fifth like a positive result. Here zero is always the middle;
 * positive and negative values are split independently so the darkest class
 * on each side identifies that direction's largest fifth. Red always means
 * more out and green always means more in. That is an explicit editorial
 * direction for transfer balance, not an inference that the source itself
 * explains why students transfer.
 *
 * `valueLabels` carries exact, already-audited text for each district so the
 * hover/focus readout does not reduce a precise transfer total to its color
 * band. Missing labels can likewise distinguish suppression from no report.
 */
export function buildDivergingLayer({
  key,
  label,
  values,
  order,
  valueLabels = new Map(),
  missingLabel = 'Suppressed or not reported',
  direction = null,
  coverage = null,
  extremeShare = 0.2,
  leaders = null,
}) {
  if (!(values instanceof Map)) throw new TypeError('map: diverging values must be a Map')
  if (!(valueLabels instanceof Map)) throw new TypeError('map: diverging valueLabels must be a Map')
  if (!Number.isFinite(extremeShare) || extremeShare <= 0 || extremeShare >= 0.5) {
    throw new RangeError('map: extremeShare must be between 0 and 0.5')
  }

  const vals = order.map((id) => {
    const v = values.get(id)
    return finite(v) ? v : null
  })
  const reported = vals.filter(finite)
  const cutoff = (side) => {
    const magnitudes = side.map(Math.abs).sort((a, b) => a - b)
    if (!magnitudes.length) return null
    return magnitudes[Math.floor((magnitudes.length - 1) * (1 - extremeShare))]
  }
  const negativeCutoff = cutoff(reported.filter((v) => v < 0))
  const positiveCutoff = cutoff(reported.filter((v) => v > 0))

  const buckets = vals.map((v) => {
    if (!finite(v)) return null
    if (v === 0) return 2
    if (v < 0) return negativeCutoff != null && Math.abs(v) >= negativeCutoff ? 0 : 1
    return positiveCutoff != null && v >= positiveCutoff ? 4 : 3
  })
  const grouped = Array.from({ length: BUCKETS }, () => [])
  vals.forEach((v, i) => {
    const b = buckets[i]
    if (b != null) grouped[b].push(v)
  })
  const ranges = [
    magnitudeRange(grouped[0], 'more out', 'Largest net outflow'),
    magnitudeRange(grouped[1], 'more out', 'Net outflow'),
    'No net difference',
    magnitudeRange(grouped[3], 'more in', 'Net inflow'),
    magnitudeRange(grouped[4], 'more in', 'Largest net inflow'),
  ]

  return {
    key,
    label,
    fmt: 'count',
    dir: null,
    palette: MAP_PALETTES.DIVERGING,
    direction: [mapDirectionNote(MAP_PALETTES.DIVERGING), direction].filter(Boolean).join(' '),
    breaks: [negativeCutoff == null ? null : -negativeCutoff, 0, 0, positiveCutoff],
    ranges,
    buckets,
    counted: reported.length,
    valueLabels: order.map((id, i) => {
      const exact = valueLabels.get(id)
      if (typeof exact === 'string' && exact.trim()) return exact.trim()
      const value = vals[i]
      if (!finite(value)) return missingLabel.toLowerCase()
      if (value === 0) return 'transfers in and out are even'
      return `${num(Math.abs(value))} more transfers ${value > 0 ? 'in' : 'out'}`
    }),
    missingLabel,
    coverage,
    leaders,
  }
}

/**
 * The rating layer is categorical, not quantiled: A–F is already five classes,
 * and cutting it into quantiles would put some B districts in one shade and
 * others in the next for no reason a reader could follow.
 */
export const GRADES = ['A', 'B', 'C', 'D', 'F']

export function buildRatingLayer({ ratings, order }) {
  const buckets = order.map((id) => {
    const g = ratings.get(id)
    const i = GRADES.indexOf(g)
    // Darkest for A: on a letter grade the reader's expectation is that the
    // strongest result is the strongest ink, and unlike the value layers there
    // is no "more of the thing" reading to conflict with it.
    return i < 0 ? null : i
  })
  return {
    key: 'rating',
    label: 'Overall rating',
    fmt: 'grade',
    palette: MAP_PALETTES.RATING,
    direction: mapDirectionNote(MAP_PALETTES.RATING),
    breaks: [],
    ranges: GRADES,
    buckets,
    counted: buckets.filter((b) => b != null).length,
  }
}

/* ----------------------------------------------------------------- page -- */

/**
 * One key entry, which is also the on/off control for that class.
 *
 * The key and the filter are the same list on purpose: the labels are already
 * per-layer ("A" for the rating, "12.5%–16.0%" for a rate), site/map.js
 * already rewrites them, and a separate filter row would be a second copy of
 * the same five labels for the client to keep in step.
 *
 * The colour comes from data-b and the stylesheet, never an inline style. The
 * server used to paint the swatch from RAMP while site/map.js repainted it
 * from CSS — two sources for one colour, which drift silently the first time a
 * reader changes measure.
 */
const swatch = (i, label) =>
  `<li><input class="sr-only map-class" type="checkbox" id="map-b${i}" checked>` +
  `<label for="map-b${i}"><span class="map-swatch" data-b="${i}"></span>` +
  `<span class="sr-only">Show </span><span class="map-range" data-map-class="${i}">${esc(label)}</span></label></li>`

/**
 * renderMapPage({ topo, districts, layers, rating, snapshotDate, missing })
 *
 *   topo      the archived TopoJSON, already parsed
 *   districts [{ teaId, geoid, name, href, rating }] for every mappable district
 *   layers    buildLayer() results, in the order the picker offers them
 *   rating    buildRatingLayer() result — the layer drawn server-side
 */
export function renderMapPage({
  topo,
  topoLo = null,
  districts,
  layers = [],
  rating,
  snapshotDate = null,
  width = 900,
  hiFiHref = null,
  charterCampuses = [],
}) {
  const byGeoid = ringsByGeoid(topo)
  // The LOW-fidelity geometry is what ships inline; the high-fidelity file is
  // fetched only where a screen can resolve it. Bounds come from the HIGH
  // fidelity either way, so both sets of paths land on the same projection and
  // swapping one for the other cannot shift the map by a pixel.
  const inlineRings = topoLo ? ringsByGeoid(topoLo) : byGeoid

  const drawn = districts.filter((d) => byGeoid.has(d.geoid) && inlineRings.has(d.geoid))

  // Every layer's `buckets` is indexed by POSITION in this list — that is what
  // makes the payload small enough to ship. So a caller that built its layers
  // from a different (longer) list of districts would shade each district with
  // some OTHER district's figure, silently, and the map would look completely
  // normal while being wrong. Cheap assertion, catastrophic failure mode:
  // filter with mappableDistricts() and the two can never drift.
  for (const l of [rating, ...layers]) {
    if (l.buckets.length !== drawn.length) {
      throw new Error(
        `map: layer "${l.key}" has ${l.buckets.length} values for ${drawn.length} drawn districts. ` +
          `Build layers from mappableDistricts(topo, districts) so the order matches.`
      )
    }
    if (l.valueLabels && l.valueLabels.length !== drawn.length) {
      throw new Error(
        `map: layer "${l.key}" has ${l.valueLabels.length} exact labels for ${drawn.length} drawn districts.`
      )
    }
  }

  const allRings = drawn.map((d) => byGeoid.get(d.geoid))
  const { height, project } = fitProjection(allRings, width)
  const charterPoints = projectCharterCampuses(charterCampuses)
    .map((campus) => ({ ...campus, svgPoint: project(campus.point) }))
    .filter(({ svgPoint: [x, y] }) => x >= 0 && x <= width && y >= 0 && y <= height)
  const onlineCharterCount = charterCampuses.filter(
    (campus) => campus?.isCharter && isOnlineSchool(campus)
  ).length

  // Where each Education Service Center region sits in projected space, so the
  // client can frame one without shipping the topology. Computed HERE because
  // this is the only scope holding `project` — a boundary refresh that moves
  // the projection moves these with it, where a hard-coded table would rot.
  //
  // The extent is the union of BOTH fidelities. The inline 1% geometry is not
  // a subset of the 3%: simplification moves vertices outward as well as in,
  // so taking only the high-fidelity extent clips the inline paths at the
  // frame edge on the very zoom that is meant to show them.
  const boxes = new Map()
  for (const d of drawn) {
    if (!d.region) continue
    let b = boxes.get(d.region)
    if (!b) {
      b = { id: d.region, label: d.regionName || `Region ${d.region}`, x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, n: 0 }
      boxes.set(d.region, b)
    }
    b.n += 1
    for (const rings of [byGeoid.get(d.geoid), inlineRings.get(d.geoid)]) {
      for (const ring of rings ?? []) {
        for (const pt of ring) {
          const [x, y] = project(pt)
          if (x < b.x0) b.x0 = x
          if (x > b.x1) b.x1 = x
          if (y < b.y0) b.y0 = y
          if (y > b.y1) b.y1 = y
        }
      }
    }
  }
  const regions = [...boxes.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((b) => {
      // Rounded OUTWARD, the only padding added at build time: it exists so
      // rounding can never clip a district. Visual margin is the client's.
      const x = Math.floor(b.x0)
      const y = Math.floor(b.y0)
      return { id: b.id, label: b.label, box: [x, y, Math.ceil(b.x1) - x, Math.ceil(b.y1) - y], n: b.n }
    })
  // Same failure mode as the layer alignment check above: a district with no
  // region would vanish from every region view while still being drawn.
  const placed = regions.reduce((t, r) => t + r.n, 0)
  if (regions.length && placed !== drawn.length) {
    throw new Error(`map: ${placed} districts fall in a region but ${drawn.length} are drawn`)
  }

  // Each district is a link, so the map is navigable with no script at all.
  // aria-label carries the name AND the figure, because the shade alone is not
  // a label and a screen reader gets nothing from a <path>.
  const paths = drawn
    .map((d, i) => {
      const b = rating.buckets[i]
      const grade = b == null ? null : GRADES[b]
      return (
        `<a href="${esc(d.href)}" aria-label="${esc(d.name)}${grade ? `, rated ${grade}` : ', overall rating not reported'}">` +
        `<path d="${pathData(inlineRings.get(d.geoid), project)}"${b == null ? '' : ` data-b="${b}"`}>` +
        `<title>${esc(d.name)} — ${grade ?? 'not reported'}</title></path></a>`
      )
    })
    .join('')

  const points = charterPoints
    .map(({ name, href, city, districtName, svgPoint: [x, y] }) => {
      const place = city ? ` in ${city}` : ''
      const operator = districtName && districtName !== name ? ` · ${districtName}` : ''
      const label = `${name}, open-enrollment charter campus${place}${operator}`
      return `<a href="${esc(href)}" aria-label="${esc(label)}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(
        1
      )}" r="2.4"><title>${esc(name)} — open-enrollment charter campus${place}</title></circle></a>`
    })
    .join('')

  const payload = {
    // Where site/map.js can fetch the sharper geometry, and the width it was
    // projected at. Null when there is no second fidelity to fetch.
    hiFi: topoLo && hiFiHref ? { href: hiFiHref, width } : null,
    view: [0, 0, width, height],
    regions,
    order: drawn.map((d) => d.geoid),
    names: drawn.map((d) => d.name),
    layers: [rating, ...layers].map((l) => ({
      key: l.key,
      label: l.label,
      fmt: l.fmt,
      palette: l.palette,
      direction: l.direction,
      ranges: l.ranges,
      buckets: l.buckets,
      counted: l.counted,
      ...(l.valueLabels ? { valueLabels: l.valueLabels } : {}),
      ...(l.missingLabel ? { missingLabel: l.missingLabel } : {}),
      ...(l.coverage ? { coverage: l.coverage } : {}),
    })),
  }

  const field = (id, label, options, attr) =>
    `<div class="map-field">
      <label class="map-pick" for="${id}">${esc(label)}</label>
      <select id="${id}" ${attr}>${options}</select>
    </div>`

  // Both selects need script to do anything, so both live inside the block
  // that ships `hidden` and is revealed by site/map.js.
  const controls = `<div class="map-controls" data-map-controls hidden>
    ${field(
      'map-layer',
      'Shade districts by',
      [rating, ...layers].map((l) => `<option value="${esc(l.key)}">${esc(l.label)}</option>`).join(''),
      'data-map-layer'
    )}${
      regions.length
        ? field(
            'map-zoom',
            'Zoom to',
            `<option value="">Whole state</option>` +
              regions.map((r) => `<option value="${esc(r.id)}">${esc(r.label)}</option>`).join(''),
            'data-map-zoom'
          )
        : ''
    }
  </div>`

  // The key is the figure's CAPTION, and HTML allows a figcaption first or
  // last inside a <figure> — so "the key goes above the map" is the content
  // model rather than a CSS reordering trick, and DOM order still matches
  // visual order for a screen reader and for the keyboard.
  //
  // It also has to sit there for the filtering to work at all: the CSS reaches
  // the paths with `~`, which only looks forward among SIBLINGS, and inside
  // the figure the figcaption and the svg are siblings.
  const missing = drawn.length - rating.counted
  const noDataKey = `<li class="map-no-data-key" data-map-missing-key${missing ? '' : ' hidden'}><span class="map-swatch map-swatch-missing" aria-hidden="true"></span><span data-map-missing-label>Not reported</span></li>`
  const legend = `<figcaption class="map-legend map-classes" data-map-legend>
      <p class="map-legend-title"><span data-map-legend-title>${esc(rating.label)}</span><span class="map-legend-hint"> &mdash; untick a class to hide it</span></p>
      <ul data-map-legend-items>${rating.ranges.map((r, i) => swatch(i, r)).join('')}${noDataKey}</ul>
      <p class="map-charter-key"><input class="sr-only map-charter-toggle" type="checkbox" id="map-charters" checked>
        <label for="map-charters"><span class="map-charter-swatch" aria-hidden="true"></span>Show ${num(
          charterPoints.length
        )} physical open-enrollment charter campus ${charterPoints.length === 1 ? 'location' : 'locations'}</label></p>
    </figcaption>`

  const coverage = `${num(rating.counted)} of ${num(drawn.length)} districts ${rating.counted === 1 ? 'has' : 'have'} a published rating${
    missing ? `; ${num(missing)} ${missing === 1 ? 'is' : 'are'} shown as not reported` : ''
  }.`

  const layerDetails = layers
    .filter((layer) => layer.leaders?.groups?.length)
    .map((layer) => {
      const leaders = layer.leaders
      const groups = leaders.groups.map((group) => `<section class="map-leader-group">
        <h4>${esc(group.label)}</h4>
        <ol>${(group.rows ?? []).map((row) => `<li>
          <span>${row.href ? `<a href="${esc(row.href)}">${esc(row.name)}</a>` : esc(row.name)}</span>
          <strong>${esc(row.value)}</strong>
          <small>${esc(row.detail)}</small>
        </li>`).join('')}</ol>
      </section>`).join('')
      return `<div class="map-layer-detail" data-map-layer-detail="${esc(layer.key)}" hidden>
        <h3>${esc(leaders.title)}</h3>
        <div class="map-leader-grid">${groups}</div>
        ${leaders.note ? `<p class="note">${esc(leaders.note)}</p>` : ''}
      </div>`
    })
    .join('')

  return shell({
    title: 'Map of Texas school districts — txschools.net',
    description: `Every rated Texas school district drawn on a map of the state and shaded by its TEA rating, with ${num(
      layers.length
    )} other measures available. Unofficial republication of Texas Education Agency data.`,
    canonical: `${SITE_ORIGIN}${MAP_HREF}`,
    scripts: ['/map.js'],
    crumbs: [{ href: '/', label: 'Texas schools', current: 'Map' }],
    sections: [
      `<section class="hero">
  <p class="eyebrow">Map</p>
  <h1>Texas school districts, mapped</h1>
  <p class="place">${esc(num(drawn.length))} districts${
        snapshotDate ? ` &middot; TEA data fetched ${esc(snapshotDate)}` : ''
      }</p>
  <p class="lede">Geographic public school districts are drawn on their real boundaries and shaded by
    TEA rating. Gold points show physical open-enrollment charter campuses as locations, never as resident-assignment areas.${
      onlineCharterCount
        ? ` ${num(onlineCharterCount)} online charter ${onlineCharterCount === 1 ? 'program is' : 'programs are'} not pinned to ${onlineCharterCount === 1 ? 'a mailing address' : 'mailing addresses'}.`
        : ''
    } Tap any feature to open its page.</p>
</section>`,
      section(
        'map',
        'The map',
        `${controls}
  <form class="map-form">
    <figure class="map-figure" data-map-palette="${esc(rating.palette)}">
    ${legend}
    <svg class="map-svg" viewBox="0 0 ${width} ${height}" role="group"
         aria-label="Texas school districts shaded by rating" data-map data-base-view="0 0 ${width} ${height}">
      <defs><pattern id="map-missing-pattern" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="var(--line-2)"/><path d="M-2 2L2-2M0 6L6 0M4 8L8 4" fill="none" stroke="var(--ink-3)" stroke-width=".7" opacity=".38"/></pattern></defs>
      <g data-map-features><g data-map-shapes>${paths}</g><g data-map-charters>${points}</g></g>
    </svg>
    </figure>
    <p class="map-reset"><button type="reset">Show every class</button></p>
  </form>
  <p class="note" data-map-legend-note>${esc(rating.direction)} ${esc(coverage)}</p>
  ${layerDetails}
  <div class="map-tip" data-map-tip hidden aria-hidden="true"></div>
  <script type="application/json" data-map-payload>${JSON.stringify(payload).replace(/</g, '\\u003c')}</script>`
      ),
      section(
        'about',
        'What this map draws, and what it leaves out',
        `<p>Boundaries are the Census Bureau's TIGER/Line school district polygons, which NCES
     republishes as EDGE, joined to TEA's districts through the NCES Common Core of Data. The
     shapes are simplified for the web, so a boundary here is close to but not exactly the legal
     line; the archived file and the command that produced it are recorded in the repository.</p>
  <p class="note">${esc(NO_SHAPE_NOTE)}</p>
  <p class="note">Boundary shading covers geographic school-district territories. Open-enrollment
     charter school systems have no attendance boundary, so physical campuses are shown as locations,
     not district polygons; this map does not treat them
     as a resident-assigned district. Charter points are not part of the shaded district totals.${
       onlineCharterCount
         ? ` TEA marks ${num(onlineCharterCount)} charter ${onlineCharterCount === 1 ? 'campus record' : 'campus records'} as online; ${onlineCharterCount === 1 ? 'it is' : 'they are'} omitted from the point layer because a mailing address is not a physical campus location.`
         : ''
     }</p>
  <p class="downloads"><a href="/download">Download the data behind this map</a> &middot;
     <a href="${MAP_HREF === '/map' ? '/rankings' : '/rankings'}">every ranked list</a></p>`
      ),
    ],
  })
}
