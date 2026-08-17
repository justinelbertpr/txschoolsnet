// Layer switching for /map.
//
// The map itself is already drawn when this file loads — src/render/map.js
// server-renders one layer into the HTML, and every district is a link. So
// everything here is enhancement: if this never runs, the reader still gets a
// complete, navigable map of the state, and only the measure picker is missing.
// That is why the picker ships with `hidden` set and this script is what
// reveals it: a control that does nothing without script should not be on the
// page at all.
//
// Recolouring is an attribute write per district (data-b), which the stylesheet
// turns into a fill. 1,015 attribute writes measured under 40ms on a phone —
// cheaper than re-rendering paths, and it leaves the geometry, the links and
// the accessible names untouched.
;(() => {
  const root = document.querySelector('[data-map]')
  const tag = document.querySelector('[data-map-payload]')
  const controls = document.querySelector('[data-map-controls]')
  const select = document.querySelector('[data-map-layer]')
  if (!root || !tag || !controls || !select) return

  let payload
  try {
    payload = JSON.parse(tag.textContent)
  } catch {
    return // A malformed payload leaves the server-rendered layer alone.
  }
  const layers = payload?.layers
  if (!Array.isArray(layers) || !layers.length) return

  const shapes = [...root.querySelectorAll('[data-map-shapes] path')]
  const links = shapes.map((p) => p.closest('a'))
  const title = document.querySelector('[data-map-legend-title]')
  const items = document.querySelector('[data-map-legend-items]')
  const note = document.querySelector('[data-map-legend-note]')

  // The accessible name of each district is rebuilt per layer, because "Klein
  // ISD, rated B" is wrong once the map is shading by dropout rate. Everything
  // before the comma is the district's own name and never changes.
  const names = links.map((a) => (a?.getAttribute('aria-label') ?? '').split(',')[0])

  const nf = new Intl.NumberFormat('en-US')

  const paint = (layer) => {
    const { buckets, ranges, label, direction, counted } = layer
    for (let i = 0; i < shapes.length; i += 1) {
      const b = buckets[i]
      if (b == null) shapes[i].removeAttribute('data-b')
      else shapes[i].setAttribute('data-b', String(b))
      const band = b == null ? 'no figure' : ranges[b]
      const a = links[i]
      if (a) a.setAttribute('aria-label', `${names[i]}, ${label}: ${band}`)
      const t = shapes[i].querySelector('title')
      if (t) t.textContent = `${names[i]} — ${band}`
    }
    if (title) title.textContent = label
    // The key entries are the filter's checkboxes now, so only their TEXT is
    // rewritten per layer — rebuilding the list would throw away which classes
    // the reader has turned off, and reset the map under them.
    if (items) {
      ranges.forEach((r, i) => {
        const t = items.querySelector(`[data-map-class="${i}"]`)
        if (t) t.textContent = r
      })
    }
    if (note) note.textContent = `${direction} ${nf.format(counted)} districts shown.`
    root.setAttribute('aria-label', `Texas school districts shaded by ${label}`)
  }

  select.addEventListener('change', () => {
    const layer = layers.find((l) => l.key === select.value)
    if (layer) paint(layer)
  })

  controls.hidden = false

  /* ---- sharper geometry, where a screen can actually resolve it ----------
     The page ships the 1% simplification inline. At the ~350px a phone draws
     the state at, that is indistinguishable from the 3% version — but it is
     40% fewer bytes, and a phone on cell data should not pay for detail it
     cannot see. On a wide screen the difference IS visible, so the sharper
     paths are fetched and swapped in.

     Both were projected from the same bounds at build time, so this is a pure
     `d` swap: nothing moves, no reflow, and the links, shading and accessible
     names are all untouched. Any failure — offline, 404, malformed — simply
     leaves the inline geometry in place, which is a complete map. */
  const hi = payload.hiFi
  if (!hi?.href || typeof fetch !== 'function') return
  // Below this the sharper geometry is bytes with nothing to show for them.
  if (!window.matchMedia?.('(min-width: 48rem)')?.matches) return
  // Honour an explicit request to save data over a nicety.
  if (navigator.connection?.saveData) return

  fetch(hi.href, { cache: 'force-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .then((paths) => {
      if (!paths) return
      for (let i = 0; i < shapes.length; i += 1) {
        const d = paths[payload.order[i]]
        if (d) shapes[i].setAttribute('d', d)
      }
    })
    .catch(() => {})
})()

/* ---- zoom to region, and the hover readout -----------------------------
   Split from the block above because neither depends on the layer payload
   being usable: if the picker never appears, zoom and hover still should. */
;(() => {
  const root = document.querySelector('[data-map]')
  const tag = document.querySelector('[data-map-payload]')
  if (!root || !tag) return
  let payload
  try {
    payload = JSON.parse(tag.textContent)
  } catch {
    return
  }

  /* ---- zoom ----
     The viewBox moves; the 1,016 paths do not. Transforming the <g> instead
     would ask the compositor to re-rasterise every polygon, and scale the
     hairline strokes with it. */
  const zoom = document.querySelector('[data-map-zoom]')
  const base = (root.getAttribute('data-base-view') || '').split(/\s+/).map(Number)
  const boxes = new Map((payload.regions || []).map((r) => [r.id, r.box]))
  if (zoom && base.length === 4 && boxes.size) {
    const [, , W, H] = base
    const aspect = W / H
    const frame = (b) => {
      // Letterbox: grow the short side so the region keeps the page's aspect
      // and nothing is squashed. 6% margin so a district on the region's edge
      // is not flush against the frame.
      let [x, y, w, h] = b
      const pad = Math.max(w, h) * 0.06
      x -= pad; y -= pad; w += pad * 2; h += pad * 2
      if (w / h < aspect) { const nw = h * aspect; x -= (nw - w) / 2; w = nw }
      else { const nh = w / aspect; y -= (nh - h) / 2; h = nh }
      return [x, y, w, h]
    }
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    let raf = null
    const setView = (to) => {
      const from = (root.getAttribute('viewBox') || '').split(/\s+/).map(Number)
      if (still || from.length !== 4) { root.setAttribute('viewBox', to.join(' ')); return }
      if (raf) cancelAnimationFrame(raf)
      const t0 = performance.now()
      const step = (t) => {
        const k = Math.min(1, (t - t0) / 320)
        const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2 // ease-in-out
        root.setAttribute('viewBox', from.map((v, i) => v + (to[i] - v) * e).join(' '))
        if (k < 1) raf = requestAnimationFrame(step)
      }
      raf = requestAnimationFrame(step)
    }
    zoom.addEventListener('change', () => {
      const b = boxes.get(zoom.value)
      setView(b ? frame(b) : base)
      const opt = zoom.selectedOptions[0]
      root.setAttribute(
        'aria-label',
        b ? `Texas school districts, zoomed to ${opt ? opt.textContent : 'a region'}` : 'Texas school districts'
      )
    })
  }

  /* ---- hover readout ----
     One listener on the <g>, not 1,016 on the paths. The <a>'s aria-label is
     already "<name>, <layer>: <band>" and site/map.js rewrites it whenever the
     layer changes, so it is the single source for what the tooltip says — no
     second copy to fall out of step. */
  const tip = document.querySelector('[data-map-tip]')
  const shapes = root.querySelector('[data-map-shapes]')
  if (!tip || !shapes) return
  // Touch has no hover: there a tap navigates, and a tooltip would either
  // flash and vanish or sit under the reader's finger.
  if (!window.matchMedia?.('(hover: hover)')?.matches) return

  const show = (target, x, y) => {
    const a = target.closest('a')
    if (!a) return hide()
    const label = a.getAttribute('aria-label') || ''
    const cut = label.indexOf(',')
    tip.textContent = ''
    const name = document.createElement('b')
    name.textContent = cut < 0 ? label : label.slice(0, cut)
    tip.append(name)
    if (cut >= 0) {
      const rest = document.createElement('span')
      rest.textContent = label.slice(cut + 2)
      tip.append(rest)
    }
    tip.hidden = false
    // Flip before the edge rather than after, so the tooltip never leaves the
    // viewport and never covers the district it describes.
    const r = tip.getBoundingClientRect()
    const left = x + 14 + r.width > window.innerWidth ? x - 14 - r.width : x + 14
    const top = y + 14 + r.height > window.innerHeight ? y - 14 - r.height : y + 14
    tip.style.left = `${Math.max(4, left)}px`
    tip.style.top = `${Math.max(4, top)}px`
  }
  const hide = () => { tip.hidden = true }

  shapes.addEventListener('pointerover', (e) => { if (e.pointerType !== 'touch') show(e.target, e.clientX, e.clientY) })
  shapes.addEventListener('pointermove', (e) => { if (!tip.hidden && e.pointerType !== 'touch') show(e.target, e.clientX, e.clientY) })
  shapes.addEventListener('pointerleave', hide)
  // Keyboard parity: tabbing through districts reads the same thing.
  shapes.addEventListener('focusin', (e) => {
    const r = e.target.getBoundingClientRect?.()
    if (r) show(e.target, r.left + r.width / 2, r.top + r.height / 2)
  })
  shapes.addEventListener('focusout', hide)
  window.addEventListener('scroll', hide, { passive: true })
})()
