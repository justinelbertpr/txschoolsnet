import { readFileSync } from 'node:fs'

import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'

const app = readFileSync(new URL('../site/app.js', import.meta.url), 'utf8')

const until = async (test, message) => {
  for (let i = 0; i < 50; i += 1) {
    if (test()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(message)
}

const hbar = (metric, label, mine, peer) => `
  <li class="hbar" data-metric="${metric}" data-value="${mine}">
    <span class="hbar-label">${label}</span>
    <span class="hbar-track" aria-hidden="true">
      <span class="hbar-fill"></span>
      <span class="hbar-mark hbar-mark-peer" data-mark="peer" data-value="${peer}" style="--m:${peer}"></span>
    </span>
    <span class="hbar-value">${mine}</span>
    <span class="hbar-sub"><span class="hbar-delta" data-delta="peer">Peer comparison</span></span>
  </li>`

const composition = (prefix, labels) => `
  <div class="comparison-composition-groups" data-pin-composition="${prefix}"
       data-pin-composition-labels='${JSON.stringify(labels)}'>
    <div class="comparison-composition" data-comparison-cohort="peer">
      <p class="comparison-composition-title"><strong>Similar districts</strong></p>
      <svg class="chart chart-stack" viewBox="0 0 640 26" role="img" aria-label="Composition">
        ${labels.map((label, i) => `<rect class="seg seg-${i}" x="${i * 100}" y="0" width="98" height="26"><title>${label}: ${30 + i * 10}%</title></rect>`).join('')}
      </svg>
      <ul class="legend">
        ${labels.map((label, i) => `<li><span class="swatch swatch-${i}"></span>${label} ${30 + i * 10}%</li>`).join('')}
      </ul>
    </div>
    <p class="note na" data-comparison-pin-unavailable hidden style="display:none">
      A precomputed composition average is not available for <span data-comparison-pin-label></span>.
    </p>
  </div>`

const pinMark = (document, metric, id) =>
  document.querySelector(`.hbar[data-metric="${metric}"] .hbar-mark-pin[data-pin="${id}"]`)

describe('additive pinned-district chart overlays', () => {
  it('adds every reported pin measure without selecting the pin and removes every overlay on unpin', async () => {
    const raceLabels = ['African American', 'Hispanic', 'White']
    const experienceLabels = ['Beginning', '1 to 5 years', '6 to 10 years']
    const dom = new JSDOM(`<!doctype html><html><body>
      <aside class="rail-pins">
        <h2 class="rail-title">Pin to compare</h2>
        <p class="rail-hint">Compare matching measures.</p>
        <input class="pin-search">
        <ul class="pin-results" hidden></ul>
        <ul class="pin-list" aria-label="Pinned schools, districts and charter systems"></ul>
        <script type="application/json" data-pin-source>{"payload":"/data/payload-test.json"}</script>
      </aside>

      <div class="cohort-bar" data-accountability-population="standard">
        <button class="chip chip-cohort" data-cohort="peer" aria-pressed="true">Similar districts</button>
      </div>

      <section id="trajectory">
        <div class="picker" role="group" aria-label="Choose comparisons"></div>
        <svg data-chart="trajectory" data-pad="10,10,10,10" data-w="100" data-h="80" data-lo="0" data-hi="100">
          <g class="bands"></g>
          <g class="lines"><path class="line line-entity"></path></g>
          <g class="dots"></g>
        </svg>
        <script type="application/json" data-trajectory>{"years":["2024-25","2025-26"],"defaults":[],"entity":{"label":"Test ISD","values":[80,82]},"comparisons":[]}</script>
      </section>

      <section id="domains">
        <ul class="hbars" data-bars="domain">
          ${hbar('domain:achievement', 'Student Achievement', 80, 70)}
          ${hbar('domain:progress', 'School Progress', 75, 74)}
        </ul>
        <ul class="legend">
          <li><span class="swatch swatch-entity"></span>Test ISD</li>
          <li><span class="swatch swatch-peer"></span>Similar districts</li>
        </ul>
      </section>

      <section id="outcomes">
        <div class="hbar-groups" data-bars="staar">
          <div class="hbar-group">
            <h4 class="hbar-group-label">Math</h4>
            <ul class="hbars">${hbar('staar:Math:0', 'Approaches grade level', 81, 71)}</ul>
          </div>
          <div class="hbar-group">
            <h4 class="hbar-group-label">Reading</h4>
            <ul class="hbars">${hbar('staar:Reading:0', 'Approaches grade level', 78, 68)}</ul>
          </div>
        </div>
        <ul class="legend"><li><span class="swatch swatch-peer"></span>Tick: Similar districts</li></ul>
        <p class="note">The tick on each bar is the average for similar districts.</p>
      </section>

      <section id="students">
        ${composition('race', raceLabels)}
      </section>

      <section id="enrollment">
        <table class="data enrollment-table"><thead><tr><th>School year</th><th>Students enrolled<small>Test ISD</small></th></tr></thead><tbody>
          <tr data-enrollment-year="2024-25">
            <th scope="row">2024-25</th>
            <td class="num enrollment-count-cell"><span class="enrollment-measure" style="--enrollment-width:90%"><span class="enrollment-bar"></span><span class="enrollment-value">900</span></span></td>
            <td></td><td data-comparison-cell data-metric="public:enrollment:2024-25">800</td>
          </tr>
          <tr data-enrollment-year="2025-26">
            <th scope="row">2025-26</th>
            <td class="num enrollment-count-cell"><span class="enrollment-measure" style="--enrollment-width:100%"><span class="enrollment-bar"></span><span class="enrollment-value">1,000</span></span></td>
            <td></td><td data-comparison-cell data-metric="public:enrollment:2025-26">850</td>
          </tr>
        </tbody></table>
      </section>

      <section id="teachers">
        ${composition('experience', experienceLabels)}
      </section>

      <script type="application/json" data-cohorts>${JSON.stringify([{
        key: 'peer', short: 'similar districts', label: 'Similar districts', n: 20,
        metrics: {
          'domain:achievement': 70, 'domain:progress': 74,
          'staar:Math:0': 71, 'staar:Reading:0': 68,
          'race:0': 30, 'race:1': 40, 'race:2': 30,
          'experience:0': 20, 'experience:1': 50, 'experience:2': 30,
          'public:enrollment:2024-25': 800, 'public:enrollment:2025-26': 850,
        },
        metricN: {},
      }])}</script>
      <script type="application/json" data-own>${JSON.stringify({
        'domain:achievement': 80, 'domain:progress': 75,
        'staar:Math:0': 81, 'staar:Reading:0': 78,
        'race:0': 20, 'race:1': 50, 'race:2': 30,
        'experience:0': 15, 'experience:1': 55, 'experience:2': 30,
        'public:enrollment:2024-25': 900, 'public:enrollment:2025-26': 1_000,
      })}</script>
    </body></html>`, {
      url: 'https://txschools.net/district/test-isd-123456',
      runScripts: 'outside-only',
      pretendToBeVisual: true,
    })

    const { window } = dom
    window.matchMedia = vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} }))

    const docs = {
      '/data/entity/001902.json': {
        metrics: {
          'domain:achievement': 92,
          'domain:progress': 77,
          'staar:Math:0': 88,
          'staar:Reading:0': 70,
          'race:0': 25,
          'race:1': 55,
          'race:2': 20,
          'experience:0': 10,
          'experience:1': 60,
          'experience:2': 30,
          'public:enrollment:2024-25': 1_100,
          'public:enrollment:2025-26': 1_200,
        },
      },
      '/data/entity/101902.json': {
        metrics: {
          'domain:achievement': 66,
          // School Progress and Math are deliberately missing.
          'staar:Reading:0': 55,
          'race:0': 45,
          // Hispanic is deliberately missing.
          'race:2': 55,
          'experience:0': 30,
          // 1 to 5 years is deliberately missing.
          'experience:2': 70,
          // The earlier enrollment year is deliberately missing.
          'public:enrollment:2025-26': 600,
        },
      },
    }
    window.fetch = vi.fn(async (url) => ({
      ok: Object.hasOwn(docs, String(url)),
      status: Object.hasOwn(docs, String(url)) ? 200 : 404,
      async json() { return docs[String(url)] },
    }))

    window.sessionStorage.setItem('txschools:pins', JSON.stringify([
      {
        id: '001902', name: 'Cayuga ISD', label: 'Cayuga ISD', level: 'district', isAlt: false,
        hue: 8, byYear: { '2024-25': 90, '2025-26': 92 },
      },
      {
        id: '101902', name: 'Katy ISD', label: 'Katy ISD', level: 'district', isAlt: false,
        hue: 265, byYear: { '2024-25': 84, '2025-26': 86 },
      },
    ]))

    window.eval(app)
    await until(
      () => window.document.querySelectorAll('.chip-cohort.chip-pin').length === 2,
      'the restored districts never became available as comparisons'
    )
    await until(
      () => window.document.querySelectorAll('.hbar-mark-pin[data-pin]').length === 6,
      'the restored districts never appeared automatically on the hbar charts'
    )

    const { document } = window
    // Adding a pin is additive: the selected cohort remains selected and its
    // server-rendered marks stay put while both pin overlays appear.
    expect(document.querySelector('[data-cohort="peer"]').getAttribute('aria-pressed')).toBe('true')
    expect([...document.querySelectorAll('.chip-cohort.chip-pin')].every((chip) => chip.getAttribute('aria-pressed') === 'false')).toBe(true)
    expect(document.querySelectorAll('.hbar-mark-peer')).toHaveLength(4)

    expect(pinMark(document, 'domain:achievement', '001902')?.dataset.value).toBe('92')
    expect(pinMark(document, 'domain:achievement', '001902')?.style.getPropertyValue('--m')).toBe('92')
    expect(pinMark(document, 'domain:achievement', '001902')?.style.getPropertyValue('--pin-hue')).toBe('8')
    expect(pinMark(document, 'domain:progress', '001902')).not.toBeNull()
    expect(pinMark(document, 'staar:Math:0', '001902')).not.toBeNull()
    expect(pinMark(document, 'staar:Reading:0', '001902')).not.toBeNull()
    expect(document.querySelector('.hbar[data-metric="staar:Math:0"] .hbar-pin-value[data-pin="001902"]')?.textContent).toContain('88%')
    expect(document.querySelector('#outcomes p.note')?.textContent).toContain('Additional dashed, pin-colored ticks')

    expect(pinMark(document, 'domain:achievement', '101902')?.dataset.value).toBe('66')
    expect(pinMark(document, 'domain:achievement', '101902')?.style.getPropertyValue('--pin-hue')).toBe('265')
    expect(pinMark(document, 'staar:Reading:0', '101902')).not.toBeNull()
    expect(pinMark(document, 'domain:progress', '101902')).toBeNull()
    expect(pinMark(document, 'staar:Math:0', '101902')).toBeNull()

    const compositionBlock = (kind, id) =>
      document.querySelector(`[data-pin-composition="${kind}"] .comparison-composition-pin[data-pin="${id}"]`)
    const cayugaRace = compositionBlock('race', '001902')
    const katyRace = compositionBlock('race', '101902')
    const cayugaExperience = compositionBlock('experience', '001902')
    const katyExperience = compositionBlock('experience', '101902')
    for (const block of [cayugaRace, katyRace, cayugaExperience, katyExperience]) expect(block).not.toBeNull()
    expect(cayugaRace.style.getPropertyValue('--pin-hue')).toBe('8')
    expect(cayugaRace.textContent).toContain('Cayuga ISD')
    expect(cayugaRace.querySelectorAll('.seg')).toHaveLength(3)
    expect(katyRace.style.getPropertyValue('--pin-hue')).toBe('265')
    expect(katyRace.textContent).toContain('Katy ISD')
    expect(katyRace.querySelectorAll('.seg')).toHaveLength(2)
    expect(katyRace.querySelector('.seg-2')).not.toBeNull()
    expect(katyRace.querySelector('.seg-1')).toBeNull()
    expect(katyRace.textContent).not.toContain('Hispanic')
    expect(cayugaExperience.querySelectorAll('.seg')).toHaveLength(3)
    expect(katyExperience.querySelectorAll('.seg')).toHaveLength(2)
    expect(katyExperience.textContent).not.toContain('1 to 5 years')

    const enrollmentPin = (year, id) =>
      document.querySelector(`[data-enrollment-year="${year}"] .enrollment-pin-row[data-pin="${id}"]`)
    expect(enrollmentPin('2024-25', '001902')?.textContent).toContain('1,100')
    expect(enrollmentPin('2025-26', '001902')?.textContent).toContain('1,200')
    expect(enrollmentPin('2025-26', '001902')?.style.getPropertyValue('--pin-hue')).toBe('8')
    expect(enrollmentPin('2024-25', '101902')).toBeNull()
    expect(enrollmentPin('2025-26', '101902')?.textContent).toContain('600')
    expect(enrollmentPin('2025-26', '101902')?.style.getPropertyValue('--pin-hue')).toBe('265')
    expect(document.querySelector('.enrollment-table thead th:nth-child(2)')?.textContent).toContain('This district and pinned comparisons')

    // Selecting one of the already-visible pins must not draw a duplicate tick.
    document.querySelector('[data-cohort="pin:101902"]').click()
    expect(document.querySelector('.hbar[data-metric="domain:achievement"] .hbar-mark-peer')?.hidden).toBe(true)
    expect(document.querySelectorAll('.hbar[data-metric="domain:achievement"] .hbar-mark-pin[data-pin="101902"]')).toHaveLength(1)
    document.querySelector('[data-cohort="peer"]').click()
    expect(document.querySelector('.hbar[data-metric="domain:achievement"] .hbar-mark-peer')?.hidden).toBe(false)

    document.querySelector('.pin[data-id="001902"] .pin-remove').click()
    expect(document.querySelectorAll('[data-pin="001902"]')).toHaveLength(0)
    expect(document.querySelectorAll('[data-pin="101902"]')).not.toHaveLength(0)
    expect(document.querySelectorAll('.hbar-mark-peer')).toHaveLength(4)

    document.querySelector('.pin[data-id="101902"] .pin-remove').click()
    expect(document.querySelectorAll('[data-pin]')).toHaveLength(0)
    expect(document.querySelectorAll('.comparison-composition-pin')).toHaveLength(0)
    expect(document.querySelectorAll('.enrollment-pin-row')).toHaveLength(0)
    expect(document.querySelectorAll('.hbar-mark-peer')).toHaveLength(4)
    expect(document.querySelector('.enrollment-table thead th:nth-child(2)')?.textContent).toContain('Test ISD')
    expect(window.sessionStorage.getItem('txschools:pins')).toBe('[]')
    const fetchedEntities = window.fetch.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.startsWith('/data/entity/'))
    expect(fetchedEntities).toEqual(['/data/entity/001902.json', '/data/entity/101902.json'])
    dom.window.close()
  })
})
