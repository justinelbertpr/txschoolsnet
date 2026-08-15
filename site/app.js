// Progressive enhancement only. Every chart and table is already complete in the
// HTML; this adds the comparison picker, the rail's section index and district
// pinning, and the motion. If it never runs, or the reader has asked for reduced
// motion, the page still shows a full trajectory chart with two comparison lines,
// a working section index of plain anchors, and every number in a table beneath.
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

/* ------------------------------------------------- trajectory comparisons -- */

/**
 * Returns a controller so the rail's district pinner can add and remove lines on
 * the identical geometry — same pad, same band-snapping domain rule, same path
 * builder. A second copy of that maths would drift from the server's the first
 * time either changed, and the chart would disagree with its own table.
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
    // array for the length of the animation.
    const dash = el.style.strokeDasharray
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

  /** Names the pinned lines for a screen reader, which cannot see the rail's dots. */
  const relabel = () => {
    const names = [...pins.values()].map((p) => p.label)
    svg.setAttribute('aria-label', names.length ? `${baseLabel}. Also showing ${names.join(', ')}` : baseLabel)
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

  picker?.addEventListener('click', (e) => {
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

  return {
    years: data.years,
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
 * The cohort switch moved out of the hero and into the rail. Nothing here reads
 * its container any more: the two JSON tags are found wherever they sit and the
 * clicks are delegated from the document, so the markup can move again without
 * this breaking. It also keeps the sticky bar's comparison label in step.
 */
function initCohorts() {
  const cohortsTag = document.querySelector('script[data-cohorts]')
  const ownTag = document.querySelector('script[data-own]')
  if (!cohortsTag || !ownTag) return

  const cohorts = JSON.parse(cohortsTag.textContent)
  const own = JSON.parse(ownTag.textContent)
  const sbCohort = document.querySelector('[data-sb-cohort]')

  const fmtDelta = (d, fmt) => {
    const sign = d > 0 ? '+' : d < 0 ? '−' : '±'
    const a = Math.abs(d)
    if (fmt === 'usd') return `${sign}$${Math.round(a).toLocaleString('en-US')}`
    if (fmt === 'pct') return `${sign}${a.toFixed(1)} pts`
    return `${sign}${a.toFixed(1)}`
  }

  const label = (c) => c.label ?? c.short ?? c.key

  const apply = (key, { animateIn = true } = {}) => {
    const c = cohorts.find((x) => x.key === key)
    if (!c) return
    if (sbCohort) sbCohort.textContent = label(c)
    document.querySelectorAll('.cmp').forEach((el) => {
      const metric = el.dataset.metric
      const mine = own[metric]
      const other = c.metrics[metric]
      if (mine == null || other == null) { el.hidden = true; return }
      el.hidden = false
      const d = mine - other
      const good = el.dataset.invert ? d < 0 : d > 0
      el.className = `cmp ${Math.abs(d) < 0.05 ? 'cmp-level' : good ? 'cmp-up' : 'cmp-down'}`
      el.innerHTML = `${fmtDelta(d, el.dataset.fmt)} <span class="cmp-vs">vs ${c.short}</span>`
      if (animateIn && !REDUCED) {
        el.animate([{ opacity: 0, transform: 'translateY(-3px)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: 'ease-out' })
      }
    })
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip-cohort')
    if (!btn || btn.getAttribute('aria-pressed') === 'true') return
    document.querySelectorAll('.chip-cohort').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)))
    apply(btn.dataset.cohort)
  })

  // The server rendered every comparison against the first cohort; teach the
  // sticky bar which one that is without touching the numbers.
  const pressed = document.querySelector('.chip-cohort[aria-pressed="true"]')
  const start = cohorts.find((c) => c.key === pressed?.dataset.cohort) ?? cohorts[0]
  if (sbCohort && start) sbCohort.textContent = label(start)
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
 * Search every district, pin up to five, and their lines join the trajectory
 * chart. The payload is ~10,000 entities, so it is never fetched on page load —
 * only when the reader first touches the search box. Pins survive across pages in
 * sessionStorage carrying their own year->score map, which means a restored pin
 * draws immediately, with no request at all, and remaps cleanly onto a chart with
 * a different run of years.
 */
function initPins(chart) {
  const box = document.querySelector('.rail-pins')
  if (!box || !chart) return
  const input = box.querySelector('.pin-search')
  const results = box.querySelector('.pin-results')
  const list = box.querySelector('.pin-list')
  if (!input || !results || !list) return

  // The source is either an attribute value or a JSON tag holding { payload }.
  // Both spellings are in the markup's gift, and neither is worth a second file.
  const readSource = () => {
    const el = box.matches('[data-pin-source]') ? box : box.querySelector('[data-pin-source]')
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
  const src = readSource()
  // The district whose page this is: pinning it would draw a second line exactly
  // on top of its own.
  const ownId = location.pathname.match(/-(\d{6,9})(?:\.html)?$/)?.[1] ?? null

  const status = document.createElement('p')
  status.className = 'pin-status'
  status.setAttribute('role', 'status')
  results.before(status)
  const say = (msg) => { status.textContent = msg }

  results.id = results.id || 'pin-results'
  results.setAttribute('role', 'listbox')
  if (!results.getAttribute('aria-label')) results.setAttribute('aria-label', 'Matching districts')
  input.setAttribute('role', 'combobox')
  input.setAttribute('aria-autocomplete', 'list')
  input.setAttribute('aria-controls', results.id)
  input.setAttribute('aria-expanded', 'false')

  /* ---- the index, loaded once, lazily ---- */

  let index = null
  let loading = null

  const buildIndex = (raw) => {
    const cols = raw.entities ?? {}
    const ids = cols.id ?? []
    const rows = []
    for (let i = 0; i < ids.length; i++) {
      if (cols.level?.[i] !== 'district') continue
      const name = String(cols.name?.[i] ?? '')
      rows.push({ id: String(ids[i]), name, key: name.toLowerCase(), row: i })
    }
    rows.sort((a, b) => a.name.localeCompare(b.name))
    return { years: raw.years ?? [], scores: raw.scores ?? [], rows }
  }

  const load = () => {
    if (index) return Promise.resolve(index)
    if (loading) return loading
    if (!src) {
      say('District search is not available on this page.')
      return Promise.reject(new Error('no pin source'))
    }
    say('Loading the district list…')
    loading = fetch(src, { credentials: 'omit' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((raw) => {
        index = buildIndex(raw)
        say('')
        return index
      })
      .catch((err) => {
        // Say so. A search box that stays empty forever looks like no matches.
        loading = null
        say('Could not load the district list. Check your connection, then type again to retry.')
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

  const pinItem = (rec) => {
    const li = document.createElement('li')
    li.className = 'pin'
    li.dataset.id = rec.id
    const dot = document.createElement('span')
    dot.className = 'pin-dot'
    dot.style.setProperty('--pin-hue', String(rec.hue))
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'pin-remove'
    remove.setAttribute('aria-label', `Unpin ${rec.name}`)
    remove.textContent = 'x'
    li.append(dot, document.createTextNode(rec.name), remove)
    return li
  }

  const capMessage = 'Five pinned districts is the limit — six lines on one chart cannot be read. Remove one to add another.'

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
      chart.addPins(taking.map((rec) => ({ id: rec.id, label: rec.name, values: valuesFor(rec), hue: rec.hue })))
      save()
    }
    if (!announce) return
    if (capped && !taking.length) say(capMessage)
    else if (taking.length) {
      const names = taking.map((r) => r.name).join(', ')
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
    say(`Unpinned ${rec.name}.`)
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
      li.textContent = it.name
      results.appendChild(li)
    })
    results.hidden = !hits.length
    input.setAttribute('aria-expanded', String(hits.length > 0))
    select(hits.length ? 0 : -1)
  }

  const search = (q) => {
    const needle = q.trim().toLowerCase()
    if (!needle || !index) return []
    const starts = []
    const inside = []
    for (const it of index.rows) {
      if (pinned.has(it.id) || it.id === ownId) continue
      const at = it.key.indexOf(needle)
      if (at < 0) continue
      const bucket = at === 0 ? starts : inside
      bucket.push(it)
      if (starts.length >= 8) break
    }
    return [...starts, ...inside].slice(0, 8)
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
    add([{ id: it.id, name: it.name, hue: nextHue(), byYear: byYearFor(it) }])
    input.value = ''
    close()
  }

  const run = (q) => {
    load()
      .then(() => {
        if (input.value !== q) return // the reader has typed on since
        const hits = search(q)
        show(hits)
        if (!hits.length) say(`No districts match “${q.trim()}”.`)
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
      return { id: p.id, name: p.name, hue, byYear: p.byYear }
    })
  if (restorable.length) {
    add(restorable, { announce: false })
    if (restorable.some((p) => p.id === ownId)) save() // drop this page's own entity
  }
}

/* ------------------------------------------------------------------ init -- */

const charts = [...document.querySelectorAll('[data-chart="trajectory"]')].map(initTrajectory).filter(Boolean)
initBars()
initCohorts()
initCopy()
initSpy()
initStickybar()
initPins(charts[0])
