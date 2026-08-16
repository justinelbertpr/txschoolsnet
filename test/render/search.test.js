// test/render/search.test.js
import { describe, it, expect } from 'vitest'
import { gzipSync } from 'node:zlib'

import {
  buildSearchIndex,
  readSearchIndex,
  renderSearch,
  renderSearchPage,
  searchAssets,
  searchClientJs,
  searchIndexJson,
  searchLetter,
  SEARCH_INDEX_PATH,
  SEARCH_LETTERS,
  SEARCH_PATH,
} from '../../src/render/search.js'
import { renderHomePage } from '../../src/render/hubs.js'
import { entitySlug } from '../../src/render/view-model.js'

/* --------------------------------------------------------------- fixtures -- */

const district = (over = {}) => ({
  id: '057905',
  level: 'district',
  districtId: '057905',
  districtName: 'Dallas ISD',
  name: 'Dallas ISD',
  county: 'Dallas',
  countyId: '057',
  regionId: '10',
  ...over,
})

const campus = (over = {}) => ({
  id: '057905001',
  level: 'campus',
  districtId: '057905',
  districtName: 'Dallas ISD',
  name: 'Beverly Hills El',
  county: 'Dallas',
  countyId: '057',
  regionId: '10',
  ...over,
})

/** Two districts sharing a name, two campuses sharing a name: the real hazard. */
const entities = [
  district(),
  district({ id: '057916', districtId: '057916', name: 'Highland Park ISD', districtName: 'Highland Park ISD' }),
  district({
    id: '220916',
    districtId: '220916',
    name: 'Highland Park ISD',
    districtName: 'Highland Park ISD',
    county: 'Potter',
    countyId: '188',
    regionId: '16',
  }),
  campus(),
  campus({ id: '057916001', districtId: '057916', districtName: 'Highland Park ISD', name: 'Bradfield El' }),
  campus({
    id: '220916001',
    districtId: '220916',
    districtName: 'Highland Park ISD',
    name: 'Bradfield El',
    county: 'Potter',
    countyId: '188',
    regionId: '16',
  }),
  campus({ id: '057905002', name: "O'Connell & Sons H.S." }),
]

/* ------------------------------------------------------------------ index -- */

describe('buildSearchIndex', () => {
  const index = buildSearchIndex(entities)

  it('carries every district and every campus', () => {
    expect(index.count).toBe(entities.length)
    expect(index.districts.name).toHaveLength(3)
    expect(index.campuses.name).toHaveLength(4)
  })

  it('stores counties once, by reference, not once per row', () => {
    expect(index.counties).toEqual(['Dallas', 'Potter'])
    expect(index.districts.county).toEqual([0, 0, 1])
  })

  it('stores no slug — the client derives it, which is what halves the file', () => {
    expect(index.districts.slug).toBeUndefined()
    expect(index.campuses.slug).toBeUndefined()
    expect(JSON.stringify(index)).not.toContain('dallas-isd-057905')
  })

  it('ignores rows with no id or no name rather than emitting a blank result', () => {
    const i = buildSearchIndex([...entities, { id: null, name: 'Ghost' }, { id: '1', name: '' }])
    expect(i.count).toBe(entities.length)
  })

  it('survives being handed nothing', () => {
    expect(buildSearchIndex().count).toBe(0)
    expect(buildSearchIndex([]).campuses.name).toEqual([])
  })

  it('points a campus at its district by position, and at -1 when it has none', () => {
    const orphan = buildSearchIndex([campus({ districtId: '999999' })])
    expect(orphan.campuses.district).toEqual([-1])
    expect(readSearchIndex(orphan)[0].district).toBe(null)
  })
})

describe('readSearchIndex — the decoder the browser mirrors', () => {
  const rows = readSearchIndex(buildSearchIndex(entities))

  it('returns id, name, level, district, county and slug for every entity', () => {
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(['county', 'district', 'href', 'id', 'level', 'name', 'slug'])
      expect(typeof r.slug).toBe('string')
    }
    expect(rows).toHaveLength(entities.length)
  })

  it('derives exactly the slug the entity pages are written under', () => {
    for (const e of entities) {
      const row = rows.find((r) => r.id === e.id)
      expect(row.slug).toBe(entitySlug(e))
      expect(row.href).toBe(`/${e.level}/${entitySlug(e)}`)
    }
  })

  it('derives the same slug for a name full of punctuation', () => {
    const e = entities.find((x) => x.name.includes('&'))
    expect(rows.find((r) => r.id === e.id).slug).toBe(entitySlug(e))
  })

  it('names the district and county of every campus, so duplicates stay apart', () => {
    const dupes = rows.filter((r) => r.name === 'Bradfield El')
    expect(dupes).toHaveLength(2)
    expect(dupes.map((d) => d.county).sort()).toEqual(['Dallas', 'Potter'])
    expect(new Set(dupes.map((d) => d.href)).size).toBe(2)
  })

  it('gives duplicate district names distinct counties too', () => {
    const dupes = rows.filter((r) => r.name === 'Highland Park ISD')
    expect(dupes.map((d) => d.county).sort()).toEqual(['Dallas', 'Potter'])
  })
})

describe('searchIndexJson', () => {
  it('is valid JSON that round-trips through the decoder', () => {
    const rows = readSearchIndex(JSON.parse(searchIndexJson(entities)))
    expect(rows.map((r) => r.id).sort()).toEqual(entities.map((e) => e.id).sort())
  })

  it('stays far smaller than one object per entity', () => {
    const columnar = searchIndexJson(entities).length
    const rowWise = JSON.stringify(readSearchIndex(buildSearchIndex(entities))).length
    expect(columnar).toBeLessThan(rowWise)
  })

  it('compresses — the number the lazy-load budget is actually spent in', () => {
    const json = searchIndexJson(entities)
    expect(gzipSync(json).length).toBeLessThan(Buffer.byteLength(json))
  })
})

/* ---------------------------------------------------------------- control -- */

describe('renderSearch', () => {
  const html = renderSearch({ counts: { districts: 1199, campuses: 9031 } })

  it('is a GET form aimed at a page that exists, so it works with JavaScript off', () => {
    expect(html).toContain('method="get"')
    expect(html).toContain(`action="${SEARCH_PATH}"`)
    expect(html).toContain('name="q"')
  })

  it('names the index it lazy-loads rather than inlining 10,230 names', () => {
    expect(html).toContain(`data-search-index="${SEARCH_INDEX_PATH}"`)
    expect(html).not.toContain('Dallas ISD')
  })

  it('labels the input, and points the hint at it with aria-describedby', () => {
    const id = html.match(/<input class="sitesearch-input" id="([^"]+)"/)[1]
    expect(html).toContain(`for="${id}"`)
    expect(html).toContain(`aria-describedby="${id}-hint"`)
    expect(html).toContain(`id="${id}-hint"`)
  })

  it('states the denominator it searches', () => {
    expect(html).toContain('10,230')
    expect(html).toContain('1,199 districts')
    expect(html).toContain('9,031 campuses')
  })

  it('drops the numbers rather than inventing them when it was given none', () => {
    const bare = renderSearch()
    expect(bare).not.toMatch(/\d,\d{3}/)
    expect(bare).toContain('Type at least two letters')
  })

  it('is a labelled search landmark, because more than one appears per page', () => {
    expect(html).toContain('role="search"')
    expect(html).toMatch(/aria-label="Find a school or district"/)
  })

  it('defaults to a stable id, so a build is byte-identical across worker threads', () => {
    expect(renderSearch()).toContain('id="sitesearch"')
    expect(renderSearch()).toBe(renderSearch())
  })

  it('takes an explicit id so two on one page do not collide', () => {
    const a = renderSearch({ id: 'one' })
    const b = renderSearch({ id: 'two' })
    expect(a).toContain('id="one"')
    expect(b).toContain('id="two"')
    expect(a).not.toContain('id="two"')
  })

  it('autofocuses only when asked', () => {
    expect(renderSearch({ autofocus: true })).toContain(' autofocus')
    expect(renderSearch({ autofocus: false })).not.toContain(' autofocus')
  })

  it('shows its label and hint in the hero variant and hides them in the header', () => {
    expect(renderSearch({ variant: 'hero' })).toContain('<label class="sitesearch-label" ')
    expect(renderSearch({ variant: 'header' })).toContain('<label class="sitesearch-label sr-only" ')
  })

  it('escapes what a caller hands it', () => {
    const nasty = renderSearch({ placeholder: '"><script>x</script>', label: 'A & B' })
    expect(nasty).not.toContain('"><script>x')
    expect(nasty).toContain('A &amp; B')
  })

  it('ships its style and script by default, and can be told not to', () => {
    expect(html).toContain('<style data-search-style>')
    expect(html).toContain('<script>')
    expect(renderSearch({ assets: false })).not.toContain('<style')
  })

  it('takes an external script instead of the inline copy, for the 10,230 pages', () => {
    const ext = searchAssets({ scriptSrc: '/search.js' })
    expect(ext).toContain('<script src="/search.js" defer></script>')
    expect(ext).not.toContain('function boot()')
  })

  it('offers the browsable index in the visible hint, so the fallback is discoverable', () => {
    expect(renderSearch({ variant: 'hero' })).toContain(`href="${SEARCH_PATH}"`)
  })

  it('puts no focusable link inside the hidden hint of the header variant', () => {
    const hint = renderSearch({ variant: 'header' }).match(/<p class="sitesearch-hint sr-only"[^>]*>([\s\S]*?)<\/p>/)[1]
    expect(hint).not.toContain('<a ')
  })

  it('uses no literal colour, so it inherits both themes from style.css', () => {
    const css = html.match(/<style data-search-style>([\s\S]*?)<\/style>/)[1]
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(css).not.toMatch(/\b(rgb|hsl|oklch)\(/)
    expect(css).toContain('var(--accent)')
  })

  it('sets the input to 16px, which is what stops iOS zooming on focus', () => {
    const css = html.match(/<style data-search-style>([\s\S]*?)<\/style>/)[1]
    expect(css).toMatch(/\.sitesearch-input\{[^}]*font-size:1rem/)
  })

  it('makes focus visible', () => {
    expect(html).toContain(':focus-visible{outline:2px solid var(--accent)')
  })

  it('marks the active result with a bar as well as a fill, not colour alone', () => {
    expect(html).toContain('border-left-color:var(--accent)')
  })

  it('anchors the results panel to the input row, not to the whole form', () => {
    expect(html).toMatch(/<div class="sitesearch-field">[\s\S]*sitesearch-row[\s\S]*sitesearch-panel[\s\S]*<\/div>/)
    expect(html).toContain('.sitesearch-field{position:relative}')
  })

  // The rationale for these rules lives in JavaScript beside the constant. A CSS
  // comment here would be shipped on every page, and one of them was already
  // quoting a heading from the front page — which a hubs test then matched.
  it('ships no comment inside the stylesheet', () => {
    expect(SEARCH_CSS_OF(html)).not.toContain('/*')
  })

  it('contains nothing that would close its own inline script tag', () => {
    expect(searchClientJs().toLowerCase()).not.toContain('</script')
    expect(SEARCH_CSS_OF(html).toLowerCase()).not.toContain('</style')
  })
})

const SEARCH_CSS_OF = (html) => html.match(/<style data-search-style>([\s\S]*?)<\/style>/)[1]

describe('the client script', () => {
  const js = searchClientJs()

  it('carries the server slugify by source, so hrefs cannot drift', () => {
    expect(js).toContain("replace(/[^a-z0-9]+/g, '-')")
    expect(js).toContain("'/' + level + '/' + slugify(name) + '-' + id")
  })

  it('is inert until the reader interacts — the index is fetched, never inlined', () => {
    expect(js).toContain('fetch(url')
    expect(js).toContain("form.getAttribute('data-search-index')")
  })

  it('initialises every form on the page and never twice', () => {
    expect(js).toContain("document.querySelectorAll('form[data-search]')")
    expect(js).toContain('if (form.dataset.searchReady) return')
  })

  it('waits for the document rather than assuming its own position', () => {
    expect(js).toContain("document.readyState === 'loading'")
    expect(js).toContain("addEventListener('DOMContentLoaded', boot)")
  })

  it('speaks the combobox pattern, and only once JavaScript is proven to run', () => {
    for (const attr of ['role', 'aria-expanded', 'aria-autocomplete', 'aria-controls', 'aria-activedescendant']) {
      expect(js).toContain(attr)
    }
    expect(js).toContain("list.setAttribute('role', 'listbox')")
    expect(js).toContain("li.setAttribute('role', 'option')")
  })

  it('is reachable by keyboard in both directions, and escapable', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', 'Escape', 'Tab']) {
      expect(js).toContain(`'${key}'`)
    }
  })

  it('navigates on choosing a result, rather than pinning a chart line', () => {
    expect(js).toContain('window.location.assign(r.href)')
    expect(js).toContain('window.location.assign(li.dataset.href)')
  })

  it('puts the district and county on every row', () => {
    expect(js).toContain("bits.push(r.district)")
    expect(js).toContain("' County'")
  })

  it('builds rows as text nodes, so a school name can never be markup', () => {
    expect(js).toContain('name.textContent = r.name')
    expect(js).not.toContain('innerHTML')
  })

  it('says what happened, for a reader who cannot see the list', () => {
    expect(renderSearch()).toContain('aria-live="polite"')  // the markup carries the region
    expect(js).toContain('[data-search-status]')
    expect(js).toContain('Use the up and down arrow keys')
  })

  it('says so when the index will not load, instead of looking like no matches', () => {
    expect(js).toContain('could not be loaded')
  })

  it('reads ?q= itself, which is what makes the fallback URL a real search', () => {
    expect(js).toContain('URLSearchParams')
  })

  it('parses as JavaScript', () => {
    expect(() => new Function(js)).not.toThrow()
  })
})

/* ------------------------------------------------------------------ pages -- */

const pageArgs = {
  districts: entities.filter((e) => e.level === 'district'),
  campuses: entities.filter((e) => e.level === 'campus'),
  snapshotDate: '15 August 2026',
}

describe('renderSearchPage — the no-JavaScript destination', () => {
  const hub = renderSearchPage(pageArgs)

  it('is a whole page with a title, a description and a canonical URL', () => {
    expect(hub).toContain('<h1>Find a school or district</h1>')
    expect(hub).toMatch(/<title>[^<]{10,}<\/title>/)
    expect(hub).toMatch(/<meta name="description" content="[^"]{40,}">/)
    expect(hub).toContain(`<link rel="canonical" href="https://txschools.net${SEARCH_PATH}">`)
  })

  it('lists every district as a real link, with no script involved', () => {
    for (const d of pageArgs.districts) expect(hub).toContain(`href="/district/${entitySlug(d)}"`)
    expect(hub).toContain('class="findlist"')
  })

  it('states its denominators', () => {
    expect(hub).toContain('3 districts')
    expect(hub).toContain('4 campuses')
  })

  it('sends campuses to the letter pages rather than pretending they are here', () => {
    expect(hub).not.toContain('Beverly Hills El')
    for (const l of SEARCH_LETTERS) expect(hub).toContain(`href="${SEARCH_PATH}/${l}"`)
  })

  it('counts each letter, so no letter advertises a page of nothing', () => {
    // b: Beverly Hills El + two Bradfield Els. h: two Highland Park ISDs.
    expect(hub).toMatch(/>B<\/a> <span class="chip-n">3 names/)
    expect(hub).toMatch(/>H<\/a> <span class="chip-n">2 names/)
    expect(hub).toMatch(/>D<\/a> <span class="chip-n">1 name</)
    expect(hub).toMatch(/>Z<\/a> <span class="chip-n">0 names/)
  })

  it('autofocuses here, because arriving is itself the decision to type', () => {
    expect(hub).toContain(' autofocus')
  })

  it('says it is unofficial', () => {
    expect(hub).toContain('unofficial')
  })

  const letterPage = renderSearchPage({ ...pageArgs, letter: 'b' })

  it('a letter page lists districts and campuses that begin with it, and nothing else', () => {
    expect(letterPage).toContain('<h1>Names starting with B</h1>')
    expect(letterPage).toContain('Beverly Hills El')
    expect(letterPage).toContain('Bradfield El')
    expect(letterPage).not.toContain('Dallas ISD</a>')
    expect(letterPage).toContain(`<link rel="canonical" href="https://txschools.net${SEARCH_PATH}/b">`)
  })

  it('a letter page disambiguates every duplicate name it lists', () => {
    const rows = [...letterPage.matchAll(/<li><a href="\/campus\/bradfield-el-(\d+)">Bradfield El<\/a><span class="findlist-in">([^<]+)<\/span>/g)]
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r[2])).toEqual([
      'Highland Park ISD &middot; Dallas County',
      'Highland Park ISD &middot; Potter County',
    ])
  })

  it('a letter page with nothing in it says so, rather than showing an empty list', () => {
    const empty = renderSearchPage({ ...pageArgs, letter: 'z' })
    expect(empty).toContain('No district in this snapshot has a name beginning with Z.')
    expect(empty).toContain('No campus in this snapshot has a name beginning with Z.')
  })

  it('filters the lists itself, so its heading is true whatever it is handed', () => {
    const page = renderSearchPage({ districts: pageArgs.districts, campuses: pageArgs.campuses, letter: 'd' })
    expect(page).toContain('1 districts starting with D')
    expect(page).toContain('0 campuses starting with D')
  })

  it('survives being handed nothing at all', () => {
    const bare = renderSearchPage()
    expect(bare).toContain('<h1>Find a school or district</h1>')
    expect(bare).toContain('No districts appear in this snapshot.')
  })

  it('offers a search box that is itself a working form', () => {
    expect(hub).toContain(`action="${SEARCH_PATH}"`)
    expect(letterPage).toContain('name="q"')
  })
})

describe('searchLetter', () => {
  it('is the first letter, lowercased', () => {
    expect(searchLetter('Dallas ISD')).toBe('d')
    expect(searchLetter('  elgin isd')).toBe('e')
  })

  it('is null for anything that is not a-z, so no page claims it', () => {
    expect(searchLetter('6th Grade Center')).toBe(null)
    expect(searchLetter('')).toBe(null)
    expect(searchLetter(null)).toBe(null)
  })
})

/* ------------------------------------------------------------- the home page -- */

describe('the home page leads with search', () => {
  const home = renderHomePage({
    regions: [{ id: '10', name: 'Region 10: Richardson', districtCount: 80 }],
    letters: [{ letter: 'a', count: 12 }],
    snapshotDate: '15 August 2026',
    stats: [
      ['Districts', 1199, 'Every Texas public school district in this snapshot'],
      ['Campuses', 9031, 'Individual schools, each with a page of its own'],
    ],
  })

  it('puts the search form before the regions and before the A-Z', () => {
    const box = home.indexOf('class="sitesearch')
    expect(box).toBeGreaterThan(-1)
    expect(box).toBeLessThan(home.indexOf('id="regions"'))
    expect(box).toBeLessThan(home.indexOf('id="index"'))
  })

  it('puts it inside the hero, above the paragraph explaining the site', () => {
    // The homepage hero carries the hero-home modifier (site/style.css's one
    // deliberate block of colour) — every other hub's hero stays bare.
    const hero = home.slice(home.indexOf('<section class="hero hero-home">'), home.indexOf('</section>'))
    expect(hero).toContain('class="sitesearch')
    expect(hero.indexOf('class="sitesearch')).toBeLessThan(hero.indexOf('class="lede"'))
  })

  it('reads its denominator off the stat grid it was already given', () => {
    expect(home).toContain('1,199 districts')
    expect(home).toContain('9,031 campuses')
  })

  it('takes an explicit counts argument in preference', () => {
    const html = renderHomePage({ counts: { districts: 2, campuses: 3 } })
    expect(html).toContain('2 districts')
    expect(html).toContain('3 campuses')
  })

  it('does not autofocus, so a phone keyboard never covers the page on arrival', () => {
    expect(home).not.toContain(' autofocus')
  })

  it('keeps the regions and the A-Z, below', () => {
    expect(home).toContain('href="/region/10"')
    expect(home).toContain('href="/districts/a"')
  })

  it('links the full district-and-campus index from the A-Z', () => {
    expect(home).toContain(`href="${SEARCH_PATH}"`)
  })

  it('still renders when handed nothing but regions', () => {
    const html = renderHomePage({ regions: [{ id: '10', name: 'Region 10' }] })
    expect(html).toContain('<h1>Texas school ratings</h1>')
    expect(html).toContain('Districts and campuses, by region, county and name')
  })
})

describe('navigation is navigation, not a chart legend', () => {
  it('the hubs A-Z is a nav element, not a .legend list', () => {
    const home = renderHomePage({ regions: [{ id: '10', name: 'Region 10' }] })
    expect(home).toContain('<nav class="sitenav"')
    expect(home).not.toContain('<ul class="legend">')
  })

  it('so is the search page letter nav', () => {
    expect(renderSearchPage(pageArgs)).toContain('aria-label="Search index by first letter"')
  })
})
