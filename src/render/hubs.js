// The pages the breadcrumbs point at. A region, a county, a letter of the alphabet
// and the front page are the same shape: a named cohort, its denominator, and a
// table of links out of it. They go through shell() and reuse section/table/
// statGrid/grade, so a hub reads like an entity page with fewer sections rather
// than like a second site bolted on.
//
// The rule the entity pages follow holds here too: a page states only figures it
// was handed. Nothing below computes a statewide number, invents a campus count,
// or prints a comparison it was not given the other side of. Where an argument is
// missing the sentence carrying it disappears — it is never filled with a guess.

import {
  esc,
  grade,
  navList,
  num,
  section,
  shell,
  statGrid,
  table,
  SITE_ORIGIN,
  TEA_REPORTS_DATA_PORTAL,
} from './shell.js'
import { entitySlug, slugify } from './view-model.js'
import { renderSearch, SEARCH_PATH } from './search.js'
import { ADDRESS_SCRIPT_PATH, renderAddressLookup } from './address.js'

/* ------------------------------------------------------------- primitives -- */

/** regionId is a zero-padded 2-char string; callers pass 7, '7' and '07' alike. */
export const regionPath = (regionId) => String(regionId ?? '').padStart(2, '0')

const href = (d) => `/district/${esc(d.slug || entitySlug(d))}`

const finite = (v) => typeof v === 'number' && Number.isFinite(v)

/** TEA's district-level table contains both geographic districts and charter LEAs. */
const charter = (row) => row?.isCharter === true || String(row?.entityType ?? '').toLowerCase() === 'charter'

/** Region and county hubs describe geographic school systems, never charter administrative rows. */
const geographicOnly = (rows) => (rows ?? []).filter((row) => !charter(row))

/** Mean of the published scores, plus the n it averages. Never one without the other. */
const avgScore = (rows) => {
  const xs = rows.map((d) => d.score).filter(finite)
  if (!xs.length) return { avg: null, n: 0 }
  return { avg: Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10, n: xs.length }
}

/** A caller may hand a mixed list; districts and campuses are counted separately. */
const split = (list) => ({
  districts: (list ?? []).filter((e) => e && e.level !== 'campus'),
  campuses: (list ?? []).filter((e) => e && e.level === 'campus'),
})

/**
 * Campuses are only counted when they were actually supplied — either as rows in
 * the list, or as a campusCount on every district. Otherwise the figure is null
 * and the page simply does not mention campuses.
 */
const campusTotal = (districts, campuses) => {
  if (campuses.length) return campuses.length
  const counts = districts.map((d) => d.campusCount).filter(finite)
  return counts.length === districts.length && counts.length ? counts.reduce((a, b) => a + b, 0) : null
}

const enrollTotal = (rows) => {
  const xs = rows.map((d) => d.enrollment).filter(finite)
  return xs.length ? { total: xs.reduce((a, b) => a + b, 0), n: xs.length } : { total: null, n: 0 }
}

const byScoreThenName = (a, b) =>
  (finite(b.score) ? b.score : -1) - (finite(a.score) ? a.score : -1) ||
  String(a.name ?? '').localeCompare(String(b.name ?? ''))

const byName = (a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''))

/* ------------------------------------------------------------------ parts -- */

/**
 * `search` is raw markup dropped between the place line and the lede, so the one
 * control a visitor came to use sits above the paragraph explaining the site
 * rather than below it. Every other hub passes nothing and is unchanged.
 */
const hero = ({ eyebrow, title, place = '', lede = '', search = '', variant = null }) => `<section class="hero${
  variant ? ` hero-${esc(variant)}` : ''
}">
  ${eyebrow ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ''}
  <h1>${esc(title)}</h1>
  ${place ? `<p class="place">${place}</p>` : ''}
  ${search}
  ${lede ? `<p class="lede">${lede}</p>` : ''}
</section>`

const IRREGULAR = { campus: 'campuses', county: 'counties' }
const plural = (n, word) => `${num(n)} ${n === 1 ? word : IRREGULAR[word] ?? `${word}s`}`

/**
 * A wrapped row of links. It used to emit `.legend` markup, which is the class a
 * chart key uses: wrapping twenty region links in one tells a screen-reader user
 * that the front page's navigation is a figure legend. It goes through
 * shell.js:navList now — same wrapped layout, real navigation semantics.
 *
 * A count beside a link always carries its unit — a bare number next to a name is
 * the same unlabelled boast a rank without an n would be.
 */
const linkList = (items, label = null, { className = null } = {}) =>
  navList(
    items.map((i) => ({
      href: i.href,
      label: i.label,
      current: i.current,
      meta: finite(i.n) ? plural(i.n, i.unit ?? 'district') : null,
    })),
    { label, className }
  )

/* -------------------------------------------------------------- rankings -- */

/**
 * The ranked lists that cover this page's population.
 *
 * A hub already orders its districts by score, but the ordering is a table on a
 * page about a place, not a list anyone can cite: /region/10 is 112 districts
 * sorted by score with no heading that says so and nothing above 112. These
 * links point at the pages that ARE the list — statewide, by region, by county —
 * so "the top 20 districts in Texas" has somewhere to be read off.
 *
 * Nothing here decides which rankings exist. The caller (src/prerender.js)
 * passes only boards it actually wrote, each with the population count it was
 * computed over, so a hub can neither invent a ranking nor link a page that was
 * not built. With no boards passed the section does not render at all, which is
 * what keeps every existing hub byte-identical.
 *
 * items: [{ href, label, meta }] — `meta` is the caller's population line
 * ("1,199 districts"), carried through navList's count slot, because a link to a
 * ranking with no n is the same unlabelled boast a rank with no n is.
 */
const rankingList = (items, ariaLabel, className = null) =>
  navList(
    (items ?? [])
      .filter((r) => r && r.href && r.label)
      .map((r) => ({ href: r.href, label: r.label, meta: r.meta ?? null })),
    { label: ariaLabel, className }
  )

/**
 * Homepage sections need stable layout hooks, while every other hub must keep
 * the shared section() markup it already has. This local variant adds a class
 * only when the caller asks for one; the null path delegates to section() so
 * region and county output remains byte-for-byte unchanged.
 */
const hubSection = (id, heading, inner, lede = '', className = null) =>
  !className
    ? section(id, heading, inner, lede)
    : `<section id="${esc(id)}" class="${esc(className)}">
  <h2>${esc(heading)}</h2>${lede ? `\n  <p class="lede">${lede}</p>` : ''}
  ${inner}
</section>`

const rankingsSection = ({
  rankings,
  rankingsIndex,
  heading,
  lede,
  ariaLabel,
  more = null,
  className = null,
  listClassName = null,
}) => {
  const items = (rankings ?? []).filter((r) => r && r.href && r.label)
  if (!items.length && !rankingsIndex) return null
  const tail = rankingsIndex
    ? `<p class="note"><a href="${esc(rankingsIndex)}">${esc(more ?? 'Every ranking this site publishes')}</a> —
       each one states the population it ranks, how many entities are in it, and what was left out.</p>`
    : ''
  const inner = className
    ? `<div class="home-rankings-content">
    ${items.length ? rankingList(items, ariaLabel, listClassName) : ''}
    ${tail}
  </div>`
    : `${items.length ? rankingList(items, ariaLabel, listClassName) : ''}\n  ${tail}`
  return hubSection(
    'rankings',
    heading,
    inner,
    lede,
    className
  )
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'.split('')

const azNav = (current = null, counts = null) =>
  linkList(
    ALPHABET.map((l) => ({
      href: `/districts/${l}`,
      label: l.toUpperCase(),
      current: current === l,
      n: counts?.get(l) ?? null,
    })),
    'Geographic district index by first letter',
    // 26 single-character links: a run of underlined text turns each one into
    // a ~9px-wide tap target — style.css's .navlist-letters gives them the
    // real button-sized targets a letter-only link needs.
    { className: 'navlist-letters' }
  )

/**
 * The districts table. Returns a stated-empty paragraph instead of a table with no
 * rows, because an empty table reads as a rendering failure rather than as a fact.
 */
const districtTable = (
  districts,
  {
    caption,
    showCounty = false,
    showType = false,
    entityHeading = 'District',
    countyHeading = 'County',
    linkCounties = true,
    emptyMessage,
  }
) => {
  if (!districts.length) return `<p class="note na">${esc(emptyMessage)}</p>`

  const head = [
    entityHeading,
    showType ? 'Type' : null,
    showCounty ? countyHeading : null,
    'Rating',
    { label: 'Score', num: true },
    { label: 'Students', num: true },
  ].filter(Boolean)

  const rows = districts.map(
    (d) =>
      `<tr><th scope="row"><a href="${href(d)}">${esc(d.name ?? d.id)}</a></th>${
        showType ? `<td>${charter(d) ? 'Charter school system' : 'Geographic district'}</td>` : ''
      }${
        showCounty
          ? `<td>${
              d.county
                ? linkCounties && !charter(d)
                  ? `<a href="/county/${esc(slugify(d.county))}">${esc(d.county)}</a>`
                  : esc(d.county)
                : '—'
            }</td>`
          : ''
      }<td>${grade(d.rating)}</td><td class="num">${finite(d.score) ? d.score : '—'}</td><td class="num">${num(
        d.enrollment
      )}</td></tr>`
  )

  return table({ caption, head, rows, className: 'data scroll' })
}

/**
 * The average line. States its own n always, and the state's n whenever the caller
 * supplied it. With no state average given, the comparison clause is simply absent.
 */
const averageLine = ({ mine, unit, cohort: rawCohort, stateAvg = null, stateN = null }) => {
  const cohort = esc(rawCohort)
  if (mine.avg == null) {
    return `<p class="note na">No ${unit.replace(/s$/, '')} in ${cohort} has a published overall score in this snapshot, so no average is shown.</p>`
  }
  const own = `${cohort} averages <strong>${mine.avg.toFixed(1)}</strong> across the ${num(mine.n)} ${
    mine.n === 1 ? unit.replace(/s$/, '') : unit
  } with a published overall score.`
  if (!finite(stateAvg)) return `<p class="callout">${own}</p>`

  const d = mine.avg - stateAvg
  const against = finite(stateN)
    ? `the state average of ${stateAvg.toFixed(1)}, which averages ${num(stateN)} Texas ${unit}`
    : `the state average of ${stateAvg.toFixed(1)}`
  const rel =
    Math.abs(d) < 0.05
      ? `That is level with ${against}.`
      : `That is <strong>${Math.abs(d).toFixed(1)} points ${d > 0 ? 'above' : 'below'}</strong> ${against}.`
  return `<p class="callout">${own} ${rel}</p>`
}

/** Source and downloads, matching the entity pages' closing section. */
const sourceSection = (snapshotDate) =>
  section(
    'source',
    'Where this comes from',
    `<p>Ratings and scores come from data the Texas Education Agency publishes at
     <a href="https://txschools.gov" rel="nofollow">txschools.gov</a>${
       snapshotDate ? `, fetched ${esc(snapshotDate)}` : ''
     }. Enrollment figures come from TEA's separate
     <a href="https://rptsvr1.tea.texas.gov/adhocrpt/adspr.html" rel="nofollow">PEIMS Student Program reports</a>.
     Both archives carry checksums so each number stays traceable to the bytes TEA served.
     This site is unofficial and is not affiliated with TEA.</p>
  <p class="downloads"><a href="/download">Download the whole dataset</a> &middot;
     <a href="/about">how this site works</a></p>`
  )

/** Counties: accepts strings or objects, and falls back to the districts given. */
const countyList = (counties, districts) => {
  const norm = (c) => {
    const name = String((typeof c === 'string' ? c : c?.name ?? c?.county) ?? '').replace(/ County$/i, '')
    if (!name) return null
    return {
      name,
      slug: (typeof c === 'object' && c?.slug) || slugify(name),
      n: finite(c?.districtCount) ? c.districtCount : null,
    }
  }

  const given = (counties ?? []).map(norm).filter(Boolean)
  if (given.length) return dedupe(given)

  const derived = new Map()
  for (const d of districts) {
    if (!d.county) continue
    const key = slugify(d.county)
    derived.set(key, { name: String(d.county).replace(/ County$/i, ''), slug: key, n: (derived.get(key)?.n ?? 0) + 1 })
  }
  return [...derived.values()].sort(byName)
}

const dedupe = (rows) => {
  const seen = new Map()
  for (const r of rows) if (!seen.has(r.slug)) seen.set(r.slug, r)
  return [...seen.values()].sort(byName)
}

/* ----------------------------------------------------------------- region -- */

/**
 * renderRegionPage({ regionId, regionName, districts, counties, snapshotDate,
 *                    stateAvg, stateN, rankings, rankingsIndex })
 *
 * districts may include campus rows; they are counted, not tabled. stateAvg /
 * stateN are optional — without them the page shows the region average alone and
 * claims no comparison. `rankings` are the ranked lists scoped to THIS region
 * (see rankingsSection); absent, the section does not render.
 */
export function renderRegionPage({
  regionId,
  regionName,
  districts = [],
  counties = [],
  snapshotDate = null,
  stateAvg = null,
  stateN = null,
  rankings = [],
  rankingsIndex = null,
}) {
  const id = regionPath(regionId)
  const name = regionName || `Region ${id}`
  const { districts: ds, campuses } = split(geographicOnly(districts))
  const sorted = [...ds].sort(byScoreThenName)
  const cos = countyList(counties, ds)
  const nCampus = campusTotal(ds, campuses)
  const avg = avgScore(ds)
  const enrolled = enrollTotal(ds)

  const place = [
    plural(ds.length, 'district'),
    nCampus == null ? null : plural(nCampus, 'campus'),
    plural(cos.length, 'county'),
  ]
    .filter(Boolean)
    .join(' &middot; ')

  const stats = statGrid([
    ['Districts', num(ds.length)],
    nCampus == null ? null : ['Campuses', num(nCampus)],
    ['Counties', num(cos.length)],
    [
      'Average district score',
      avg.avg == null ? '—' : avg.avg.toFixed(1),
      avg.avg == null ? 'No district here has a published score' : `Mean of ${num(avg.n)} districts with a score`,
    ],
    enrolled.total == null
      ? null
      : ['Students', num(enrolled.total), `Across ${num(enrolled.n)} districts reporting enrollment`],
  ])

  return shell({
    title: `${name} — Texas school districts and ratings`,
    description: `Accountability ratings for the ${num(ds.length)} geographic school districts in ${name}${
      nCampus == null ? '' : ` and their ${num(nCampus)} campuses`
    }, with each district's rating, score and enrollment.`,
    canonical: `${SITE_ORIGIN}/region/${id}`,
    crumbs: [{ href: '/', label: 'Texas schools', current: name }],
    sections: [
      hero({
        eyebrow: `Education service region ${id}`,
        title: name,
        place,
        lede: `One of the twenty regions TEA uses to organise Texas public education. Every geographic
               district below links to its full record; open-enrollment charter systems are indexed statewide.`,
      }),
      section(
        'summary',
        'What this region contains',
        `${stats}\n  ${averageLine({ mine: avg, unit: 'districts', cohort: name, stateAvg, stateN })}`
      ),
      rankingsSection({
        rankings,
        rankingsIndex,
        heading: `${name} ranked`,
        ariaLabel: `Rankings for ${name}`,
        lede: `The districts below this heading are ordered by score in one table on one page. These
               are the ranked lists for ${esc(name)} on their own — each with its population, its n and
               its exclusions stated — for when the ordering is the thing you came for.`,
        more: 'Rankings for every region, county and the whole state',
      }),
      section(
        'counties',
        `${plural(cos.length, 'county')} in this region`,
        cos.length
          ? linkList(
              cos.map((c) => ({ href: `/county/${c.slug}`, label: `${c.name} County`, n: c.n, unit: 'district' })),
              'Counties in this region'
            )
          : '<p class="note na">No counties are listed for this region in this snapshot.</p>'
      ),
      section(
        'districts',
        `${plural(ds.length, 'district')} in ${name}`,
        districtTable(sorted, {
          caption: `Districts in ${name}`,
          showCounty: true,
          emptyMessage: `No districts in ${name} appear in this snapshot.`,
        }),
        'Ordered by overall score, highest first. Districts TEA did not rate appear last.'
      ),
      sourceSection(snapshotDate),
    ],
  })
}

/* ----------------------------------------------------------------- county -- */

/**
 * renderCountyPage({ countyName, countySlug, regionName, regionId, districts,
 *                    snapshotDate, stateAvg, stateN, rankings, rankingsIndex })
 *
 * "Best districts in my county" is the question a parent arrives with, and it
 * had no page. `rankings` are the ranked lists scoped to THIS county.
 */
export function renderCountyPage({
  countyName,
  countySlug,
  regionName = null,
  regionId = null,
  districts = [],
  snapshotDate = null,
  stateAvg = null,
  stateN = null,
  rankings = [],
  rankingsIndex = null,
}) {
  const name = String(countyName ?? '').replace(/ County$/i, '')
  const slug = countySlug || slugify(name)
  const { districts: ds, campuses } = split(geographicOnly(districts))
  const sorted = [...ds].sort(byScoreThenName)
  const nCampus = campusTotal(ds, campuses)
  const avg = avgScore(ds)
  const enrolled = enrollTotal(ds)
  const rid = regionId == null ? null : regionPath(regionId)
  const region = regionName || (rid ? `Region ${rid}` : null)

  const place = [
    region && rid ? `<a href="/region/${esc(rid)}">${esc(region)}</a>` : region ? esc(region) : null,
    plural(ds.length, 'district'),
    nCampus == null ? null : plural(nCampus, 'campus'),
  ]
    .filter(Boolean)
    .join(' &middot; ')

  const stats = statGrid([
    ['Districts', num(ds.length)],
    nCampus == null ? null : ['Campuses', num(nCampus)],
    [
      'Average district score',
      avg.avg == null ? '—' : avg.avg.toFixed(1),
      avg.avg == null ? 'No district here has a published score' : `Mean of ${num(avg.n)} districts with a score`,
    ],
    enrolled.total == null
      ? null
      : ['Students', num(enrolled.total), `Across ${num(enrolled.n)} districts reporting enrollment`],
  ])

  const crumbs = [{ href: '/', label: 'Texas schools' }]
  if (rid) crumbs.push({ href: `/region/${rid}`, label: region })
  crumbs.at(-1).current = `${name} County`

  return shell({
    title: `${name} County — Texas school districts and ratings`,
    description: `The ${num(ds.length)} geographic school districts in ${name} County, Texas${
      region ? `, part of ${region}` : ''
    }, with each district's accountability rating, score and enrollment.`,
    canonical: `${SITE_ORIGIN}/county/${slug}`,
    crumbs,
    sections: [
      hero({
        eyebrow: 'County',
        title: `${name} County`,
        place,
        lede: `Every geographic public school district whose administrative county TEA records as ${name}.
               Open-enrollment charter systems are indexed statewide because their recorded county is not an attendance boundary.`,
      }),
      section(
        'summary',
        'What this county contains',
        `${stats}\n  ${averageLine({
          mine: avg,
          unit: 'districts',
          cohort: `${name} County`,
          stateAvg,
          stateN,
        })}`
      ),
      rankingsSection({
        rankings,
        rankingsIndex,
        heading: `${name} County ranked`,
        ariaLabel: `Rankings for ${name} County`,
        lede: `Ranked lists covering ${esc(name)} County alone, each stating the population it ranks and
               how many districts are in it.`,
        more: 'Rankings for every county, region and the whole state',
      }),
      section(
        'districts',
        `${plural(ds.length, 'district')} in ${name} County`,
        districtTable(sorted, {
          caption: `Districts in ${name} County`,
          emptyMessage: `No districts in ${name} County appear in this snapshot.`,
        }),
        'Ordered by overall score, highest first. Districts TEA did not rate appear last.'
      ),
      region && rid
        ? section(
            'region',
            'Up one level',
            `<p><a href="/region/${esc(rid)}">All districts in ${esc(region)}</a></p>`
          )
        : null,
      sourceSection(snapshotDate),
    ],
  })
}

/* -------------------------------------------------------------- districts -- */

/**
 * The persistent Districts tab is only for geographic public school districts.
 * Open-enrollment charter systems have their own statewide index because their
 * TEA county is administrative context, not a resident attendance boundary.
 */
export function renderDistrictsPage({ districts = [], snapshotDate = null } = {}) {
  const { districts: systems } = split(geographicOnly(districts))
  const counts = new Map(ALPHABET.map((letter) => [letter, 0]))
  for (const district of systems) {
    const letter = String(district.name ?? '').trim().slice(0, 1).toLowerCase()
    if (counts.has(letter)) counts.set(letter, counts.get(letter) + 1)
  }

  return shell({
    title: 'Texas public school districts — A–Z index',
    description: `Browse ${num(systems.length)} Texas geographic public school districts by name. Open-enrollment charter school systems are kept in a separate statewide index.`,
    canonical: `${SITE_ORIGIN}/districts`,
    crumbs: [{ href: '/', label: 'Texas schools', current: 'Districts' }],
    sections: [
      hero({
        eyebrow: 'Geographic district index',
        title: 'Texas public school districts',
        place: plural(systems.length, 'geographic district'),
        lede: `These are public school districts with geographic resident boundaries. Open-enrollment
               charter school systems are listed separately so their administrative county is never mistaken for an attendance area.`,
      }),
      section(
        'index',
        'Browse districts A–Z',
        `${azNav(null, counts)}
      <p class="note"><a href="/charters">Browse charter school systems</a> in their separate statewide index.</p>`,
        'Choose the first letter of a district name. Each letter page contains geographic districts only.'
      ),
      section(
        'find',
        'Search every school system and campus',
        `<p><a href="${SEARCH_PATH}">Search geographic districts, charter systems and campuses</a>.</p>`,
        'Search remains the combined discovery tool; the Districts and Charters browse indexes stay separate.'
      ),
      sourceSection(snapshotDate),
    ],
  })
}

/* --------------------------------------------------------------- charters -- */

/**
 * A statewide index for TEA's district-level open-enrollment charter records.
 * Charters are deliberately not folded into region or county hubs: the county
 * on a TEA record is administrative context, not a resident attendance area.
 * The `districts` alias lets a caller pass the same all-entity list used by the
 * A-Z pages; an explicit `charters` list wins when supplied.
 */
export function renderChartersPage({
  charters = null,
  districts = [],
  snapshotDate = null,
  stateAvg = null,
  stateN = null,
  rankings = [],
  rankingsIndex = null,
} = {}) {
  const supplied = charters ?? districts
  const { districts: systems, campuses } = split((supplied ?? []).filter(charter))
  const sorted = [...systems].sort(byScoreThenName)
  const nCampus = campusTotal(systems, campuses)
  const avg = avgScore(systems)
  const enrolled = enrollTotal(systems)

  const place = [
    plural(systems.length, 'charter school system'),
    nCampus == null ? null : plural(nCampus, 'campus'),
  ]
    .filter(Boolean)
    .join(' &middot; ')

  const stats = statGrid([
    ['Charter school systems', num(systems.length)],
    nCampus == null ? null : ['Campuses', num(nCampus)],
    [
      'Average charter-system score',
      avg.avg == null ? '—' : avg.avg.toFixed(1),
      avg.avg == null
        ? 'No charter school system has a published score'
        : `Mean of ${num(avg.n)} charter school systems with a score`,
    ],
    enrolled.total == null
      ? null
      : ['Students', num(enrolled.total), `Across ${num(enrolled.n)} charter school systems reporting enrollment`],
  ])

  return shell({
    title: 'Texas charter school systems and ratings',
    description: `Accountability ratings for ${num(systems.length)} open-enrollment charter school systems in Texas${
      nCampus == null ? '' : ` and their ${num(nCampus)} campuses`
    }, with each system's rating, score and enrollment.`,
    canonical: `${SITE_ORIGIN}/charters`,
    crumbs: [{ href: '/', label: 'Texas schools', current: 'Charter school systems' }],
    sections: [
      hero({
        eyebrow: 'Statewide charter coverage',
        title: 'Texas charter school systems',
        place,
        lede: `Open-enrollment charter school systems are listed statewide. The county on a TEA record
               is administrative context; it is not presented here as a geographic attendance boundary.`,
      }),
      section(
        'summary',
        'What this index contains',
        `${stats}\n  ${averageLine({
          mine: avg,
          unit: 'charter school systems',
          cohort: 'The Texas charter-school sector',
          stateAvg,
          stateN,
        })}`
      ),
      rankingsSection({
        rankings,
        rankingsIndex,
        heading: 'Charter school systems ranked',
        ariaLabel: 'Rankings for Texas charter school systems',
        lede: `Statewide ranked lists for open-enrollment charter school systems. Each list states its
               population, denominator, ties and exclusions.`,
        more: 'Every ranking this site publishes',
      }),
      section(
        'charter-systems',
        `${plural(systems.length, 'charter school system')} statewide`,
        districtTable(sorted, {
          caption: 'Texas open-enrollment charter school systems',
          showCounty: true,
          entityHeading: 'Charter school system',
          countyHeading: 'Administrative county',
          linkCounties: false,
          emptyMessage: 'No open-enrollment charter school systems appear in this snapshot.',
        }),
        'Ordered by overall score, highest first. Systems TEA did not rate appear last.'
      ),
      section(
        'browse',
        'Browse another way',
        `<p><a href="/districts">Geographic district A&ndash;Z</a> &middot;
           <a href="${SEARCH_PATH}">search districts, charter systems and campuses</a></p>`
      ),
      sourceSection(snapshotDate),
    ],
  })
}

/* ----------------------------------------------------------------- letter -- */

/**
 * renderLetterPage({ letter, districts, snapshotDate })
 *
 * Filters the list itself, so the page's own claim about the letter is true even
 * if the caller hands it more than it asked for.
 */
export function renderLetterPage({ letter, districts = [], snapshotDate = null }) {
  const l = String(letter ?? '').slice(0, 1).toLowerCase()
  const L = l.toUpperCase()
  const { districts: ds } = split(geographicOnly(districts))
  const mine = ds.filter((d) => String(d.name ?? '').trim().slice(0, 1).toLowerCase() === l).sort(byName)
  const counts = new Map(ALPHABET.map((letter) => [letter, 0]))
  for (const district of ds) {
    const first = String(district.name ?? '').trim().slice(0, 1).toLowerCase()
    if (counts.has(first)) counts.set(first, counts.get(first) + 1)
  }

  return shell({
    title: `Texas public school districts starting with ${L}`,
    description: `An index of the ${num(mine.length)} Texas geographic public school districts whose name begins with ${L}, each with its accountability rating, score and enrollment.`,
    canonical: `${SITE_ORIGIN}/districts/${l}`,
    crumbs: [
      { href: '/', label: 'Texas schools' },
      { href: '/districts', label: 'Districts', current: L },
    ],
    sections: [
      hero({
        eyebrow: 'Geographic district index',
        title: `Public school districts starting with ${L}`,
        place: `${plural(mine.length, 'geographic district')} in this snapshot ${mine.length === 1 ? 'begins' : 'begin'} with ${L}`,
        lede: `This page contains geographic public school districts only. Open-enrollment charter school
               systems have a <a href="/charters">separate statewide index</a>.`,
      }),
      section(
        'index',
        'Jump to another letter',
        `${azNav(l, counts)}
      <p class="note"><a href="${SEARCH_PATH}/${esc(l)}">All districts, charter systems and campuses starting with ${esc(L)}</a> in the combined search index.</p>`
      ),
      section(
        'districts',
        `${plural(mine.length, 'geographic district')} beginning with ${L}`,
        districtTable(mine, {
          caption: `Texas geographic public school districts beginning with ${L}`,
          showCounty: true,
          emptyMessage: `No geographic public school district in this snapshot has a name beginning with ${L}.`,
        }),
        'Ordered alphabetically.'
      ),
      sourceSection(snapshotDate),
    ],
  })
}

/* ------------------------------------------------------------------- home -- */

/** Accepts [[label, value, note]], [{label, value, note}] or {label: value}. */
const statItems = (stats) => {
  if (!stats) return []
  const list = Array.isArray(stats)
    ? stats.map((s) => (Array.isArray(s) ? { label: s[0], value: s[1], note: s[2] } : s))
    : Object.entries(stats).map(([label, value]) =>
        value && typeof value === 'object' && !Array.isArray(value) ? { label, ...value } : { label, value }
      )

  return list
    .filter((s) => s && s.label != null && s.value != null && s.value !== '')
    .map((s) => [s.label, finite(s.value) ? num(s.value, Number.isInteger(s.value) ? 0 : 1) : esc(s.value), s.note])
}

/**
 * Districts and campuses, read off the stat grid the caller already passes, so
 * the search hint can state its denominator without a second argument to keep in
 * step. An explicit `counts` wins; with neither, the hint drops the numbers
 * rather than inventing them.
 */
const homeCounts = (stats, counts) => {
  const first = (...values) => values.find(finite) ?? null
  const geographicDistricts = first(counts?.geographicDistricts, counts?.traditionalDistricts)
  const charterSystems = first(counts?.charterSystems, counts?.charterDistricts)
  const geographicCampuses = first(counts?.geographicCampuses, counts?.traditionalCampuses)
  const charterCampuses = first(counts?.charterCampuses)
  const districts = first(
    counts?.districts,
    geographicDistricts != null && charterSystems != null ? geographicDistricts + charterSystems : null
  )
  const campuses = first(
    counts?.campuses,
    geographicCampuses != null && charterCampuses != null ? geographicCampuses + charterCampuses : null
  )
  if (districts != null && campuses != null) {
    return { districts, campuses, geographicDistricts, charterSystems, geographicCampuses, charterCampuses }
  }
  const found = {}
  for (const [label, value] of statItems(stats).map((s) => [String(s[0]).toLowerCase(), s[1]])) {
    if (label === 'districts' || label === 'campuses') found[label] = Number(String(value).replace(/,/g, ''))
  }
  return finite(found.districts) && finite(found.campuses)
    ? {
        ...found,
        geographicDistricts: null,
        charterSystems: null,
        geographicCampuses: null,
        charterCampuses: null,
      }
    : null
}

/**
 * Older callers describe the district-level table as districts only even though
 * it now includes TEA's charter-system records. Rewrite only those two known
 * notes, leaving every unrelated caller-supplied fact intact.
 */
const scopedHomeStats = (items) =>
  items.map(([label, value, note]) => {
    const key = String(label).toLowerCase()
    if (key === 'districts' && /every texas public school district/i.test(String(note ?? ''))) {
      return ['District & charter systems', value, 'Geographic districts and open-enrollment charter school systems in this snapshot']
    }
    if (key === 'campuses' && /individual schools, each with a page of its own/i.test(String(note ?? ''))) {
      return [label, value, 'Campuses operated by geographic districts and charter school systems, each with a page of its own']
    }
    return [label, value, note]
  })

/** The homepage alone gets a two-column composition; other hub heroes stay unchanged. */
const homeHero = ({ place, search, address }) => `<section class="hero hero-home">
  <div class="home-hero-grid">
    <div class="home-hero-copy">
      <h1>Texas school ratings</h1>
      <p class="place">${place}</p>
    </div>
    <div class="home-hero-action">
      <div class="home-hero-search">${search}</div>
    </div>
    <div class="home-hero-address">${address}
      <p class="lede">Explore TEA&rsquo;s A&ndash;F ratings for Texas public school districts,
        open-enrollment charter school systems and campuses. Follow five years of history and compare
        each one with a similar economic context.</p>
    </div>
  </div>
</section>`

/** A compact statement of independence, coverage and provenance beside the primary task. */
const homeTrustStrip = (snapshotDate, counts = null) => {
  const coverage = finite(counts?.geographicDistricts) && finite(counts?.charterSystems)
    ? `${plural(counts.geographicDistricts, 'geographic district')} &middot; ${plural(counts.charterSystems, 'charter school system')}${
        finite(counts.campuses) ? ` &middot; ${plural(counts.campuses, 'campus')}` : ''
      }`
    : 'Geographic districts, open-enrollment charter school systems and campuses'
  return `<aside class="home-trust-strip" aria-label="About this site and its data">
  <dl class="home-trust-list">
    <div class="home-trust-item home-trust-independent">
      <dt>Publisher</dt>
      <dd>Independent and <strong>unofficial</strong> &middot; <a href="/about">not affiliated with TEA</a></dd>
    </div>
    <div class="home-trust-item home-trust-coverage">
      <dt>Coverage</dt>
      <dd>${coverage} &middot; <a href="/charters">browse charter systems</a></dd>
    </div>
    <div class="home-trust-item home-trust-source">
      <dt>Source</dt>
      <dd><a href="${TEA_REPORTS_DATA_PORTAL}" rel="nofollow">Texas Education Agency data</a>${
        snapshotDate ? ` &middot; fetched ${esc(snapshotDate)}` : ' &middot; archived with each build'
      }</dd>
    </div>
  </dl>
</aside>`
}

/** Three routes into the same dataset, written for tasks rather than site departments. */
const homeTaskCards = (rankingsIndex) => `<section id="start" class="home-section home-tasks">
  <h2>Choose a way to explore</h2>
  <p class="lede">Start with a name, browse the ranked lists, or take the underlying data with you.</p>
  <div class="home-task-grid">
    <article class="home-task-card home-task-card-families home-task-card-find">
      <p class="eyebrow">For families</p>
      <h3>Find a school, district or charter system</h3>
      <p>Look up a name, then see its current rating, five-year direction and comparison with similar schools.</p>
      <p class="home-task-action"><a href="${SEARCH_PATH}">Search and browse schools</a></p>
    </article>
    <article class="home-task-card home-task-card-rankings">
      <p class="eyebrow">Explore performance</p>
      <h3>Open the ranked lists</h3>
      <p>Compare scores and gains statewide, by education service region and by county, with ties and denominators shown.</p>
      <p class="home-task-action"><a href="${esc(rankingsIndex ?? '/rankings')}">Explore rankings</a></p>
    </article>
    <article class="home-task-card home-task-card-journalists home-task-card-data">
      <p class="eyebrow">For journalists and researchers</p>
      <h3>Download and verify the data</h3>
      <p>Use the normalized files, snapshot date, source notes and methodology behind every figure on the site.</p>
      <p class="home-task-action"><a href="/download">Get data and documentation</a></p>
    </article>
  </div>
</section>`

/**
 * renderHomePage({ regions, letters, stats, counts, snapshotDate })
 *
 * regions: [{ id, name, districtCount? }]. letters: ['a', ...] or [{ letter, count }];
 * absent means the full a–z, which the URL scheme guarantees. stats is passed
 * straight through to the stat grid — nothing here computes a statewide figure.
 * counts is optional and only feeds the search hint's denominator.
 *
 * The front page carries no breadcrumb trail: it is the root every other trail
 * starts from, and a crumb pointing at itself would be noise.
 *
 * ------------------------------------------------------------------- ORDER
 *
 * The hero owns the primary action and is split into two deliberate layout
 * columns: the promise and scope on one side, the existing search component and
 * plain-language explanation on the other. A compact trust strip follows, then
 * three task cards for families, ranking readers and data users. Only after
 * those routes does the page expand into rankings, statewide facts, regions and
 * A-Z browsing. Every link and count from the old page remains available.
 */
export function renderHomePage({
  regions = [],
  letters = null,
  stats = null,
  counts = null,
  snapshotDate = null,
  rankings = [],
  rankingsIndex = null,
}) {
  const rs = (regions ?? [])
    .map((r) => ({
      id: regionPath(r.id ?? r.regionId),
      name: r.name ?? r.regionName ?? `Region ${regionPath(r.id ?? r.regionId)}`,
      n: finite(r.districtCount) ? r.districtCount : null,
    }))
    .filter((r) => r.id)
    .sort((a, b) => a.id.localeCompare(b.id))

  const ls = (letters ?? ALPHABET).map((x) =>
    typeof x === 'string'
      ? { letter: x.toLowerCase(), n: null }
      : { letter: String(x.letter ?? '').toLowerCase(), n: finite(x.count) ? x.count : null }
  )

  const items = scopedHomeStats(statItems(stats))
  const c = homeCounts(stats, counts)

  const place = c
    ? finite(c.geographicDistricts) && finite(c.charterSystems)
      ? `${plural(c.geographicDistricts, 'geographic district')} &middot; ${plural(c.charterSystems, 'charter school system')} &middot; ${plural(c.campuses, 'campus')}`
      : `${num(c.districts)} districts and charter systems &middot; ${num(c.campuses)} campuses`
    : 'Districts and campuses, by region, county and name &middot; Charter school systems statewide'

  const searchByName = renderSearch({
    variant: 'hero',
    counts: c,
    // No autofocus: the box is already the first thing on the page, and
    // stealing focus on arrival throws a phone keyboard over the content of a
    // reader who came to browse.
    autofocus: false,
    id: 'home-search',
    label: 'Find a school, district or charter system',
    placeholder: 'School, district or charter name',
    hint: c
      ? `Search ${num(c.districts + c.campuses)} districts, charter systems and schools. Each result identifies its sector, system and relevant location context.`
      : 'Each result identifies its governance sector and school system, with county for geographic schools or physical city for charter campuses when applicable.',
    // The shell emits the header instance's assets once per page.
    assets: false,
  })
  const address = renderAddressLookup({ id: 'home-address' })

  return shell({
    title: 'Texas public school ratings — find a district, charter system or school',
    description:
      'Search Texas public school districts, open-enrollment charter school systems and campuses by name, then read the A–F accountability ratings the Texas Education Agency published, with ranks, five years of history and comparisons against schools serving a similar share of economically disadvantaged students. Unofficial.',
    canonical: `${SITE_ORIGIN}/`,
    scripts: [ADDRESS_SCRIPT_PATH],
    crumbs: [],
    sections: [
      homeHero({ place, search: searchByName, address }),
      homeTrustStrip(snapshotDate, c),
      homeTaskCards(rankingsIndex),
      rankingsSection({
        rankings,
        rankingsIndex,
        heading: 'Texas schools, ranked',
        ariaLabel: 'Ranked lists',
        lede: `Featured rankings of public school districts, charter school systems and campuses. These lists order
               specific TEA measures rather than declaring one school “best”; each states its population,
               denominator, ties and exclusions.`,
        more: 'Every ranking — statewide, by region, by county',
        className: 'home-section home-rankings',
        listClassName: 'home-ranking-list',
      }),
      items.length
        ? hubSection(
            'statewide',
            'Texas public schools at a glance',
            `<div class="home-stats-grid">${statGrid(items)}</div>`,
            snapshotDate
              ? `Every figure is from the TEA snapshot fetched ${esc(snapshotDate)}.`
              : 'Every figure is from the archived TEA snapshot this site was built from.',
            'home-section home-stats'
          )
        : null,
      hubSection(
        'regions',
        rs.length ? `Browse ${num(rs.length)} education service regions` : 'Browse by region',
        rs.length
          ? `<div class="home-region-grid">${linkList(
              rs.map((r) => ({ href: `/region/${r.id}`, label: r.name, n: r.n })),
              'Education service regions',
              { className: 'home-region-list' }
            )}</div>`
          : '<p class="note na">No regions are listed in this snapshot.</p>',
        'TEA groups geographic school districts into regional service centres. Open a region to browse its districts and counties, or use the statewide charter-system index for open-enrollment charters.',
        'home-section home-regions'
      ),
      hubSection(
        'index',
        'Find a geographic district A–Z',
        ls.length
          ? `<div class="home-az-grid">${linkList(
              ls.map((x) => ({ href: `/districts/${x.letter}`, label: x.letter.toUpperCase(), n: x.n })),
              'Geographic district index by first letter',
              { className: 'home-az-list' }
            )}</div>
      <p class="note"><a href="${SEARCH_PATH}">The full index of districts, charter systems <em>and</em> campuses</a> —
         every included name, with its system and relevant location context. <a href="/charters">Browse charter school systems statewide</a>.</p>`
          : '<p class="note na">No district index is available in this snapshot.</p>',
        'The alphabetical district index contains geographic public school districts only. Open-enrollment charter systems have their own statewide index.',
        'home-section home-index'
      ),
      hubSection(
        'data',
        'Data and methodology',
        `<div class="home-data-copy"><p>Every page is built from public Texas Education Agency files. Ratings,
         outcomes, demographics, staffing and finance come from
         <a href="https://txschools.gov" rel="nofollow">txschools.gov</a>${
           snapshotDate ? `, fetched ${esc(snapshotDate)}` : ''
         }; student-count and program context comes from the official bulk summaries in TEA&rsquo;s
         <a href="${TEA_REPORTS_DATA_PORTAL}" rel="nofollow">Reports and Data Portal</a>; enrollment history comes from TEA's
         <a href="https://rptsvr1.tea.texas.gov/adhocrpt/adspr.html" rel="nofollow">PEIMS Student Program reports</a>.
         Both archives carry checksums, so any number here can be traced back to the bytes TEA served.</p>
      <p class="downloads"><a href="/download">Download the whole dataset</a> &middot;
         <a href="/about">how this site works and what it adds</a></p></div>`,
        'For reporting, research and anyone who wants to verify a figure.',
        'home-section home-data'
      ),
    ],
  })
}
