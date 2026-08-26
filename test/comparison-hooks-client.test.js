import { readFileSync } from 'node:fs'

import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'

const app = readFileSync(new URL('../site/app.js', import.meta.url), 'utf8')

describe('generic selected-comparison hooks', () => {
  it('keeps the entity trajectory and score axis fixed across standard cohort switches', () => {
    const cohorts = [
      { key: 'peer', short: 'peers', label: 'Peers', n: 10, metrics: { score: 75 }, metricN: { score: 10 } },
      { key: 'region', short: 'region', label: 'Region 20', n: 58, metrics: { score: 94 }, metricN: { score: 58 } },
      { key: 'county', short: 'county', label: 'Bexar County', n: 15, metrics: { score: 61 }, metricN: { score: 15 } },
      { key: 'size', short: 'size', label: 'Similar size', n: 110, metrics: { score: 72 }, metricN: { score: 110 } },
      { key: 'state', short: 'state', label: 'Texas average', n: 1019, metrics: { score: 85 }, metricN: { score: 1019 } },
    ]
    const dom = new JSDOM(`<!doctype html><html><body>
      <div class="cohort-bar">
        <button class="chip-cohort" data-cohort="peer" aria-pressed="true">Peer</button>
        <button class="chip-cohort" data-cohort="region" aria-pressed="false">Region</button>
        <button class="chip-cohort" data-cohort="county" aria-pressed="false">County</button>
        <button class="chip-cohort" data-cohort="size" aria-pressed="false">Size</button>
        <button class="chip-cohort" data-cohort="state" aria-pressed="false">State</button>
      </div>
      <section id="trajectory">
        <svg data-chart="trajectory" data-pad="22,22,28,36" data-w="640" data-h="320" data-lo="50" data-hi="100">
          <g class="bands"></g>
          <g class="lines"><path class="line line-peer"></path><path class="line line-state"></path><path class="line line-entity"></path></g>
          <g class="dots"></g>
        </svg>
        <script type="application/json" data-trajectory>${JSON.stringify({
          years: ['2024', '2025'],
          entity: { label: 'Test ISD', values: [80, 82] },
          comparisons: [
            { key: 'peer', label: 'Peers', values: [75, 76] },
            { key: 'region', label: 'Region 20', values: [92, 94] },
            { key: 'county', label: 'Bexar County', values: [61, 62] },
            { key: 'size', label: 'Similar size', values: [70, 72] },
            { key: 'state', label: 'Texas average', values: [85, 86] },
          ],
          defaults: ['peer', 'state'],
        })}</script>
      </section>
      <script type="application/json" data-cohorts>${JSON.stringify(cohorts)}</script>
      <script type="application/json" data-own>{"score":82}</script>
    </body></html>`, {
      url: 'https://txschools.net/district/test-isd-123456',
      runScripts: 'outside-only',
      pretendToBeVisual: true,
    })
    const { window } = dom
    window.matchMedia = vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
    window.eval(app)

    window.document.querySelector('[data-cohort="county"]').click()
    const entity = window.document.querySelector('.line-entity').getAttribute('d')
    const bands = window.document.querySelector('.bands').innerHTML
    for (const key of ['region', 'size', 'state', 'peer']) {
      window.document.querySelector(`[data-cohort="${key}"]`).click()
      expect(window.document.querySelector('.line-entity').getAttribute('d')).toBe(entity)
      expect(window.document.querySelector('.bands').innerHTML).toBe(bands)
    }
    dom.window.close()
  })

  it('updates supplemental readouts, table cells and precomputed cohort groups together', () => {
    const dom = new JSDOM(`<!doctype html><html><body>
      <div class="cohort-bar">
        <button class="chip-cohort" data-cohort="peer" aria-pressed="true">Peer</button>
        <button class="chip-cohort" data-cohort="county" aria-pressed="false">County</button>
        <button class="chip-cohort" data-cohort="state" aria-pressed="false">State</button>
        <button class="chip-cohort" data-cohort="pin:2" aria-pressed="false">Pin</button>
      </div>
      <p data-comparison-readout data-metric="public:enrollment:2025" data-format="count">
        <span class="comparison-readout-label">Average enrollment</span>
        <strong data-entity-value>123</strong>
        <strong data-compare-value>100</strong>
        <span><span data-compare-kind>average for</span> <span data-compare-label>Peers</span> · <span data-compare-n>8</span> reporting</span>
      </p>
      <table><tbody><tr><td data-comparison-cell data-metric="public:enrollment:2025" data-format="count">100</td></tr></tbody></table>
      <section data-comparison-cohort="peer">Peer editorial claims</section>
      <section data-comparison-cohort="county" hidden>County editorial claims</section>
      <section id="standouts"><div class="standout-buckets"><p>Stable all-cohort rankings</p></div></section>
      <script type="application/json" data-cohorts>${JSON.stringify([
        { key: 'peer', short: 'peers', label: 'Peers', n: 10, metrics: { 'public:enrollment:2025': 100 }, metricN: { 'public:enrollment:2025': 8 } },
        { key: 'county', short: 'county', label: 'Bexar County', n: 15, metrics: { 'public:enrollment:2025': 220.5 }, metricN: { 'public:enrollment:2025': 12 } },
        { key: 'state', short: 'state', label: 'Texas average', n: 1019, metrics: {}, metricN: {} },
        { key: 'pin:2', short: 'Other ISD', label: 'Other ISD', n: 1, single: true, metrics: { 'public:enrollment:2025': 321 }, metricN: {} },
      ])}</script>
      <script type="application/json" data-own>{"public:enrollment:2025":123}</script>
    </body></html>`, {
      url: 'https://txschools.net/district/test-isd-123456',
      runScripts: 'outside-only',
      pretendToBeVisual: true,
    })
    const { window } = dom
    window.matchMedia = vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
    window.eval(app)
    const stableStandouts = window.document.querySelector('#standouts').innerHTML

    window.document.querySelector('[data-cohort="county"]').click()
    const readout = window.document.querySelector('[data-comparison-readout]')
    const cell = window.document.querySelector('[data-comparison-cell]')
    expect(readout.querySelector('[data-entity-value]').textContent).toBe('123')
    expect(readout.querySelector('[data-compare-value]').textContent).toBe('220.5')
    expect(readout.querySelector('[data-compare-kind]').textContent).toBe('average for')
    expect(readout.querySelector('[data-compare-label]').textContent).toBe('Bexar County')
    expect(readout.querySelector('[data-compare-n]').textContent).toBe('12')
    expect(readout.querySelector('[data-compare-kind]').parentElement.textContent).toBe(
      'average for Bexar County · 12 rated districts reporting'
    )
    expect(cell.textContent).toBe('220.5')
    expect(window.document.querySelector('[data-comparison-cohort="peer"]').hidden).toBe(true)
    expect(window.document.querySelector('[data-comparison-cohort="county"]').hidden).toBe(false)
    expect(window.document.querySelector('#standouts').innerHTML).toBe(stableStandouts)
    expect(window.document.querySelector('#standouts').hidden).toBe(false)

    window.document.querySelector('[data-cohort="pin:2"]').click()
    expect(readout.querySelector('[data-entity-value]').textContent).toBe('123')
    expect(readout.querySelector('[data-compare-value]').textContent).toBe('321')
    expect(readout.querySelector('[data-compare-kind]').textContent).toBe('figure for')
    expect(readout.querySelector('[data-compare-label]').textContent).toBe('Other ISD')
    expect(readout.querySelector('[data-compare-n]')).toBeNull()
    expect(window.document.querySelector('[data-comparison-cohort="peer"]').hidden).toBe(true)
    expect(window.document.querySelector('[data-comparison-cohort="county"]').hidden).toBe(true)
    expect(window.document.querySelector('#standouts').innerHTML).toBe(stableStandouts)
    expect(window.document.querySelector('#standouts').hidden).toBe(false)

    window.document.querySelector('[data-cohort="state"]').click()
    expect(readout.querySelector('[data-entity-value]').textContent).toBe('123')
    expect(readout.hidden).toBe(true)
    expect(readout.style.display).toBe('none')
    expect(cell.textContent).toBe('—')
    expect(cell.classList.contains('na')).toBe(true)
    expect(window.document.querySelector('#standouts').innerHTML).toBe(stableStandouts)
    expect(window.document.querySelector('#standouts').hidden).toBe(false)
    dom.window.close()
  })

  it('uses grammatical, source-clear statewide wording in readouts, STAAR and CCMR', () => {
    const dom = new JSDOM(`<!doctype html><html><body>
      <div class="cohort-bar">
        <button class="chip-cohort" data-cohort="peer" aria-pressed="true">Peer</button>
        <button class="chip-cohort" data-cohort="state" aria-pressed="false">State</button>
      </div>
      <p data-comparison-readout data-metric="public:enrollment:2025" data-format="count">
        <span>Average enrollment</span><strong data-entity-value>123</strong><strong data-compare-value>100</strong>
        <span><span data-compare-kind>average for</span> <span data-compare-label>Peers</span> · <span data-compare-n>8</span> reporting</span>
      </p>
      <section id="outcomes">
        <div data-bars="staar">
          <div class="hbar" data-metric="staar:Math:0">
            <span class="hbar-track"><span class="hbar-mark hbar-mark-peer" data-mark="peer" data-value="50"></span></span>
            <span class="hbar-sub"><span class="hbar-delta">+10.0 vs peers</span></span>
          </div>
        </div>
        <ul class="legend"><li><span class="swatch swatch-peer"></span>Tick: Peers</li></ul>
        <p class="note">Percentage of tests at or above each level. The tick on each bar is the average for Peers.</p>
        <table class="data">
          <caption>CCMR criteria</caption>
          <thead><tr><th>Criterion</th><th>This district</th><th>Average<small>peers</small></th><th>Difference</th></tr></thead>
          <tbody>
            <tr><th>Ready</th><td>61%</td><td>50.0%</td><td>+11.0</td></tr>
            <tr><th>Industry credential</th><td>40%</td><td>—</td><td>—</td></tr>
          </tbody>
        </table>
        <p>Difference is this district minus <span data-ccmr-comparison>the average for</span> <strong data-ccmr-cohort>Peers</strong>.</p>
      </section>
      <section id="trajectory">
        <table class="data">
          <thead><tr><th>Year</th><th>Rating</th><th>Score</th><th>Similar</th><th>State</th></tr></thead>
          <tbody><tr><th>2025</th><td>B</td><td>80</td><td>70.0</td><td>75.0</td></tr></tbody>
        </table>
        <script type="application/json" data-trajectory>{"years":["2025"],"comparisons":[{"key":"peer","values":[70],"reportingNs":[9]},{"key":"state","values":[75],"reportingNs":[990]}]}</script>
      </section>
      <script type="application/json" data-cohorts>${JSON.stringify([
        {
          key: 'peer', short: 'peers', label: 'Peers', n: 10,
          metrics: { 'public:enrollment:2025': 100, 'staar:Math:0': 50, 'ccmr:0': 50 },
          metricN: { 'public:enrollment:2025': 8, 'staar:Math:0': 9, 'ccmr:0': 10 },
        },
        {
          key: 'state', short: 'state', label: 'Texas average', n: 1019,
          metrics: { 'public:enrollment:2025': 200, 'staar:Math:0': 55, 'ccmr:0': 56, 'ccmr:1': 42 },
          metricN: { 'public:enrollment:2025': 981, 'staar:Math:0': 990, 'ccmr:0': 995, 'ccmr:1': 940 },
        },
      ])}</script>
      <script type="application/json" data-own>{"public:enrollment:2025":123,"staar:Math:0":60,"ccmr:0":61,"ccmr:1":40}</script>
    </body></html>`, {
      url: 'https://txschools.net/district/test-isd-123456',
      runScripts: 'outside-only',
      pretendToBeVisual: true,
    })
    const { window } = dom
    window.matchMedia = vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
    window.eval(app)
    window.document.querySelector('[data-cohort="state"]').click()

    const readout = window.document.querySelector('[data-comparison-readout]')
    expect(readout.querySelector('[data-entity-value]').textContent).toBe('123')
    expect(readout.querySelector('[data-compare-kind]').textContent).toBe('statewide cohort average across')
    expect(readout.querySelector('[data-compare-label]').textContent).toBe('Texas')
    expect(readout.querySelector('[data-compare-n]').textContent).toBe('981')
    expect(readout.querySelector('[data-compare-kind]').parentElement.textContent).toBe(
      'statewide cohort average across Texas · 981 rated districts reporting'
    )

    const staarNote = window.document.querySelector('#outcomes p.note').textContent
    expect(staarNote).toContain('The tick on each bar is the statewide cohort average across Texas.')
    expect(staarNote).toContain('This comparison is not published by TEA.')
    expect(window.document.querySelector('[data-ccmr-comparison]').textContent).toBe('the statewide cohort average across')
    expect(window.document.querySelector('[data-ccmr-cohort]').textContent).toBe('Texas')
    expect(window.document.querySelector('table.data thead th:nth-child(3)').textContent).toBe('Statewide averageTexas cohort')
    const ccmrRows = window.document.querySelectorAll('table.data tbody tr')
    expect(ccmrRows[1].querySelectorAll('td')[1].textContent).toBe('42.0%')
    expect(ccmrRows[1].querySelectorAll('td')[2].textContent).toBe('−2.0')
    const trajectoryHeads = window.document.querySelectorAll('#trajectory thead th')
    const trajectoryCells = window.document.querySelectorAll('#trajectory tbody td')
    expect(trajectoryHeads[3].textContent).toBe('Texas average')
    expect(trajectoryHeads[4].hidden).toBe(true)
    expect(trajectoryCells[2].textContent).toBe('75.0 990 reporting')
    expect(trajectoryCells[3].hidden).toBe(true)
    expect(window.document.body.textContent).not.toContain('average for Texas average')
    dom.window.close()
  })

  it('uses precomputed hero prose for server cohorts and a fallback clause only for runtime pins', () => {
    const dom = new JSDOM(`<!doctype html><html><body>
      <div class="cohort-bar">
        <button class="chip-cohort" data-cohort="peer" aria-pressed="true">Peer</button>
        <button class="chip-cohort" data-cohort="county" aria-pressed="false">County</button>
        <button class="chip-cohort chip-pin" data-cohort="pin:2" aria-pressed="false">Other ISD</button>
      </div>
      <section class="hero"><p class="summary">
        <span data-comparison-cohort="peer">Precomputed peer comparison.</span>
        <span data-comparison-cohort="county" hidden>Precomputed county comparison.</span>
      </p></section>
      <p data-comparison-pin-unavailable hidden>Precomputed cohort evidence is unavailable for <span data-comparison-pin-label></span>.</p>
      <script type="application/json" data-cohorts>${JSON.stringify([
        { key: 'peer', short: 'peers', label: 'Peers', n: 10, metrics: { score: 70 }, metricN: { score: 10 } },
        { key: 'county', short: 'county', label: 'Bexar County', n: 15, metrics: { score: 72 }, metricN: { score: 15 } },
        { key: 'pin:2', short: 'Other ISD', label: 'Other ISD', n: 1, single: true, metrics: { score: 75 }, metricN: {} },
      ])}</script>
      <script type="application/json" data-own>{"score":80}</script>
    </body></html>`, {
      url: 'https://txschools.net/district/test-isd-123456',
      runScripts: 'outside-only',
      pretendToBeVisual: true,
    })
    const { window } = dom
    window.matchMedia = vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
    window.eval(app)

    window.document.querySelector('[data-cohort="county"]').click()
    expect(window.document.querySelector('[data-comparison-cohort="county"]').hidden).toBe(false)
    expect(window.document.querySelector('[data-cohort-clause]')).toBeNull()
    expect(window.document.querySelector('[data-comparison-pin-unavailable]').hidden).toBe(true)

    window.document.querySelector('[data-cohort="pin:2"]').click()
    expect(window.document.querySelectorAll('[data-comparison-cohort]:not([hidden])')).toHaveLength(0)
    expect(window.document.querySelector('[data-cohort-clause]').textContent).toBe('+5.0 points against Other ISD.')
    expect(window.document.querySelector('[data-comparison-pin-unavailable]').hidden).toBe(false)
    expect(window.document.querySelector('[data-comparison-pin-label]').textContent).toBe('Other ISD')

    window.document.querySelector('[data-cohort="peer"]').click()
    expect(window.document.querySelector('[data-cohort-clause]')).toBeNull()
    expect(window.document.querySelector('[data-comparison-pin-unavailable]').hidden).toBe(true)
    dom.window.close()
  })

  it('moves a distinct spending cohort series while retaining both fixed TEA references', () => {
    const cohorts = [
      {
        key: 'peer', short: 'peers', label: 'Peers', n: 10,
        metrics: { 'public:spending:2024': 9_000, 'public:spending:2025': 10_000 }, metricN: {},
      },
      {
        key: 'region', short: 'region', label: 'Region 20', n: 58,
        metrics: { 'public:spending:2024': 8_000, 'public:spending:2025': 9_000 }, metricN: {},
      },
      {
        key: 'county', short: 'county', label: 'Bexar County', n: 15,
        metrics: { 'public:spending:2024': 14_000, 'public:spending:2025': 15_000 }, metricN: {},
      },
      {
        key: 'size', short: 'size', label: 'Similar size', n: 110,
        metrics: { 'public:spending:2024': 16_000, 'public:spending:2025': 17_000 }, metricN: {},
      },
      {
        key: 'state', short: 'state', label: 'Texas average', n: 1019,
        metrics: { 'public:spending:2024': 12_500, 'public:spending:2025': 13_500 },
        metricN: { 'public:spending:2024': 990, 'public:spending:2025': 981 },
      },
      { key: 'pin:2', short: 'Sample HS', label: 'Sample HS', n: 1, single: true, level: 'school', metrics: {}, metricN: {} },
    ]
    const dom = new JSDOM(`<!doctype html><html><body>
      <div class="cohort-bar">
        <button class="chip-cohort" data-cohort="peer" aria-pressed="true">Peer</button>
        <button class="chip-cohort" data-cohort="region" aria-pressed="false">Region</button>
        <button class="chip-cohort" data-cohort="county" aria-pressed="false">County</button>
        <button class="chip-cohort" data-cohort="size" aria-pressed="false">Size</button>
        <button class="chip-cohort" data-cohort="state" aria-pressed="false">State</button>
        <button class="chip-cohort chip-pin" data-cohort="pin:2" aria-pressed="false">Sample HS</button>
      </div>
      <section id="spending">
        <svg class="chart-cmp"><g class="cmp-grid"></g><g class="cmp-lines"></g></svg>
        <ul class="legend">
          <li><span class="swatch swatch-entity"></span>Test ISD</li>
          <li><span class="swatch swatch-selected"></span>Selected comparison: Peers</li>
          <li><span class="swatch swatch-tea"></span>TEA peer group</li>
          <li><span class="swatch swatch-state"></span>Texas average</li>
        </ul>
        <script type="application/json" data-spending>${JSON.stringify({
          years: ['2024', '2025'],
          series: [
            { key: 'entity', label: 'Test ISD', values: [11_000, 12_000] },
            { key: 'tea', label: 'TEA peer group', values: [10_500, 11_500] },
            { key: 'state', label: 'Texas average', values: [12_000, 13_000] },
          ],
          cohortMetricKeys: ['public:spending:2024', 'public:spending:2025'],
          selected: { key: 'selected', label: 'Selected comparison: Peers', values: [9_000, 10_000] },
          domain: { lo: 7_200, hi: 17_850 },
        })}</script>
      </section>
      <script type="application/json" data-cohorts>${JSON.stringify(cohorts)}</script>
      <script type="application/json" data-own>{}</script>
    </body></html>`, {
      url: 'https://txschools.net/district/test-isd-123456',
      runScripts: 'outside-only',
      pretendToBeVisual: true,
    })
    const { window } = dom
    window.matchMedia = vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
    window.eval(app)

    const first = window.document.querySelector('.line-selected').getAttribute('d')
    const entity = window.document.querySelector('.line-entity').getAttribute('d')
    const grid = window.document.querySelector('.cmp-grid').innerHTML
    expect(window.document.querySelectorAll('#spending .swatch-selected')).toHaveLength(1)
    expect(window.document.querySelector('[data-spend-comparison]').textContent).toContain('Selected comparison: Peers')

    window.document.querySelector('[data-cohort="county"]').click()
    expect(window.document.querySelector('.line-selected').getAttribute('d')).not.toBe(first)
    expect(window.document.querySelector('.line-entity').getAttribute('d')).toBe(entity)
    expect(window.document.querySelector('.cmp-grid').innerHTML).toBe(grid)
    expect(window.document.querySelector('[data-spend-comparison]').textContent).toContain('Selected comparison: Bexar County')
    expect(window.document.querySelector('.line-tea')).not.toBeNull()
    expect(window.document.querySelector('.line-state')).not.toBeNull()

    for (const key of ['region', 'size']) {
      window.document.querySelector(`[data-cohort="${key}"]`).click()
      expect(window.document.querySelector('.line-entity').getAttribute('d')).toBe(entity)
      expect(window.document.querySelector('.cmp-grid').innerHTML).toBe(grid)
    }

    // The selected statewide cohort and TEA's fixed statewide reference are
    // separate lines even though both legitimately contain "state" context.
    window.document.querySelector('[data-cohort="state"]').click()
    expect(window.document.querySelector('.line-entity').getAttribute('d')).toBe(entity)
    expect(window.document.querySelector('.cmp-grid').innerHTML).toBe(grid)
    expect(window.document.querySelector('.line-selected')).not.toBeNull()
    expect(window.document.querySelector('.line-state')).not.toBeNull()
    expect(window.document.querySelector('[data-spend-comparison]').textContent).toBe(
      'Selected comparison: txschools.net statewide cohort average (981 Texas districts reporting for 2025)'
    )
    expect(window.document.querySelector('.swatch-state').parentElement.textContent).toBe('Texas average')
    expect(window.document.body.textContent).not.toContain('average for Texas average')

    window.document.querySelector('[data-cohort="pin:2"]').click()
    const unavailable = window.document.querySelector('[data-spend-unavailable]')
    expect(unavailable.hidden).toBe(false)
    expect(unavailable.textContent).toBe(
      'Selected comparison: Sample HS. A campus spending history is not available through the comparison picker, so no comparison line can be shown here.'
    )
    expect(window.document.querySelector('[data-spend-comparison]').hidden).toBe(true)
    expect(window.document.querySelector('.line-tea')).not.toBeNull()
    expect(window.document.querySelector('.line-state')).not.toBeNull()
    dom.window.close()
  })
})
