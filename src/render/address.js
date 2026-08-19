// Address-to-district lookup for the two places where a family is already
// searching: the homepage hero and /search.
//
// The site stays assets-only. Autocomplete reads small, same-origin street
// shards derived from the Census Bureau's published Texas address ranges; text
// typed into the field therefore stays in the browser. Only after an explicit
// submit does it send the chosen (or manually entered) address directly to the
// U.S. Census Bureau's public geocoder. Census returns a Unified School District
// GEOID; a small same-origin file then maps that GEOID to the TEA district page
// already published here. The address never enters a txschools.net URL,
// analytics call, cookie, localStorage or sessionStorage.
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
export const ADDRESS_STREETS_PATH = '/data/address-streets'
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
  streetsUrl = ADDRESS_STREETS_PATH,
} = {}) {
  const root = `${id}-lookup`
  const hint = `${id}-privacy`
  const help = `${id}-help`
  const status = `${id}-status`
  const result = `${id}-result`
  const suggestions = `${id}-suggestions`

  const markup = `<div class="addressfind" id="${esc(root)}" data-address-lookup data-address-index="${esc(indexUrl)}"
  data-address-geocoder="${esc(CENSUS_GEOCODER_PATH)}" data-address-streets="${esc(streetsUrl)}">
  <details class="addressfind-details"${open ? ' open' : ''}>
    <summary><span>Find my district by address</span><small>Start with your house number and street</small></summary>
    <div class="addressfind-body">
      <form class="addressfind-form" method="get" action="/search" data-address-form>
        <label class="addressfind-label" for="${esc(id)}">Home street address</label>
        <div class="addressfind-row">
          <div class="addressfind-combobox">
            <input class="addressfind-input" id="${esc(id)}" type="text" maxlength="${ADDRESS_MAX_LENGTH}"
              placeholder="Start typing your address" autocomplete="off"
              enterkeyhint="search" role="combobox" aria-autocomplete="list" aria-haspopup="listbox"
              aria-expanded="false" aria-controls="${esc(suggestions)}"
              aria-describedby="${esc(help)} ${esc(hint)} ${esc(status)}">
            <div class="addressfind-suggestions" data-address-suggestions hidden>
              <ul class="addressfind-options" id="${esc(suggestions)}" role="listbox" aria-label="Texas address suggestions"></ul>
            </div>
          </div>
          <button class="addressfind-go" type="submit">Find my district</button>
        </div>
        <p class="addressfind-help" id="${esc(help)}">Apartment or unit number isn’t needed. Choose a suggestion, or enter the full street, city and ZIP yourself.</p>
        <p class="addressfind-privacy" id="${esc(hint)}">Suggestions use Census street data stored on txschools.net. Your address is not sent anywhere while you type. Your selected or manually entered address is sent directly to the
          <a href="https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html" rel="external nofollow noreferrer">U.S. Census Bureau</a>
          only when you press Find. txschools.net does not save your address.</p>
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
.addressfind-combobox{position:relative;flex:1 1 auto;min-width:0}
.addressfind-input{width:100%;min-width:0;font:inherit;font-size:1rem;line-height:1.3;padding:.7rem .75rem;
 color:var(--ink);background:var(--raised);border:1px solid var(--ink-3);border-radius:var(--radius)}
.addressfind-input::placeholder{color:var(--ink-3)}
.addressfind-suggestions{position:absolute;z-index:40;inset:calc(100% + .2rem) 0 auto;max-height:min(40dvh,18rem);overflow-y:auto;
 overscroll-behavior:contain;padding:.25rem 0;background:var(--raised);border:1px solid var(--line);border-radius:var(--radius);
 box-shadow:0 .55rem 1.4rem color-mix(in srgb,var(--ink) 18%,transparent)}
.addressfind-options{margin:0;padding:0;list-style:none}
.addressfind-option{display:flex;align-items:center;min-height:2.75rem;margin:0;padding:.62rem .75rem;cursor:pointer;line-height:1.35;color:var(--ink)}
.addressfind-option:hover,.addressfind-option[aria-selected="true"]{background:color-mix(in srgb,var(--accent) 13%,var(--raised));color:var(--ink)}
.addressfind-option[aria-selected="true"]{box-shadow:inset 3px 0 var(--accent)}
.addressfind-go{flex:none;font:inherit;font-weight:650;padding:.7rem .9rem;cursor:pointer;color:var(--surface);
 background:var(--accent);border:1px solid var(--accent);border-radius:var(--radius)}
.addressfind-go:hover{background:var(--accent-hover);border-color:var(--accent-hover)}
.addressfind-go:disabled{cursor:wait;opacity:.68}
.addressfind :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.addressfind-help,.addressfind-privacy,.addressfind-status,.addressfind-noscript{margin:.5rem 0 0;font-size:.78rem;line-height:1.45;color:var(--ink-3)}
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
.hero-home .addressfind-suggestions{position:static;max-height:min(40dvh,16rem);margin-top:.2rem}
.hero-home .addressfind-form a{color:var(--accent)}
.hero-home .addressfind-form .addressfind-action-primary{color:var(--surface)}
@media(max-width:44rem){
 .addressfind-details>summary{align-items:flex-start;flex-wrap:wrap;gap:.2rem .55rem;padding-right:2rem}
 .addressfind-details>summary small{flex:1 0 100%}
 .addressfind-details>summary:after{position:absolute;right:0}
 .addressfind-details{position:relative}
 .addressfind-row{display:grid;grid-template-columns:minmax(0,1fr)}
 .addressfind-suggestions{position:static;max-height:min(40dvh,16rem);margin-top:.2rem}
 .addressfind-go{min-height:2.75rem;width:100%}
}`.trim()

/** Browser client, emitted once as /address.js and loaded only on home/search. */
export function addressClientJs() {
  return `(function () {
  var MAX = ${ADDRESS_MAX_LENGTH}
  var TIMEOUT = 12000
  var SUGGEST_DELAY = 275
  var sequence = 0
  var loaded = Object.create(null)

  function load(url, credentials) {
    var mode = credentials || 'omit'
    var key = mode + ':' + url
    if (!loaded[key]) {
      loaded[key] = fetch(url, { credentials: mode })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
        .catch(function (err) { loaded[key] = null; throw err })
    }
    return loaded[key]
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
    var details = root.querySelector('.addressfind-details')
    var input = root.querySelector('.addressfind-input')
    var button = root.querySelector('.addressfind-go')
    var status = root.querySelector('.addressfind-status')
    var result = root.querySelector('.addressfind-result')
    var suggestionBox = root.querySelector('[data-address-suggestions]')
    var optionList = root.querySelector('.addressfind-options')
    var indexUrl = root.getAttribute('data-address-index')
    var endpoint = root.getAttribute('data-address-geocoder')
    var streetsPath = root.getAttribute('data-address-streets')
    var busy = false
    var suggestTimer = null
    var suggestGeneration = 0
    var suggestionValues = []
    var activeSuggestion = -1
    var composing = false
    if (!form || !input || !button || !status || !result || !suggestionBox || !optionList || !indexUrl || !endpoint || !streetsPath) return

    function say(message) { status.textContent = message }
    function resetResult() { result.hidden = true; result.textContent = '' }
    function normalizedInput() { return input.value.replace(/\\s+/g, ' ').trim() }

    function emptySuggestions() {
      suggestionValues = []
      activeSuggestion = -1
      optionList.textContent = ''
      suggestionBox.hidden = true
      input.setAttribute('aria-expanded', 'false')
      input.removeAttribute('aria-activedescendant')
    }

    function stopSuggestions() {
      suggestGeneration += 1
      if (suggestTimer !== null) clearTimeout(suggestTimer)
      suggestTimer = null
      emptySuggestions()
    }

    function activateSuggestion(index) {
      if (!suggestionValues.length) return
      if (index < 0) index = suggestionValues.length - 1
      if (index >= suggestionValues.length) index = 0
      activeSuggestion = index
      var options = optionList.querySelectorAll('[role="option"]')
      for (var i = 0; i < options.length; i++) options[i].setAttribute('aria-selected', String(i === index))
      var active = options[index]
      if (active) {
        input.setAttribute('aria-activedescendant', active.id)
        active.scrollIntoView({ block: 'nearest' })
      }
    }

    function chooseSuggestion(index) {
      var value = suggestionValues[index]
      if (!value) return
      input.value = value
      stopSuggestions()
      say('Address selected. Press Find my district to check its district.')
      input.focus()
    }

    function normalizeStreet(value) {
      var normalized = String(value || '')
      if (normalized.normalize) normalized = normalized.normalize('NFKD')
      return normalized.replace(/[\\u0300-\\u036f]/g, '').toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ').trim()
    }

    function parseStreetQuery(raw) {
      var match = String(raw || '').match(/^(\\d+[a-z]?(?:-\\d+[a-z]?)?)\\s+(.+)$/i)
      if (!match) return null
      var numeric = match[1].match(/^\\d+/)
      var street = normalizeStreet(match[2])
      if (!numeric || street.length < 3) return null
      var house = Number(numeric[0])
      var shard = street.charAt(0)
      if (!Number.isSafeInteger(house) || house < 1 || !/[a-z0-9]/.test(shard)) return null
      return { houseText: match[1], house: house, street: street, shard: shard }
    }

    function streetRow(row) {
      if (!Array.isArray(row) || row.length !== 6) return null
      var street = typeof row[0] === 'string' ? row[0].replace(/\\s+/g, ' ').trim() : ''
      var zip = typeof row[1] === 'string' ? row[1].trim() : ''
      var city = row[2] === null ? null : (typeof row[2] === 'string' ? row[2].replace(/\\s+/g, ' ').trim() : '')
      var min = row[3] === null ? null : row[3]
      var max = row[4] === null ? null : row[4]
      var count = row[5]
      var normalized = normalizeStreet(street)
      if (!street || street.length > 100 || !normalized || !/^\\d{5}$/.test(zip)) return null
      if (city !== null && (!city || city.length > 80)) return null
      if (min !== null && (!Number.isSafeInteger(min) || min < 0)) return null
      if (max !== null && (!Number.isSafeInteger(max) || max < 0)) return null
      if (min !== null && max !== null && min > max) return null
      if (!Number.isSafeInteger(count) || count < 1) return null
      return { street: street, normalized: normalized, zip: zip, city: city, min: min, max: max, count: count }
    }

    function displayCase(value) {
      var original = String(value || '').replace(/\\s+/g, ' ').trim()
      // Census street names and TEA postal cities normally carry intentional
      // casing already (McAllen, FM 1960). Only normalize all-uppercase input,
      // which also keeps synthetic/older snapshots pleasant to read.
      if (/[a-z]/.test(original)) return original
      return original.toLowerCase().replace(/(^|[\\s-])([a-z])/g,
        function (_, before, letter) { return before + letter.toUpperCase() })
        .replace(/\\b(?:Fm|Us|Tx|Sh|Ih|Rr)\\b/g, function (word) { return word.toUpperCase() })
    }

    function rangeTier(row, house) {
      if (row.min === null || row.max === null) return 1
      return house >= row.min && house <= row.max ? 0 : 2
    }

    function rangeDistance(row, house) {
      if (row.min === null || row.max === null || house >= row.min && house <= row.max) return 0
      return house < row.min ? row.min - house : house - row.max
    }

    function renderSuggestions(payload, generation, requestedText, parsed) {
      if (generation !== suggestGeneration || normalizedInput() !== requestedText || busy) return
      if (!payload || payload.v !== 1 || !Array.isArray(payload.rows)) throw new Error('Invalid street shard')
      var incoming = payload.rows
      var seen = Object.create(null)
      var candidates = []
      for (var i = 0; i < incoming.length; i++) {
        var row = streetRow(incoming[i])
        if (!row || row.normalized.indexOf(parsed.street) !== 0) continue
        row.tier = rangeTier(row, parsed.house)
        row.distance = rangeDistance(row, parsed.house)
        candidates.push(row)
      }
      candidates.sort(function (a, b) {
        return a.tier - b.tier ||
          a.normalized.length - b.normalized.length ||
          a.distance - b.distance ||
          b.count - a.count ||
          a.normalized.localeCompare(b.normalized) ||
          a.zip.localeCompare(b.zip) ||
          String(a.city || '').localeCompare(String(b.city || ''))
      })
      var values = []
      for (var j = 0; j < candidates.length && values.length < 5; j++) {
        var candidate = candidates[j]
        var place = candidate.city ? displayCase(candidate.city) + ', TX ' + candidate.zip : 'TX ' + candidate.zip
        var value = parsed.houseText + ' ' + displayCase(candidate.street) + ', ' + place
        var key = value.toLowerCase()
        if (value.length > MAX || seen[key]) continue
        seen[key] = true
        values.push(value)
      }
      emptySuggestions()
      if (!values.length) {
        say('No suggestions yet. Add the city or ZIP, or enter the full address yourself.')
        return
      }
      suggestionValues = values
      for (var k = 0; k < values.length; k++) {
        var option = text('li', 'addressfind-option', values[k])
        option.id = optionList.id + '-option-' + k
        option.setAttribute('role', 'option')
        option.setAttribute('aria-selected', 'false')
        option.setAttribute('data-address-option-index', String(k))
        optionList.appendChild(option)
      }
      suggestionBox.hidden = false
      input.setAttribute('aria-expanded', 'true')
      say(values.length + (values.length === 1 ? ' address suggestion available.' : ' address suggestions available.') + ' Use the arrow keys to review them.')
    }

    function requestSuggestions(raw, parsed, generation) {
      suggestTimer = null
      var base = new URL(streetsPath.replace(/\\/?$/, '/') + parsed.shard + '.json', window.location.href)
      if (base.origin !== window.location.origin) {
        emptySuggestions()
        say('Address suggestions are unavailable. Enter the full street, city and ZIP, then press Find.')
        return
      }
      load(base.pathname + base.search, 'same-origin').then(function (payload) {
        renderSuggestions(payload, generation, raw, parsed)
      }).catch(function (error) {
        if (generation !== suggestGeneration) return
        emptySuggestions()
        say('Address suggestions are unavailable. Enter the full street, city and ZIP, then press Find.')
      })
    }

    function scheduleSuggestions() {
      stopSuggestions()
      resetResult()
      say('')
      if (busy) return
      var raw = normalizedInput()
      var parsed = parseStreetQuery(raw)
      if (!parsed) return
      var generation = suggestGeneration
      suggestTimer = setTimeout(function () { requestSuggestions(raw, parsed, generation) }, SUGGEST_DELAY)
    }
    function setBusy(value) {
      busy = value
      button.disabled = value
      input.disabled = value
      button.textContent = value ? 'Finding\u2026' : 'Find my district'
      input.setAttribute('aria-busy', String(value))
    }

    function renderFound(record) {
      stopSuggestions()
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
      stopSuggestions()
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

    input.addEventListener('compositionstart', function () { composing = true })
    input.addEventListener('compositionend', function () { composing = false; scheduleSuggestions() })
    input.addEventListener('input', function (event) {
      if (composing || event.isComposing) return
      scheduleSuggestions()
    })
    input.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowDown' && !suggestionBox.hidden) {
        event.preventDefault()
        activateSuggestion(activeSuggestion + 1)
      } else if (event.key === 'ArrowUp' && !suggestionBox.hidden) {
        event.preventDefault()
        activateSuggestion(activeSuggestion - 1)
      } else if (event.key === 'Enter' && !suggestionBox.hidden && activeSuggestion >= 0) {
        event.preventDefault()
        chooseSuggestion(activeSuggestion)
      } else if (event.key === 'Escape' && !suggestionBox.hidden) {
        event.preventDefault()
        stopSuggestions()
        say('Suggestions closed. You can keep typing or enter the full address yourself.')
      } else if (event.key === 'Tab') {
        stopSuggestions()
      }
    })

    optionList.addEventListener('click', function (event) {
      var option = event.target.closest && event.target.closest('[data-address-option-index]')
      if (!option || !optionList.contains(option)) return
      event.preventDefault()
      chooseSuggestion(Number(option.getAttribute('data-address-option-index')))
    })

    document.addEventListener('pointerdown', function (event) {
      if (!root.contains(event.target)) stopSuggestions()
    })

    if (details) details.addEventListener('toggle', function () {
      if (!details.open) stopSuggestions()
    })
    window.addEventListener('pagehide', function () {
      stopSuggestions()
      input.value = ''
    })

    form.addEventListener('submit', function (event) {
      event.preventDefault()
      if (busy) return
      var raw = normalizedInput()
      resetResult()
      if (!raw) { say('Enter a Texas street address, city and ZIP.'); input.focus(); return }
      if (raw.length > MAX) { say('Keep the address to ' + MAX + ' characters or fewer.'); input.focus(); return }
      stopSuggestions()
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
