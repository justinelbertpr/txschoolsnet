// Chart primitives. No dependencies, no client JS required to read any of them.
//
// TWO KINDS OF FIGURE, AND WHY
//
//   The line charts are inline SVG. A trajectory is a shape; there is no way to
//   draw "rising, then flat, then falling" out of boxes and have it read as one
//   gesture.
//
//   The bar charts are HTML. They were SVG, and on a phone that made them
//   unreadable — not by a little. An SVG with a fixed 640-unit viewBox scaled
//   into a 309px column renders at 0.483, and font-size inside SVG is in USER
//   UNITS, so an 11px label lands at 5.3 CSS px. The stylesheet cannot fix that
//   for these two charts: their labels live in fixed 190- and 132-unit gutters
//   and their rows are pitched 14 and 16 units apart, so raising the type makes
//   the text overlap rather than legible. Measured on a 380px viewport before
//   this change: row labels 6.3px, values 5.8px, delta lines 5.3px, against a
//   16px body.
//
//   A bar chart is a label, a length and a number. In HTML the label is real
//   text: it reflows, it wraps, it is selectable and findable, it honours the
//   reader's own font size, and it is the same size as the prose around it. The
//   length is one <span> with a width. Nothing is lost and 5.3px becomes 13-16px
//   at every viewport width, with no media query and no JavaScript.
//
//   The markup contract for those lists (.hbars) is defined in site/style.css.
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
 * Draw values in contiguous runs. Filtering missing years before building one
 * path would connect the years on either side and turn "not reported" into a
 * visual claim of continuous change.
 */
const valuePath = (values, x, y) => {
  let open = false
  let hasLine = false
  const d = values
    .map((v, i) => {
      if (v === null || v === undefined) {
        open = false
        return ''
      }
      const command = open ? 'L' : 'M'
      if (open) hasLine = true
      open = true
      return `${command}${x(i).toFixed(1)} ${y(v).toFixed(1)}`
    })
    .filter(Boolean)
    .join(' ')
  return { d, hasLine }
}

/* ------------------------------------------------------- HTML bar helpers -- */

/**
 * A cohort's ink and its dash, mirroring style.css's .mark-* / .chip-dot-*
 * families. It is stated here because this file may not edit the stylesheet and
 * the marks it draws are inline <span>s rather than SVG <line>s — a stroke rule
 * cannot reach them. If a cohort's colour changes in style.css it must change
 * here too, or a tick stops matching the swatch that names it.
 *
 * Every cohort carries a dash as well as a hue: the site's rule is hue AND
 * pattern, never hue alone, so the ticks stay separable under CVD.
 */
const COHORT_MARK = {
  peer: { ink: 'var(--c-peer)', dash: null },
  state: { ink: 'var(--c-state)', dash: [2, 3] },
  region: { ink: 'var(--s3)', dash: [1, 5] },
  county: { ink: 'var(--s4)', dash: [7, 4] },
  size: { ink: 'var(--s5)', dash: [2, 4] },
  tea: { ink: 'var(--c-tea)', dash: [8, 4] },
}

/**
 * The three STAAR levels, in the same three ramp colours the legend's squares
 * use — style.css .swatch-l0/.swatch-l1/.swatch-l2 resolve to --s0/--s2/--s3.
 * Same reason as above: .hbar-fill's rule paints --c-entity, and the legend
 * beside the chart would stop naming the bars if these drifted apart.
 */
const LEVEL_FILL = ['var(--s0)', 'var(--s2)', 'var(--s3)']

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** A number safe to interpolate into a style attribute, clamped to the track. */
const pos = (v) => Math.max(0, Math.min(100, v)).toFixed(1).replace(/\.0$/, '')

/** "+4.5" / "−10.0" — a minus sign, not a hyphen, and never a bare number. */
const delta = (a, b, dp) => `${a > b ? '+' : a < b ? '−' : '±'}${Math.abs(a - b).toFixed(dp)}`

/**
 * What one cohort tick says in words. With a figure of our own it is a signed
 * difference; without one it is the cohort's own level, because "no score" and
 * "no comparison" are different facts and only the first is true.
 */
const cohortSub = (key, mine, theirs, name, dp, unit, reportingN = null) => {
  const n = num(reportingN)
  const coverage = n === null ? '' : ` &middot; ${n.toLocaleString('en-US')} reporting`
  return `<span class="hbar-delta" data-delta="${esc(key)}">${
    mine === null ? `${esc(name)} ${theirs}${unit}` : `${delta(mine, theirs, dp)} vs ${esc(name)}`
  }${coverage}</span>`
}

/**
 * One tick on a bar track. A vertical hairline is a repeating gradient rather
 * than a border because that is the only way to dash it, and the dash is the
 * second channel the palette rules require.
 */
const markSpan = (key, value, label) => {
  const m = COHORT_MARK[key] ?? COHORT_MARK.peer
  const paint = m.dash
    ? `background:repeating-linear-gradient(180deg,${m.ink} 0 ${m.dash[0]}px,transparent ${m.dash[0]}px ${
        m.dash[0] + m.dash[1]
      }px)`
    : `background:${m.ink}`
  return (
    `<span class="hbar-mark hbar-mark-${esc(key)}" data-mark="${esc(key)}" data-value="${value}"` +
    ` style="--m:${pos(value)};${paint}" title="${esc(label)}: ${value}"></span>`
  )
}

/**
 * One row of a horizontal bar list. Every figure in it is text; the track is
 * decoration and is hidden from assistive technology so a reader is not made to
 * step through empty spans to reach the number that is already beside them.
 */
const hbarRow = ({ key, label, value, unit = '', grade = null, fill = null, marks = [], subs = [] }) => {
  const v = num(value)
  const track =
    `<span class="hbar-track" aria-hidden="true">` +
    (v === null ? '' : `<span class="hbar-fill"${fill ? ` style="background:${fill}"` : ''}></span>`) +
    marks.map((m) => markSpan(m.key, m.value, m.label)).join('') +
    `</span>`
  const shown =
    v === null
      ? `<span class="hbar-value">&mdash;</span>`
      : `<span class="hbar-value">${v}${unit}${grade ? ` <span class="hbar-grade">${esc(grade)}</span>` : ''}</span>`
  const sub = v === null ? ['Not reported', ...subs] : subs
  return (
    `<li class="hbar"${key ? ` data-metric="${esc(key)}"` : ''}${v === null ? '' : ` data-value="${v}"`}` +
    `${v === null ? '' : ` style="--v:${pos(v)}"`}>` +
    `<span class="hbar-label">${esc(label)}</span>` +
    track +
    shown +
    (sub.length ? `<span class="hbar-sub">${sub.join(' &middot; ')}</span>` : '') +
    `</li>`
  )
}

/**
 * Score trajectory across years, with the A-F bands drawn as background rules so a
 * reader can see which band a year sits in without a colour lookup.
 *
 * The viewBox is 640x320, not the 640x240 it was. An SVG with a viewBox and
 * height:auto has ONE aspect ratio at every width, so the only lever on how tall
 * this chart is on a phone is how tall it is everywhere. At 2.67:1 a 309px phone
 * column produced a 116px chart whose plot area — the part with the line in it —
 * was 66px tall; a thirty-point score domain across 66px is 2.2px per point, and
 * "is my school getting better" is a question you cannot answer from that. At 2:1
 * the same column gives 155px and a 130px plot area, near double, and a desktop
 * figure of 704x352, which is a chart rather than a strip. The type is already
 * handled: style.css steps the user-unit font sizes per width band so the labels
 * render at 10-14 CSS px throughout, and taller rows give those larger labels
 * somewhere to sit.
 */
export function trajectoryChart({ years, series, w = 640, h = 320 }) {
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
      const run = valuePath(s.values, x, y)
      if (!run.hasLine) return ''
      return `<path d="${run.d}" class="line line-${esc(s.key)}"><title>${esc(s.label ?? s.key)}</title></path>`
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
 *
 * An HTML list per subject rather than one SVG. The subject heading and the
 * three level names are the whole point of this figure — "Meets grade level" is
 * not a decoration on a bar, it is the thing being measured — and at 5.8 CSS px
 * they could not be read at all on a phone. Each row carries its metric key, so
 * the enhancement layer identifies a row by name rather than by parsing the
 * tooltip it used to have to draw a scale.
 */
export function groupedBars({
  groups,
  series,
  compareKey = 'peer',
  compareLabel = 'Similar schools',
  collapseAfterFirst = false,
  // Every row states which cohort its gap is measured against, because a bare
  // "+7" beside a bar is a number with no denominator and the footnote holding
  // the referent is two screens down on a phone. `compareShort` is the same
  // cohort's short name — scoreBars already receives one per marker — and the
  // caller should pass it; until then the rows carry the full label rather than
  // saying nothing.
  compareShort = null,
}) {
  const cohortName = compareShort ?? compareLabel
  const body = groups
    .map((g, gi) => {
      const rows = series
        .map((s, si) => {
          const v = num(s.values[gi])
          const cmp = num(s.compare?.[gi])
          const reportingN = num(s.compareN?.[gi])
          const level = /^l(\d)$/.exec(String(s.key))?.[1]
          return hbarRow({
            // Exactly the key metrics.js publishes for this cell, so nothing
            // downstream has to reconstruct it from prose.
            key: `staar:${g}:${level ?? si}`,
            label: s.label,
            value: v,
            unit: '%',
            fill: LEVEL_FILL[Number(level ?? si)] ?? null,
            marks: cmp === null ? [] : [{ key: compareKey, value: cmp, label: compareLabel }],
            subs: cmp === null ? [] : [cohortSub(compareKey, v, cmp, cohortName, 0, '%', reportingN)],
          })
        })
        .join('')
      const list = `<ul class="hbars">${rows}</ul>`
      return collapseAfterFirst && gi > 0
        ? `<details class="hbar-group hbar-group-disclosure"><summary><span class="hbar-group-label" role="heading" aria-level="4">${esc(g)}</span><span class="hbar-group-meta">${series.length} performance levels</span></summary>${list}</details>`
        : `<div class="hbar-group"><h4 class="hbar-group-label">${esc(g)}</h4>${list}</div>`
    })
    .join('')

  return `<div class="hbar-groups" data-bars="staar">${body}</div>`
}

/**
 * Horizontal bars on a fixed 0-100 scale, so every bar is comparable to every
 * other. The track's own repeating hairlines mark the ten-point steps, which
 * covers the 60/70/80/90 letter-grade thresholds the SVG drew explicitly —
 * still without colouring anything.
 *
 * `rows[].key` is optional and emitted as data-metric when present; without it
 * the list is still in the caller's order, which is how the enhancement layer
 * has always matched rows to metrics.
 */
export function scoreBars(rows, { label = 'Domain scores' } = {}) {
  const body = rows
    .map((r) => {
      const v = num(r.score)
      const marks = (r.markers ?? []).filter((m) => num(m.value) !== null)
      return hbarRow({
        key: r.key ?? null,
        label: r.label,
        value: v,
        grade: r.grade ?? null,
        // Ticks do not depend on the entity's own score: a domain TEA published
        // nothing for still has a cohort average, and saying where that sits is
        // the whole comparison this site exists to add.
        marks,
        // Every cohort on the track gets its difference stated in words. The SVG
        // could only fit one line of 5.3px type under each bar and so printed
        // the first; the second cohort's tick sat there unexplained.
        subs: marks.map((m) => cohortSub(m.key, v, m.value, m.short ?? m.label, 1, '', m.n)),
      })
    })
    .join('')

  return `<ul class="hbars" data-bars="domain" aria-label="${esc(label)}">${body}</ul>`
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

/**
 * Three-series comparison over time. The one place colour carries identity.
 *
 * 640x320 for the same reason trajectoryChart is: at 220 units this rendered
 * 106px tall on a phone, of which 62px was plot. Eight years of spending in
 * 62px is a rumour, not a series.
 */
export function comparisonChart({ years, series, w = 640, h = 320, fmt = (v) => v }) {
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

  // A dot on EVERY reading, not just the last one. Without them the chart is
  // three bare lines: a reader can see the shape but not where the actual
  // measurements fall, so a bend between two years is indistinguishable from a
  // year with no data at all — and on a phone, where the plot is ~250px wide,
  // that was the whole complaint. The final dot stays larger, because it is
  // the figure the surrounding prose quotes.
  const lines = series
    .map((s) => {
      const run = valuePath(s.values, x, y)
      const lastIndex = s.values.findLastIndex((v) => v !== null && v !== undefined)
      if (lastIndex < 0) return ''
      const dots = s.values
        .map((v, i) =>
          v === null || v === undefined
            ? ''
            : `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${
                i === lastIndex ? 4 : 2.6
              }" class="dot dot-${s.key}"/>`
        )
        .join('')
      return (run.hasLine ? `<path d="${run.d}" class="line line-${s.key}"/>` : '') + dots
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
