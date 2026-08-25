import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'

const CLIENT = readFileSync(new URL('../site/map.js', import.meta.url), 'utf8')

const payload = {
  hiFi: null,
  view: [0, 0, 900, 700],
  regions: [],
  order: ['4800001', '4800002'],
  names: ['Alpha ISD', 'Beta ISD'],
  layers: [
    {
      key: 'rating', label: 'Overall rating', palette: 'rating',
      direction: 'A is strongest.', ranges: ['A', 'B', 'C', 'D', 'F'],
      buckets: [0, 2], counted: 2,
    },
    {
      key: 'transfer-balance', label: 'Student transfer balance, 2025-26', palette: 'diverging',
      direction: 'Teal means more in; brown means more out. This is not a quality judgment.',
      ranges: ['30–100 more out', '5–29 more out', 'No net difference', '1–29 more in', '30–100 more in'],
      buckets: [4, null], counted: 1,
      valueLabels: [
        '76 more transfers in; 94 in and 18 out',
        'net unavailable — transfers in total is suppressed by TEA',
      ],
      missingLabel: 'Suppressed or not reported',
      coverage: '1 of 2 districts has both official totals available; 1 has a suppressed total.',
    },
  ],
}

const fixture = () => `<!doctype html><html><body>
  <div data-map-controls hidden>
    <select data-map-layer>
      <option value="rating">Overall rating</option>
      <option value="transfer-balance">Student transfer balance</option>
    </select>
  </div>
  <p data-map-legend-note></p>
  <figure data-map-palette="rating">
    <figcaption data-map-legend>
      <span data-map-legend-title>Overall rating</span>
      <ul data-map-legend-items>
        ${Array.from({ length: 5 }, (_, i) => `<li><span data-map-class="${i}"></span></li>`).join('')}
        <li data-map-missing-key hidden><span data-map-missing-label>Not reported</span></li>
      </ul>
    </figcaption>
    <svg data-map data-base-view="0 0 900 700" aria-label="Texas school districts shaded by rating">
      <g data-map-shapes>
        <a aria-label="Alpha ISD, rated A"><path data-b="0"><title>Alpha ISD — A</title></path></a>
        <a aria-label="Beta ISD, rated C"><path data-b="2"><title>Beta ISD — C</title></path></a>
      </g>
    </svg>
  </figure>
  <div data-map-layer-detail="transfer-balance" hidden>Transfer leaders</div>
  <script type="application/json" data-map-payload>${JSON.stringify(payload)}</script>
</body></html>`

describe('map layer switching', () => {
  it('uses exact transfer readouts, diverging colors and honest missing copy', () => {
    const dom = new JSDOM(fixture(), { runScripts: 'outside-only', url: 'https://txschools.net/map' })
    dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
    dom.window.eval(CLIENT)

    const { document, Event } = dom.window
    const select = document.querySelector('[data-map-layer]')
    expect(document.querySelector('[data-map-controls]').hidden).toBe(false)
    select.value = 'transfer-balance'
    select.dispatchEvent(new Event('change', { bubbles: true }))

    const paths = [...document.querySelectorAll('[data-map-shapes] path')]
    expect(document.querySelector('[data-map-palette]').getAttribute('data-map-palette')).toBe('diverging')
    expect(paths[0].getAttribute('data-b')).toBe('4')
    expect(paths[1].hasAttribute('data-b')).toBe(false)
    expect(paths[0].closest('a').getAttribute('aria-label')).toBe(
      'Alpha ISD, Student transfer balance, 2025-26: 76 more transfers in; 94 in and 18 out'
    )
    expect(paths[1].querySelector('title').textContent).toContain('transfers in total is suppressed')
    expect(document.querySelector('[data-map-missing-key]').hidden).toBe(false)
    expect(document.querySelector('[data-map-missing-label]').textContent).toBe('Suppressed or not reported')
    expect(document.querySelector('[data-map-layer-detail]').hidden).toBe(false)
    expect(document.querySelector('[data-map-legend-note]').textContent).toContain(
      '1 of 2 districts has both official totals available'
    )
  })
})
