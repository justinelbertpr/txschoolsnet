// The statewide map: one polygon per school district, shaded by whichever
// measure the reader picks.
//
// ------------------------------------------------------------------ ENCODING
//
// site/style.css rule 3 says grades are never colour-coded, and gives the
// measurement behind it: every green–amber–red five-step ramp tested failed
// CVD separation, worst adjacent pair ΔE 0.6 under deuteranopia. That rule
// applies here, and the obvious choropleth — green A through red F — is exactly
// what it forbids. Re-measured for this page with the same method (Brettel
// simulation, CIE76): green–amber–red scores deutan ΔE 12.1 AND is
// non-monotonic in lightness, with A and F landing on the identical L* 47. A
// reader with deuteranopia cannot tell the best districts from the worst.
//
// So the ramp here is single-hue and sequential, on the brand teal:
//
//     L*  17 → 37 → 57 → 76 → 92          (monotonic, so it survives even
//     ΔE  normal 19.9 · protan 16.9        total achromatopsia as a
//         deutan 19.8 · tritan 20.2        light-to-dark ordering)
//
// Every one of those minimums beats the site's existing series palette
// (protan 13.1, deutan 9.8). Lightness IS the second channel rule 3 asks for:
// on a polygon there is no dash pattern to carry one, and hue alone would be
// the whole encoding. The letter stays the encoding in the legend and in every
// district's own accessible name.
//
// Two-colour views — "show me the A districts" — are the default and are
// trivially safe: a district is in the set or it is not.
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
// Districts, not campuses. NCES publishes attendance-area polygons for school
// districts; an individual campus is a point, and a dot map of 8,066 points
// answers a different question than this page asks. Charters have no territory
// at all and this site does not publish them.

import { esc, num, pct, section, shell, usd, SITE_ORIGIN } from './shell.js'

export const MAP_HREF = '/map'
export const MAP_FILE = 'map.html'

/** How many shades a continuous measure is cut into. */
export const BUCKETS = 5

/**
 * The ramp, darkest first. Dark = more of the thing measured, always — never
 * "dark = good", because the same ramp draws chronic absenteeism and dropout
 * rate, where more is worse. The legend states the direction in words for
 * every layer rather than relying on the reader to infer it.
 */
export const RAMP = ['#082f39', '#155f70', '#3d95a2', '#8ac4c9', '#dbebea']

/** Districts TEA rates but NCES draws no polygon for. */
export const NO_SHAPE_NOTE =
  'Four rated districts have no boundary to draw: South Texas ISD is a magnet district with no ' +
  'contiguous territory, Vysehrad ISD is folded into a neighbour by the Census, and Texas Tech ' +
  'University K-12 and University of Texas at Austin HS enroll from across the state.'

const finite = (v) => typeof v === 'number' && Number.isFinite(v)

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
export function buildLayer({ key, label, fmt, direction, values, order }) {
  const vals = order.map((id) => {
    const v = values.get(id)
    return finite(v) ? v : null
  })
  const breaks = quantileBreaks(vals)
  return {
    key,
    label,
    fmt,
    direction,
    breaks,
    ranges: bucketRanges(vals, breaks, fmt),
    buckets: vals.map((v) => bucketOf(v, breaks)),
    counted: vals.filter(finite).length,
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
    direction: 'A is the best result.',
    breaks: [],
    ranges: GRADES,
    buckets,
    counted: buckets.filter((b) => b != null).length,
  }
}

/* ----------------------------------------------------------------- page -- */

const swatch = (i, label) =>
  `<li><span class="map-swatch" style="background:${RAMP[i]}"></span>${esc(label)}</li>`

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
  }

  const allRings = drawn.map((d) => byGeoid.get(d.geoid))
  const { height, project } = fitProjection(allRings, width)

  // Each district is a link, so the map is navigable with no script at all.
  // aria-label carries the name AND the figure, because the shade alone is not
  // a label and a screen reader gets nothing from a <path>.
  const paths = drawn
    .map((d, i) => {
      const b = rating.buckets[i]
      const grade = b == null ? null : GRADES[b]
      return (
        `<a href="${esc(d.href)}" aria-label="${esc(d.name)}${grade ? `, rated ${grade}` : ''}">` +
        `<path d="${pathData(inlineRings.get(d.geoid), project)}"${b == null ? '' : ` data-b="${b}"`}>` +
        `<title>${esc(d.name)}${grade ? ` — ${grade}` : ''}</title></path></a>`
      )
    })
    .join('')

  const payload = {
    // Where site/map.js can fetch the sharper geometry, and the width it was
    // projected at. Null when there is no second fidelity to fetch.
    hiFi: topoLo && hiFiHref ? { href: hiFiHref, width } : null,
    order: drawn.map((d) => d.geoid),
    layers: [rating, ...layers].map((l) => ({
      key: l.key,
      label: l.label,
      fmt: l.fmt,
      direction: l.direction,
      ranges: l.ranges,
      buckets: l.buckets,
      counted: l.counted,
    })),
  }

  const picker = `<div class="map-controls" data-map-controls hidden>
    <label class="map-pick" for="map-layer">Shade districts by</label>
    <select id="map-layer" data-map-layer>
      ${[rating, ...layers]
        .map((l) => `<option value="${esc(l.key)}">${esc(l.label)}</option>`)
        .join('\n      ')}
    </select>
  </div>`

  const legend = `<div class="map-legend" data-map-legend>
    <p class="map-legend-title" data-map-legend-title>${esc(rating.label)}</p>
    <ul data-map-legend-items>${rating.ranges.map((r, i) => swatch(i, r)).join('')}</ul>
    <p class="note" data-map-legend-note>${esc(rating.direction)} ${esc(
      `${num(rating.counted)} districts shown.`
    )}</p>
  </div>`

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
  <p class="lede">Every rated traditional district, drawn on its real boundary and shaded by its TEA
    rating. Tap any district to open its page.</p>
</section>`,
      section(
        'map',
        'The map',
        `${picker}
  <figure class="map-figure">
    <svg class="map-svg" viewBox="0 0 ${width} ${height}" role="group"
         aria-label="Texas school districts shaded by rating" data-map>
      <g data-map-shapes>${paths}</g>
    </svg>
  </figure>
  ${legend}
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
  <p class="note">Open-enrollment charter districts are not drawn and not counted. A charter
     enrolls from anywhere and has no attendance boundary, so there is no territory to shade —
     the same reason this site does not publish them elsewhere.</p>
  <p class="downloads"><a href="/download">Download the data behind this map</a> &middot;
     <a href="${MAP_HREF === '/map' ? '/rankings' : '/rankings'}">every ranked list</a></p>`
      ),
    ],
  })
}
