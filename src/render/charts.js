// Inline SVG chart primitives. No dependencies, no client JS required to read them.
//
// Colour decisions, made against the dataviz validator rather than by eye:
//
//   Grades are NOT colour-coded. Every green->amber->red five-step ramp tested
//   failed CVD separation (worst adjacent pair ΔE 0.6 under deuteranopia) and the
//   normal-vision floor. Five distinguishable steps do not fit along that path.
//   The LETTER is the encoding; badges are neutral tonal chips.
//
//   The comparison palette below (entity / peer / state) passed all six checks:
//   CVD separation ΔE 13.8 protan, normal-vision ΔE 28.8, contrast >= 3:1.

export const SERIES = {
  entity: 'var(--c-entity)',
  peer: 'var(--c-peer)',
  state: 'var(--c-state)',
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const path = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')

/**
 * Score trajectory across years, with the A-F bands drawn as background rules so a
 * reader can see which band a year sits in without a colour lookup.
 */
export function trajectoryChart({ years, series, w = 640, h = 240 }) {
  const pad = { t: 22, r: 22, b: 28, l: 36 }
  const iw = w - pad.l - pad.r
  const ih = h - pad.t - pad.b

  // Domain snaps to the grade boundaries that contain the data, plus one band of
  // headroom. A fixed 40-100 scale is comparable across pages but leaves most
  // charts two-thirds empty; snapping to bands keeps every gridline a real
  // letter-grade threshold while the data actually fills the frame.
  const all = series.flatMap((s) => s.values).filter((v) => v !== null && v !== undefined)
  const lo = Math.max(0, Math.floor((Math.min(...all) - 4) / 10) * 10)
  const hi = Math.min(100, Math.ceil((Math.max(...all) + 4) / 10) * 10)

  const x = (i) => pad.l + (years.length === 1 ? iw / 2 : (i * iw) / (years.length - 1))
  const y = (v) => pad.t + ih - ((v - lo) / (hi - lo)) * ih

  const bands = [90, 80, 70, 60, 50]
    .filter((v) => v >= lo && v <= hi)
    .map(
      (v) =>
        `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="band"/>` +
        `<text x="${pad.l - 7}" y="${(y(v) + 3.5).toFixed(1)}" class="band-label">${v}</text>`
    )
    .join('')

  // Comparison lines first so the entity's own line sits on top of them.
  const ordered = [...series].sort((a, b) => (a.key === 'entity' ? 1 : b.key === 'entity' ? -1 : 0))

  const lines = ordered
    .map((s) => {
      const pts = s.values.map((v, i) => (v === null ? null : [x(i), y(v)])).filter(Boolean)
      if (pts.length < 2) return ''
      return `<path d="${path(pts)}" class="line line-${esc(s.key)}"><title>${esc(s.label ?? s.key)}</title></path>`
    })
    .join('')

  const own = series.find((s) => s.key === 'entity')
  const dots = own
    ? own.values
        .map((v, i) => {
          if (v === null) return ''
          // Nudge the first and last labels inward so they clear the axis and edge.
          const anchor = i === 0 ? 'start' : i === own.values.length - 1 ? 'end' : 'middle'
          const dx = i === 0 ? 6 : i === own.values.length - 1 ? -6 : 0
          return (
            `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4.5" class="dot"/>` +
            `<text x="${(x(i) + dx).toFixed(1)}" y="${(y(v) - 11).toFixed(1)}" class="pt-label" text-anchor="${anchor}">${v}</text>`
          )
        })
        .join('')
    : ''

  const xlabels = years
    .map((yr, i) => `<text x="${x(i).toFixed(1)}" y="${h - 8}" class="x-label">${esc(yr)}</text>`)
    .join('')

  // Geometry travels with the element so the enhancement layer can redraw on the
  // identical scale rather than re-deriving it and drifting.
  return `<svg viewBox="0 0 ${w} ${h}" class="chart chart-traj" role="img"
  aria-label="Accountability score by year, compared with similar entities and the state"
  data-chart="trajectory" data-w="${w}" data-h="${h}"
  data-pad="${pad.t},${pad.r},${pad.b},${pad.l}" data-lo="${lo}" data-hi="${hi}">
  <g class="bands">${bands}</g>
  <g class="lines">${lines}</g>
  <g class="dots">${dots}</g>
  <g class="xlabels">${xlabels}</g>
</svg>`
}

/**
 * Grouped bars: one group per subject, one bar per performance level.
 * Levels are nested (Masters ⊂ Meets ⊂ Approaches), so they share one 0-100 scale.
 */
export function groupedBars({ groups, series, w = 640, gap = 10, compareKey = 'peer', compareLabel = 'Similar schools' }) {
  const labelH = 20
  const barH = 13
  const groupH = series.length * (barH + 3) + labelH + gap
  const h = groups.length * groupH + 6
  const labelW = 132
  const barW = w - labelW - 46

  const body = groups
    .map((g, gi) => {
      const top = gi * groupH + 4
      const bars = series
        .map((s, si) => {
          const v = s.values[gi]
          const yy = top + labelH + si * (barH + 3)
          if (v === null || v === undefined)
            return `<text x="${labelW}" y="${yy + barH - 2}" class="na-sm">—</text>`
          const len = (v / 100) * barW
          const cmp = s.compare?.[gi]
          const tick =
            cmp == null
              ? ''
              : `<line x1="${(labelW + (cmp / 100) * barW).toFixed(1)}" x2="${(labelW + (cmp / 100) * barW).toFixed(1)}" y1="${yy - 2}" y2="${yy + barH + 2}" class="mark mark-${esc(compareKey)}"><title>${esc(compareLabel)}: ${cmp}%</title></line>`
          const gap = cmp == null ? '' : ` <tspan class="delta">${v >= cmp ? '+' : '−'}${Math.abs(v - cmp).toFixed(0)}</tspan>`
          return (
            `<rect x="${labelW}" y="${yy}" width="${len.toFixed(1)}" height="${barH}" rx="3.5" class="gb gb-${esc(s.key)}"><title>${esc(g)} · ${esc(s.label)}: ${v}%</title></rect>` +
            tick +
            `<text x="${(labelW + Math.max(len, cmp == null ? len : (cmp / 100) * barW) + 7).toFixed(1)}" y="${yy + barH - 2}" class="bar-value">${v}%${gap}</text>`
          )
        })
        .join('')
      return `<text x="0" y="${top + 13}" class="group-label">${esc(g)}</text>${bars}`
    })
    .join('')

  return `<svg viewBox="0 0 ${w} ${h}" class="chart chart-grouped" role="img" aria-label="STAAR performance by subject and level">${body}</svg>`
}

/** Horizontal bars on a fixed 0-100 scale, so every bar is comparable to every other. */
export function scoreBars(rows, { w = 640, rowH = 40 } = {}) {
  const labelW = 190
  const barW = w - labelW - 76
  const h = rows.length * rowH + 8

  const body = rows
    .map((r, i) => {
      const cy = i * rowH + 8
      const len = r.score === null ? 0 : (r.score / 100) * barW
      const bar =
        r.score === null
          ? `<text x="${labelW}" y="${cy + 17}" class="na">Not reported</text>`
          : `<rect x="${labelW}" y="${cy + 6}" width="${len.toFixed(1)}" height="15" rx="4" class="bar"/>` +
            `<text x="${(labelW + len + 8).toFixed(1)}" y="${cy + 18}" class="bar-value">${r.score}</text>`

      // A cohort tick sits ON the bar track, so "ahead of" and "behind" read
      // positionally rather than needing the reader to compare two numbers.
      const marks = (r.markers ?? [])
        .filter((m) => m.value != null)
        .map((m) => {
          const mx = labelW + (m.value / 100) * barW
          return (
            `<line x1="${mx.toFixed(1)}" x2="${mx.toFixed(1)}" y1="${cy + 2}" y2="${cy + 25}" class="mark mark-${esc(m.key)}"><title>${esc(m.label)}: ${m.value}</title></line>`
          )
        })
        .join('')

      const delta =
        r.score != null && r.markers?.[0]?.value != null
          ? `<text x="0" y="${cy + 31}" class="row-sub">${
              r.score >= r.markers[0].value ? '+' : '−'
            }${Math.abs(r.score - r.markers[0].value).toFixed(1)} vs ${esc(r.markers[0].short ?? r.markers[0].label)}</text>`
          : ''

      return (
        `<text x="0" y="${cy + 17}" class="row-label">${esc(r.label)}</text>` +
        delta +
        bar +
        marks +
        (r.grade ? `<text x="${w - 14}" y="${cy + 17}" class="row-grade">${esc(r.grade)}</text>` : '')
      )
    })
    .join('')

  // 60/70/80/90 rules give the letter-grade thresholds without colouring anything.
  const rules = [60, 70, 80, 90]
    .map((v) => {
      const gx = labelW + (v / 100) * barW
      return `<line x1="${gx.toFixed(1)}" x2="${gx.toFixed(1)}" y1="4" y2="${h - 4}" class="band"/>`
    })
    .join('')

  return `<svg viewBox="0 0 ${w} ${h}" class="chart chart-bars" role="img" aria-label="Domain scores">
  ${rules}${body}
</svg>`
}

/** Composition as a single stacked rule — reads as one population, not as separate bars. */
export function stackedShare(parts, { w = 640, h = 26 } = {}) {
  const total = parts.reduce((a, p) => a + (p.value || 0), 0) || 100
  let cursor = 0
  const segs = parts
    .filter((p) => p.value > 0)
    .map((p, i) => {
      const width = (p.value / total) * w
      const seg = `<rect x="${cursor.toFixed(1)}" y="0" width="${Math.max(0, width - 2).toFixed(1)}" height="${h}" rx="3" class="seg seg-${i % 7}"><title>${esc(p.label)}: ${p.value}%</title></rect>`
      cursor += width
      return seg
    })
    .join('')
  return `<svg viewBox="0 0 ${w} ${h}" class="chart chart-stack" role="img" aria-label="Composition">${segs}</svg>`
}

/** Three-series comparison over time. The one place colour carries identity. */
export function comparisonChart({ years, series, w = 640, h = 220, fmt = (v) => v }) {
  const pad = { t: 16, r: 16, b: 28, l: 52 }
  const iw = w - pad.l - pad.r
  const ih = h - pad.t - pad.b
  const all = series.flatMap((s) => s.values.filter((v) => v !== null))
  const lo = Math.min(...all) * 0.9
  const hi = Math.max(...all) * 1.05
  const x = (i) => pad.l + (i * iw) / Math.max(1, years.length - 1)
  const y = (v) => pad.t + ih - ((v - lo) / (hi - lo || 1)) * ih

  const grid = [0, 0.5, 1]
    .map((f) => {
      const gy = pad.t + ih - f * ih
      const val = lo + f * (hi - lo)
      return `<line x1="${pad.l}" x2="${w - pad.r}" y1="${gy.toFixed(1)}" y2="${gy.toFixed(1)}" class="band"/>` +
        `<text x="${pad.l - 6}" y="${(gy + 3.5).toFixed(1)}" class="band-label">${fmt(Math.round(val))}</text>`
    })
    .join('')

  const lines = series
    .map((s) => {
      const pts = s.values.map((v, i) => (v === null ? null : [x(i), y(v)])).filter(Boolean)
      if (pts.length < 2) return ''
      const last = pts[pts.length - 1]
      return (
        `<path d="${path(pts)}" class="line line-${s.key}"/>` +
        `<circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="4" class="dot dot-${s.key}"/>`
      )
    })
    .join('')

  const xlabels = years
    .map((yr, i) =>
      i % 2 === 0 || i === years.length - 1
        ? `<text x="${x(i).toFixed(1)}" y="${h - 8}" class="x-label">${esc(yr)}</text>`
        : ''
    )
    .join('')

  return `<svg viewBox="0 0 ${w} ${h}" class="chart chart-cmp" role="img" aria-label="Comparison over time">
  ${grid}${lines}${xlabels}
</svg>`
}

export { esc }
