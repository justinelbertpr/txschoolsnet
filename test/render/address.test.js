import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'

import {
  ADDRESS_INDEX_PATH,
  ADDRESS_MAX_LENGTH,
  CENSUS_GEOCODER_PATH,
  addressClientJs,
  buildDistrictLocator,
  districtLocatorJson,
  renderAddressLookup,
} from '../../src/render/address.js'
import { TRUSTED_TYPES_INIT_SCRIPT } from '../../src/render/shell.js'

const topo = {
  txschools: {
    teaToGeoid: {
      '057905': '4816230',
      '227901': '4808940',
    },
  },
}

const districts = [
  { id: '057905', level: 'district', name: 'Dallas ISD', county: 'Dallas', website: 'www.dallasisd.org' },
  { id: '227901', level: 'district', name: 'Austin ISD', county: 'Travis', website: 'javascript:alert(1)' },
  { id: '999999', level: 'district', name: 'No Bridge ISD', county: 'Nowhere' },
]

describe('district address index', () => {
  it('uses the map archive’s TEA-to-Census bridge and local profile URLs', () => {
    const index = buildDistrictLocator({ topo, districts })
    expect(index.count).toBe(2)
    expect(index.districts['4816230']).toEqual([
      'Dallas ISD',
      '/district/dallas-isd-057905',
      'Dallas',
      'https://www.dallasisd.org/',
    ])
    expect(index.districts['4808940']).toEqual([
      'Austin ISD',
      '/district/austin-isd-227901',
      'Travis',
    ])
    expect(JSON.stringify(index)).not.toContain('No Bridge ISD')
  })

  it('round-trips as a compact JSON object and survives a missing archive', () => {
    expect(JSON.parse(districtLocatorJson({ topo, districts })).count).toBe(2)
    expect(buildDistrictLocator({ districts }).districts).toEqual({})
  })

  it('fails rather than silently choosing when a GEOID is duplicated', () => {
    expect(() => buildDistrictLocator({
      topo: { txschools: { teaToGeoid: { '1': '48x', '2': '48x' } } },
      districts: [{ id: '1', name: 'One' }, { id: '2', name: 'Two' }],
    })).toThrow(/more than one published district/)
  })
})

describe('address lookup control', () => {
  const html = renderAddressLookup({ id: 'home-address' })

  it('is immediately discoverable beside search and explicitly discloses the address recipient', () => {
    expect(html).toContain('Find my district by address')
    expect(html).toContain('Texas home address')
    expect(html).toContain('Sent directly to the')
    expect(html).toContain('only when you press Find; txschools.net does not save it.')
    expect(html).toContain('https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html')
  })

  it('cannot put a raw address in txschools.net’s URL when JavaScript is missing', () => {
    expect(html).toContain('method="get" action="/search"')
    const input = html.match(/<input class="addressfind-input"[\s\S]*?>/)[0]
    expect(input).not.toMatch(/\bname=/)
    expect(input).toContain(`maxlength="${ADDRESS_MAX_LENGTH}"`)
    expect(html).toContain('Address matching needs JavaScript')
  })

  it('names the stable same-origin mapping file without inlining district records', () => {
    expect(html).toContain(`data-address-index="${ADDRESS_INDEX_PATH}"`)
    expect(html).toContain(`data-address-geocoder="${CENSUS_GEOCODER_PATH}"`)
    expect(html).not.toContain('Dallas ISD')
  })

  it('escapes caller-controlled ids and URLs', () => {
    const nasty = renderAddressLookup({ id: '"><script>x</script>', indexUrl: '"><img src=x>' })
    expect(nasty).not.toContain('"><script>x')
    expect(nasty).not.toContain('"><img src=x>')
  })
})

const censusPayload = (over = {}) => ({
  result: {
    addressMatches: [{
      addressComponents: { state: 'TX' },
      geographies: {
        'Unified School Districts': [{ GEOID: '4808940', NAME: 'Austin Independent School District' }],
      },
      ...over,
    }],
  },
})

function clientHarness({ index = null } = {}) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${renderAddressLookup({ assets: false })}</body></html>`, {
    url: 'https://txschools.net/',
    runScripts: 'outside-only',
  })
  const { window } = dom
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
  window.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => index ?? {
      v: 1,
      districts: {
        '4808940': ['<Austin & Friends> ISD', '/district/austin-isd-227901', 'Travis', 'https://www.austinisd.org/'],
      },
    },
  })
  const appended = []
  const append = window.document.head.appendChild.bind(window.document.head)
  window.document.head.appendChild = (node) => {
    appended.push(node)
    return append(node)
  }
  window.eval(addressClientJs())
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'))
  const form = window.document.querySelector('[data-address-form]')
  const input = window.document.querySelector('.addressfind-input')
  const submit = (value = '1100 Congress Ave, Austin, TX 78701') => {
    input.value = value
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
  }
  return { dom, window, form, input, appended, submit }
}

const flush = async () => {
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('address browser client', () => {
  const js = addressClientJs()

  it('uses the documented Census JSONP parameters and never writes address state locally', () => {
    expect(js).toContain("'Public_AR_Current'")
    expect(js).toContain("'Current_Current'")
    expect(js).toContain("'Unified School Districts'")
    expect(js).toContain("'jsonp'")
    expect(js).toContain("script.referrerPolicy = 'no-referrer'")
    expect(js).not.toMatch(/localStorage|sessionStorage|history\.|gtag\(/)
    expect(js).not.toContain('innerHTML')
    expect(() => new Function(js)).not.toThrow()
  })

  it('sends only the submitted address to Census, then renders the local match as text', async () => {
    const h = clientHarness()
    const before = h.window.location.href
    h.submit()
    expect(h.input.disabled).toBe(true)
    expect(h.appended).toHaveLength(1)
    const request = new URL(h.appended[0].src)
    expect(request.origin + request.pathname).toBe(CENSUS_GEOCODER_PATH)
    expect(request.searchParams.get('address')).toBe('1100 Congress Ave, Austin, TX 78701')
    expect(request.searchParams.get('benchmark')).toBe('Public_AR_Current')
    expect(request.searchParams.get('vintage')).toBe('Current_Current')
    expect(request.searchParams.get('layers')).toBe('Unified School Districts')
    expect(request.searchParams.get('format')).toBe('jsonp')
    expect(request.searchParams.get('callback')).toMatch(/^__txschoolsAddress\d+_\d+$/)

    const callback = request.searchParams.get('callback')
    h.window[callback](censusPayload())
    await flush()

    expect(h.window.location.href).toBe(before)
    expect(h.window.fetch).toHaveBeenCalledWith(ADDRESS_INDEX_PATH, { credentials: 'omit' })
    expect(h.window[callback]).toBeUndefined()
    expect(h.window.document.head.contains(h.appended[0])).toBe(false)
    expect(h.input.disabled).toBe(false)
    const result = h.window.document.querySelector('.addressfind-result')
    expect(result.hidden).toBe(false)
    expect(result.textContent).toContain('<Austin & Friends> ISD')
    expect(result.querySelector('img')).toBeNull()
    expect(result.textContent).toContain('official district site')
    expect(result.textContent).toContain('Confirm this address with the district')
    expect(result.querySelector('a[href^="https://tea.texas.gov/"]')).not.toBeNull()
  })

  it('rejects a non-Texas response without fetching the local district index', () => {
    const h = clientHarness()
    h.submit('1600 Pennsylvania Ave, Washington, DC 20500')
    const request = new URL(h.appended[0].src)
    const callback = request.searchParams.get('callback')
    h.window[callback](censusPayload({ addressComponents: { state: 'DC' } }))
    expect(h.input.disabled).toBe(false)
    expect(h.window.fetch).not.toHaveBeenCalled()
    expect(h.window.document.querySelector('.addressfind-status').textContent).toContain('No Texas district matched')
  })

  it('cleans up and restores the form on JSONP error and timeout', () => {
    const error = clientHarness()
    error.submit()
    const errorRequest = new URL(error.appended[0].src)
    const errorCallback = errorRequest.searchParams.get('callback')
    error.appended[0].onerror()
    expect(error.input.disabled).toBe(false)
    expect(error.window[errorCallback]).toBeUndefined()
    expect(error.window.document.querySelector('.addressfind-status').textContent).toContain('could not be reached')

    const timeout = clientHarness()
    let timeoutFn = null
    timeout.window.setTimeout = (fn) => { timeoutFn = fn; return 7 }
    timeout.window.clearTimeout = vi.fn()
    timeout.submit()
    const timeoutRequest = new URL(timeout.appended[0].src)
    const timeoutCallback = timeoutRequest.searchParams.get('callback')
    timeoutFn()
    expect(timeout.input.disabled).toBe(false)
    expect(timeout.window[timeoutCallback]).toBeUndefined()
    expect(timeout.window.document.querySelector('.addressfind-status').textContent).toContain('too long')
  })
})

describe('address lookup security contract', () => {
  const headers = readFileSync('site/_headers', 'utf8')
  const csp = headers.match(/Content-Security-Policy: (.*)/)[1]

  it('allows only the exact Census geographies endpoint and keeps form submissions same-origin', () => {
    expect(csp).toContain(`script-src 'self'`)
    expect(csp).toContain(CENSUS_GEOCODER_PATH)
    expect(csp).toMatch(/form-action 'self'/)
    expect(csp).not.toMatch(/form-action[^;]*census\.gov/)
  })

  it('constrains the Trusted Types exception to the endpoint and fixed JSONP contract', () => {
    for (const part of [
      "x.origin==='https://geocoding.geo.census.gov'",
      "x.pathname==='/geocoder/geographies/onelineaddress'",
      "x.searchParams.get('format')==='jsonp'",
      "x.searchParams.get('benchmark')==='Public_AR_Current'",
      "x.searchParams.get('vintage')==='Current_Current'",
      "x.searchParams.get('layers')==='Unified School Districts'",
      'x.searchParams.getAll(k[j]).length!==1',
      'n===k.length',
      'q.length>0&&q.length<=100',
      '/^__txschoolsAddress\\d+_\\d+$/',
    ]) expect(TRUSTED_TYPES_INIT_SCRIPT).toContain(part)
  })

  it('carries the updated inline policy hash', () => {
    const hash = `sha256-${createHash('sha256').update(TRUSTED_TYPES_INIT_SCRIPT).digest('base64')}`
    expect(headers).toContain(hash)
  })

  it('caches the stable mapping briefly, never immutably', () => {
    expect(headers).toMatch(/\/data\/district-locator\.json\n  Cache-Control: public, max-age=3600/)
    const rule = headers.match(/\/data\/district-locator\.json([\s\S]*?)(?=\n\/|\n# -)/)?.[1] ?? ''
    expect(rule).not.toContain('immutable')
  })
})
