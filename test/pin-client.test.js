import { readFileSync } from 'node:fs'

import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'

const app = readFileSync(new URL('../site/app.js', import.meta.url), 'utf8')

const until = async (test, message) => {
  for (let i = 0; i < 30; i += 1) {
    if (test()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(message)
}

describe('pinned current-measure comparisons', () => {
  it('turns a restored campus into a selectable page-wide comparison, then removes it cleanly', async () => {
    const dom = new JSDOM(`<!doctype html><html><body>
      <aside class="rail-pins">
        <h2 class="rail-title">Pin to compare</h2>
        <p class="rail-hint">Compare matching measures.</p>
        <input class="pin-search">
        <ul class="pin-results" hidden></ul>
        <ul class="pin-list" aria-label="Pinned schools and districts"></ul>
        <script type="application/json" data-pin-source>{"payload":"/data/payload-test.json"}</script>
      </aside>
      <div class="cohort-bar">
        <button class="chip chip-cohort" data-cohort="peer" aria-pressed="true">Similar districts</button>
      </div>
      <div class="trajectory">
        <svg data-chart="trajectory" data-pad="10,10,10,10" data-w="100" data-h="80" data-lo="0" data-hi="100">
          <g class="bands"></g><g class="lines"><path class="line line-entity"></path></g><g class="dots"></g>
        </svg>
        <script type="application/json" data-trajectory>{"years":["2025-26"],"defaults":[],"entity":{"label":"Test ISD","values":[80]},"comparisons":[]}</script>
      </div>
      <ul class="hbars" data-bars="domain">
        <li class="hbar" data-metric="domain:achievement" data-value="80">
          <span class="hbar-label">Student Achievement</span>
          <span class="hbar-track" aria-hidden="true"><span class="hbar-fill"></span><span class="hbar-mark hbar-mark-peer" data-mark="peer" data-value="70" style="--m:70"></span></span>
          <span class="hbar-value">80</span>
          <span class="hbar-sub"><span class="hbar-delta" data-delta="peer">+10.0 vs similar districts</span></span>
        </li>
        <li class="hbar" data-metric="domain:progress" data-value="75">
          <span class="hbar-label">School Progress</span>
          <span class="hbar-track" aria-hidden="true"><span class="hbar-fill"></span><span class="hbar-mark hbar-mark-peer" data-mark="peer" data-value="74" style="--m:74"></span></span>
          <span class="hbar-value">75</span>
          <span class="hbar-sub"><span class="hbar-delta" data-delta="peer">+1.0 vs similar districts</span></span>
        </li>
      </ul>
      <table class="data"><caption>CCMR criteria</caption>
        <thead><tr><th>Criterion</th><th>This district</th><th>Average<small>similar districts</small></th><th>Difference</th></tr></thead>
        <tbody><tr><th>Ready</th><td>61%</td><td>50.0%</td><td>+11.0</td></tr></tbody>
      </table>
      <p>Difference is this district minus <span data-ccmr-comparison>the average for</span> <strong data-ccmr-cohort>Similar districts</strong>.</p>
      <script type="application/json" data-cohorts>[{"key":"peer","short":"similar districts","label":"Similar districts","n":20,"metrics":{"domain:achievement":70,"domain:progress":74,"ccmr:0":50},"metricN":{"domain:achievement":20,"domain:progress":20,"ccmr:0":20}}]</script>
      <script type="application/json" data-own>{"domain:achievement":80,"domain:progress":75,"ccmr:0":61}</script>
    </body></html>`, {
      url: 'https://txschools.net/district/test-isd-123456',
      runScripts: 'outside-only',
      pretendToBeVisual: true,
    })
    const { window } = dom
    window.matchMedia = vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
    window.fetch = vi.fn(async (url) => {
      expect(String(url)).toBe('/data/pins/001902.json')
      return {
        ok: true,
        async json() {
          return {
            version: 1,
            districtId: '001902',
            entities: { '001902001': { 'domain:achievement': 92, 'ccmr:0': 55 } },
          }
        },
      }
    })
    window.sessionStorage.setItem('txschools:pins', JSON.stringify([{
      id: '001902001',
      name: 'Cayuga HS',
      label: 'Cayuga HS (Cayuga ISD)',
      level: 'campus',
      hue: 8,
      byYear: { '2025-26': 98 },
    }]))

    window.eval(app)
    await until(
      () => window.document.querySelector('.chip-cohort.chip-pin[data-cohort="pin:001902001"]'),
      'the restored campus pin never became a page-wide comparison'
    )

    const [row, missingRow] = window.document.querySelectorAll('.hbar')
    const campusChip = window.document.querySelector('.chip-cohort.chip-pin[data-cohort="pin:001902001"]')
    campusChip.click()

    expect(campusChip.getAttribute('aria-pressed')).toBe('true')
    expect(row.querySelector('.hbar-mark')?.dataset.mark).toBe('pin:001902001')
    expect(row.querySelector('.hbar-mark')?.classList.contains('hbar-mark-pin')).toBe(true)
    expect(row.querySelector('.hbar-mark')?.style.getPropertyValue('--pin-hue')).toBe('8')
    expect(row.querySelector('.hbar-mark')?.style.getPropertyValue('--m')).toBe('92')
    expect(row.querySelector('.hbar-sub')?.textContent).toContain('−12.0 vs Cayuga HS (Cayuga ISD)')
    expect(missingRow.querySelector('.hbar-mark')?.hidden).toBe(true)
    expect(window.document.querySelector('.cohort-status')?.textContent).toBe(
      'Every comparison on this page is now against Cayuga HS (Cayuga ISD).'
    )
    expect(window.document.querySelector('table.data thead th:nth-child(3)')?.textContent).toContain('Pinned school')
    expect(window.document.querySelector('[data-ccmr-comparison]')?.textContent).toBe('the figure for')
    expect(window.fetch).toHaveBeenCalledTimes(1)

    row.ownerDocument.querySelector('.pin-remove').click()
    expect(window.document.querySelector('.chip-cohort.chip-pin')).toBeNull()
    expect(row.querySelector('.hbar-mark')?.dataset.mark).toBe('peer')
    expect(row.querySelector('.hbar-mark')?.style.getPropertyValue('--m')).toBe('70')
    expect(missingRow.querySelector('.hbar-mark')?.hidden).toBe(false)
    expect(window.document.querySelector('table.data thead th:nth-child(3)')?.textContent).toContain('Average')
    expect(window.document.querySelector('[data-ccmr-comparison]')?.textContent).toBe('the average for')
    expect(window.sessionStorage.getItem('txschools:pins')).toBe('[]')
    dom.window.close()
  })
})
