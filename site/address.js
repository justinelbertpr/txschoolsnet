(function () {
  var MAX = 100
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
        'See TEA’s school-finder guidance.')
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
    function normalizedInput() { return input.value.replace(/\s+/g, ' ').trim() }

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
      return normalized.replace(/[\u0300-\u036f]/g, '').toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ').trim()
    }

    function parseStreetQuery(raw) {
      var match = String(raw || '').match(/^(\d+[a-z]?(?:-\d+[a-z]?)?)\s+(.+)$/i)
      if (!match) return null
      var numeric = match[1].match(/^\d+/)
      var street = normalizeStreet(match[2])
      if (!numeric || street.length < 3) return null
      var house = Number(numeric[0])
      var shard = street.charAt(0)
      if (!Number.isSafeInteger(house) || house < 1 || !/[a-z0-9]/.test(shard)) return null
      return { houseText: match[1], house: house, street: street, shard: shard }
    }

    function streetRow(row) {
      if (!Array.isArray(row) || row.length !== 6) return null
      var street = typeof row[0] === 'string' ? row[0].replace(/\s+/g, ' ').trim() : ''
      var zip = typeof row[1] === 'string' ? row[1].trim() : ''
      var city = row[2] === null ? null : (typeof row[2] === 'string' ? row[2].replace(/\s+/g, ' ').trim() : '')
      var min = row[3] === null ? null : row[3]
      var max = row[4] === null ? null : row[4]
      var count = row[5]
      var normalized = normalizeStreet(street)
      if (!street || street.length > 100 || !normalized || !/^\d{5}$/.test(zip)) return null
      if (city !== null && (!city || city.length > 80)) return null
      if (min !== null && (!Number.isSafeInteger(min) || min < 0)) return null
      if (max !== null && (!Number.isSafeInteger(max) || max < 0)) return null
      if (min !== null && max !== null && min > max) return null
      if (!Number.isSafeInteger(count) || count < 1) return null
      return { street: street, normalized: normalized, zip: zip, city: city, min: min, max: max, count: count }
    }

    function displayCase(value) {
      var original = String(value || '').replace(/\s+/g, ' ').trim()
      // Census street names and TEA postal cities normally carry intentional
      // casing already (McAllen, FM 1960). Only normalize all-uppercase input,
      // which also keeps synthetic/older snapshots pleasant to read.
      if (/[a-z]/.test(original)) return original
      return original.toLowerCase().replace(/(^|[\s-])([a-z])/g,
        function (_, before, letter) { return before + letter.toUpperCase() })
        .replace(/\b(?:Fm|Us|Tx|Sh|Ih|Rr)\b/g, function (word) { return word.toUpperCase() })
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
      var base = new URL(streetsPath.replace(/\/?$/, '/') + parsed.shard + '.json', window.location.href)
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
      button.textContent = value ? 'Finding…' : 'Find my district'
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
        var official = link('addressfind-action', record[3], 'Enrollment & registration — official district site ↗')
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
        'This district is not in the site’s current traditional-district index. Confirm the boundary and enrollment eligibility with the district.')
      result.hidden = false
      say('The Census Bureau found a district, but it is not in this site’s current index.')
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
      say('Asking the U.S. Census Bureau which Texas district contains this address…')
      request(raw)
    })
  }

  function boot() {
    var roots = document.querySelectorAll('[data-address-lookup]')
    for (var i = 0; i < roots.length; i++) init(roots[i])
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()