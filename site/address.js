(function () {
  var MAX = 100
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
        'See TEA’s school-finder guidance.')
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
      button.textContent = value ? 'Finding…' : 'Find my district'
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

    form.addEventListener('submit', function (event) {
      event.preventDefault()
      if (busy) return
      var raw = input.value.replace(/\s+/g, ' ').trim()
      resetResult()
      if (!raw) { say('Enter a Texas street address, city and ZIP.'); input.focus(); return }
      if (raw.length > MAX) { say('Keep the address to ' + MAX + ' characters or fewer.'); input.focus(); return }
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