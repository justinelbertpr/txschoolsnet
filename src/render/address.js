// Address-to-district lookup for the two places where a family is already
// searching: the homepage hero and /search.
//
// The site stays assets-only. After an explicit submit, the browser sends the
// address directly to the U.S. Census Bureau's public geocoder. Census returns
// a Unified School District GEOID; a small same-origin file then maps that GEOID
// to the TEA district page already published here. The address never enters a
// txschools.net URL, analytics call, cookie, localStorage or sessionStorage.
//
// Census documents that its geocoder does not support CORS and recommends JSONP
// for browser clients, so the client uses one short-lived, fixed-origin script
// request and removes its callback and element on success, error or timeout:
// https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html

import { esc } from './shell.js'
import { entitySlug } from './view-model.js'
import { officialWebsiteHref } from './sections.js'

export const ADDRESS_INDEX_PATH = '/data/district-locator.json'
export const ADDRESS_SCRIPT_PATH = '/address.js'
export const CENSUS_GEOCODER_ORIGIN = 'https://geocoding.geo.census.gov'
export const CENSUS_GEOCODER_PATH = `${CENSUS_GEOCODER_ORIGIN}/geocoder/geographies/onelineaddress`
export const ADDRESS_MAX_LENGTH = 100

/**
 * Build the local half of the lookup from the same archived TEA-to-GEOID bridge
 * the map uses. Geometry and identifiers therefore refresh together; there is
 * no second hand-maintained district-name join to drift.
 *
 * Records are arrays to keep the lazy file small:
 *   GEOID: [district name, profile href, county, official website?]
 */
export function buildDistrictLocator({ topo = null, districts = [] } = {}) {
  const bridge = topo?.txschools?.teaToGeoid ?? {}
  const rows = {}

  for (const district of [...(districts ?? [])].sort((a, b) => String(a?.id).localeCompare(String(b?.id)))) {
    if (!district?.id || !district.name) continue
    const geoid = bridge[String(district.id)]
    if (!geoid) continue
    if (rows[geoid]) throw new Error(`district locator: GEOID ${geoid} maps to more than one published district`)

    const official = officialWebsiteHref(district.website)
    const record = [
      String(district.name),
      `/district/${district.slug || entitySlug(district)}`,
      district.county ? String(district.county).replace(/ County$/i, '') : null,
    ]
    if (official) record.push(official)
    rows[String(geoid)] = record
  }

  return { v: 1, count: Object.keys(rows).length, districts: rows }
}

export const districtLocatorJson = (args) => JSON.stringify(buildDistrictLocator(args))

/** One immediately discoverable disclosure; it expands into a separate form. */
export function renderAddressLookup({
  id = 'district-address',
  indexUrl = ADDRESS_INDEX_PATH,
  open = false,
  assets = true,
} = {}) {
  const root = `${id}-lookup`
  const hint = `${id}-privacy`
  const status = `${id}-status`
  const result = `${id}-result`

  const markup = `<div class="addressfind" id="${esc(root)}" data-address-lookup data-address-index="${esc(indexUrl)}"
  data-address-geocoder="${esc(CENSUS_GEOCODER_PATH)}">
  <details class="addressfind-details"${open ? ' open' : ''}>
    <summary><span>Find my district by address</span><small>Use a Texas home address</small></summary>
    <div class="addressfind-body">
      <form class="addressfind-form" method="get" action="/search" data-address-form>
        <label class="addressfind-label" for="${esc(id)}">Texas home address</label>
        <div class="addressfind-row">
          <input class="addressfind-input" id="${esc(id)}" type="text" maxlength="${ADDRESS_MAX_LENGTH}"
            placeholder="Street address, city, TX ZIP" autocomplete="street-address"
            enterkeyhint="search" aria-describedby="${esc(hint)} ${esc(status)}">
          <button class="addressfind-go" type="submit">Find my district</button>
        </div>
        <p class="addressfind-privacy" id="${esc(hint)}">Sent directly to the
          <a href="https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html" rel="external nofollow noreferrer">U.S. Census Bureau</a>
          only when you press Find; txschools.net does not save it.</p>
        <p class="addressfind-status" id="${esc(status)}" role="status" aria-live="polite"></p>
        <div class="addressfind-result" id="${esc(result)}" tabindex="-1" hidden role="region" aria-label="Address lookup result"></div>
        <noscript><p class="addressfind-noscript">Address matching needs JavaScript. You can instead use the
          <a href="https://geocoding.geo.census.gov/geocoder/geographies/address" rel="external nofollow noreferrer">Census address finder</a>,
          then search this site for the district name it returns.</p></noscript>
      </form>
    </div>
  </details>
</div>`

  return assets ? `${markup}\n<style data-address-style>${ADDRESS_CSS}</style>` : markup
}

// Tokens only. In the homepage's dark hero the expanded form becomes a small
// light work surface; on /search the same tokens make it a quiet nested card.
export const ADDRESS_CSS = `
.addressfind{margin:.75rem 0 0;border-top:1px solid var(--line)}
.addressfind-details>summary{display:flex;align-items:center;gap:.65rem;min-height:2.75rem;padding:.55rem 0;
 list-style:none;cursor:pointer;font-weight:650;color:inherit}
.addressfind-details>summary::-webkit-details-marker{display:none}
.addressfind-details>summary span{flex:1 1 auto}
.addressfind-details>summary small{font-size:.75rem;font-weight:450;color:var(--ink-3)}
.addressfind-details>summary:after{content:'+';display:grid;place-items:center;width:1.45rem;height:1.45rem;
 flex:none;border:1px solid currentColor;border-radius:999px;font-size:1.1rem;line-height:1}
.addressfind-details[open]>summary:after{content:'\\2212'}
.addressfind-details>summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.addressfind-body{padding:.15rem 0 .25rem}
.addressfind-form{margin:0;padding:.85rem;background:var(--surface);color:var(--ink);
 border:1px solid var(--line);border-radius:var(--radius)}
.addressfind-label{display:block;margin:0 0 .35rem;font-weight:650}
.addressfind-row{display:flex;align-items:stretch;gap:.5rem}
.addressfind-input{flex:1 1 auto;min-width:0;font:inherit;font-size:1rem;line-height:1.3;padding:.7rem .75rem;
 color:var(--ink);background:var(--raised);border:1px solid var(--ink-3);border-radius:var(--radius)}
.addressfind-input::placeholder{color:var(--ink-3)}
.addressfind-go{flex:none;font:inherit;font-weight:650;padding:.7rem .9rem;cursor:pointer;color:var(--surface);
 background:var(--accent);border:1px solid var(--accent);border-radius:var(--radius)}
.addressfind-go:hover{background:var(--accent-hover);border-color:var(--accent-hover)}
.addressfind-go:disabled{cursor:wait;opacity:.68}
.addressfind :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.addressfind-privacy,.addressfind-status,.addressfind-noscript{margin:.5rem 0 0;font-size:.78rem;line-height:1.45;color:var(--ink-3)}
.addressfind-status:empty{display:none}
.addressfind-result{margin:.8rem 0 0;padding:.8rem;border-left:3px solid var(--accent);background:var(--ground);color:var(--ink)}
.addressfind-result:focus{outline:0}
.addressfind-result-kicker{margin:0 0 .2rem;font-size:.72rem;font-weight:750;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3)}
.addressfind-result h3{margin:0;font-size:1.25rem;color:var(--ink)}
.addressfind-result-place{margin:.2rem 0 0;color:var(--ink-3)}
.addressfind-actions{display:flex;flex-wrap:wrap;gap:.5rem;margin:.7rem 0 0}
.addressfind .addressfind-action{display:inline-flex;align-items:center;min-height:2.55rem;padding:.55rem .72rem;
 border:1px solid var(--line);border-radius:var(--radius);font-weight:650;text-decoration:none;color:var(--ink)}
.addressfind .addressfind-action-primary{color:var(--surface);background:var(--accent);border-color:var(--accent)}
.addressfind .addressfind-action:hover{border-color:var(--accent);text-decoration:underline}
.addressfind-disclaimer{margin:.7rem 0 0;font-size:.78rem;line-height:1.45;color:var(--ink-3)}
.hero-home .addressfind{border-color:color-mix(in srgb,var(--hero-ink) 22%,transparent)}
.hero-home .addressfind-details>summary small{color:color-mix(in srgb,var(--hero-ink) 68%,transparent)}
.hero-home .addressfind-form a{color:var(--accent)}
.hero-home .addressfind-form .addressfind-action-primary{color:var(--surface)}
@media(max-width:44rem){
 .addressfind-details>summary{align-items:flex-start;flex-wrap:wrap;gap:.2rem .55rem}
 .addressfind-details>summary small{flex:1 0 100%}
 .addressfind-details>summary:after{position:absolute;right:0}
 .addressfind-details{position:relative}
 .addressfind-row{display:grid;grid-template-columns:minmax(0,1fr)}
 .addressfind-go{min-height:2.75rem;width:100%}
}`.trim()

/** Browser client, emitted once as /address.js and loaded only on home/search. */
export function addressClientJs() {
  return `(function () {
  var MAX = ${ADDRESS_MAX_LENGTH}
  var TIMEOUT = 12000
  var sequence = 0
  var loaded = Object.create(null)

  function load(url) {
    if (!loaded[url]) {
      loaded[url] = fetch(url, { credentials: 'omit' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
        .catch(function (err) { loaded[url] = null; throw err })
    }
    return loaded[url]
  }

  function text(tag, className, value) {
    var node = document.createElement(tag)
    if (className) node.className = className
    node.textContent = value
    return node
  }

    function link(className, href, value) {
    var a = text('a', className, value)
    a.href = href
      return a
    }

    function appendBoundaryNote(parent, sentence) {
      var note = text('p', 'addressfind-disclaimer', sentence + ' ')
      var guidance = link('', 'https://tea.texas.gov/families-and-students/finding-school-your-child/finding-school',
        'See TEA\u2019s school-finder guidance.')
      guidance.rel = 'external nofollow noreferrer'
      note.appendChild(guidance)
      parent.appendChild(note)
    }

  function init(root) {
    if (root.dataset.addressReady) return
    root.dataset.addressReady = '1'
    var form = root.querySelector('[data-address-form]')
    var input = root.querySelector('.addressfind-input')
    var button = root.querySelector('.addressfind-go')
    var status = root.querySelector('.addressfind-status')
    var result = root.querySelector('.addressfind-result')
    var indexUrl = root.getAttribute('data-address-index')
    var endpoint = root.getAttribute('data-address-geocoder')
    var busy = false
    if (!form || !input || !button || !status || !result || !indexUrl || !endpoint) return

    function say(message) { status.textContent = message }
    function resetResult() { result.hidden = true; result.textContent = '' }
    function setBusy(value) {
      busy = value
      button.disabled = value
      input.disabled = value
      button.textContent = value ? 'Finding\u2026' : 'Find my district'
      input.setAttribute('aria-busy', String(value))
    }

    function renderFound(record) {
      result.textContent = ''
      result.appendChild(text('p', 'addressfind-result-kicker', 'District boundary match'))
      result.appendChild(text('h3', '', record[0]))
      if (record[2]) result.appendChild(text('p', 'addressfind-result-place', record[2] + ' County'))
      var actions = document.createElement('p')
      actions.className = 'addressfind-actions'
      actions.appendChild(link('addressfind-action addressfind-action-primary', record[1], 'View district data'))
      if (record[3]) {
        var official = link('addressfind-action', record[3], 'Enrollment & registration \u2014 official district site \u2197')
        official.rel = 'external nofollow noreferrer'
        actions.appendChild(official)
      }
      result.appendChild(actions)
      appendBoundaryNote(result,
        'District boundaries and enrollment eligibility can change. Confirm this address with the district before registering.')
      result.hidden = false
      say('Found ' + record[0] + '. Results and enrollment links are below.')
      result.focus({ preventScroll: true })
      result.scrollIntoView({ block: 'nearest' })
    }

    function renderUnlisted(name) {
      result.textContent = ''
      result.appendChild(text('p', 'addressfind-result-kicker', 'Census match'))
      result.appendChild(text('h3', '', name || 'A Texas school district'))
      appendBoundaryNote(result,
        'This district is not in the site\u2019s current traditional-district index. Confirm the boundary and enrollment eligibility with the district.')
      result.hidden = false
      say('The Census Bureau found a district, but it is not in this site\u2019s current index.')
      result.focus({ preventScroll: true })
    }

    function districtGeography(payload) {
      var matches = payload && payload.result && payload.result.addressMatches || []
      for (var i = 0; i < matches.length; i++) {
        var match = matches[i] || {}
        var state = match.addressComponents && match.addressComponents.state
        if (String(state || '').toUpperCase() !== 'TX') continue
        var geographies = match.geographies || {}
        var districts = geographies['Unified School Districts'] || []
        if (districts[0] && districts[0].GEOID) {
          return { geoid: String(districts[0].GEOID), name: districts[0].NAME || districts[0].BASENAME || null }
        }
      }
      return null
    }

    function request(raw) {
      var callback = '__txschoolsAddress' + Date.now() + '_' + (++sequence)
      var script = document.createElement('script')
      var done = false
      var timer

      function cleanup(releaseBusy) {
        if (done) return false
        done = true
        clearTimeout(timer)
        script.remove()
        try { delete window[callback] } catch (e) { window[callback] = undefined }
        if (releaseBusy !== false) setBusy(false)
        return true
      }

      window[callback] = function (payload) {
        if (!cleanup(false)) return
        var district = districtGeography(payload)
        if (!district) {
          setBusy(false)
          resetResult()
          say('No Texas district matched that address. Check the street, city and ZIP, then try again.')
          input.focus()
          return
        }
        load(indexUrl).then(function (index) {
          setBusy(false)
          var record = index && index.districts && index.districts[district.geoid]
          if (record) renderFound(record)
          else renderUnlisted(district.name)
        }).catch(function () {
          setBusy(false)
          resetResult()
          say('The district was matched, but its local profile could not be loaded. Please try again.')
        })
      }

      script.onerror = function () {
        if (!cleanup()) return
        resetResult()
        say('The Census address service could not be reached. Please try again in a moment.')
      }
      script.referrerPolicy = 'no-referrer'
      var url = new URL(endpoint)
      url.searchParams.set('address', raw)
      url.searchParams.set('benchmark', 'Public_AR_Current')
      url.searchParams.set('vintage', 'Current_Current')
      url.searchParams.set('layers', 'Unified School Districts')
      url.searchParams.set('format', 'jsonp')
      url.searchParams.set('callback', callback)
      script.src = url.toString()
      timer = setTimeout(function () {
        if (!cleanup()) return
        resetResult()
        say('The Census address service took too long to respond. Please try again.')
      }, TIMEOUT)
      document.head.appendChild(script)
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault()
      if (busy) return
      var raw = input.value.replace(/\\s+/g, ' ').trim()
      resetResult()
      if (!raw) { say('Enter a Texas street address, city and ZIP.'); input.focus(); return }
      if (raw.length > MAX) { say('Keep the address to ' + MAX + ' characters or fewer.'); input.focus(); return }
      setBusy(true)
      say('Asking the U.S. Census Bureau which Texas district contains this address\u2026')
      request(raw)
    })
  }

  function boot() {
    var roots = document.querySelectorAll('[data-address-lookup]')
    for (var i = 0; i < roots.length; i++) init(roots[i])
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()`
}
