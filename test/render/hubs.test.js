// test/render/hubs.test.js
import { describe, it, expect } from 'vitest'
import { renderRegionPage, renderCountyPage, renderLetterPage, renderHomePage, regionPath } from '../../src/render/hubs.js'

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
    ['letter', () => renderLetterPage({ letter: 'd', districts: [district()] }), 'Districts starting with D', 'https://txschools.net/districts/d'],
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
    expect(html).toContain('No district in this snapshot has a name beginning with Q.')
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
    expect(renderLetterPage({ letter: 'd', districts: [] })).toContain('<li aria-current="page">Districts: D</li>')
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
  it('keeps only districts whose name begins with the letter', () => {
    const html = renderLetterPage({
      letter: 'd',
      districts: [district(), district({ id: '109901', name: 'Abbott ISD', slug: 'abbott-isd-109901' })],
    })
    expect(html).toContain('Dallas ISD')
    expect(html).not.toContain('Abbott ISD')
    expect(html).toContain('1 district beginning with D')
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
    expect(html).toContain('<h1>Districts starting with D</h1>')
  })
})

describe('home page', () => {
  it('says it is unofficial and links /about', () => {
    const html = renderHomePage({})
    expect(html).toContain('<strong>unofficial</strong>')
    expect(html).toContain('href="/about"')
  })

  it('states the traditional-public-school scope without claiming every Texas public school', () => {
    const html = renderHomePage({
      stats: [
        ['Districts', 1020, 'Every Texas public school district in this snapshot'],
        ['Campuses', 8066, 'Individual schools, each with a page of its own'],
      ],
    })

    // The scope is stated by the lede and the two stat notes below. The hero
    // eyebrow used to say it a fourth time, above the h1, and was removed as
    // redundant chrome on a phone — so this asserts it is gone, and that the
    // scope survives its removal.
    expect(html).not.toContain('<p class="eyebrow">Traditional public schools in Texas</p>')
    expect(html).toContain('Open-enrollment charter districts and campuses are not included.')
    expect(html).toContain('Traditional public school districts included in this snapshot')
    expect(html).toContain('Schools in those traditional public school districts')
    expect(html).not.toContain('Search every Texas public school')
    expect(html).not.toContain('Every Texas public school district in this snapshot')
  })

  it('exposes a two-column hero and a three-part trust strip', () => {
    const html = renderHomePage({ snapshotDate: '15 August 2026' })
    expect(html).toContain('<div class="home-hero-grid">')
    expect(html).toContain('<div class="home-hero-copy">')
    expect(html).toContain('<div class="home-hero-action">')
    expect(html).toContain('<aside class="home-trust-strip"')
    expect(html).toContain('home-trust-independent')
    expect(html).toContain('home-trust-coverage')
    expect(html).toContain('home-trust-source')
    expect(html).toContain('fetched 15 August 2026')
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

  it('drops the stats section entirely when given no stats', () => {
    expect(renderHomePage({})).not.toContain('Traditional public schools at a glance')
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
    expect(html.indexOf('Texas schools, ranked')).toBeLessThan(html.indexOf('Traditional public schools at a glance'))
    expect(html.indexOf('Traditional public schools at a glance')).toBeLessThan(
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
