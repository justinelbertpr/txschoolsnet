// Progressive enhancement only. Every chart and table is already complete in the
// HTML; this adds the comparison picker and the motion. If it never runs, or the
// reader has asked for reduced motion, the page still shows a full trajectory
// chart with two comparison lines and every number in a table beneath it.

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches
const EASE = (t) => 1 - Math.pow(1 - t, 3)

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

/* ------------------------------------------------- trajectory comparisons -- */

function initTrajectory(svg) {
  const holder = svg.parentElement.querySelector('script[data-trajectory]')
  const picker = svg.parentElement.querySelector('.picker')
  if (!holder || !picker) return

  const data = JSON.parse(holder.textContent)
  const [pt, pr, pb, pl] = svg.dataset.pad.split(',').map(Number)
  const W = +svg.dataset.w
  const H = +svg.dataset.h
  const iw = W - pl - pr
  const ih = H - pt - pb
  const n = data.years.length

  const active = new Set(data.defaults)
  let domain = { lo: +svg.dataset.lo, hi: +svg.dataset.hi }

  const linesG = svg.querySelector('.lines')
  const dotsG = svg.querySelector('.dots')
  const bandsG = svg.querySelector('.bands')

  const seriesFor = (key) => data.comparisons.find((c) => c.key === key)
  const activeValues = () => [
    data.entity.values,
    ...[...active].map((k) => seriesFor(k)?.values ?? []),
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
      el = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      el.setAttribute('class', `line line-${key}`)
      el.dataset.key = key
      linesG.appendChild(el)
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
    const len = el.getTotalLength()
    el.style.transition = 'none'
    el.style.strokeDasharray = `${len}`
    el.style.strokeDashoffset = `${len}`
    el.getBoundingClientRect() // flush
    el.style.transition = 'stroke-dashoffset .75s cubic-bezier(.22,.61,.36,1)'
    el.style.strokeDashoffset = '0'
  }

  // Seed: adopt the server-rendered paths so nothing flashes on load.
  linesG.querySelectorAll('path').forEach((p) => {
    const cls = [...p.classList].find((c) => c.startsWith('line-'))
    if (cls) p.dataset.key = cls.slice(5)
  })

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
        el.style.transition = 'opacity .25s'
        el.style.opacity = '0'
        setTimeout(() => el.remove(), 250)
      }
    }

    animate(450, (t) => {
      redraw({ lo: from.lo + (to.lo - from.lo) * t, hi: from.hi + (to.hi - from.hi) * t })
    }, () => { domain = to })
  }

  picker.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip')
    if (!btn) return
    const key = btn.dataset.cmp
    const on = btn.getAttribute('aria-pressed') === 'true'
    if (on && active.size <= 1 && active.has(key)) return // keep at least one line meaningful
    on ? active.delete(key) : active.add(key)
    btn.setAttribute('aria-pressed', String(!on))
    apply()
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
}

/* --------------------------------------------------------- bars on scroll -- */

function initBars() {
  const bars = document.querySelectorAll('.chart-bars .bar, .chart-grouped .gb, .chart-stack .seg')
  if (!bars.length) return
  if (REDUCED) { bars.forEach((b) => b.classList.add('shown')); return }

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

/* ------------------------------------------------------------------ init -- */

document.querySelectorAll('[data-chart="trajectory"]').forEach(initTrajectory)
initBars()
