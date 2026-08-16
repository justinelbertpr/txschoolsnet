// Progressive enhancement only. Every chart and table is already complete in the
// HTML; this adds the comparison picker, the cohort switch, the rail's section
// index and the chart pinner, and the motion. If it never runs, or the reader has
// asked for reduced motion, the page still shows a full trajectory chart with two
// comparison lines, every cohort tick the server drew, a working section index of
// plain anchors, and every number in a table beneath.
//
// The cohort switch is the one control that must move the whole page, so the rule
// it works under is written out at initCohorts: read the numbers the server
// published, never invent one, and leave anything that cannot be identified with
// certainty exactly as it was served.
//
// Everything below no-ops when its markup is absent, because the hubs, /about and
// /download render the same shell without a rail.

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches
const EASE = (t) => 1 - Math.pow(1 - t, 3)
const SVGNS = 'http://www.w3.org/2000/svg'

const animate = (ms, step, done) => {
  if (REDUCED) { step(1); done?.(); return }
  const t0 = performance.now()
  const frame = (now) => {
    const t = Math.min(1, (now - t0) / ms)
    step(EASE(t))
    if (t < 1) requestAnimationFrame(frame)
    else done?.()
  }
  requestAnimationFrame(frame)
}

/** :focus-visible is what decides whether a focus move was keyboard-driven. */
const keyboardFocus = (el) => {
  try { return el.matches(':focus-visible') } catch { return false }
}

/* ------------------------------------------------------- shared formatting -- */

// Same three helpers the server renders with (src/render/shell.js). A number this
// file writes has to be indistinguishable from the same number rendered into the
// HTML, or switching cohorts and switching back would leave a page that reads
// differently from the one that was served.

const num = (v) =>
  v === null || v === undefined || Number.isNaN(v) ? '—' : Number(v).toLocaleString('en-US')

const ordinal = (i) => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = i % 100
  return `${i.toLocaleString('en-US')}${s[(v - 20) % 10] || s[v] || s[0]}`
}

const fmtDelta = (d, fmt) => {
  const sign = d > 0 ? '+' : d < 0 ? '−' : '±'
  const a = Math.abs(d)
  if (fmt === 'usd') return `${sign}$${Math.round(a).toLocaleString('en-US')}`
  if (fmt === 'pct') return `${sign}${a.toFixed(1)} pts`
  return `${sign}${a.toFixed(1)}`
}

const signed = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`

/** Rounded to one decimal on both sides, so this is equality, not a tolerance. */
const near = (a, b) => a !== null && a !== undefined && b !== null && b !== undefined && Math.abs(a - b) <= 0.051

/**
 * A bar chart's value -> x mapping, recovered from what the server already drew
 * rather than restated here.
 *
 * Every bar and every tick on one of these charts sits on one linear track: a
 * bar's left edge is zero and its right edge is the value printed beside it, and
 * a tick's tooltip states the value it stands on. A least-squares fit through
 * all of those points returns the scale the renderer used — and goes on
 * returning it if the renderer's padding, width or viewBox changes, which is the
 * whole reason none of those numbers appear in this file. It also still works on
 * a page where TEA published no score at all and the only marks on the chart are
 * the cohort ticks.
 */
const fitScale = (points) => {
  if (points.length < 2) return null
  const n = points.length
  const mv = points.reduce((a, p) => a + p.v, 0) / n
  const mx = points.reduce((a, p) => a + p.x, 0) / n
  let num = 0
  let den = 0
  for (const p of points) {
    num += (p.v - mv) * (p.x - mx)
    den += (p.v - mv) ** 2
  }
  if (!(den > 1e-6)) return null // every point on the same value: no scale to read
  const unit = num / den
  return unit > 0 ? { base: mx - unit * mv, unit } : null
}

/** The nouns this site uses for the two levels, matching the server's prose. */
const UNIT = location.pathname.startsWith('/campus/') ? 'campuses' : 'districts'

/* ---------------------------------------------------------- the payload ---- */

/**
 * The 10,230-entity dashboard payload, fetched at most once per page and shared
 * by everything that needs it: the pinner's search box and the cohort switch's
 * placement line. It used to be the pinner's private business, which meant a
 * second consumer would have downloaded 230 KB a second time.
 *
 * Never fetched on load — only when the reader touches the search box or moves
 * the cohort switch.
 */
let payloadPromise = null

const payloadUrl = () => {
  const el = document.querySelector('[data-pin-source]')
  if (!el) return null
  const attr = el.getAttribute('data-pin-source')
  if (attr) return attr
  try {
    const parsed = JSON.parse(el.textContent)
    return typeof parsed === 'string' ? parsed : parsed?.payload ?? parsed?.url ?? parsed?.src ?? null
  } catch {
    return null
  }
}

const loadPayload = () => {
  if (payloadPromise) return payloadPromise
  const src = payloadUrl()
  if (!src) return Promise.reject(new Error('no payload source'))
  payloadPromise = fetch(src, { credentials: 'omit' })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    })
    .catch((err) => {
      payloadPromise = null // so the next attempt is a real retry, not a cached failure
      throw err
    })
  return payloadPromise
}

/* ------------------------------------------------- trajectory comparisons -- */

/**
 * Returns a controller so the rail's pinner and the rail's cohort switch can add
 * and remove lines on the identical geometry — same pad, same band-snapping
 * domain rule, same path builder. A second copy of that maths would drift from
 * the server's the first time either changed, and the chart would disagree with
 * its own table.
 */
function initTrajectory(svg) {
  const holder = svg.parentElement.querySelector('script[data-trajectory]')
  if (!holder) return null
  // The picker is optional: a chart with no comparison cohorts still wants the
  // draw-on and still wants to accept pins.
  const picker = svg.parentElement.querySelector('.picker')

  const data = JSON.parse(holder.textContent)
  const [pt, pr, pb, pl] = svg.dataset.pad.split(',').map(Number)
  const W = +svg.dataset.w
  const H = +svg.dataset.h
  const iw = W - pl - pr
  const ih = H - pt - pb
  const n = data.years.length

  const active = new Set(data.defaults)
  const pins = new Map() // id -> { label, values, hue }
  let domain = { lo: +svg.dataset.lo, hi: +svg.dataset.hi }

  // The picker and the rail's cohort switch are two controls over one idea, so
  // they share state rather than fighting: `autoKey` is the line the cohort
  // switch put on screen and is swapped out when the switch moves, while a line
  // the reader turned on by hand (or one the server shipped on) is theirs to
  // keep and is never taken away by a cohort change.
  let autoKey = null
  const manual = new Set()
  const onPick = []

  const linesG = svg.querySelector('.lines')
  const dotsG = svg.querySelector('.dots')
  const bandsG = svg.querySelector('.bands')
  const baseLabel = svg.getAttribute('aria-label') ?? ''

  const seriesFor = (key) => data.comparisons.find((c) => c.key === key)
  const activeValues = () => [
    data.entity.values,
    ...[...active].map((k) => seriesFor(k)?.values ?? []),
    ...[...pins.values()].map((p) => p.values),
  ].flat().filter((v) => v !== null && v !== undefined)

  /** Same band-snapping rule the server uses, so JS and HTML never disagree. */
  const targetDomain = () => {
    const all = activeValues()
    if (!all.length) return domain
    return {
      lo: Math.max(0, Math.floor((Math.min(...all) - 4) / 10) * 10),
      hi: Math.min(100, Math.ceil((Math.max(...all) + 4) / 10) * 10),
    }
  }

  const X = (i) => pl + (n === 1 ? iw / 2 : (i * iw) / (n - 1))
  const Y = (v, d) => pt + ih - ((v - d.lo) / (d.hi - d.lo)) * ih
  const toPath = (vals, d) =>
    vals
      .map((v, i) => (v == null ? null : [X(i), Y(v, d)]))
      .filter(Boolean)
      .map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
      .join(' ')

  const ensurePath = (key) => {
    let el = linesG.querySelector(`[data-key="${key}"]`)
    if (!el) {
      el = document.createElementNS(SVGNS, 'path')
      el.setAttribute('class', `line line-${key}`)
      el.dataset.key = key
      linesG.appendChild(el)
    }
    return el
  }

  const pinPaths = () => [...linesG.querySelectorAll('path[data-pin]')]
  const pinPath = (id) => pinPaths().find((el) => el.dataset.pin === id)

  /**
   * A pinned line takes its colour from --pin-hue, matching the .pin-dot in the
   * rail. If the stylesheet has no rule for .line-pin the stroke would default to
   * none and the line would be silently invisible, so fall back to a neutral ink
   * token plus a per-pin dash — never to a literal colour.
   */
  const ensurePinPath = (id, { label, hue }, dashIndex) => {
    const found = pinPath(id)
    if (found) return found
    const el = document.createElementNS(SVGNS, 'path')
    el.setAttribute('class', 'line line-pin')
    el.dataset.pin = id
    el.style.setProperty('--pin-hue', String(hue))
    const title = document.createElementNS(SVGNS, 'title')
    title.textContent = label
    el.appendChild(title)
    const own = linesG.querySelector('[data-key="entity"]')
    if (own) linesG.insertBefore(el, own) // the entity's own line stays on top
    else linesG.appendChild(el)
    if (getComputedStyle(el).stroke === 'none') {
      el.style.stroke = 'var(--ink-2)'
      el.style.strokeDasharray = ['3 3', '8 4', '1 4', '10 3 2 3', '5 5'][dashIndex % 5]
    }
    return el
  }

  const redraw = (d) => {
    // Grade-threshold rules, recomputed so they stay on real boundaries.
    bandsG.innerHTML = [90, 80, 70, 60, 50]
      .filter((v) => v >= d.lo && v <= d.hi)
      .map((v) => {
        const y = Y(v, d).toFixed(1)
        return `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" class="band"/><text x="${pl - 7}" y="${(+y + 3.5).toFixed(1)}" class="band-label">${v}</text>`
      })
      .join('')

    for (const c of data.comparisons) {
      const el = linesG.querySelector(`[data-key="${c.key}"]`)
      if (el && active.has(c.key)) el.setAttribute('d', toPath(c.values, d))
    }
    for (const [id, p] of pins) {
      const el = pinPath(id)
      if (el) el.setAttribute('d', toPath(p.values, d))
    }
    const own = linesG.querySelector('[data-key="entity"]')
    if (own) own.setAttribute('d', toPath(data.entity.values, d))

    dotsG.innerHTML = data.entity.values
      .map((v, i) => {
        if (v == null) return ''
        const x = X(i)
        const y = Y(v, d)
        const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'
        const dx = i === 0 ? 6 : i === n - 1 ? -6 : 0
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" class="dot"/><text x="${(x + dx).toFixed(1)}" y="${(y - 11).toFixed(1)}" class="pt-label" text-anchor="${anchor}">${v}</text>`
      })
      .join('')
  }

  const drawOn = (el) => {
    if (REDUCED) return
    // A fallback dash pattern has to survive the draw-on, which owns the dash
    // array for the length of the animation. Read from the COMPUTED style, not
    // el.style: most dash patterns on this page (.line-state, .line-region,
    // .line-county, .line-size, .line-tea) come from the stylesheet, not an
    // inline style, and el.style.strokeDasharray sees only the latter — it
    // used to restore nothing for those lines, leaving them permanently
    // carrying their own length as the dash pattern (i.e. solid) once the
    // draw-on finished. 'none' is the initial value for a line with no dash at
    // all, so it is treated the same as "nothing to restore".
    const computed = getComputedStyle(el).strokeDasharray
    const dash = computed && computed !== 'none' ? computed : ''
    const len = el.getTotalLength()
    el.style.transition = 'none'
    el.style.strokeDasharray = `${len}`
    el.style.strokeDashoffset = `${len}`
    el.getBoundingClientRect() // flush
    el.style.transition = 'stroke-dashoffset .75s cubic-bezier(.22,.61,.36,1)'
    el.style.strokeDashoffset = '0'
    if (dash) setTimeout(() => { el.style.strokeDasharray = dash }, 800)
  }

  const fadeOut = (el) => {
    if (REDUCED) { el.remove(); return }
    el.style.transition = 'opacity .25s'
    el.style.opacity = '0'
    setTimeout(() => el.remove(), 250)
  }

  // Seed: adopt the server-rendered paths so nothing flashes on load.
  linesG.querySelectorAll('path').forEach((p) => {
    const cls = [...p.classList].find((c) => c.startsWith('line-'))
    if (cls) p.dataset.key = cls.slice(5)
  })

  // Reveal, once, when the chart scrolls into view — the same drawOn() the
  // picker already gives a line the reader turns on by hand, just deferred
  // instead of immediate. The seeded paths are already fully drawn in their
  // final, correct shape (the comment above is exact: nothing flashes before
  // this runs), so a reader with JS off, a reduced-motion preference, or a
  // browser with no IntersectionObserver sees precisely what they see today
  // — a complete chart, never a blank or a stuck one. Disconnects after the
  // first trigger: a domain change later (apply(), below) must update these
  // same paths' `d` in place, not draw them in a second time.
  if (!REDUCED && 'IntersectionObserver' in window) {
    const seeded = [...linesG.querySelectorAll('path[data-key]')]
    if (seeded.length) {
      const io = new IntersectionObserver(
        (entries, obs) => {
          if (!entries.some((en) => en.isIntersecting)) return
          seeded.forEach(drawOn)
          obs.disconnect()
        },
        { threshold: 0.2 }
      )
      io.observe(svg)
    }
  }

  /**
   * Names every line for a screen reader, which can see neither the picker's
   * pressed states nor the rail's pin dots. The base label describes the chart
   * the server drew; once a line is added or removed it stops being true on its
   * own, so what is actually on screen is spelled out after it.
   */
  const relabel = () => {
    const shown = [
      data.entity.label,
      ...data.comparisons.filter((c) => active.has(c.key)).map((c) => c.label),
      ...[...pins.values()].map((p) => p.label),
    ]
    svg.setAttribute('aria-label', `${baseLabel}. Lines shown: ${shown.join(', ')}`)
  }

  const apply = () => {
    const from = { ...domain }
    const to = targetDomain()

    for (const c of data.comparisons) {
      const on = active.has(c.key)
      let el = linesG.querySelector(`[data-key="${c.key}"]`)
      if (on && !el) {
        el = ensurePath(c.key)
        el.setAttribute('d', toPath(c.values, to))
        drawOn(el)
      } else if (!on && el) {
        fadeOut(el)
      }
    }

    let dashIndex = 0
    for (const [id, p] of pins) {
      const had = pinPath(id)
      const el = ensurePinPath(id, p, dashIndex++)
      if (!had) {
        el.setAttribute('d', toPath(p.values, to))
        drawOn(el)
      }
    }
    for (const el of pinPaths()) if (!pins.has(el.dataset.pin)) fadeOut(el)

    animate(450, (t) => {
      redraw({ lo: from.lo + (to.lo - from.lo) * t, hi: from.hi + (to.hi - from.hi) * t })
    }, () => { domain = to })
  }

  const chipFor = (key) => picker?.querySelector(`.chip[data-cmp="${CSS.escape(key)}"]`) ?? null

  picker?.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip')
    if (!btn) return
    const key = btn.dataset.cmp
    const on = btn.getAttribute('aria-pressed') === 'true'
    if (on && active.size <= 1 && active.has(key)) return // keep at least one line meaningful
    on ? active.delete(key) : active.add(key)
    if (on) { manual.delete(key); if (autoKey === key) autoKey = null }
    else manual.add(key)
    btn.setAttribute('aria-pressed', String(!on))
    relabel()
    apply()
    for (const f of onPick) f(key, !on)
  })

  // Draw the entity's own line once, when the chart first comes into view.
  const own = linesG.querySelector('[data-key="entity"]')
  if (own && !REDUCED) {
    const io = new IntersectionObserver(
      (entries) => entries.forEach((en) => { if (en.isIntersecting) { drawOn(own); io.disconnect() } }),
      { threshold: 0.35 }
    )
    io.observe(svg)
  }

  return {
    years: data.years,
    /** Which cohorts this chart can actually draw — not every cohort has a series. */
    has: (key) => !!seriesFor(key),
    /**
     * Draw the cohort the rail switched to. Returns false when this chart has no
     * series for it, so the caller can avoid claiming the chart moved when it did
     * not.
     */
    setCohort(key) {
      if (!seriesFor(key)) return false
      if (autoKey && autoKey !== key && !manual.has(autoKey) && !data.defaults.includes(autoKey)) {
        active.delete(autoKey)
        chipFor(autoKey)?.setAttribute('aria-pressed', 'false')
      }
      autoKey = key
      if (!active.has(key)) {
        active.add(key)
        chipFor(key)?.setAttribute('aria-pressed', 'true')
      }
      relabel()
      apply()
      return true
    },
    /** Told when the picker is used, so the rail's switch can follow it. */
    onPick(fn) { onPick.push(fn) },
    /** `list` is [{ id, label, values, hue }]; one redraw covers the whole batch. */
    addPins(list) {
      for (const p of list) pins.set(p.id, { label: p.label, values: p.values, hue: p.hue })
      relabel()
      apply()
    },
    removePin(id) {
      if (!pins.delete(id)) return
      relabel()
      apply()
    },
  }
}

/* --------------------------------------------------------- bars on scroll -- */

function initBars() {
  const bars = document.querySelectorAll('.chart-bars .bar, .chart-grouped .gb, .chart-stack .seg')
  if (!bars.length) return
  if (REDUCED) { bars.forEach((b) => b.classList.add('shown')); return }

  // Only hide a mark once we know an observer exists to reveal it again. The
  // previous version added .pending (scaleX(0)) to every mark at init, so any
  // failure of the observer left server-rendered content permanently invisible —
  // the same class of defect as animating opacity from 0, which this file already
  // carries a warning about.
  if (!('IntersectionObserver' in window)) return
  bars.forEach((b) => b.classList.add('pending'))
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return
        const marks = [...en.target.querySelectorAll('.pending')]
        marks.forEach((m, i) => setTimeout(() => { m.classList.remove('pending'); m.classList.add('shown') }, i * 45))
        io.unobserve(en.target)
      })
    },
    { threshold: 0.2 }
  )
  document.querySelectorAll('.chart-bars, .chart-grouped, .chart-stack').forEach((c) => io.observe(c))
}

/* ------------------------------------------------- page-wide cohort switch -- */

/**
 * The switch changes every comparison on the page at once.
 *
 * It used to relabel six delta chips and nothing else: the ticks it sits above,
 * the chart below it, the table beside that chart and the sentence at the top of
 * the page all went on comparing against whichever cohort the server rendered
 * first. The site's stated reason to exist is the peer comparison, and its main
 * control moved six lines out of about 250. Everything that expresses a
 * comparison now moves together.
 *
 * Two rules keep it honest, and both make this file publish LESS than it could:
 *
 *   Nothing is computed here that the server did not publish. Every figure
 *   written below comes out of [data-cohorts], [data-own] or the trajectory
 *   payload — the same numbers, read against a different cohort. The one
 *   exception is the placement line, which is computed from the shared entity
 *   payload and refuses to publish unless it can prove it counted the same
 *   population the page names (see `placement`).
 *
 *   Anything that cannot be identified with certainty is left exactly as the
 *   server drew it. src/render emits no metric key on a chart row or a table
 *   row and this file does not own src/render, so rows are identified by
 *   matching the numbers they already print against the JSON (see `assign`). A
 *   row that cannot be matched is never guessed at, and a cohort with no value
 *   for a metric hides its mark rather than leaving it pointing at the previous
 *   cohort's number.
 */
function initCohorts(chart) {
  const cohortsTag = document.querySelector('script[data-cohorts]')
  const ownTag = document.querySelector('script[data-own]')
  if (!cohortsTag || !ownTag) return

  let cohorts = null
  let own = null
  try {
    cohorts = JSON.parse(cohortsTag.textContent)
    own = JSON.parse(ownTag.textContent)
  } catch {
    return // a page whose data will not parse keeps the markup it was served
  }
  if (!Array.isArray(cohorts) || !cohorts.length || !own) return

  // Every server-rendered comparison on the page is against cohorts[0] — the
  // chip the markup ships pressed. That is the baseline rows are matched
  // against, and the state "restore" means.
  const base = cohorts[0]
  const label = (c) => c.label ?? c.short ?? c.key
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)
  const sbCohort = document.querySelector('[data-sb-cohort]')
  const entityId = location.pathname.match(/-(\d{6,9})(?:\.html)?$/)?.[1] ?? null

  /* ---- small DOM helpers ---- */

  const title = (el, text) => {
    let t = el.querySelector('title')
    if (!t) { t = document.createElementNS(SVGNS, 'title'); el.appendChild(t) }
    t.textContent = text
  }

  /** A legend entry is a swatch element plus a bare text node; only the text moves. */
  const legendText = (swatch, text) => {
    const li = swatch.parentElement
    if (!li) return
    for (const n of [...li.childNodes]) if (n.nodeType === 3) n.remove()
    li.append(document.createTextNode(text))
  }

  /** A cohort label can itself contain ": " ("Region 10: Richardson"), so split last. */
  const readMark = (el) => {
    const t = el.querySelector('title')?.textContent ?? ''
    const at = t.lastIndexOf(': ')
    if (at < 0) return null
    const v = Number(t.slice(at + 2).replace('%', ''))
    return Number.isFinite(v) ? { label: t.slice(0, at), value: v } : null
  }

  /**
   * Which metric a chart row or table row is about.
   *
   * A row is identified by the two numbers it already prints: this entity's own
   * value, and the value of the cohort the server drew it against. Both must
   * match the published JSON for a key to be accepted, each key is used once,
   * and keys are tried in the order the server declares them — which is the
   * order the rows are in, so two rows that print the same pair still resolve
   * in order. If any row cannot be placed the whole set is refused: a
   * half-updated table is worse than one that did not move.
   */
  const assign = (rows, keys) => {
    const used = new Set()
    const out = []
    for (const r of rows) {
      // A row TEA published no value for still carries a cohort tick, and is
      // identified by that tick alone. A row with neither number is not
      // identified at all.
      if (r.mine == null && r.other == null) return null
      const hit = keys.find(
        (k) =>
          !used.has(k) &&
          (r.mine == null || near(own[k], r.mine)) &&
          (r.other == null || near(base.metrics[k], r.other))
      )
      if (!hit) return null
      used.add(hit)
      out.push(hit)
    }
    return out
  }

  /** Metric keys in the order the server declares them, which is the row order. */
  const keysLike = (prefix) => Object.keys(base.metrics).filter((k) => k.startsWith(prefix))

  /* ---- the delta chips ---- */

  const chips = () => {
    const els = [...document.querySelectorAll('.cmp')]
    if (!els.length) return null
    return (c) => {
      for (const el of els) {
        const mine = own[el.dataset.metric]
        const other = c.metrics[el.dataset.metric]
        // Both, deliberately: [hidden] alone does not hide a .cmp, because the
        // stylesheet gives it `display: block` and a class beats the UA rule.
        // A chip left visible here would be a stale comparison against the
        // cohort the reader has just switched away from.
        if (mine == null || other == null) {
          el.hidden = true
          el.style.display = 'none'
          continue
        }
        el.hidden = false
        el.style.display = ''
        const d = mine - other
        // Only the tone class is swapped, never the whole className, and a chip
        // the renderer marked as having no good direction keeps that mark: the
        // share of a school's students who are economically disadvantaged sitting
        // above its cohort is neither up nor down, and rebuilding className
        // unconditionally used to paint it as an achievement on every switch.
        const tone = el.dataset.neutral != null
          ? 'cmp-neutral'
          : el.dataset.tone
            ? `cmp-${el.dataset.tone}`
            : Math.abs(d) < 0.05
              ? 'cmp-level'
              : (el.dataset.invert ? d < 0 : d > 0) ? 'cmp-up' : 'cmp-down'
        for (const cls of [...el.classList]) if (cls.startsWith('cmp-')) el.classList.remove(cls)
        el.classList.add(tone)

        const vs = el.querySelector('.cmp-vs')
        const text = `${fmtDelta(d, el.dataset.fmt)} `
        if (vs) {
          vs.textContent = `vs ${c.short}`
          const lead = [...el.childNodes].find((n) => n.nodeType === 3)
          if (lead) lead.nodeValue = text
          else el.insertBefore(document.createTextNode(text), vs)
        } else {
          const span = document.createElement('span')
          span.className = 'cmp-vs'
          span.textContent = `vs ${c.short}`
          el.textContent = ''
          el.append(document.createTextNode(text), span)
        }
        if (!REDUCED) {
          el.animate([{ opacity: 0, transform: 'translateY(-3px)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: 'ease-out' })
        }
      }
    }
  }

  /* ---- the domain bars ---- */

  const domainBars = () => {
    const svg = document.querySelector('#domains svg.chart-bars')
    if (!svg) return null

    // The rows are flat siblings, so a row is "a row label and everything up to
    // the next one".
    const rows = []
    let row = null
    for (const el of svg.children) {
      const cls = el.classList
      if (cls.contains('row-label')) { row = { label: el, marks: [] }; rows.push(row); continue }
      if (!row) continue
      if (cls.contains('row-sub')) row.sub = el
      else if (cls.contains('bar')) row.bar = el
      else if (cls.contains('bar-value')) row.value = el
      else if (cls.contains('mark')) row.marks.push(el)
    }

    // One track for the whole chart, fitted through every bar edge and every
    // tick on it. Rows share it, which is what lets a domain TEA published no
    // score for — no bar, no value, but cohort ticks all the same — move with
    // the switch instead of being left pointing at the previous cohort.
    const points = []
    for (const r of rows) {
      const printed = r.value ? Number(r.value.textContent) : NaN
      r.mine = Number.isFinite(printed) ? printed : null
      const x = Number(r.bar?.getAttribute('x'))
      const w = Number(r.bar?.getAttribute('width'))
      if (Number.isFinite(x) && Number.isFinite(w) && r.mine >= 0) points.push({ v: 0, x }, { v: r.mine, x: x + w })
      for (const m of r.marks) {
        const read = readMark(m)
        const mx = Number(m.getAttribute('x1'))
        if (read && read.value >= 0 && Number.isFinite(mx)) points.push({ v: read.value, x: mx })
      }
      r.primary = r.marks.find((m) => readMark(m)?.label === label(base)) ?? r.marks[0] ?? null
      r.other = r.primary ? readMark(r.primary)?.value ?? null : null
    }
    const geo = fitScale(points)
    if (!geo) return null

    const usable = rows.filter((r) => r.primary || r.bar)
    if (!usable.length) return null
    const keys = assign(usable, keysLike('domain:'))
    if (!keys) return null
    usable.forEach((r, i) => { r.key = keys[i] })
    const swatch = document.querySelector('#domains .legend .swatch-peer')

    // The chart carries a second, fixed cohort tick. Switching the first one to
    // the cohort the second already shows would draw two ticks on the same pixel
    // and print its name twice in the legend, so the fixed one steps aside for
    // as long as the switch is pointed at it. Hidden with style rather than
    // [hidden], which .legend li's own display rule would override.
    const fixed = usable.flatMap((r) => r.marks.filter((m) => m !== r.primary))
    const fixedLabel = fixed.length ? readMark(fixed[0])?.label ?? null : null
    const fixedLegend = document.querySelector('#domains .legend .swatch-state')?.parentElement ?? null

    /** A cohort the server drew no tick for still gets one when it has a value. */
    const ensureMark = (r) => {
      if (!r.bar) return null // a row with neither a bar nor a tick has no geometry to hang one on
      const y = Number(r.bar.getAttribute('y'))
      const h = Number(r.bar.getAttribute('height'))
      if (!Number.isFinite(y) || !Number.isFinite(h)) return null
      const el = document.createElementNS(SVGNS, 'line')
      el.setAttribute('class', 'mark mark-peer')
      el.setAttribute('y1', (y - 4).toFixed(1))
      el.setAttribute('y2', (y + h + 4).toFixed(1))
      ;(r.value ?? r.bar).after(el)
      r.primary = el
      return el
    }

    const ensureSub = (r) => {
      const y = Number(r.label.getAttribute('y'))
      if (!Number.isFinite(y)) return null
      const el = document.createElementNS(SVGNS, 'text')
      el.setAttribute('x', r.label.getAttribute('x') ?? '0')
      el.setAttribute('y', (y + 14).toFixed(1))
      el.setAttribute('class', 'row-sub')
      r.label.after(el)
      r.sub = el
      return el
    }

    return (c) => {
      for (const r of usable) {
        const v = c.metrics[r.key]
        const mark = r.primary ?? (v == null ? null : ensureMark(r))
        if (mark) {
          mark.style.display = v == null ? 'none' : ''
          if (v != null) {
            const x = (geo.base + geo.unit * v).toFixed(1)
            mark.setAttribute('x1', x)
            mark.setAttribute('x2', x)
            title(mark, `${label(c)}: ${v}`)
          }
        }
        // No score, no difference to state: the delta belongs to rows TEA
        // published a number for.
        if (own[r.key] == null) continue
        const sub = r.sub ?? (v == null ? null : ensureSub(r))
        if (sub) {
          const d = own[r.key] - v
          sub.textContent = v == null ? '' : `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} vs ${c.short}`
        }
      }
      if (swatch) legendText(swatch, `${label(c)} (${num(c.n)})`)
      const duplicate = fixedLabel !== null && label(c) === fixedLabel
      for (const m of fixed) m.style.display = duplicate ? 'none' : ''
      if (fixedLegend) fixedLegend.style.display = duplicate ? 'none' : ''
    }
  }

  /* ---- the STAAR bars ---- */

  const staarBars = () => {
    const svg = document.querySelector('#outcomes svg.chart-grouped')
    if (!svg) return null

    const rows = []
    const points = []
    for (const rect of svg.querySelectorAll('rect.gb')) {
      // The bar's own tooltip names the subject and the level, which is the
      // metric key: "All Subjects · Meets grade level: 50%".
      const tip = rect.querySelector('title')?.textContent ?? ''
      const subject = tip.split(' · ')[0]
      const level = [...rect.classList].map((cls) => /^gb-l(\d)$/.exec(cls)).find(Boolean)?.[1]
      const key = `staar:${subject}:${level}`
      if (!subject || level === undefined) continue
      // The bar's own value, taken from the JSON where it is there and from the
      // tooltip the bar already shows where it is not, so a row is still tracked
      // when the two sources disagree about a masked cell.
      const printed = readMark(rect)?.value
      const mine = own[key] ?? (Number.isFinite(printed) ? printed : null)
      if (mine == null) continue
      const x = Number(rect.getAttribute('x'))
      const w = Number(rect.getAttribute('width'))
      if (!Number.isFinite(x) || !Number.isFinite(w)) continue
      // A subject where nobody reached the level has a zero-width bar, and TEA
      // masks some cells with a negative sentinel the renderer prints as it
      // finds it. Neither can anchor a scale on its own; the fit below is over
      // every group's bars and ticks, which all sit on one track.
      if (mine >= 0) points.push({ v: 0, x }, { v: mine, x: x + w })

      let mark = null
      let value = null
      for (let el = rect.nextElementSibling; el; el = el.nextElementSibling) {
        if (el.classList.contains('mark')) mark = el
        else if (el.classList.contains('bar-value')) { value = el; break }
        else break // the next group has started
      }
      if (mark) {
        const read = readMark(mark)
        const mx = Number(mark.getAttribute('x1'))
        if (read && read.value >= 0 && Number.isFinite(mx)) points.push({ v: read.value, x: mx })
      }
      rows.push({ key, mine, rect, mark, value, len: Math.max(0, w) })
    }
    if (!rows.length) return null
    const geo = fitScale(points)
    if (!geo) return null

    const swatch = document.querySelector('#outcomes .legend .swatch-peer')
    const note = [...document.querySelectorAll('#outcomes p.note')].find((p) => /tick on each bar/i.test(p.textContent)) ?? null
    const noteHtml = note?.innerHTML ?? null

    const ensureMark = (r) => {
      const y = Number(r.rect.getAttribute('y'))
      const h = Number(r.rect.getAttribute('height'))
      if (!Number.isFinite(y) || !Number.isFinite(h)) return null
      const el = document.createElementNS(SVGNS, 'line')
      el.setAttribute('class', 'mark mark-peer')
      el.setAttribute('y1', (y - 2).toFixed(1))
      el.setAttribute('y2', (y + h + 2).toFixed(1))
      r.rect.after(el)
      r.mark = el
      return el
    }

    const ensureDelta = (text) => {
      const el = document.createElementNS(SVGNS, 'tspan')
      el.setAttribute('class', 'delta')
      text.append(document.createTextNode(' '), el)
      return el
    }

    return (c) => {
      for (const r of rows) {
        const v = c.metrics[r.key]
        const mark = r.mark ?? (v == null ? null : ensureMark(r))
        if (mark) {
          mark.style.display = v == null ? 'none' : ''
          if (v != null) {
            const x = (geo.base + geo.unit * v).toFixed(1)
            mark.setAttribute('x1', x)
            mark.setAttribute('x2', x)
            title(mark, `${label(c)}: ${v}%`)
          }
        }
        if (!r.value) continue
        const delta = r.value.querySelector('.delta') ?? (v == null ? null : ensureDelta(r.value))
        if (delta) delta.textContent = v == null ? '' : `${r.mine >= v ? '+' : '−'}${Math.abs(r.mine - v).toFixed(0)}`
        // The value label clears whichever is further right, the bar or the tick.
        const reach = v == null ? r.len : Math.max(r.len, geo.unit * v)
        r.value.setAttribute('x', (geo.base + reach + 7).toFixed(1))
      }
      if (swatch) legendText(swatch, `Tick: ${label(c)} (${num(c.n)})`)
      if (note) {
        if (c === base) note.innerHTML = noteHtml
        else {
          note.textContent =
            `Percentage of tests at or above each level. Masters is a subset of Meets, which is a subset of ` +
            `Approaches. The tick on each bar is the average for ${label(c)} — ${num(c.n)} ${UNIT} — a ` +
            `comparison TEA does not publish.`
        }
      }
    }
  }

  /* ---- the CCMR table ---- */

  const ccmrTable = () => {
    const table = [...document.querySelectorAll('table.data')].find((t) =>
      /CCMR criteria/i.test(t.querySelector('caption')?.textContent ?? ''))
    if (!table) return null
    const head = table.querySelectorAll('thead th')[2] ?? null
    const rows = [...table.querySelectorAll('tbody tr')]
      .map((tr) => {
        const cells = tr.querySelectorAll('td')
        return { mine: parseFloat(cells[0]?.textContent ?? ''), other: parseFloat(cells[1]?.textContent ?? ''), cells }
      })
      .filter((r) => r.cells.length >= 3)
    if (!rows.length) return null
    const keys = assign(
      rows.map((r) => ({ mine: Number.isFinite(r.mine) ? r.mine : null, other: Number.isFinite(r.other) ? r.other : null })),
      keysLike('ccmr:')
    )
    if (!keys) return null

    return (c) => {
      if (head) head.textContent = c.short
      rows.forEach((r, i) => {
        const v = c.metrics[keys[i]]
        const mine = own[keys[i]]
        r.cells[1].textContent = v == null ? '—' : `${v.toFixed(1)}%`
        const gap = v == null || mine == null ? null : mine - v
        r.cells[2].textContent = ''
        if (gap == null) { r.cells[2].textContent = '—'; return }
        const span = document.createElement('span')
        span.className = gap >= 0 ? 'cmp-up' : 'cmp-down'
        span.textContent = `${gap >= 0 ? '+' : '−'}${Math.abs(gap).toFixed(1)}`
        r.cells[2].append(span)
      })
    }
  }

  /* ---- the trajectory table beside the chart ---- */

  const trajTable = () => {
    const tag = document.querySelector('script[data-trajectory]')
    const table = document.querySelector('#trajectory table.data')
    if (!tag || !table) return null
    let data = null
    try { data = JSON.parse(tag.textContent) } catch { return null }
    if (!Array.isArray(data?.years)) return null

    // Year | Rating | Score | comparison | State.
    const head = table.querySelectorAll('thead th')[3] ?? null
    const headHtml = head?.innerHTML ?? null
    const rows = [...table.querySelectorAll('tbody tr')]
      .map((tr) => ({ year: tr.querySelector('th')?.textContent?.trim(), cell: tr.querySelectorAll('td')[2] }))
      .filter((r) => r.cell && r.year)
    if (!rows.length) return null
    const original = rows.map((r) => r.cell.textContent)

    return (c) => {
      const series = data.comparisons?.find((s) => s.key === c.key)
      // The last column is always the state average. When the reader picks the
      // state there is nothing left for this column to become, so it goes back
      // to the cohort the server put there rather than printing the same series
      // twice under two headings.
      const restore = !series || c.key === 'state' || c === base
      if (head && headHtml != null) {
        if (restore) head.innerHTML = headHtml
        else head.textContent = `${cap(c.short)} (${num(c.n)})`
      }
      rows.forEach((r, i) => {
        if (restore) { r.cell.textContent = original[i]; return }
        const at = data.years.indexOf(r.year)
        const v = at < 0 ? null : series.values[at]
        r.cell.textContent = v == null ? '—' : v.toFixed(1)
      })
    }
  }

  /* ---- the sentence at the top of the page ---- */

  /**
   * Where this entity places inside the chosen cohort, computed from the same
   * payload the pinner searches and by the rule the server ranks with: one plus
   * the number scoring strictly better, with ties disclosed.
   *
   * Two guards decide whether the answer may be published, and both check this
   * file's cohort against the one the page names — the membership count has to
   * equal the n the server printed on the chip, and the mean of those members'
   * scores has to equal the cohort average the server published. If either
   * differs, the population counted here is not the population the page is
   * talking about, and nothing is written. A rank whose denominator cannot be
   * verified is exactly the boast this site exists to avoid.
   */
  const placement = (raw, c) => {
    const cols = raw?.entities
    if (!cols?.id || !Array.isArray(raw.scores) || !entityId) return null
    const i = cols.id.indexOf(entityId)
    if (i < 0) return null
    const scoreAt = (k) => raw.scores[k]?.[0] ?? null
    const mine = scoreAt(i)
    if (mine == null || !near(mine, own.score)) return null

    const belongs =
      c.key === 'state' ? () => true
      : c.key === 'region' ? (k) => cols.regionId?.[k] === cols.regionId[i]
      : c.key === 'county' ? (k) => cols.countyId?.[k] === cols.countyId[i]
      : c.key === 'peer'
        ? (k) => cols.ecoDisPct?.[k] != null && cols.ecoDisPct[i] != null && Math.abs(cols.ecoDisPct[k] - cols.ecoDisPct[i]) <= 10
        : null
    if (!belongs) return null

    const scores = []
    for (let k = 0; k < cols.id.length; k++) {
      if (cols.level?.[k] !== cols.level[i] || scoreAt(k) == null || !belongs(k)) continue
      scores.push(scoreAt(k))
    }
    if (scores.length !== c.n) return null
    const mean = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
    if (c.metrics.score != null && !near(mean, c.metrics.score)) return null
    return {
      rank: scores.filter((v) => v > mine).length + 1,
      of: scores.length,
      tied: scores.filter((v) => v === mine).length - 1,
    }
  }

  const verdictClause = () => {
    const summary = document.querySelector('.hero .summary') ?? document.querySelector('.verdict .summary')
    if (!summary || own.score == null) return null
    let seq = 0

    // A hook the renderer may one day own; until then this file makes its own,
    // and either way there is exactly one of them.
    const slot = () => {
      let el = summary.querySelector('[data-cohort-clause]')
      if (!el) {
        el = document.createElement('span')
        el.setAttribute('data-cohort-clause', '')
        el.className = 'summary-cohort'
        summary.append(document.createTextNode(' '), el)
      }
      return el
    }

    const write = (el, c, d, place) => {
      const tail = place ? `, ${ordinal(place.rank)} of ${num(place.of)}${place.tied > 0 ? ` (shared with ${num(place.tied)} other${place.tied === 1 ? '' : 's'})` : ''}` : ''
      el.textContent = ''
      if (Math.abs(d) < 0.05) {
        el.append(document.createTextNode(`Level with ${label(c)} (${num(c.n)} ${UNIT})${tail}.`))
        return
      }
      const strong = document.createElement('strong')
      strong.textContent = `${signed(d)} points`
      el.append(strong, document.createTextNode(` against ${label(c)} (${num(c.n)} ${UNIT})${tail}.`))
    }

    return (c) => {
      const token = ++seq
      const other = c.metrics.score
      // The server's own sentence already states the default cohort, and would
      // then be followed by the same fact in different words.
      if (c === base || other == null) {
        const el = summary.querySelector('[data-cohort-clause]')
        if (el?.previousSibling?.nodeType === 3) el.previousSibling.remove()
        el?.remove()
        return
      }
      const el = slot()
      const d = own.score - other
      write(el, c, d, null)
      // The placement needs the entity payload, so it arrives a moment later and
      // only if it can be verified. The sentence is complete and true without it.
      loadPayload()
        .then((raw) => {
          if (token !== seq) return
          const place = placement(raw, c)
          if (place) write(el, c, d, place)
        })
        .catch(() => {})
    }
  }

  /* ---- what the reader is told ---- */

  const announce = (() => {
    const el = document.createElement('p')
    el.className = 'cohort-status sr-only'
    el.setAttribute('role', 'status')
    ;(document.querySelector('.cohort-bar') ?? document.body).append(el)
    return (c, onChart) => {
      el.textContent =
        `Every comparison on this page is now against ${label(c)}, ${num(c.n)} ${UNIT}.` +
        (onChart ? ' Its line is on the trajectory chart.' : '')
    }
  })()

  const updaters = [chips(), domainBars(), staarBars(), ccmrTable(), trajTable(), verdictClause()].filter(Boolean)
  let current = base

  const apply = (key) => {
    const c = cohorts.find((x) => x.key === key)
    if (!c || c === current) return
    current = c
    document.querySelectorAll('.chip-cohort').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cohort === key)))
    if (sbCohort) sbCohort.textContent = label(c)
    for (const u of updaters) u(c)
    announce(c, chart?.setCohort?.(c.key) === true)
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip-cohort')
    if (btn) apply(btn.dataset.cohort)
  })

  // The chart's picker offers the same cohorts under the same heading. Turning
  // one on there is the same request as pressing it in the rail, so the page
  // follows rather than leaving two controls disagreeing about which comparison
  // the reader asked for.
  chart?.onPick?.((key, on) => { if (on) apply(key) })

  // The server rendered every comparison against the first cohort; teach the
  // sticky bar which one that is without touching the numbers.
  if (sbCohort) sbCohort.textContent = label(base)
}

/* ------------------------------------------------------ copy a claim ------- */

function initCopy() {
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.copy')
    if (!btn) return
    const text = btn.dataset.claim
    try {
      await navigator.clipboard.writeText(text)
      const was = btn.textContent
      btn.textContent = 'Copied'
      btn.classList.add('done')
      setTimeout(() => { btn.textContent = was; btn.classList.remove('done') }, 1600)
    } catch {
      // Clipboard can be blocked; select the text so the reader can copy it manually
      // rather than leaving the button silently doing nothing.
      const r = document.createRange()
      r.selectNodeContents(btn.closest('.standout').querySelector('.standout-body'))
      getSelection().removeAllRanges()
      getSelection().addRange(r)
      btn.textContent = 'Select & copy'
    }
  })
}

/* ------------------------------------------------------------ scroll spy -- */

/**
 * The rail index is a list of plain anchors and works with JS off; this only adds
 * aria-current to whichever one you are reading.
 *
 * The observer's root is squeezed to the top third of the viewport, so a section
 * becomes current when its heading arrives there rather than when it first peeks
 * in from the bottom. The last section usually cannot reach the top third — there
 * is not enough page under it — so a one-pixel sentinel after it says "you have
 * reached the end", and the end wins.
 */
function initSpy() {
  const links = [...document.querySelectorAll('.rail-index .rail-link[data-spy]')]
  if (!links.length || !('IntersectionObserver' in window)) return

  const items = links
    .map((a) => ({ a, el: document.getElementById(a.dataset.spy) }))
    .filter((i) => i.el)
    .sort((x, y) =>
      x.el.compareDocumentPosition(y.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)
  if (!items.length) return

  const seen = new Set()
  let atEnd = false
  let current = null

  const mark = () => {
    let pick = null
    if (atEnd) pick = items[items.length - 1]
    else for (const it of items) if (seen.has(it.el)) pick = it // deepest one in the band
    if (!pick || pick.a === current) return
    for (const it of items) it.a.removeAttribute('aria-current')
    pick.a.setAttribute('aria-current', 'true')
    current = pick.a
  }

  const band = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (en.isIntersecting) seen.add(en.target)
        else seen.delete(en.target)
      }
      mark()
    },
    { rootMargin: '0px 0px -66% 0px', threshold: 0 }
  )
  items.forEach((i) => band.observe(i.el))

  const end = document.createElement('div')
  end.className = 'spy-end'
  end.setAttribute('aria-hidden', 'true')
  end.style.cssText = 'height:1px;margin:0;padding:0;pointer-events:none'
  items[items.length - 1].el.after(end)
  new IntersectionObserver(
    (entries) => {
      atEnd = entries[entries.length - 1].isIntersecting
      mark()
    },
    { threshold: 0 }
  ).observe(end)

  mark()
}

/* ----------------------------------------------------------- sticky header -- */

/**
 * The bar repeats what the hero says, so it appears only once the hero is gone
 * and disappears again at the top. It ships `hidden`; a reader with JS off simply
 * never sees a duplicate of something already on the page.
 */
function initStickybar() {
  const bar = document.querySelector('.stickybar')
  if (!bar || !('IntersectionObserver' in window)) return
  const hero = document.querySelector('.hero') ?? document.querySelector('#main > section')
  if (!hero) return
  if (REDUCED) bar.style.transition = 'none'

  new IntersectionObserver(
    (entries) => {
      const en = entries[entries.length - 1]
      // Gone upward, not merely not-yet-reached: the difference matters on load
      // when the browser restores a scroll position below the fold.
      const past = !en.isIntersecting && en.boundingClientRect.top < 0
      if (past === !bar.hidden) return
      bar.hidden = !past
    },
    { threshold: 0 }
  ).observe(hero)

  // A sticky bar that covers what you just tabbed to is worse than no bar. Nudge
  // the page down when keyboard focus lands underneath it.
  document.addEventListener('focusin', (e) => {
    if (bar.hidden) return
    const el = e.target
    if (!(el instanceof HTMLElement) || bar.contains(el) || el.closest('.rail')) return
    if (!keyboardFocus(el)) return
    const guard = bar.getBoundingClientRect().bottom + 12
    const top = el.getBoundingClientRect().top
    if (top < guard) window.scrollBy(0, top - guard)
  })
}

/* ---------------------------------------------------------- district pins -- */

const PIN_KEY = 'txschools:pins'
const PIN_MAX = 5
const PIN_HUES = [8, 265, 152, 315, 42]

/**
 * Search every school and district, pin up to five, and their lines join the
 * trajectory chart. The payload is ~10,000 entities, so it is never fetched on
 * page load — only when the reader first touches the search box. Pins survive
 * across pages in sessionStorage carrying their own year->score map, which means
 * a restored pin draws immediately, with no request at all, and remaps cleanly
 * onto a chart with a different run of years.
 *
 * It used to drop every campus on the floor — `if (level !== 'district')
 * continue` — while the payload it had just downloaded held all 9,031 of them,
 * so a parent typing a real school name was told it did not exist. Comparing one
 * elementary school with another is the thing this box is for, and both levels
 * are on the same 0-100 accountability score, so both are searchable from either
 * kind of page. What a campus needs, and what a district-only list never had to
 * carry, is its district: 1,279 campus rows share a name with another campus, so
 * a bare name would ask the reader to guess. The id carries it — TEA numbers a
 * campus with its district's six digits followed by three — and every campus in
 * the payload resolves that way, so the district's name travels with the result,
 * with the pin, and with the chart line's accessible name.
 *
 * This is the CHART pinner, not site navigation: everything here adds a line to
 * a chart. The labels say so.
 */
function initPins(chart) {
  const box = document.querySelector('.rail-pins')
  if (!box || !chart) return
  const input = box.querySelector('.pin-search')
  const results = box.querySelector('.pin-results')
  const list = box.querySelector('.pin-list')
  if (!input || !results || !list) return

  // The entity whose page this is: pinning it would draw a second line exactly
  // on top of its own.
  const ownId = location.pathname.match(/-(\d{6,9})(?:\.html)?$/)?.[1] ?? null
  const pageLevel = location.pathname.startsWith('/campus/') ? 'campus' : 'district'

  const status = document.createElement('p')
  status.className = 'pin-status'
  status.setAttribute('role', 'status')
  results.before(status)
  const say = (msg) => { status.textContent = msg }

  results.id = results.id || 'pin-results'
  results.setAttribute('role', 'listbox')
  results.setAttribute('aria-label', 'Matching schools and districts')
  input.setAttribute('role', 'combobox')
  input.setAttribute('aria-autocomplete', 'list')
  input.setAttribute('aria-controls', results.id)
  input.setAttribute('aria-expanded', 'false')

  // The block was written when this searched districts only, and the words are
  // still on the page. They are corrected here rather than left to contradict
  // the box underneath them — but only where they still make the narrow claim,
  // so a renderer that has since told the truth for itself is left alone.
  const retitle = (el, text) => { if (el && /district/i.test(el.textContent) && !/school/i.test(el.textContent)) el.textContent = text }
  retitle(box.querySelector('.rail-title'), 'Pin to the chart')
  retitle(box.querySelector('.rail-hint'), 'Add up to five schools or districts to the trajectory chart.')
  if (/district/i.test(input.placeholder) && !/school/i.test(input.placeholder)) input.placeholder = 'Search schools and districts'
  if (/district/i.test(input.getAttribute('aria-label') ?? '') && !/school/i.test(input.getAttribute('aria-label') ?? '')) {
    input.setAttribute('aria-label', 'Search schools and districts to add to the chart')
  }
  if (/district/i.test(list.getAttribute('aria-label') ?? '')) list.setAttribute('aria-label', 'Pinned on the chart')

  /* ---- the index, loaded once, lazily ---- */

  let index = null
  let loading = null

  const buildIndex = (raw) => {
    const cols = raw.entities ?? {}
    const ids = cols.id ?? []
    const districtName = new Map()
    for (let i = 0; i < ids.length; i++) {
      if (cols.level?.[i] === 'district') districtName.set(String(ids[i]), String(cols.name?.[i] ?? ''))
    }
    const rows = []
    for (let i = 0; i < ids.length; i++) {
      const id = String(ids[i])
      const name = String(cols.name?.[i] ?? '')
      if (!name) continue
      const level = cols.level?.[i] === 'campus' ? 'campus' : 'district'
      const district = level === 'campus' ? districtName.get(id.slice(0, 6)) ?? null : null
      rows.push({
        id,
        name,
        level,
        sub: district ?? (level === 'campus' ? 'school' : 'district'),
        // What a chart line and a pin are called. A campus carries its district
        // because 1,279 of them share a name with another campus.
        label: district ? `${name} (${district})` : name,
        region: cols.regionId?.[i] ?? null,
        key: name.toLowerCase(),
        row: i,
      })
    }

    // Eleven districts share a name with another district, which means their
    // campuses can share a name AND a district ("Wylie HS, Wylie ISD" is two
    // schools 180 miles apart). Where the name and the district still do not
    // separate two rows, the region does, and it is the geography the rest of
    // the site names entities by. Computed over the whole index rather than per
    // query, so a row reads the same however it was found.
    const counts = new Map()
    for (const r of rows) counts.set(r.label, (counts.get(r.label) ?? 0) + 1)
    for (const r of rows) {
      r.detail = counts.get(r.label) > 1 && r.region != null ? ` · Region ${r.region}` : ''
    }

    rows.sort((a, b) => a.name.localeCompare(b.name))
    return { years: raw.years ?? [], scores: raw.scores ?? [], rows }
  }

  const load = () => {
    if (index) return Promise.resolve(index)
    if (loading) return loading
    say('Loading the school and district list…')
    loading = loadPayload()
      .then((raw) => {
        index = buildIndex(raw)
        say('')
        return index
      })
      .catch((err) => {
        // Say so. A search box that stays empty forever looks like no matches.
        loading = null
        say('Could not load the list of schools and districts. Check your connection, then type again to retry.')
        throw err
      })
    return loading
  }

  /* ---- pins ---- */

  const pinned = new Map() // id -> { id, name, hue, byYear }
  const valuesFor = (rec) => chart.years.map((y) => rec.byYear?.[y] ?? null)
  const nextHue = () => {
    const taken = new Set([...pinned.values()].map((p) => p.hue))
    return PIN_HUES.find((h) => !taken.has(h)) ?? PIN_HUES[0]
  }

  const save = () => {
    try {
      sessionStorage.setItem(PIN_KEY, JSON.stringify([...pinned.values()]))
    } catch {
      // Private mode or a full quota: pinning still works for this page.
    }
  }

  const nameOf = (rec) => rec.label ?? rec.name

  const pinItem = (rec) => {
    const li = document.createElement('li')
    li.className = 'pin'
    li.dataset.id = rec.id
    const dot = document.createElement('span')
    dot.className = 'pin-dot'
    dot.style.setProperty('--pin-hue', String(rec.hue))
    const name = document.createElement('span')
    name.className = 'pin-name'
    name.textContent = nameOf(rec)
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'pin-remove'
    remove.setAttribute('aria-label', `Unpin ${nameOf(rec)}`)
    remove.textContent = 'x'
    li.append(dot, name, remove)
    return li
  }

  const capMessage = 'Five pins is the limit — six lines on one chart cannot be read. Remove one to add another.'

  const add = (recs, { announce = true } = {}) => {
    const taking = []
    let capped = false
    for (const rec of recs) {
      if (pinned.has(rec.id) || rec.id === ownId) continue
      if (pinned.size >= PIN_MAX) { capped = true; break }
      pinned.set(rec.id, rec)
      taking.push(rec)
    }
    if (taking.length) {
      taking.forEach((rec) => list.appendChild(pinItem(rec)))
      chart.addPins(taking.map((rec) => ({ id: rec.id, label: nameOf(rec), values: valuesFor(rec), hue: rec.hue })))
      save()
    }
    if (!announce) return
    if (capped && !taking.length) say(capMessage)
    else if (taking.length) {
      const names = taking.map(nameOf).join(', ')
      say(pinned.size >= PIN_MAX ? `Pinned ${names}. ${capMessage}` : `Pinned ${names}.`)
    }
  }

  list.addEventListener('click', (e) => {
    const btn = e.target.closest('.pin-remove')
    if (!btn) return
    const li = btn.closest('.pin')
    const rec = pinned.get(li?.dataset.id)
    if (!rec) return
    // Removing the element that holds focus would drop focus to the body, so hand
    // it to the next pin, or back to the search box.
    const next = li.nextElementSibling?.querySelector('.pin-remove') ?? input
    pinned.delete(rec.id)
    li.remove()
    chart.removePin(rec.id)
    save()
    say(`Unpinned ${nameOf(rec)}.`)
    next.focus()
  })

  /* ---- the listbox ---- */

  let options = []
  let cursor = -1

  const close = () => {
    results.hidden = true
    results.textContent = ''
    options = []
    cursor = -1
    input.setAttribute('aria-expanded', 'false')
    input.removeAttribute('aria-activedescendant')
  }

  const select = (i) => {
    cursor = i
    const nodes = [...results.children]
    nodes.forEach((li, k) => li.setAttribute('aria-selected', String(k === cursor)))
    if (cursor < 0) { input.removeAttribute('aria-activedescendant'); return }
    input.setAttribute('aria-activedescendant', nodes[cursor].id)
    nodes[cursor].scrollIntoView({ block: 'nearest' })
  }

  const show = (hits) => {
    options = hits
    results.textContent = ''
    hits.forEach((it, i) => {
      const li = document.createElement('li')
      li.className = 'pin-result'
      li.id = `pin-opt-${i}`
      li.setAttribute('role', 'option')
      li.setAttribute('aria-selected', 'false')
      li.dataset.id = it.id
      // One line: the name, then what it is. A campus names its district, which
      // is the only thing that tells two identically named schools apart.
      const name = document.createElement('span')
      name.className = 'pin-opt-name'
      name.textContent = it.name
      const sub = document.createElement('span')
      sub.className = 'pin-opt-sub'
      sub.textContent = ` · ${it.sub}${it.detail ?? ''}`
      li.append(name, sub)
      results.appendChild(li)
    })
    results.hidden = !hits.length
    input.setAttribute('aria-expanded', String(hits.length > 0))
    select(hits.length ? 0 : -1)
  }

  /**
   * Name matches, prefix before substring, and within each the level of the page
   * you are on first — someone on a campus page typing three letters is nearly
   * always after another campus, and 9,031 campuses would otherwise bury the
   * 1,199 districts or the reverse.
   */
  const search = (q) => {
    const needle = q.trim().toLowerCase()
    if (!needle || !index) return []
    const buckets = [[], [], [], []] // prefix-same-level, prefix-other, inside-same, inside-other
    for (const it of index.rows) {
      if (pinned.has(it.id) || it.id === ownId) continue
      const at = it.key.indexOf(needle)
      if (at < 0) continue
      const b = buckets[(at === 0 ? 0 : 2) + (it.level === pageLevel ? 0 : 1)]
      if (b.length < 8) b.push(it) // a bucket that can already fill the list is full
      if (buckets[0].length >= 8) break
    }
    return buckets.flat().slice(0, 8)
  }

  const byYearFor = (it) => {
    const row = index.scores[it.row] ?? []
    const out = {}
    index.years.forEach((y, j) => {
      const v = row[j]
      if (v !== null && v !== undefined) out[y] = v
    })
    return out
  }

  const pick = (it) => {
    if (pinned.size >= PIN_MAX) { say(capMessage); close(); return }
    add([{ id: it.id, name: it.name, label: `${it.label}${it.detail ?? ''}`, hue: nextHue(), byYear: byYearFor(it) }])
    input.value = ''
    close()
  }

  const run = (q) => {
    load()
      .then(() => {
        if (input.value !== q) return // the reader has typed on since
        const hits = search(q)
        show(hits)
        if (!hits.length) say(`No school or district is named “${q.trim()}”. This box searches names only.`)
        else say('')
      })
      .catch(() => {})
  }

  input.addEventListener('focus', () => { load().catch(() => {}) })

  input.addEventListener('input', () => {
    const q = input.value
    if (!q.trim()) { close(); say(''); return }
    run(q)
  })

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!options.length) return
      e.preventDefault()
      const d = e.key === 'ArrowDown' ? 1 : -1
      select((cursor + d + options.length) % options.length)
      return
    }
    if (e.key === 'Home' || e.key === 'End') {
      if (!options.length) return
      e.preventDefault()
      select(e.key === 'Home' ? 0 : options.length - 1)
      return
    }
    if (e.key === 'Enter') {
      if (cursor < 0 || !options[cursor]) return
      e.preventDefault()
      pick(options[cursor])
      return
    }
    if (e.key === 'Escape' && !results.hidden) {
      e.preventDefault() // otherwise type=search also wipes the field
      close()
    }
  })

  // Keep focus in the input while a result is clicked, so blur never races the pin.
  results.addEventListener('pointerdown', (e) => e.preventDefault())
  results.addEventListener('click', (e) => {
    const li = e.target.closest('.pin-result')
    if (!li) return
    const it = options.find((o) => o.id === li.dataset.id)
    if (it) pick(it)
  })
  input.addEventListener('blur', () => { if (!results.hidden) close() })

  /* ---- what was pinned on the last page ---- */

  let saved = []
  try {
    saved = JSON.parse(sessionStorage.getItem(PIN_KEY) ?? '[]')
  } catch {
    saved = []
  }
  const claimed = new Set()
  const restorable = (Array.isArray(saved) ? saved : [])
    .filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string' && p.byYear)
    .map((p) => {
      // Keep the hue it had on the last page unless another pin already holds it,
      // so a district stays the same colour as the reader moves around.
      const hue = PIN_HUES.includes(p.hue) && !claimed.has(p.hue)
        ? p.hue
        : PIN_HUES.find((h) => !claimed.has(h)) ?? PIN_HUES[0]
      claimed.add(hue)
      // `label` arrived with campus pinning; a pin stored by an older page has
      // only a name, and reads the same as it did there.
      return { id: p.id, name: p.name, label: typeof p.label === 'string' ? p.label : p.name, hue, byYear: p.byYear }
    })
  if (restorable.length) {
    add(restorable, { announce: false })
    if (restorable.some((p) => p.id === ownId)) save() // drop this page's own entity
  }
}

/* ------------------------------------------------------------- theme toggle --

   shell.js's THEME_INIT_SCRIPT already set [data-theme] before paint if a
   choice was stored, so there is never a flash for a returning reader. This
   only wires the button: which theme is "current" is read off the DOM/media
   query, never tracked in a variable here, so it cannot drift from what the
   reader actually sees. The icon swap itself is pure CSS (site/style.css)
   and needs none of this — a reader with JS off sees a button that does
   nothing, on a page that already rendered in their OS theme, which is
   correct, not broken. */

function initThemeToggle() {
  const btn = document.querySelector('[data-theme-toggle]')
  if (!btn) return
  const label = btn.querySelector('[data-theme-label]')
  const media = matchMedia('(prefers-color-scheme: dark)')

  const effective = () =>
    document.documentElement.getAttribute('data-theme') || (media.matches ? 'dark' : 'light')

  const sync = () => {
    const dark = effective() === 'dark'
    btn.setAttribute('aria-pressed', String(dark))
    if (label) label.textContent = dark ? 'Switch to light theme' : 'Switch to dark theme'
  }
  sync()
  media.addEventListener('change', sync)

  btn.addEventListener('click', () => {
    const next = effective() === 'dark' ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', next)
    try { localStorage.setItem('theme', next) } catch {}
    sync()
  })
}

/* ------------------------------------------------------ header height --

   Publishes header.site's real rendered height as --header-h so every
   sticky element below it (the stickybar, the rail, .data's sticky column
   headers) can stack correctly instead of hiding underneath it — see the
   var(--header-h, 0px) reads in site/style.css next to each of those rules.
   A ResizeObserver, not a resize listener, because the header's height
   changes for reasons that have nothing to do with the viewport resizing —
   the mobile nav-disclosure opening, the "Unofficial" line wrapping to a
   second line at an in-between width, a webfont swap changing line height.
   Unset (0px, via the CSS fallback) until this runs, which is the same
   layout the site already had — never a broken one. */
function initHeaderH() {
  const header = document.querySelector('header.site')
  if (!header || !('ResizeObserver' in window)) return
  const set = () =>
    document.documentElement.style.setProperty('--header-h', `${Math.round(header.getBoundingClientRect().height)}px`)
  new ResizeObserver(set).observe(header)
  set()
}

/* ------------------------------------------------------------------ init -- */

const charts = [...document.querySelectorAll('[data-chart="trajectory"]')].map(initTrajectory).filter(Boolean)
initBars()
initCohorts(charts[0])
initCopy()
initSpy()
initHeaderH()
initStickybar()
initPins(charts[0])
initThemeToggle()
