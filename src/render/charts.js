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
export function trajectoryChart({ years, scores, stateScores = null, w = 640, h = 220 }) {
  const pad = { t: 16, r: 16, b: 28, l: 34 }
  const iw = w - pad.l - pad.r
  const ih = h - pad.t - pad.b
  const lo = 40
  const hi = 100
  const x = (i) => pad.l + (years.length === 1 ? iw / 2 : (i * iw) / (years.length - 1))
  const y = (v) => pad.t + ih - ((v - lo) / (hi - lo)) * ih

  const bands = [90, 80, 70, 60].map(
    (v) =>
      `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="band"/>` +
      `<text x="${pad.l - 6}" y="${(y(v) + 3.5).toFixed(1)}" class="band-label">${v}</text>`
  ).join('')

  const pts = scores.map((s, i) => (s === null ? null : [x(i), y(s)])).filter(Boolean)
  const statePts = stateScores ? stateScores.map((s, i) => (s === null ? null : [x(i), y(s)])).filter(Boolean) : []

  const dots = scores
    .map((s, i) =>
      s === null
        ? ''
        : `<circle cx="${x(i).toFixed(1)}" cy="${y(s).toFixed(1)}" r="4.5" class="dot"/>` +
          `<text x="${x(i).toFixed(1)}" y="${(y(s) - 11).toFixed(1)}" class="pt-label">${s}</text>`
    )
    .join('')

  const xlabels = years
    .map((yr, i) => `<text x="${x(i).toFixed(1)}" y="${h - 8}" class="x-label">${esc(yr)}</text>`)
    .join('')

  return `<svg viewBox="0 0 ${w} ${h}" class="chart chart-traj" role="img" aria-label="Accountability score by year">
  ${bands}
  ${statePts.length > 1 ? `<path d="${path(statePts)}" class="line line-state"/>` : ''}
  ${pts.length > 1 ? `<path d="${path(pts)}" class="line line-entity"/>` : ''}
  ${dots}
  ${xlabels}
</svg>`
}

/** Horizontal bars on a fixed 0-100 scale, so every bar is comparable to every other. */
export function scoreBars(rows, { w = 640, rowH = 34 } = {}) {
  const labelW = 190
  const barW = w - labelW - 58
  const h = rows.length * rowH + 8

  const body = rows
    .map((r, i) => {
      const cy = i * rowH + 8
      const len = r.score === null ? 0 : (r.score / 100) * barW
      const bar =
        r.score === null
          ? `<text x="${labelW}" y="${cy + 15}" class="na">Not reported</text>`
          : `<rect x="${labelW}" y="${cy + 5}" width="${len.toFixed(1)}" height="14" rx="4" class="bar"/>` +
            `<text x="${(labelW + len + 8).toFixed(1)}" y="${cy + 16}" class="bar-value">${r.score}</text>`
      return (
        `<text x="0" y="${cy + 16}" class="row-label">${esc(r.label)}</text>` +
        bar +
        (r.grade ? `<text x="${w - 14}" y="${cy + 16}" class="row-grade">${esc(r.grade)}</text>` : '')
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
