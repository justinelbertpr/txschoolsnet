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
    if (items) {
      items.textContent = ''
      ranges.forEach((r, i) => {
        const li = document.createElement('li')
        const sw = document.createElement('span')
        sw.className = 'map-swatch'
        sw.dataset.b = String(i)
        li.append(sw, document.createTextNode(r))
        items.append(li)
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
