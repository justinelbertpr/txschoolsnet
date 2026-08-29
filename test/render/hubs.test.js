// test/render/hubs.test.js
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { describe, it, expect } from 'vitest'
import {
  renderRegionPage,
  renderCountyPage,
  renderDistrictsPage,
  renderChartersPage,
  renderLetterPage,
  renderHomePage,
  regionPath,
} from '../../src/render/hubs.js'

const district = (over = {}) => ({
  id: '057905',
  name: 'Dallas ISD',
  slug: 'dallas-isd-057905',
  level: 'district',
  rating: 'B',
  score: 85,
  enrollment: 139000,
  countyId: '057',
  county: 'Dallas',
  regionId: '10',
  isCharter: false,
  campusType: null,
  ...over,
})

const charterSystem = (over = {}) =>
  district({
    id: '101810',
    name: 'Draw Academy',
    slug: 'draw-academy-101810',
    entityType: 'Charter',
    isCharter: true,
    rating: 'A',
    score: 92,
    enrollment: 700,
    campusCount: 2,
    county: 'Harris',
    countyId: '201',
    regionId: '04',
    ...over,
  })

const region = (over = {}) => ({
  regionId: '10',
  regionName: 'Region 10: Richardson',
  districts: [district(), district({ id: '057916', name: 'Highland Park ISD', slug: 'highland-park-isd-057916', rating: 'A', score: 96, enrollment: 7100 })],
  counties: ['Dallas', 'Collin'],
  snapshotDate: '15 August 2026',
  ...over,
})

const county = (over = {}) => ({
  countyName: 'Dallas',
  countySlug: 'dallas',
  regionName: 'Region 10: Richardson',
  regionId: '10',
  districts: [district()],
  snapshotDate: '15 August 2026',
  ...over,
})

describe('every hub renderer', () => {
  const pages = [
    ['region', () => renderRegionPage(region()), 'Region 10: Richardson', 'https://txschools.net/region/10'],
    ['county', () => renderCountyPage(county()), 'Dallas County', 'https://txschools.net/county/dallas'],
    ['districts', () => renderDistrictsPage({ districts: [district()] }), 'Texas public school districts', 'https://txschools.net/districts'],
    ['charters', () => renderChartersPage({ charters: [charterSystem()] }), 'Texas charter school systems', 'https://txschools.net/charters'],
    ['letter', () => renderLetterPage({ letter: 'd', districts: [district()] }), 'Public school districts starting with D', 'https://txschools.net/districts/d'],
    ['home', () => renderHomePage({ regions: [{ id: '10', name: 'Region 10: Richardson' }] }), 'Texas school ratings', 'https://txschools.net/'],
  ]

  for (const [kind, render, heading, canonical] of pages) {
    it(`${kind}: returns a string carrying its heading`, () => {
      const html = render()
      expect(typeof html).toBe('string')
      expect(html).toContain(`<h1>${heading}</h1>`)
    })

    it(`${kind}: declares a canonical URL on SITE_ORIGIN`, () => {
      expect(render()).toContain(`<link rel="canonical" href="${canonical}">`)
    })

    it(`${kind}: has a title and a meta description`, () => {
      const html = render()
      expect(html).toMatch(/<title>[^<]{10,}<\/title>/)
      expect(html).toMatch(/<meta name="description" content="[^"]{40,}">/)
    })
  }
})

describe('district links', () => {
  it('links a district by /district/SLUG', () => {
    expect(renderRegionPage(region())).toContain('href="/district/dallas-isd-057905"')
  })

  it('falls back to entitySlug when the caller omits slug', () => {
    const html = renderCountyPage(county({ districts: [district({ slug: undefined })] }))
    expect(html).toContain('href="/district/dallas-isd-057905"')
  })

  it('links a district from the letter index too', () => {
    expect(renderLetterPage({ letter: 'd', districts: [district()] })).toContain('href="/district/dallas-isd-057905"')
  })
})

describe('empty lists', () => {
  it('region: states the emptiness instead of rendering an empty table', () => {
    const html = renderRegionPage(region({ districts: [], counties: [] }))
    expect(html).toContain('No districts in Region 10: Richardson appear in this snapshot.')
    expect(html).not.toContain('<table')
  })

  it('county: states the emptiness instead of rendering an empty table', () => {
    const html = renderCountyPage(county({ districts: [] }))
    expect(html).toContain('No districts in Dallas County appear in this snapshot.')
    expect(html).not.toContain('<table')
  })

  it('letter: states the emptiness instead of rendering an empty table', () => {
    const html = renderLetterPage({ letter: 'q', districts: [] })
    expect(html).toContain('No geographic public school district in this snapshot has a name beginning with Q.')
    expect(html).not.toContain('<table')
  })

  it('charters: states the emptiness instead of rendering an empty table', () => {
    const html = renderChartersPage({ charters: [] })
    expect(html).toContain('No open-enrollment charter school systems appear in this snapshot.')
    expect(html).not.toContain('<table')
  })

  it('home: renders without regions, letters or stats', () => {
    const html = renderHomePage({})
    expect(html).toContain('<h1>Texas school ratings</h1>')
    expect(html).toContain('No regions are listed in this snapshot.')
  })

  it('renders a zero count rather than crashing', () => {
    expect(renderRegionPage(region({ districts: [] }))).toContain('0 districts in Region 10')
  })
})

describe('breadcrumbs', () => {
  it('region: sits under the site root', () => {
    const html = renderRegionPage(region())
    expect(html).toContain('<li><a href="/">Texas schools</a></li>')
    expect(html).toContain('<li aria-current="page">Region 10: Richardson</li>')
  })

  it('county: climbs through its region', () => {
    const html = renderCountyPage(county())
    expect(html).toContain('<li><a href="/region/10">Region 10: Richardson</a></li>')
    expect(html).toContain('<li aria-current="page">Dallas County</li>')
  })

  it('county: drops the region crumb when no region was given', () => {
    const html = renderCountyPage(county({ regionId: null, regionName: null }))
    expect(html).toContain('<li aria-current="page">Dallas County</li>')
    expect(html).not.toContain('/region/')
  })

  it('letter: sits under the site root', () => {
    const html = renderLetterPage({ letter: 'd', districts: [] })
    expect(html).toContain('<li><a href="/districts">Districts</a></li>')
    expect(html).toContain('<li aria-current="page">D</li>')
  })
})

describe('counts and averages state their denominator', () => {
  it('reports the region average with its n', () => {
    const html = renderRegionPage(region())
    expect(html).toContain('90.5') // mean of 85 and 96
    expect(html).toContain('across the 2 districts with a published overall score')
  })

  it('compares against the state average only when given both sides', () => {
    const bare = renderRegionPage(region())
    expect(bare).not.toContain('state average')

    const withState = renderRegionPage(region({ stateAvg: 79.8, stateN: 1199 }))
    expect(withState).toContain('the state average of 79.8, which averages 1,199 Texas districts')
    expect(withState).toContain('10.7 points above')
  })

  it('omits the campus figure when no campuses were supplied', () => {
    expect(renderRegionPage(region())).not.toContain('Campuses')
  })

  it('counts campus rows separately from district rows', () => {
    const html = renderRegionPage(
      region({
        districts: [
          ...region().districts,
          { id: '057905001', name: 'Cayuga HS', slug: 'cayuga-hs-057905001', level: 'campus', score: 70 },
        ],
      })
    )
    expect(html).toContain('<dt>Campuses</dt><dd>1</dd>')
    expect(html).toContain('2 districts in Region 10: Richardson')
    expect(html).not.toContain('href="/district/cayuga-hs-057905001"')
  })

  it('says so plainly when nothing has a published score', () => {
    const html = renderCountyPage(county({ districts: [district({ score: null, rating: 'Not Rated' })] }))
    expect(html).toContain('No district in Dallas County has a published overall score')
  })
})

describe('counties', () => {
  it('lists the given counties as links', () => {
    const html = renderRegionPage(region())
    expect(html).toContain('href="/county/dallas"')
    expect(html).toContain('href="/county/collin"')
  })

  it('derives the county list from the districts when none is given', () => {
    const html = renderRegionPage(region({ counties: [] }))
    expect(html).toContain('href="/county/dallas"')
    expect(html).toContain('1 county in this region')
  })

  it('accepts county objects with an explicit slug', () => {
    const html = renderRegionPage(region({ counties: [{ name: 'De Witt', slug: 'de-witt', districtCount: 3 }] }))
    expect(html).toContain('href="/county/de-witt"')
    expect(html).toContain('De Witt County')
  })
})

describe('letter pages', () => {
  it('keeps only geographic districts whose name begins with the letter', () => {
    const html = renderLetterPage({
      letter: 'd',
      districts: [
        district(),
        district({ id: '109901', name: 'Abbott ISD', slug: 'abbott-isd-109901' }),
        charterSystem(),
      ],
    })
    expect(html).toContain('Dallas ISD')
    expect(html).not.toContain('Abbott ISD')
    expect(html).not.toContain('Draw Academy')
    expect(html).toContain('1 geographic district beginning with D')
  })

  it('carries an A-Z nav and marks the current letter', () => {
    const html = renderLetterPage({ letter: 'd', districts: [] })
    expect(html).toContain('<a href="/districts/a">A</a>')
    expect(html).toContain('<a href="/districts/z">Z</a>')
    expect(html).toContain('<a href="/districts/d" aria-current="page">D</a>')
  })

  it('accepts an uppercase letter', () => {
    const html = renderLetterPage({ letter: 'D', districts: [district()] })
    expect(html).toContain('https://txschools.net/districts/d')
    expect(html).toContain('<h1>Public school districts starting with D</h1>')
  })

  it('never places a charter system under the Districts tab', () => {
    const html = renderLetterPage({ letter: 'd', districts: [district(), charterSystem()] })
    expect(html).toContain('Dallas ISD')
    expect(html).not.toContain('Draw Academy')
    expect(html).not.toContain('<th>Type</th>')
    expect(html).toContain('href="/charters"')
    expect(html).toContain('separate statewide index')
  })
})

describe('district and charter browse separation', () => {
  const mixed = [district(), charterSystem()]

  it('gives geographic districts their own landing page and counts only that sector', () => {
    const html = renderDistrictsPage({ districts: mixed })
    expect(html).toContain('<h1>Texas public school districts</h1>')
    expect(html).toContain('1 geographic district')
    expect(html).toContain('href="/districts/d"')
    expect(html).toContain('href="/charters"')
    expect(html).not.toContain('Draw Academy')
    expect(html).not.toContain('2 geographic districts')
  })

  it('keeps each browse index linked to the other without mixing their rows', () => {
    const districts = renderDistrictsPage({ districts: mixed })
    const charters = renderChartersPage({ districts: mixed })
    expect(districts).toContain('Browse charter school systems')
    expect(districts).not.toContain('Draw Academy')
    expect(charters).toContain('Draw Academy')
    expect(charters).not.toContain('Dallas ISD')
    expect(charters).toContain('href="/districts"')
  })
})

describe('charter school systems hub', () => {
  it('filters a mixed all-entity list to charter systems and charter campuses', () => {
    const html = renderChartersPage({
      districts: [
        district(),
        charterSystem(),
        { ...charterSystem({ id: '101810001', name: 'Draw Academy Campus', slug: 'draw-academy-campus-101810001' }), level: 'campus' },
        { ...district({ id: '057905001', name: 'Dallas Campus' }), level: 'campus' },
      ],
    })
    expect(html).toContain('Draw Academy')
    expect(html).toContain('<dt>Charter school systems</dt><dd>1</dd>')
    expect(html).toContain('<dt>Campuses</dt><dd>1</dd>')
    expect(html).not.toContain('Dallas ISD')
    expect(html).not.toContain('Dallas Campus')
  })

  it('treats county as administrative context and never links it as a cohort', () => {
    const html = renderChartersPage({ charters: [charterSystem()] })
    expect(html).toContain('<th>Administrative county</th>')
    expect(html).toContain('<td>Harris</td>')
    expect(html).not.toContain('href="/county/harris"')
    expect(html).toMatch(/not presented here as a geographic attendance boundary/i)
  })

  it('states the score denominator and links the separate district index and search', () => {
    const html = renderChartersPage({
      charters: [charterSystem(), charterSystem({ id: '101811', name: 'Evolve Academy', slug: 'evolve-academy-101811', score: 82 })],
    })
    expect(html).toContain('87.0')
    expect(html).toContain('The Texas charter-school sector averages')
    expect(html).toContain('across the 2 charter school systems with a published overall score')
    expect(html).toContain('href="/districts"')
    expect(html).toContain('href="/search"')
  })
})

describe('geographic region and county hubs', () => {
  const mixed = [
    ...region().districts,
    charterSystem({ name: 'Metro Charter', slug: 'metro-charter-101810', score: 100 }),
    { ...charterSystem({ id: '101810001', name: 'Metro Charter Campus' }), level: 'campus' },
  ]

  it('rejects charter rows from region counts, averages and tables', () => {
    const html = renderRegionPage(region({ districts: mixed }))
    expect(html).toContain('2 districts in Region 10: Richardson')
    expect(html).toContain('90.5')
    expect(html).not.toContain('Metro Charter')
    expect(html).not.toContain('<dt>Campuses</dt>')
    expect(html).toContain('Every geographic')
    expect(html).toContain('open-enrollment charter systems are indexed statewide')
  })

  it('rejects charter rows from county counts, averages and tables', () => {
    const html = renderCountyPage(county({ districts: [district(), ...mixed.slice(2)] }))
    expect(html).toContain('1 district in Dallas County')
    expect(html).toContain('85.0')
    expect(html).not.toContain('Metro Charter')
    expect(html).not.toContain('<dt>Campuses</dt>')
    expect(html).toContain('Every geographic public school district')
    expect(html).toContain('recorded county is not an attendance boundary')
  })
})

describe('home page', () => {
  it('says it is unofficial and links /about', () => {
    const html = renderHomePage({})
    expect(html).toContain('<strong>unofficial</strong>')
    expect(html).toContain('href="/about"')
  })

  it('states both geographic and charter-system coverage without an exclusion claim', () => {
    const html = renderHomePage({
      counts: { geographicDistricts: 1020, charterSystems: 179, campuses: 9031 },
      stats: [
        ['Districts', 1199, 'Every Texas public school district in this snapshot'],
        ['Campuses', 9031, 'Individual schools, each with a page of its own'],
      ],
    })

    // The scope is stated by the lede and the two stat notes below. The hero
    // eyebrow used to say it a fourth time, above the h1, and was removed as
    // redundant chrome on a phone — so this asserts it is gone, and that the
    // scope survives its removal.
    expect(html).not.toContain('<p class="eyebrow">Traditional public schools in Texas</p>')
    expect(html).toContain('1,020 geographic districts')
    expect(html).toContain('179 charter school systems')
    expect(html).toContain('9,031 campuses')
    expect(html).toContain('Geographic districts and open-enrollment charter school systems in this snapshot')
    expect(html).toContain('Campuses operated by geographic districts and charter school systems')
    expect(html).toContain('href="/charters"')
    expect(html).not.toMatch(/charters excluded|charters are not included/i)
    expect(html).not.toContain('Every Texas public school district in this snapshot')
  })

  it('exposes a responsive hero and a three-part trust strip', () => {
    const html = renderHomePage({ snapshotDate: '15 August 2026' })
    expect(html).toContain('<div class="home-hero-grid">')
    expect(html).toContain('<div class="home-hero-copy">')
    expect(html).toContain('<div class="home-hero-action">')
    expect(html).toContain('<div class="home-hero-address">')
    expect(html.indexOf('home-hero-address')).toBeGreaterThan(html.indexOf('home-hero-action'))
    const action = html.slice(html.indexOf('home-hero-action'), html.indexOf('home-hero-address'))
    expect(action).not.toContain('data-address-lookup')
    expect(action).not.toContain('Explore TEA')
    const hero = new JSDOM(html).window.document.querySelector('.home-hero-grid')
    expect([...hero.children].map((node) => node.className)).toEqual([
      'home-hero-copy',
      'home-hero-action',
      'home-hero-address',
    ])
    expect(hero.children[2].textContent).toContain('Explore TEA')
    expect(html).toContain('<aside class="home-trust-strip"')
    expect(html).toContain('home-trust-independent')
    expect(html).toContain('home-trust-coverage')
    expect(html).toContain('home-trust-source')
    expect(html).toContain('fetched 15 August 2026')
  })

  it('keeps the title stable while the address drawer grows downward', () => {
    const css = readFileSync(new URL('../../site/style.css', import.meta.url), 'utf8')
    expect(css).toMatch(/\.home-hero-grid\s*\{[^}]*align-items:\s*center/)
    expect(css).toMatch(/\.home-hero-address\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/)
    expect(css).toMatch(/@media \(max-width: 70rem\)[\s\S]*?\.home-hero-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/)
  })

  it('keeps open name-search results above the address drawer and outside the hero clip', () => {
    const css = readFileSync(new URL('../../site/style.css', import.meta.url), 'utf8')
    expect(css).toMatch(/\.home-hero-action:has\(\.sitesearch-panel:not\(\[hidden\]\)\)\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*2/)
    expect(css).toMatch(/main\s*>\s*section\.hero-home:has\(\.sitesearch-panel:not\(\[hidden\]\)\)\s*\{[^}]*overflow:\s*visible/)
  })

  it('offers explicit paths for families, ranking readers and journalists', () => {
    const html = renderHomePage({ rankingsIndex: '/rankings' })
    expect(html).toContain('home-task-card-families')
    expect(html).toContain('home-task-card-rankings')
    expect(html).toContain('home-task-card-journalists')
    expect(html).toContain('href="/search">Search and browse schools</a>')
    expect(html).toContain('href="/rankings">Explore rankings</a>')
    expect(html).toContain('href="/download">Get data and documentation</a>')
  })

  it('adds stable hooks to the scannable homepage sections', () => {
    const html = renderHomePage({
      regions: [{ id: '10', name: 'Region 10' }],
      stats: { Districts: 1020 },
      rankings: [{ href: '/rankings/example', label: 'Example ranking', meta: '10 districts' }],
      rankingsIndex: '/rankings',
    })
    expect(html).toContain('<section id="rankings" class="home-section home-rankings">')
    expect(html).toContain('class="navlist home-ranking-list"')
    expect(html).toContain('<section id="statewide" class="home-section home-stats">')
    expect(html).toContain('<section id="regions" class="home-section home-regions">')
    expect(html).toContain('class="navlist home-region-list"')
    expect(html).toContain('<section id="index" class="home-section home-index">')
    expect(html).toContain('class="navlist home-az-list"')
    expect(html).toContain('<section id="data" class="home-section home-data">')
  })

  it('links every region it is given', () => {
    const html = renderHomePage({
      regions: Array.from({ length: 20 }, (_, i) => ({ id: String(i + 1).padStart(2, '0'), name: `Region ${i + 1}` })),
    })
    expect(html).toContain('20 education service regions')
    expect(html).toContain('href="/region/01"')
    expect(html).toContain('href="/region/20"')
  })

  it('offers the full A-Z index by default', () => {
    const html = renderHomePage({})
    expect(html).toContain('href="/districts/a"')
    expect(html).toContain('href="/districts/z"')
  })

  it('prints the stats it is handed and invents none', () => {
    const html = renderHomePage({ stats: { Districts: 1199, Campuses: 9031 } })
    expect(html).toContain('<dt>Districts</dt><dd>1,199</dd>')
    expect(html).toContain('<dt>Campuses</dt><dd>9,031</dd>')
  })

  it('accepts stats as label/value/note triples', () => {
    const html = renderHomePage({ stats: [['Rated A', 214, 'of 1,199 districts']] })
    // The note lives inside the <dd> it describes, not as a <p> sibling of
    // dt/dd inside the wrapping div — a <dl> group's div may contain only
    // dt/dd (plus script/template), so a stray <p> there is invalid markup.
    expect(html).toContain('<dt>Rated A</dt><dd>214<p class="stat-note">of 1,199 districts</p></dd>')
  })

  it('resets statistic descriptions to readable body typography', () => {
    const css = readFileSync(new URL('../../site/style.css', import.meta.url), 'utf8')
    const rule = css.match(/#statewide \.stat-note\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toMatch(/font-family:\s*var\(--font-sans\)/)
    expect(rule).toMatch(/font-size:\s*var\(--t-small\)/)
    expect(rule).toMatch(/color:\s*var\(--ink-2\)/)
    expect(rule).toMatch(/letter-spacing:\s*normal/)
    expect(rule).toMatch(/line-height:\s*1\.45/)
    expect(rule).toMatch(/overflow-wrap:\s*anywhere/)
  })

  it('drops the stats section entirely when given no stats', () => {
    expect(renderHomePage({})).not.toContain('Texas public schools at a glance')
  })

  it('escapes a string stat rather than injecting it', () => {
    const html = renderHomePage({ stats: [['Note', '<script>x</script>']] })
    expect(html).not.toContain('<script>x</script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('regionPath', () => {
  it('zero-pads to the two-character ids the URL scheme uses', () => {
    expect(regionPath(7)).toBe('07')
    expect(regionPath('7')).toBe('07')
    expect(regionPath('07')).toBe('07')
    expect(regionPath('20')).toBe('20')
  })

  it('is applied to the canonical URL', () => {
    expect(renderRegionPage(region({ regionId: 7 }))).toContain('https://txschools.net/region/07')
  })
})

/* ------------------------------------------------------------- rankings -- */
//
// A hub already orders its districts by score, but the ordering is a table on a
// page about a place — /region/10 was 112 districts sorted by score and never
// labelled as an ordering at all. These links point at the pages that ARE the
// list. Nothing here decides which rankings exist: the caller passes only boards
// it wrote, so a hub can neither invent a ranking nor link a page that is not
// there.

describe('ranking links on the hubs', () => {
  const boards = [
    { href: '/rankings/region-10-districts/overall-score-highest', label: 'Region 10 districts by overall score', meta: '110 districts' },
    { href: '/rankings/region-10-districts/overall-score-gains', label: 'Region 10 districts by gain since 2021-22', meta: '108 districts' },
  ]

  const withRankings = {
    region: () => renderRegionPage({ ...region(), rankings: boards, rankingsIndex: '/rankings' }),
    county: () => renderCountyPage({ ...county(), rankings: boards, rankingsIndex: '/rankings' }),
    home: () => renderHomePage({ regions: [{ id: '10', name: 'Region 10' }], rankings: boards, rankingsIndex: '/rankings' }),
  }

  for (const [kind, render] of Object.entries(withRankings)) {
    it(`${kind}: links every ranking it is given, and the index`, () => {
      const html = render()
      expect(html).toContain('<section id="rankings"')
      expect(html).toContain('href="/rankings/region-10-districts/overall-score-highest"')
      expect(html).toContain('href="/rankings">')
    })

    it(`${kind}: states the population beside every ranked list it links`, () => {
      // A link to a ranking with no n is the same unlabelled boast a rank with
      // no n is.
      expect(render()).toContain('110 districts')
    })
  }

  it('renders no rankings section at all when none were built', () => {
    expect(renderRegionPage(region())).not.toContain('<section id="rankings">')
    expect(renderCountyPage(county())).not.toContain('<section id="rankings">')
    expect(renderHomePage({})).not.toContain('<section id="rankings">')
  })

  it('still points a county with no ranking of its own at the ones that exist', () => {
    // 231 of 253 counties hold fewer than ten rated districts, so no ranking is
    // published for them. The hub says where the rankings are rather than
    // pretending there are none.
    const html = renderCountyPage({ ...county(), rankings: [], rankingsIndex: '/rankings' })
    expect(html).toContain('<section id="rankings">')
    expect(html).toContain('href="/rankings">')
  })

  it('home: leads with search and task paths before rankings and browsing tools', () => {
    const html = renderHomePage({
      regions: [{ id: '10', name: 'Region 10' }],
      stats: { Districts: 1199 },
      rankings: boards,
      rankingsIndex: '/rankings',
    })
    expect(html.indexOf('home-search')).toBeLessThan(html.indexOf('home-trust-strip'))
    expect(html.indexOf('home-trust-strip')).toBeLessThan(html.indexOf('home-task-grid'))
    expect(html.indexOf('home-task-grid')).toBeLessThan(html.indexOf('Texas schools, ranked'))
    expect(html.indexOf('Texas schools, ranked')).toBeLessThan(html.indexOf('Texas public schools at a glance'))
    expect(html.indexOf('Texas public schools at a glance')).toBeLessThan(
      html.indexOf('education service regions')
    )
  })

  it('names the population each hub ranks in its own heading', () => {
    expect(withRankings.region()).toContain('Region 10: Richardson ranked')
    expect(withRankings.county()).toContain('Dallas County ranked')
  })

  // Fixed in src/prerender.js:rankingBoardsFor, which used to drop every
  // 'bottom'-end board (b.end !== 'top') before a hub ever saw it — so the
  // front page, every region and every county linked "highest"/"gains" only,
  // never "lowest"/"declines". Nothing in THIS file ever filtered by end; a
  // hub renders whatever boards it is handed, in order, which is exactly what
  // makes prerender.js the whole fix. These fixtures document that contract
  // from the hub's side: handed both ends of a metric, a hub links both.
  const bothEnds = [
    { href: '/rankings/region-10-districts/overall-score-highest', label: 'Region 10 districts with the highest overall score', meta: '110 districts' },
    { href: '/rankings/region-10-districts/overall-score-lowest', label: 'Region 10 districts with the lowest overall score', meta: '110 districts' },
  ]

  it('links a board\'s "lowest" end right alongside its "highest" one, not only the flattering half', () => {
    const html = renderRegionPage({ ...region(), rankings: bothEnds, rankingsIndex: '/rankings' })
    expect(html).toContain('href="/rankings/region-10-districts/overall-score-highest"')
    expect(html).toContain('href="/rankings/region-10-districts/overall-score-lowest"')
  })

  it('does the same on the county hub and the front page', () => {
    const county_ = renderCountyPage({ ...county(), rankings: bothEnds, rankingsIndex: '/rankings' })
    const home = renderHomePage({ regions: [{ id: '10', name: 'Region 10' }], rankings: bothEnds, rankingsIndex: '/rankings' })
    for (const html of [county_, home]) {
      expect(html).toContain('overall-score-highest')
      expect(html).toContain('overall-score-lowest')
    }
  })
})
