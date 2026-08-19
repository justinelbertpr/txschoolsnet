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
  it('adds a campus value and mark to matching bars, then removes both', async () => {
    const dom = new JSDOM(`<!doctype html><html><body>
      <aside class="rail-pins">
        <h2 class="rail-title">Pin comparisons</h2>
        <p class="rail-hint">Compare matching measures.</p>
        <input class="pin-search">
        <ul class="pin-results" hidden></ul>
        <ul class="pin-list" aria-label="Pinned comparisons"></ul>
        <script type="application/json" data-pin-source>{"payload":"/data/payload-test.json"}</script>
      </aside>
      <div class="trajectory">
        <svg data-chart="trajectory" data-pad="10,10,10,10" data-w="100" data-h="80" data-lo="0" data-hi="100">
          <g class="bands"></g><g class="lines"><path class="line line-entity"></path></g><g class="dots"></g>
        </svg>
        <script type="application/json" data-trajectory>{"years":["2025-26"],"defaults":[],"entity":{"label":"Test ISD","values":[80]},"comparisons":[]}</script>
      </div>
      <ul class="hbars" data-bars="domain">
        <li class="hbar" data-metric="domain:achievement" data-value="80">
          <span class="hbar-label">Student Achievement</span>
          <span class="hbar-track" aria-hidden="true"><span class="hbar-fill"></span></span>
          <span class="hbar-value">80</span>
        </li>
        <li class="hbar" data-metric="domain:progress" data-value="75">
          <span class="hbar-label">School Progress</span>
          <span class="hbar-track" aria-hidden="true"><span class="hbar-fill"></span></span>
          <span class="hbar-value">75</span>
        </li>
      </ul>
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
            entities: { '001902001': { 'domain:achievement': 92 } },
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
      () => window.document.querySelector('.hbar-mark-pin'),
      'the restored campus pin never reached the current-measure bar'
    )

    const [row, missingRow] = window.document.querySelectorAll('.hbar')
    expect(row.querySelector('.hbar-mark-pin')?.style.getPropertyValue('--m')).toBe('92')
    expect(row.querySelector('.hbar-pin-sub')?.textContent).toContain('Cayuga HS (Cayuga ISD): 92')
    expect(missingRow.querySelector('.hbar-mark-pin')).toBeNull()
    expect(missingRow.querySelector('.hbar-pin-sub')?.textContent).toContain('Cayuga HS (Cayuga ISD): not reported')
    expect(window.fetch).toHaveBeenCalledTimes(1)

    row.ownerDocument.querySelector('.pin-remove').click()
    expect(row.querySelector('.hbar-mark-pin')).toBeNull()
    expect(row.querySelector('.hbar-pin-sub')).toBeNull()
    expect(missingRow.querySelector('.hbar-pin-sub')).toBeNull()
    expect(window.sessionStorage.getItem('txschools:pins')).toBe('[]')
    dom.window.close()
  })
})
