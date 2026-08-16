(function () {
  var slugify = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  var MIN = 2
  var SHOW = 12
  var loaded = Object.create(null)

  function normalize(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() }

  function decode(raw) {
    var counties = raw.counties || []
    var d = raw.districts || {}, c = raw.campuses || {}
    var dn = d.name || [], cn = c.name || []
    var out = [], i
    for (i = 0; i < dn.length; i++) out.push(rec(dn[i], d.id[i], 'district', null, counties[d.county[i]]))
    for (i = 0; i < cn.length; i++) out.push(rec(cn[i], c.id[i], 'campus', dn[c.district[i]], counties[c.county[i]]))
    return out
  }

  function rec(name, id, level, district, county) {
    return {
      name: name, level: level, district: district || null, county: county || null,
      href: '/' + level + '/' + slugify(name) + '-' + id,
      key: normalize(name), dkey: normalize(district || '')
    }
  }

  function load(url) {
    if (!loaded[url]) {
      loaded[url] = fetch(url, { credentials: 'omit' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
        .then(decode)
        .catch(function (err) { loaded[url] = null; throw err })
    }
    return loaded[url]
  }

  // A token scores where it starts a word; it scores inside one only when it is
  // long enough for that to have been meant. Without the length floor, "lincoln
  // el" returned Lincoln MS in San Angelo ISD, because "el" sits inside
  // "Angelo" — a match no reader would call one.
  function tokenScore(hay, t, midWord) {
    if (!hay) return 0
    var i = hay.indexOf(t)
    if (i < 0) return 0
    if (i === 0) return hay.length === t.length ? 12 : 8
    if (hay.charAt(i - 1) === ' ') return 6
    return midWord && t.length >= 4 ? 2 : 0
  }

  // TEA writes "Austin HS", parents type "Austin High School". Without this the
  // school a reader is holding in her head is simply not findable, so a handful
  // of school-name abbreviations are treated as the same word, and the filler
  // words that only ever appear in the reader's version are allowed to miss.
  var ALT = {
    high: ['hs'], hs: ['high'], senior: ['sr'], sr: ['senior'],
    elementary: ['elem', 'el'], elem: ['elementary', 'el'], el: ['elem', 'elementary'],
    middle: ['ms'], ms: ['middle'], junior: ['jr'], jr: ['junior'],
    intermediate: ['int'], int: ['intermediate'], primary: ['pri'], academy: ['acad']
  }
  var OPTIONAL = { school: 1, schools: 1, district: 1, campus: 1 }

  function best(hay, t, midWord) {
    var s = tokenScore(hay, t, midWord)
    var alts = ALT[t]
    for (var i = 0; alts && i < alts.length; i++) {
      var a = tokenScore(hay, alts[i], midWord)
      if (a > s) s = a
    }
    return s
  }

  function score(r, q, tokens) {
    var total = 0
    var ownName = true
    for (var i = 0; i < tokens.length; i++) {
      var s = best(r.key, tokens[i], true)
      if (!s) {
        // The district name is a weaker haystack — it is context, not the thing
        // being named — so it matches on word starts only.
        var ds = best(r.dkey, tokens[i], false)
        if (!ds) {
          if (OPTIONAL[tokens[i]]) continue
          return 0
        }
        ownName = false
        s = ds / 4
      }
      total += s
    }
    if (!total) return 0
    // A school that carries every word itself beats one that borrowed half of
    // them from its district's name.
    if (ownName) total += 8
    if (r.key === q) total += 40
    else if (r.key.indexOf(q) === 0) total += 12
    else if (r.key.indexOf(q) > 0) total += 4
    if (r.level === 'district') total += 1
    return total
  }

  function rank(list, raw) {
    var q = normalize(raw)
    if (q.length < MIN) return null
    var tokens = q.split(' ')
    var hits = []
    for (var i = 0; i < list.length; i++) {
      var s = score(list[i], q, tokens)
      if (s > 0) hits.push([s, list[i]])
    }
    hits.sort(function (a, b) { return b[0] - a[0] || a[1].name.localeCompare(b[1].name) })
    return { total: hits.length, rows: hits.slice(0, SHOW).map(function (h) { return h[1] }) }
  }

  function meta(r) {
    var bits = [r.level === 'campus' ? 'Campus' : 'District']
    if (r.level === 'campus' && r.district) bits.push(r.district)
    if (r.county) bits.push(r.county.replace(/ County$/i, '') + ' County')
    return bits.join(' \u00b7 ')
  }

  function init(form) {
    if (form.dataset.searchReady) return
    form.dataset.searchReady = '1'

    var input = form.querySelector('.sitesearch-input')
    var panel = form.querySelector('.sitesearch-panel')
    var list = form.querySelector('.sitesearch-results')
    var more = form.querySelector('.sitesearch-more')
    var status = form.querySelector('[data-search-status]')
    var url = form.getAttribute('data-search-index')
    if (!input || !panel || !list || !url) return

    var rows = null
    var options = []
    var cursor = -1

    input.setAttribute('role', 'combobox')
    input.setAttribute('aria-expanded', 'false')
    input.setAttribute('aria-autocomplete', 'list')
    input.setAttribute('aria-controls', list.id)
    list.setAttribute('role', 'listbox')
    list.setAttribute('aria-label', 'Search results')

    function say(msg) { if (status) status.textContent = msg }

    function close() {
      panel.hidden = true
      list.textContent = ''
      more.hidden = true
      options = []
      cursor = -1
      input.setAttribute('aria-expanded', 'false')
      input.removeAttribute('aria-activedescendant')
    }

    function select(i) {
      cursor = i
      var nodes = list.children
      for (var k = 0; k < nodes.length; k++) nodes[k].setAttribute('aria-selected', String(k === cursor))
      if (cursor < 0) { input.removeAttribute('aria-activedescendant'); return }
      input.setAttribute('aria-activedescendant', nodes[cursor].id)
      nodes[cursor].scrollIntoView({ block: 'nearest' })
    }

    function show(result, raw) {
      options = result.rows
      list.textContent = ''
      for (var i = 0; i < result.rows.length; i++) {
        var r = result.rows[i]
        var li = document.createElement('li')
        li.id = input.id + '-opt-' + i
        li.setAttribute('role', 'option')
        li.setAttribute('aria-selected', 'false')
        li.dataset.href = r.href
        var name = document.createElement('span')
        name.className = 'sitesearch-name'
        name.textContent = r.name
        var sub = document.createElement('span')
        sub.className = 'sitesearch-meta'
        sub.textContent = meta(r)
        li.appendChild(name)
        li.appendChild(sub)
        list.appendChild(li)
      }
      if (!result.rows.length) {
        panel.hidden = true
        input.setAttribute('aria-expanded', 'false')
        say('Nothing matches \u201c' + raw + '\u201d. Try fewer words, or browse the A to Z index.')
        return
      }
      panel.hidden = false
      input.setAttribute('aria-expanded', 'true')
      more.hidden = result.total <= result.rows.length
      more.textContent = result.total > result.rows.length
        ? 'Showing ' + result.rows.length + ' of ' + result.total + ' matches. Keep typing to narrow them.'
        : ''
      select(0)
      say(result.total + (result.total === 1 ? ' match' : ' matches') + ' for \u201c' + raw +
          '\u201d. Use the up and down arrow keys to choose one, then press Enter.')
    }

    function run() {
      var raw = input.value
      if (normalize(raw).length < MIN) { close(); return }
      load(url).then(function (data) {
        rows = data
        if (input.value !== raw) return
        var result = rank(rows, raw)
        if (result) show(result, raw.trim())
      }).catch(function () {
        say('The school list could not be loaded. Press Enter to browse the full index instead.')
      })
    }

    input.addEventListener('input', run)
    input.addEventListener('focus', function () { if (!rows) load(url).then(function (d) { rows = d }).catch(function () {}) })

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { close(); return }
      if (panel.hidden || !options.length) return
      if (e.key === 'ArrowDown') { e.preventDefault(); select((cursor + 1) % options.length) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); select((cursor - 1 + options.length) % options.length) }
      else if (e.key === 'Home') { e.preventDefault(); select(0) }
      else if (e.key === 'End') { e.preventDefault(); select(options.length - 1) }
      else if (e.key === 'Enter' && cursor >= 0) { e.preventDefault(); go(options[cursor]) }
      else if (e.key === 'Tab') close()
    })

    function go(r) { if (r) window.location.assign(r.href) }

    // mousedown, not click: blur must not close the panel before the choice lands.
    list.addEventListener('mousedown', function (e) {
      var li = e.target.closest('li[data-href]')
      if (!li) return
      e.preventDefault()
      window.location.assign(li.dataset.href)
    })

    form.addEventListener('submit', function (e) {
      if (cursor >= 0 && options[cursor]) { e.preventDefault(); go(options[cursor]) }
      // otherwise the GET runs and /search takes over, which is the point.
    })

    document.addEventListener('click', function (e) { if (!form.contains(e.target)) close() })

    // /search?q=... is a real search for anyone with this script; without it the
    // same URL is still the browsable index, which is why the form targets it.
    if (!input.value && /(^|[?&])q=/.test(window.location.search)) {
      var q = new URLSearchParams(window.location.search).get('q')
      if (q) { input.value = q; run() }
    }
  }

  function boot() {
    var forms = document.querySelectorAll('form[data-search]')
    for (var i = 0; i < forms.length; i++) init(forms[i])
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()