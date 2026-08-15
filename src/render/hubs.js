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

import { esc, grade, num, section, shell, statGrid, table, SITE_ORIGIN } from './shell.js'
import { entitySlug, slugify } from './view-model.js'

/* ------------------------------------------------------------- primitives -- */

/** regionId is a zero-padded 2-char string; callers pass 7, '7' and '07' alike. */
export const regionPath = (regionId) => String(regionId ?? '').padStart(2, '0')

const href = (d) => `/district/${esc(d.slug || entitySlug(d))}`

const finite = (v) => typeof v === 'number' && Number.isFinite(v)

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

const hero = ({ eyebrow, title, place = '', lede = '' }) => `<section class="hero">
  ${eyebrow ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ''}
  <h1>${esc(title)}</h1>
  ${place ? `<p class="place">${place}</p>` : ''}
  ${lede ? `<p class="lede">${lede}</p>` : ''}
</section>`

const IRREGULAR = { campus: 'campuses', county: 'counties' }
const plural = (n, word) => `${num(n)} ${n === 1 ? word : IRREGULAR[word] ?? `${word}s`}`

/**
 * A wrapped row of links. Reuses .legend, which is exactly this layout already.
 * A count beside a link always carries its unit — a bare number next to a name is
 * the same unlabelled boast a rank without an n would be.
 */
const linkList = (items) =>
  `<ul class="legend">${items
    .map((i) => `<li><a href="${esc(i.href)}"${i.current ? ' aria-current="page"' : ''}>${esc(i.label)}</a>${
      finite(i.n) ? ` <span class="chip-n">${esc(plural(i.n, i.unit ?? 'district'))}</span>` : ''
    }</li>`)
    .join('')}</ul>`

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'.split('')

const azNav = (current = null) =>
  linkList(
    ALPHABET.map((l) => ({
      href: `/districts/${l}`,
      label: l.toUpperCase(),
      current: current === l,
    }))
  )

/**
 * The districts table. Returns a stated-empty paragraph instead of a table with no
 * rows, because an empty table reads as a rendering failure rather than as a fact.
 */
const districtTable = (districts, { caption, showCounty = false, emptyMessage }) => {
  if (!districts.length) return `<p class="note na">${esc(emptyMessage)}</p>`

  const head = [
    'District',
    showCounty ? 'County' : null,
    'Rating',
    { label: 'Score', num: true },
    { label: 'Students', num: true },
  ].filter(Boolean)

  const rows = districts.map(
    (d) =>
      `<tr><th scope="row"><a href="${href(d)}">${esc(d.name ?? d.id)}</a>${
        d.isCharter ? ' <span class="na-sm">Charter</span>' : ''
      }</th>${
        showCounty
          ? `<td>${d.county ? `<a href="/county/${esc(slugify(d.county))}">${esc(d.county)}</a>` : '—'}</td>`
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
    `<p>Every figure on this page comes from data the Texas Education Agency publishes at
     <a href="https://txschools.gov" rel="nofollow">txschools.gov</a>${
       snapshotDate ? `, fetched ${esc(snapshotDate)}` : ''
     } and archived with a checksum so each number stays traceable to the bytes TEA served.
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
 *                    stateAvg, stateN })
 *
 * districts may include campus rows; they are counted, not tabled. stateAvg /
 * stateN are optional — without them the page shows the region average alone and
 * claims no comparison.
 */
export function renderRegionPage({
  regionId,
  regionName,
  districts = [],
  counties = [],
  snapshotDate = null,
  stateAvg = null,
  stateN = null,
}) {
  const id = regionPath(regionId)
  const name = regionName || `Region ${id}`
  const { districts: ds, campuses } = split(districts)
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
    description: `Accountability ratings for the ${num(ds.length)} school districts in ${name}${
      nCampus == null ? '' : ` and their ${num(nCampus)} campuses`
    }, with each district's rating, score and enrollment.`,
    canonical: `${SITE_ORIGIN}/region/${id}`,
    crumbs: [{ href: '/', label: 'Texas schools', current: name }],
    sections: [
      hero({
        eyebrow: `Education service region ${id}`,
        title: name,
        place,
        lede: 'One of the twenty regions TEA uses to organise Texas public education. Every district below links to its full record.',
      }),
      section(
        'summary',
        'What this region contains',
        `${stats}\n  ${averageLine({ mine: avg, unit: 'districts', cohort: name, stateAvg, stateN })}`
      ),
      section(
        'counties',
        `${plural(cos.length, 'county')} in this region`,
        cos.length
          ? linkList(cos.map((c) => ({ href: `/county/${c.slug}`, label: `${c.name} County`, n: c.n, unit: 'district' })))
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
 *                    snapshotDate, stateAvg, stateN })
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
}) {
  const name = String(countyName ?? '').replace(/ County$/i, '')
  const slug = countySlug || slugify(name)
  const { districts: ds, campuses } = split(districts)
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
    description: `The ${num(ds.length)} school districts in ${name} County, Texas${
      region ? `, part of ${region}` : ''
    }, with each district's accountability rating, score and enrollment.`,
    canonical: `${SITE_ORIGIN}/county/${slug}`,
    crumbs,
    sections: [
      hero({
        eyebrow: 'County',
        title: `${name} County`,
        place,
        lede: `Every public school district whose administrative county TEA records as ${name}.`,
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
  const { districts: ds } = split(districts)
  const mine = ds.filter((d) => String(d.name ?? '').trim().slice(0, 1).toLowerCase() === l).sort(byName)

  return shell({
    title: `Texas school districts starting with ${L}`,
    description: `An index of the ${num(mine.length)} Texas public school districts whose name begins with ${L}, each with its accountability rating, score and enrollment.`,
    canonical: `${SITE_ORIGIN}/districts/${l}`,
    crumbs: [{ href: '/', label: 'Texas schools', current: `Districts: ${L}` }],
    sections: [
      hero({
        eyebrow: 'District index',
        title: `Districts starting with ${L}`,
        place: `${plural(mine.length, 'district')} in this snapshot ${mine.length === 1 ? 'begins' : 'begin'} with ${L}`,
        lede: 'District names are not unique in Texas, so each link carries the district number TEA assigns.',
      }),
      section('index', 'Jump to another letter', azNav(l)),
      section(
        'districts',
        `${plural(mine.length, 'district')} beginning with ${L}`,
        districtTable(mine, {
          caption: `Texas districts beginning with ${L}`,
          showCounty: true,
          emptyMessage: `No district in this snapshot has a name beginning with ${L}.`,
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
 * renderHomePage({ regions, letters, stats, snapshotDate })
 *
 * regions: [{ id, name, districtCount? }]. letters: ['a', ...] or [{ letter, count }];
 * absent means the full a–z, which the URL scheme guarantees. stats is passed
 * straight through to the stat grid — nothing here computes a statewide figure.
 *
 * The front page carries no breadcrumb trail: it is the root every other trail
 * starts from, and a crumb pointing at itself would be noise.
 */
export function renderHomePage({ regions = [], letters = null, stats = null, snapshotDate = null }) {
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

  const items = statItems(stats)

  return shell({
    title: 'Texas school ratings — every district and campus',
    description:
      'An independent, unofficial index of the A–F accountability ratings the Texas Education Agency publishes for every Texas school district and campus. Browse by region, county or name.',
    canonical: `${SITE_ORIGIN}/`,
    crumbs: [],
    sections: [
      hero({
        eyebrow: 'Texas public schools',
        title: 'Texas school ratings',
        place: 'Districts and campuses, by region, county and name',
        lede: `This site republishes the A&ndash;F accountability ratings the Texas Education Agency
          publishes for every Texas school district and campus, and adds the comparison TEA does not:
          each school set against others serving a similar share of economically disadvantaged students.
          It is <strong>unofficial</strong> and is not operated by, endorsed by, or affiliated with TEA
          &mdash; <a href="/about">what this is and how it works</a>.`,
      }),
      items.length
        ? section(
            'statewide',
            'Texas at a glance',
            statGrid(items),
            snapshotDate
              ? `Every figure is from the TEA snapshot fetched ${esc(snapshotDate)}.`
              : 'Every figure is from the TEA snapshot this site was built from.'
          )
        : null,
      section(
        'regions',
        rs.length ? `${num(rs.length)} education service regions` : 'Browse by region',
        rs.length
          ? linkList(rs.map((r) => ({ href: `/region/${r.id}`, label: r.name, n: r.n })))
          : '<p class="note na">No regions are listed in this snapshot.</p>',
        'TEA groups Texas public education into regional service centres. Each region lists its counties and districts.'
      ),
      section(
        'index',
        'Districts A to Z',
        ls.length
          ? linkList(ls.map((x) => ({ href: `/districts/${x.letter}`, label: x.letter.toUpperCase(), n: x.n })))
          : '<p class="note na">No district index is available in this snapshot.</p>',
        'The alphabetical index of every district, for when you know the name but not the region.'
      ),
      section(
        'data',
        'The data behind this',
        `<p>Every page is built from files the Texas Education Agency publishes at
         <a href="https://txschools.gov" rel="nofollow">txschools.gov</a>${
           snapshotDate ? `, fetched ${esc(snapshotDate)}` : ''
         } and archived with a checksum, so any number here can be traced back to the bytes TEA served.</p>
      <p class="downloads"><a href="/download">Download the whole dataset</a> &middot;
         <a href="/about">how this site works and what it adds</a></p>`
      ),
    ],
  })
}
