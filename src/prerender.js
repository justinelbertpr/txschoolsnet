// Turns the build tables plus the archived TEA snapshot into the whole site:
// one page per entity, the hub pages their breadcrumbs point at, the data files
// those pages link, and the sitemap that ties it together.
//
// Two constraints shape this file, and both are stated in full rather than left
// for the next reader to rediscover.
//
// ---------------------------------------------------------------- PERFORMANCE
//
// buildViewModel is O(every entity) per entity: each call rebuilds the source
// bundles, every cohort average and every rank from the full tables. Measured on
// this snapshot with `node --version` 24 on a 10-core machine:
//
//     sourceBundles   ~15 ms   invariant across entities
//     buildCohorts    ~15 ms   varies only by region/county/peer band
//     rankAll         ~26 ms   varies only by the metric specs
//     ----------------------
//     ~42 ms per entity x 10,230 entities = ~7 minutes on one core
//
// Nothing in sourceBundles varies by entity, so the fix is a memo inside
// src/render/view-model.js — a file this step does not own. Until that lands the
// work is striped across worker threads: each worker loads the tables once and
// renders every Nth entity. That turns ~7 minutes into ~1, without touching a
// module owned by someone else. See the note in the summary output.
//
// --------------------------------------------------------------- FILE BUDGET
//
// Cloudflare's Free plan caps a Worker version at 20,000 assets; CI fails above
// 18,000 (scripts/check-file-count.mjs). The arithmetic decides the download
// design, it is not a preference:
//
//     entity pages                         9,086   1,020 districts + 8,066 campuses
//     region/county/letter/search hubs       325
//     per-district reporter CSV + JSON     2,040   two files x 1,020 districts
//     pin metric bundles                   1,020   one district bundle, campuses inside
//     ranking board pages + CSVs             391
//     bulk CSVs                                3
//     shell/map/search/address/data assets     26
//     ------------------------------------------
//     expected 2026-08 build              12,891
//
// That leaves 5,109 slots under the CI guard and 7,109 under the hard cap. One
// extra file per entity would add 9,086 and exceed both; CSV + JSON for all
// entities would add 18,172 before anything else grew. The pin comparison data
// fits because it is grouped by district: 1,020 assets instead of one for each
// of 8,066 campuses.
//
// The same arithmetic is why there is ONE share image rather than one per entity:
// 9,086 og:images is nearly half the cap on its own. See writeBrandAssets below.
// It is also why the search index is one lazy-loaded JSON file rather than 9,086
// names inlined into every page — see src/render/search.js.
//
// The decision: per-entity CSV + JSON for the 1,020 districts only; compact
// current-measure comparison JSON grouped into one more file per district.
//
// The ranked lists spend from the remaining budget, and RANKING_FILE_BUDGET
// caps their catalogue at 1,200 so that a plan which starts emitting one
// board per district fails here with the arithmetic printed rather than at
// deploy time. Ranking pages are cohort-shaped, not entity-shaped — one page per
// (metric, scope), where scope is the state, one of 20 regions or one of 253
// counties — which is why they fit at all and entity-shaped files do not.
//
// Districts win the slots because they are the low-cardinality half (1,020 vs
// 8,066) and the half people download — a district's record is the unit a comms
// officer, a board member or a reporter works in.
//
// ------------------------------------------- WHY THERE IS NO _redirects FILE
//
// An earlier version of this step wrote site/_redirects containing
//
//     /data/entity/* /download 302
//
// on the theory that the 1,199 real district files would serve normally and only
// the unmatched campus ids would fall through to the download index. That theory
// is wrong, and Cloudflare documents it plainly. From
// https://developers.cloudflare.com/workers/static-assets/redirects/ (§ Structure
// → Per file, retrieved 15 August 2026):
//
//     "Redirects are always followed, regardless of whether or not an asset
//      matches the incoming request."
//
// So the splat did not catch the leftovers — it hijacked the whole prefix. All
// 2,398 real per-district files, ~112 MB of assets, answered 302 /download and
// nothing could fetch them. The rule broke exactly the thing it was written to
// protect.
//
// _redirects cannot express "serve the file if it exists, otherwise redirect".
// Nor can it be worked around by listing the exceptions: the same page caps the
// file at "2,000 static redirects and 100 dynamic redirects, for a combined
// total of 2,100", and there are 2,398 district files to except (or 9,031 campus
// ids to enumerate). Both overflow the limit.
//
// The fix is therefore to stop needing the file. No catch-all rule is emitted,
// site/_redirects is not written at all, and an entity page links a per-entity
// file only when that file exists (src/render/sections.js). Campus pages link
// /download instead. Nothing on the site requests a URL that is not there, so
// nothing needs rescuing from a 404 — and the district files, which are the ones
// people actually download, are reachable again.
//
// A hand-typed /data/entity/<campus id>.csv still 404s. That is honest: the file
// does not exist. The real fix remains a Worker route generating these on demand
// (entityCsv/entityJson are pure string functions and would work unchanged in a
// fetch handler), which wrangler.jsonc's assets-only design — no "main" key,
// asserted by test/wrangler.test.js — currently rules out.

import { Worker, isMainThread, workerData, parentPort } from 'node:worker_threads'
import { availableParallelism } from 'node:os'
import { fileURLToPath } from 'node:url'
import { deflateSync, gunzipSync } from 'node:zlib'
import { existsSync, readFileSync } from 'node:fs'
import { readdir, writeFile, stat, rm, mkdir, readFile } from 'node:fs/promises'

import { resetDir } from './lib/reset-dir.js'
import { latestSnapshot } from './build.js'
import { toRatings, preferredRatings } from './normalize/ratings.js'
import { toDomains } from './normalize/domains.js'
import { toFinance } from './normalize/finance.js'
import { toProfile } from './normalize/profile.js'
import { buildViewModel, entitySlug, slugify } from './render/view-model.js'
import { metricSpecs } from './render/metrics.js'
import { renderEntity } from './render/page.js'
import { renderRegionPage, renderCountyPage, renderLetterPage, renderHomePage, regionPath } from './render/hubs.js'
import { searchIndexJson, searchClientJs, renderSearchPage, SEARCH_LETTERS } from './render/search.js'
import { addressClientJs, districtLocatorJson } from './render/address.js'
import { APPLE_TOUCH_ICON, BRAND, MARK_BARS, OG_IMAGE, faviconSvg, shell } from './render/shell.js'
import { renderAboutPage } from './render/about.js'
import { renderDownloadPage, datasetCsv, entityCsv, entityJson } from './render/downloads.js'
import { pinMetricPayloads } from './pin-metrics.js'
import { RANKABLE, CHANGE_METRICS, MIN_POPULATION, rankingBundles, rankBy, changeMetrics, scopeKey } from './render/rankings.js'
import {
  DEFAULT_PLAN,
  PAGE_ROWS,
  RANKINGS_HREF,
  boardPages,
  isHeadlineMetric,
  pageCountFor,
  rankingCatalogue,
  relatedFor,
  renderRankingsIndexPage,
} from './render/rankings-page.js'

// A second, namespace import of the same module, for one export the line above
// deliberately does NOT name: rankingCsv. Its owner (src/render/rankings-page.js)
// is adding it alongside this build, not before it — `import { rankingCsv } from
// ...` is a NAMED import, and Node throws a SyntaxError at module load, for every
// test and every page this file renders, the instant a named import does not
// exist on the target module. That would take the whole build down over a
// function this step does not own and has not landed yet. Reading it off the
// namespace object instead resolves to `undefined` until the export lands, which
// lets the write loop below degrade to "skip the CSV for this build" rather than
// "fail every page render". See the loop for how the presence check is made.
import * as rankingsPageModule from './render/rankings-page.js'
import { MAP_FILE, MAP_HREF, buildLayer, buildRatingLayer, hiFiPaths, mappableDistricts, renderMapPage } from './render/map.js'
import { BOUNDARY_FILE, BOUNDARY_FILE_LO } from './boundaries.js'

/**
 * The archived district geometry, or null when it has never been fetched.
 *
 * Null is a legitimate state, not an error: a fresh clone that has not run
 * `npm run fetch:boundaries` should still build the other 11,868 files. The map
 * is the only page that depends on this, and it simply is not written.
 */
async function readBoundaries(file = BOUNDARY_FILE) {
  try {
    const gz = await readFile(file)
    return JSON.parse(gunzipSync(gz).toString('utf8'))
  } catch {
    return null
  }
}

export const SITE_ORIGIN = 'https://txschools.net'

// The escapeHtml that used to live here is gone with the renderer that used it.
// esc() in src/render/shell.js is the one escaping function now; two of them in
// one codebase is how one of them quietly stops matching the other.

/** site-relative path for an entity page. Named slug + id: names are not unique. */
export const entityPath = (e) => `${e.level}/${entitySlug(e)}.html`

export const renderSitemap = (paths) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((p) => `<url><loc>${SITE_ORIGIN}/${p.replace(/\.html$/, '')}</loc></url>`).join('\n')}
</urlset>
`

export const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'.split('')

const ndjson = (table) =>
  readFileSync(`build/${table}.ndjson`, 'utf8').trim().split('\n').map((l) => JSON.parse(l))

const gz = (dir, name) => JSON.parse(gunzipSync(readFileSync(`${dir}/${name}.json.gz`)).toString('utf8'))

/** The snapshot the build tables were made from, so page and payload agree. */
export async function snapshotDir() {
  const named = existsSync('build/snapshot.txt') ? readFileSync('build/snapshot.txt', 'utf8').trim() : null
  if (named && existsSync(`data/raw/${named}`)) return `data/raw/${named}`
  const dirs = await readdir('data/raw')
  return `data/raw/${latestSnapshot(dirs, (n) => existsSync(`data/raw/${n}/manifest.json`))}`
}

/** '2026-08-15T16:19:29.181Z' -> '15 August 2026'. Same wording as every page. */
export const humanDate = (iso) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(iso))

/**
 * student_achievement_tab publishes '' rather than [] for a campus with no STAAR
 * results — 244 live entities in this snapshot, plus 4 rows with a blank id.
 * buildViewModel passes `ach.subject ?? []` straight to metricSpecs, and `??`
 * does not catch '', so `''.flatMap` throws and the page never renders. Coercing
 * the ragged fields to [] here is behaviour-preserving (every consumer tests
 * `.length`, which is 0 either way) and keeps the fix out of a module this step
 * does not own. Reported separately: view-model.js:115 should guard the type.
 */
const ARRAY_FIELDS = ['subject', 'approach', 'meet', 'master', 'grad_rate_col2', 'grad_rate_col3', 'ccmr_col2', 'ccmr_col3']

export function cleanAchievement(rows) {
  return (rows ?? []).map((r) => {
    let patched = null
    for (const f of ARRAY_FIELDS) {
      if (r[f] !== undefined && !Array.isArray(r[f])) (patched ??= { ...r })[f] = []
    }
    return patched ?? r
  })
}

/**
 * Everything buildViewModel needs. The normalized table is used wherever one
 * exists (entities, ratings, profile from build/*.ndjson); the rest comes off
 * the archived snapshot, because those columns were deliberately left out of the
 * tidy tables — see scripts/prototype.mjs, which assembles the same shape.
 */
export function loadTables(dir) {
  const rawDistricts = gz(dir, 'districts')
  const rawSchools = gz(dir, 'schools')
  const rawProfile = gz(dir, 'profile_tab')

  const entities = ndjson('entities')
  const allRatings = ndjson('ratings')
  const profile = ndjson('profile')

  const raw = new Map()
  for (const r of rawDistricts) raw.set(r.id, r)
  for (const r of rawSchools) raw.set(r.id, r)
  for (const p of rawProfile) raw.set(p.id, { ...raw.get(p.id), ...p })

  const latestYear = allRatings.reduce((y, r) => (r.year > y ? r.year : y), '')

  return {
    entities,
    allRatings,
    ratings: preferredRatings(allRatings),
    profile,
    domains: toDomains(gz(dir, 'overview')),
    finance: [...toFinance(gz(dir, 'finance_district')), ...toFinance(gz(dir, 'finance_school'))],
    achievement: cleanAchievement(gz(dir, 'student_achievement_tab')),
    raw,
    latestYear,
  }
}

const viewModelFor = (t, entity, snapshotDate) =>
  buildViewModel({
    entity,
    entities: t.entities,
    ratings: t.ratings,
    allRatings: t.allRatings,
    domains: t.domains,
    finance: t.finance,
    profile: t.profile,
    raw: t.raw.get(entity.id) ?? {},
    achievement: t.achievement,
    snapshotDate,
    latestYear: t.latestYear,
  })

/* ----------------------------------------------------------- brand assets -- */
//
// Three files, written once per build, that make a link to this site legible when
// it leaves this site: a favicon, a share card, and a home-screen icon. All three
// draw the same mark, whose colours and coordinates live in src/render/shell.js
// so the tab and the card cannot drift apart.
//
// WHY A PNG WRITER AND NOT AN SVG. Every other drawing this project makes is an
// SVG string, and the favicon still is — but no major unfurler rasterises SVG for
// og:image. X, Facebook, LinkedIn, Slack and iMessage all want PNG/JPEG/WEBP/GIF,
// so shipping an SVG card would be shipping a file that nothing ever renders. The
// writer below is the whole of PNG that a flat, axis-aligned mark needs: a CRC, a
// chunk framer, and zlib — which is already imported here to read the snapshot.
// No dependency, no font, no rasteriser, ~40 lines. The mark is rectangles for
// exactly that reason: it needs no anti-aliasing to look drawn on purpose.
//
// WHY NO WEB MANIFEST. A manifest earns its file when an app has a standalone
// display mode, an install prompt, offline behaviour or maskable icons. This is a
// document site whose whole purpose is being linked, quoted and pasted; installing
// it standalone would hide the address bar people copy the URL out of. The two
// things a manifest would carry that matter — a theme colour and an icon — are
// already in the shell as <meta name="theme-color"> and <link rel="icon">, which
// every browser honours without one.

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1
  return c
})

const crc32 = (buf) => {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) c = (CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)) >>> 0
  return (c ^ 0xffffffff) >>> 0
}

/** length + type + data + CRC32 of (type + data). The PNG container, in full. */
const pngChunk = (type, data) => {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  const tail = Buffer.alloc(4)
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, tail])
}

/**
 * A truecolour 8-bit PNG. `paint(x, y)` returns a 0xRRGGBB integer.
 *
 * Every scanline uses filter 0 (none): the filters exist to make gradients and
 * photographs compress, and this image is two flat colours, which deflate encodes
 * as run lengths whether or not it is filtered first.
 */
export function png(width, height, paint) {
  const raw = Buffer.alloc(height * (width * 3 + 1))
  let p = 0
  for (let y = 0; y < height; y += 1) {
    raw[p] = 0
    p += 1
    for (let x = 0; x < width; x += 1) {
      const c = paint(x, y)
      raw[p] = (c >> 16) & 0xff
      raw[p + 1] = (c >> 8) & 0xff
      raw[p + 2] = c & 0xff
      p += 3
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type 2: truecolour, no alpha — the tile is opaque by design

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

const rgb = (hex) => parseInt(hex.slice(1), 16)

/**
 * The mark as a square raster: the light-scheme tile with the light-scheme glyph,
 * because a PNG cannot answer prefers-color-scheme and an opaque blue tile reads
 * on white chat bubbles and dark ones alike. Corners are square — every client
 * that wants them rounded (iOS home screen, Slack, X) rounds them itself.
 */
export function markPng(size) {
  const s = size / 32
  const bars = MARK_BARS.map((b) => ({
    x0: Math.round(b.x * s),
    x1: Math.round((b.x + b.w) * s),
    y0: Math.round(b.y * s),
    y1: Math.round((b.y + b.h) * s),
  }))
  const tile = rgb(BRAND.tile)
  const glyph = rgb(BRAND.glyph)
  return png(size, size, (x, y) =>
    bars.some((b) => x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1) ? glyph : tile
  )
}

/** Written to site/ root, where resetDir does not reach, so they survive a rebuild intact. */
export async function writeBrandAssets(dir = 'site') {
  const assets = [
    ['favicon.svg', Buffer.from(faviconSvg(), 'utf8')],
    [OG_IMAGE.path.replace(/^\//, ''), markPng(OG_IMAGE.width)],
    [APPLE_TOUCH_ICON.path.replace(/^\//, ''), markPng(APPLE_TOUCH_ICON.size)],
  ]
  for (const [name, body] of assets) await writeFile(`${dir}/${name}`, body)
  return assets.map(([name, body]) => ({ path: name, bytes: body.length }))
}

/* ------------------------------------------------------------------ worker -- */

const SHARD_TAG = 'txschools:prerender-shard'

/**
 * One stripe of the entity list: pages, plus data files for the districts in it.
 *
 * `rankIndex` arrives through workerData (structured-cloned once per worker, a
 * few hundred strings) and is attached to each view model rather than computed
 * inside buildViewModel — view-model.js is not this step's to edit, and the
 * index is a fact about which FILES this run wrote, which only this step knows.
 */
async function renderShard({ dir, index, stride, snapshotDate, rankIndex = null, rankingsIndex = null }) {
  const t = loadTables(dir)
  const stats = { pages: 0, district: 0, campus: 0, dataFiles: 0, htmlBytes: 0, dataBytes: 0, largest: null, linked: 0 }

  for (let i = index; i < t.entities.length; i += stride) {
    const e = t.entities[i]
    const vm = viewModelFor(t, e, snapshotDate)
    const links = rankingLinksFor(rankIndex, e)
    if (rankingsIndex) vm.rankingsIndex = rankingsIndex
    if (links) {
      vm.rankingLinks = links
      stats.linked += 1
    }
    const html = renderEntity(vm)
    const path = entityPath(e)
    const bytes = Buffer.byteLength(html)

    await writeFile(`site/${path}`, html)
    stats.pages += 1
    stats[e.level] += 1
    stats.htmlBytes += bytes
    if (!stats.largest || bytes > stats.largest.bytes) stats.largest = { path, bytes }

    if (e.level === 'district') {
      const csv = entityCsv(vm)
      const json = entityJson(vm)
      await writeFile(`site/data/entity/${e.id}.csv`, csv)
      await writeFile(`site/data/entity/${e.id}.json`, json)
      stats.dataFiles += 2
      stats.dataBytes += Buffer.byteLength(csv) + Buffer.byteLength(json)
    }
  }
  return stats
}

/* -------------------------------------------------------------------- hubs -- */

const finite = (v) => typeof v === 'number' && Number.isFinite(v)

const avgOf = (rows) => {
  const xs = rows.map((r) => r.score).filter(finite)
  return xs.length ? { avg: Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10, n: xs.length } : { avg: null, n: 0 }
}

const groupBy = (rows, key) => {
  const m = new Map()
  for (const r of rows) {
    const k = key(r)
    if (k == null) continue
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(r)
  }
  return m
}

/**
 * The hub set, derived rather than hard-coded: a region page for every regionId
 * that has entities, a county page for every county slug that appears anywhere
 * (so a campus breadcrumb can never point at a page that was not built), and the
 * full a-z, which the URL scheme guarantees exists.
 */
export function hubPlan(entities, regionNames) {
  const withSlug = entities.map((e) => (e.level === 'district' ? { ...e, slug: entitySlug(e) } : e))
  const districts = withSlug.filter((e) => e.level === 'district')

  const byRegion = groupBy(withSlug, (e) => regionPath(e.regionId))
  const byCounty = groupBy(withSlug, (e) => (e.county ? slugify(e.county) : null))
  const state = avgOf(districts)

  const regions = [...byRegion.keys()].sort().map((id) => ({
    id,
    name: regionNames.get(id) ?? `Region ${id}`,
    rows: byRegion.get(id),
    districtCount: byRegion.get(id).filter((e) => e.level === 'district').length,
  }))

  const counties = [...byCounty.keys()].sort().map((slug) => {
    const rows = byCounty.get(slug)
    const first = rows.find((r) => r.county)
    return {
      slug,
      name: first.county,
      regionId: regionPath(first.regionId),
      regionName: regionNames.get(regionPath(first.regionId)) ?? null,
      rows,
    }
  })

  return { districts, regions, counties, state }
}
/* --------------------------------------------------------------- rankings -- */
//
// The ranked lists, and the wiring that makes them reachable.
//
// WHAT WAS MISSING. Until these pages existed the only ranks this site published
// were single-entity and single-year, shown on the profile of the entity they
// flattered: "Ranks 400th of 1,184 Texas districts" with no link to the other
// 1,183, and a standouts section that showed a district's best twelve placements
// and none of its worst. There was no page anywhere on the site — not statewide,
// not by region, not by county — on which the sentence "the top 20 districts in
// Texas" could be read off. The largest list was /region/10: 112 districts
// ordered by score, unsortable, and never labelled as an ordering at all.
//
// WHO OWNS WHAT. This step owns none of the ranking arithmetic and none of the
// ranking markup. src/render/rankings.js computes a ranked population from the
// snapshot; src/render/rankings-page.js turns one of those into a page and
// declares, in rankingCatalogue, which (metric x scope) combinations are worth
// a file — and, per metric, which single end of the ordering (`goodEnd`: the
// one where 1st place is the best result) is the one that gets published. This
// file is the driver between them: it decides which
// populations are offered, computes each result once, writes the pages, puts
// them in the sitemap, counts them against the asset budget, and — the part that
// matters most here — hands every OTHER page the hrefs it needs, so a rank
// printed anywhere on the site links to the list it came out of.
//
// ------------------------------------------------------ LINKS ARE A LOOKUP
//
// No entity page and no hub constructs a ranking URL. Every board that is
// actually written contributes its href to an index keyed by
//
//     level ("district" | "campus")  ->  scope  ->  metric key  ->  href
//
// where scope is 'state', `region:<id>` or `county:<id>`. Each entity is handed
// the three slices of that index that apply to it, and src/render/sections.js
// emits a link only where it finds one.
//
// That is deliberately the opposite of a URL-scheme constant shared between the
// renderer and the linker. A shared scheme has to be kept in step by two files
// edited at different times, and its failure mode is a 10,230-page site full of
// links to pages that were renamed or never built. A lookup cannot fail that
// way: an href is in the index because the file was written, in this run, at
// that path. Drop a board and its links disappear with it; add one and it is
// linked with no change to sections.js at all.
//
// Two populations are absent from that index on purpose:
//
//   The peer band. "Districts within 10 points of this district's economically
//   disadvantaged share" is a different population for every district, so no
//   static page can exist for it. A standout measured against the band is left
//   unlinked rather than pointed at a statewide list it never entered.
//
//   Any board whose result was suppressed. rankings.js will not publish a rank
//   out of fewer than MIN_POPULATION, so those entries are dropped before
//   anything is written — no file, no sitemap entry, no link, and no thin page
//   saying "nothing to rank" for a crawler to find.
//
// --------------------------------------------------------- THE FILE BUDGET
//
// 12,971 files before this section, an 18,000 CI guard and a 20,000 hard cap, so
// 5,029 spare. What the plan below asks for, publishing one end per metric —
// see rankings-page.js's Rule 3 and `goodEnd`, the site owner's explicit call
// not to compile a standalone "worst of" list — measured on the 2026-08
// snapshot:
//
//     statewide districts   35 metrics                             35
//     statewide campuses     7 metrics                              7
//     regions                2 metrics x 20 regions                40
//     counties               2 metrics x 16 counties                32
//     the /rankings index                                           1
//     -----------------------------------------------------------
//                                                                  115
//
// That is 115 ORDERINGS. It stopped being the file count when long orderings
// started paging instead of truncating (rankings-page.js:PAGE_ROWS, 500 rows a
// page): a 7,283-campus board is 15 files, a 1,199-district board is 3, and a
// county board still fits on 1. Measured on the 2026-08 snapshot, the same 114
// boards now write 280 pages, so this section costs 280 + 1 index + 114 CSVs =
// 395 files where it used to cost 229 — an extra 166, against 4,800 spare. The
// catalogue itself is unchanged at 114 entries, and MAX_RANKING_PAGES still
// counts THAT, because a plan that grows per-entity is the failure it exists to
// catch and paging a cohort board is not one.
//
// 12,971 + 115 = 13,086, which is 4,914 under the CI guard. Publishing both
// ends cost 457 files here (228 boards x 2 + the index); one end costs 229
// (114 boards + the index) — almost exactly half, and site/rankings/ itself
// (the boards, with no index in it) is EXACTLY half: 456 files before this
// change, 228 after, because every metric+scope this build kept still
// contributes precisely one board and one CSV, only the SIDE it publishes
// changed. `npm run site` is what re-measures this; the numbers above are
// its actual output on this snapshot, not an estimate.
//
// Every one of the 114 boards (115 minus the /rankings index, which has no CSV
// of its own) ships ONE CSV beside its HTML — rankingCsv, wired in the write
// loop below — and it holds the whole ordering, not one page of it: a download
// that had to be assembled from 15 files would not be a download. So the CSV
// count tracks boards, not pages, and RANKING_FILE_BUDGET (which counts the
// HTML catalogue) still bounds it one-for-one.
//
// Pages are the term that now grows without the catalogue growing, and the
// thing that bounds them is PAGE_ROWS against the ranked population — both
// data, not plan. A snapshot that doubled the campus count would double this
// section's page count; at 280 pages against 4,800 spare files, that is three
// doublings of headroom, and the CI guard catches it either way.
//
// Ranking pages are cohort-shaped, not entity-shaped — one page per (metric,
// scope) — which is why they fit at all when per-entity files do not. The guard
// below is what stops that from changing quietly: a plan that starts emitting
// one board per district fails here with the arithmetic printed, rather than at
// deploy time.

export const RANKING_FILE_BUDGET = 1_200

/** A board's CSV, same path as its HTML with the extension swapped. */
export const rankingCsvFile = (htmlFile) => String(htmlFile ?? '').replace(/\.html$/, '.csv')

/**
 * Which counties are offered a ranking at all.
 *
 * rankings.js refuses to publish a rank out of fewer than MIN_POPULATION, on the
 * same reasoning metrics.js uses: 4th of 6 is a fact about a small county, not a
 * placement anyone can cite. 231 of the 253 Texas counties hold fewer than ten
 * rated districts, so offering them a ranking page would mean 924 files, most of
 * them suppressed on arrival.
 *
 * The 22 that clear the bar are the ones where the question has an answer, and
 * they are the populous ones — Harris, Dallas, Bexar, Tarrant, Travis — so most
 * Texas parents asking "the best districts in my county" get a page. The rest
 * keep their county hub's score-ordered table and a link to the rankings index,
 * which is the honest resolution rather than a page ranking four districts.
 */
export const countyRankingScopes = (counties, level = 'district') =>
  counties
    .map((c) => ({
      c,
      rated: c.rows.filter((e) => e.level === level && typeof e.score === 'number' && Number.isFinite(e.score)).length,
    }))
    .filter(({ rated }) => rated >= MIN_POPULATION)
    .map(({ c }) => ({
      kind: 'county',
      // `id` is what rankings.js partitions on (SCOPES.county reads countyId);
      // `slug` is only the URL segment, and `countySlug` is what the link index
      // is keyed by, so /county/dallas and its ranking agree on one spelling.
      id: c.rows.find((e) => e.countyId != null)?.countyId ?? c.slug,
      slug: `${c.slug}-county`,
      countySlug: c.slug,
      label: `${c.name} County`,
      level,
      href: `/county/${c.slug}`,
    }))

/**
 * The metric set offered to the catalogue: everything rankings.js declares
 * rankable, plus a change variant for the seven measures that have real history.
 *
 * The change variants are separate metric objects rather than a flag on the
 * page, because rankings-page.js keys almost everything off the metric — the URL
 * segment, the headline verb ("largest gains" not "highest"), the signed
 * formatting, the cross-links. `kind: 'change'` is what its isChangeMetric
 * reads; the `change:` key prefix says the same thing a second way, so a spread
 * that dropped one signal cannot silently turn a change page back into a level
 * page. The slug is deliberately NOT changed: the end segment already differs
 * (`-gains` / `-declines` against `-highest` / `-lowest`), so the paths cannot
 * collide and the URLs stay readable.
 *
 * STAAR, CCMR, graduation and absenteeism get no change variant, and that is a
 * fact about the snapshot rather than an omission: TEA publishes them for the
 * current year only. Differencing a single year against itself would be
 * fabrication. They become rankable over time from the second annual snapshot,
 * which is what the dated archive exists for.
 */
export function rankingMetrics() {
  const change = CHANGE_METRICS.map((m) => ({
    ...m,
    key: `change:${m.key}`,
    base: m,
    kind: 'change',
    label: m.changeTitle ?? `Change in ${m.label}`,
    title: m.changeTitle ?? `Change in ${m.label}`,
    // The thing measured, for the headline: "the largest overall score gains".
    // Left un-lowered: rankings-page.js's nounOf()/lower1() already sentence-
    // cases this correctly, and only for labels that are sentence case
    // throughout — pre-lowering it here stripped the internal capitals off
    // Title Case labels ("Student Achievement" -> "student achievement")
    // before that check ever ran.
    noun: String(m.label ?? ''),
  }))
  return [...RANKABLE, ...change]
}

/** State (both levels), every region, and the counties big enough to rank. */
export function rankingScopes({ regions, counties }) {
  return [
    { kind: 'state', label: 'Texas', level: 'district' },
    { kind: 'state', label: 'Texas', level: 'campus' },
    ...regions.map((r) => ({ kind: 'region', id: r.id, label: r.name, level: 'district', href: `/region/${r.id}` })),
    ...countyRankingScopes(counties),
  ]
}

/**
 * DEFAULT_PLAN gives statewide districts every metric, statewide campuses the
 * ones TEA scores every campus on, and regions the headline pair. Counties are
 * added here rather than there: rankings-page.js left them out on the grounds
 * that 253 counties x 2 metrics x 2 ends is 1,012 pages for populations mostly
 * too small to rank, which is correct for all 253 and wrong for the 22 that
 * clear MIN_POPULATION. countyRankingScopes is what makes the difference — the
 * plan only ever sees counties that can carry a real ranking.
 */
export const RANKING_PLAN = [...DEFAULT_PLAN, { kind: 'county', level: 'district', select: isHeadlineMetric }]

/**
 * The exclusion lines, as prose that agrees with its own count.
 *
 * rankings.js returns exclusions as a tally; rankings-page.js prints each as
 * "<n> <reason> and are not ranked", and reconciles the total against the
 * population — a page whose named exclusions do not add up says so out loud. So
 * every reason is a verb phrase, and every one is written for both numbers: "1
 * was not rated by TEA" and "15 were not rated by TEA".
 */
const EXCLUSION_REASONS = {
  notRated: (n, year) => `${n === 1 ? 'was' : 'were'} not rated by TEA for ${year}`,
  population: (n) =>
    `${n === 1 ? 'is' : 'are'} judged under the other accountability standard, on which this measure means something different`,
  aea: (n) => `${n === 1 ? 'was' : 'were'} removed by the alternative-education filter`,
  noValue: (n) => `reported no figure for this measure`,
  noStart: (n) => `${n === 1 ? 'has' : 'have'} no figure at the start of the window`,
  noEnd: (n) => `${n === 1 ? 'has' : 'have'} no figure at the end of the window`,
}

// `level` and `scope` count the entities this page was never about — the wrong
// level, or a different county — and naming them would put "9,031 campuses are
// not ranked" under a table of districts.
const EXCLUDED_HERE = ['notRated', 'population', 'aea', 'noValue', 'noStart', 'noEnd']

export function rankingMeta(result, latestYear) {
  const tally = result.population?.excluded ?? {}
  const excluded = EXCLUDED_HERE.map((k) => ({ k, n: tally[k] ?? 0 }))
    .filter((x) => x.n > 0)
    .map(({ k, n }) => ({ n, reason: EXCLUSION_REASONS[k](n, latestYear) }))

  // The population the page states is exactly what it can account for: the rows
  // it ranked plus every exclusion it names. `result.population.eligible` counts
  // the pool AFTER rankings.js has already dropped the unrated and the
  // wrong-population, so publishing that as the denominator alongside the same
  // exclusions would double-count them and trip the reconciliation warning.
  const named = excluded.reduce((a, x) => a + x.n, 0)
  const w = result.window

  return {
    eligible: (result.population?.n ?? result.rows.length) + named,
    excluded,
    window: w ? `since ${w.from}` : latestYear ? `in ${latestYear}` : null,
    fromLabel: w?.from ?? null,
    toLabel: w?.to ?? null,
    methodology: w?.methodology ?? null,
  }
}

/**
 * A ranked row as the table wants it. rankings.js keeps the demographic shares
 * in `context` so a ranking can never BE of them (see its CONTEXT note); the
 * table reads enrollment and the two slugs from the top level, so those three
 * are lifted and the shares stay where they are.
 */
const rankingRow = (r) => {
  // A district's own districtName is itself, and rankings-page.js chooses the
  // context column by asking whether the rows carry one — so passing it through
  // gave a district ranking two "District" columns holding the same name twice.
  // The useful context for a district is its county; for a campus it is the
  // district it belongs to, which is why only the district rows drop it.
  const ofDistrict = r.level === 'district'
  return {
    ...r,
    enrollment: r.context?.enrollment ?? null,
    countySlug: r.county ? slugify(r.county) : null,
    districtName: ofDistrict ? null : r.districtName ?? null,
    districtSlug: !ofDistrict && r.districtName && r.districtId ? `${slugify(r.districtName)}-${r.districtId}` : null,
  }
}

/**
 * The rows for one end of one ordering.
 *
 * `end` is a statement about the VALUE — 'top' is the highest figure, 'bottom'
 * the lowest — never about the result, which is why chronic absenteeism has a
 * "highest" page that is its worst end and the page says so in words.
 * rankings.js sorts best-first, which is the opposite order for a metric where
 * less is better, so the rows are re-sorted here and their placements are
 * dropped: rankings-page.js recomputes them from the values with the same
 * competition rule (ties share a placement, the next skips), and a rank counted
 * from the other end of the list would otherwise travel with the row and be kept.
 */
export const rankingRows = (result, end) =>
  [...result.rows]
    .sort((a, b) => (end === 'bottom' ? a.value - b.value : b.value - a.value))
    .map(({ rank, tied, pctile, ...r }) => rankingRow(r))

/**
 * Every ranking page this build will write, computed but not yet rendered.
 *
 * Computed early, before the entity shards are spawned, because the link index
 * has to travel into the workers with them. Rendering waits until after: ~250
 * page renders competing with ten CPU-bound shards for the same cores costs more
 * than it saves.
 *
 * `cache` below is keyed by metric+level+scope, not by catalogue entry. Before
 * Rule 3 (rankings-page.js) that mattered: a metric's 'top' and 'bottom' pages
 * were two catalogue entries sharing one underlying rankBy/changeMetrics
 * result, and the cache was what stopped ~257 entries from computing it twice
 * each. Now rankingCatalogue emits at most one entry per metric+level+scope,
 * so the cache ordinarily never gets a second lookup for the same key at
 * all — it is kept anyway, as a cheap defensive dedup rather than the load-
 * bearing optimization it used to be, so a plan or a metric list that someday
 * does produce two entries for the same population still shares one
 * computation instead of paying for it twice.
 */
export function planRankings({ entities, bundles, regions, counties, latestYear }) {
  const catalogue = rankingCatalogue({
    metrics: rankingMetrics(),
    scopes: rankingScopes({ regions, counties }),
    plan: RANKING_PLAN,
  })

  if (catalogue.length + 1 > RANKING_FILE_BUDGET) {
    throw new Error(
      `the ranking catalogue asks for ${catalogue.length.toLocaleString('en-US')} pages plus an index; ` +
        `this section's budget is ${RANKING_FILE_BUDGET.toLocaleString('en-US')} files.\n` +
        `site/ held 12,971 files before rankings, the CI guard is 18,000 and the Workers hard cap is 20,000, ` +
        `so there are 5,029 spare and rankings may spend a quarter of them.\n` +
        `Read the FILE BUDGET note above RANKING_FILE_BUDGET before raising it — the usual cause is a scope ` +
        `list that grew per-entity rather than per-cohort.`
    )
  }

  const cache = new Map()
  const kept = []
  const suppressed = []

  for (const entry of catalogue) {
    const { metric, scope } = entry
    const level = scope.level ?? 'district'
    const where = scope.kind === 'state' ? 'state' : { kind: scope.kind, id: scope.id }
    const ck = `${metric.key}|${level}|${scopeKey(where)}`

    if (!cache.has(ck)) {
      const args = { entities, bundles, scope: where, level, latestYear }
      cache.set(
        ck,
        metric.base
          ? changeMetrics({ ...args, metric: metric.base.key })
          : rankBy({ ...args, metric: metric.key })
      )
    }
    const result = cache.get(ck)

    // Suppressed populations are not written at all. A page saying "nothing to
    // rank" is a file, a sitemap entry and a crawl budget spent on a table with
    // no rows in it; the count is reported instead.
    if (!result.published || result.rows.length < MIN_POPULATION) {
      suppressed.push(entry)
      continue
    }
    kept.push({ ...entry, result, level, n: result.population?.n ?? result.rows.length })
  }

  return { kept, suppressed, catalogue }
}

/**
 * level -> scope -> metric -> { top, bottom }, over the boards that were
 * actually kept. `top`/`bottom` are each either undefined (that end was never
 * built) or `{ href, title, pages }`, where `pages` is how many files that
 * board was written as.
 *
 * Only one of the two is EVER populated for a given metric now, by
 * construction: rankings-page.js's rankingCatalogue publishes a single end per
 * metric (`goodEnd` — 'bottom' for a lower-is-better measure like chronic
 * absenteeism, 'top' for everything else; see its Rule 3), so the other slot
 * is indistinguishable from one dropped by MIN_POPULATION suppression — both
 * are simply absent, and that is deliberate: a caller reading this index has
 * no way to tell "this end was never built at all" apart from "this cohort
 * was too small to rank," and does not need to.
 *
 * The shape still keys by `end` explicitly rather than collapsing to a single
 * href, because src/render/sections.js:rankedBoard has to know WHICH end it is
 * linking before it can work out where a given entity's row falls in it: the
 * two ends run in opposite directions, so an entity 400th from the top is
 * 785th from the bottom, and the page number differs accordingly.
 *
 * A board no longer truncates — a long ordering pages instead (boardPages) —
 * so every ranked entity is on some page of every end that was built, and
 * `pages` above is how many pages that is. An entity with no board to link is
 * therefore one whose only placement is on an end that does not exist: for a
 * higher-is-better metric that end would have been the worst-performers list
 * rankings-page.js's Rule 3 refuses to publish, so "no board covers this
 * entity" stays the correct, intended answer there.
 * rankedBoard's own doc comment (sections.js) has the position arithmetic;
 * this index only has to carry each end's href, title and page count, so a
 * caller can label a link with the board's actual heading ("Texas school
 * districts with the highest overall score") instead of composing its own
 * claim about what the destination contains.
 */
export function rankingIndex(kept) {
  const idx = {}
  for (const b of kept) {
    const scope = b.scope.kind === 'state' ? 'state' : `${b.scope.kind}:${b.scope.countySlug ?? b.scope.id}`
    const slot = (((idx[b.level] ??= {})[scope] ??= {})[b.metric.key] ??= {})
    // `pages` is how many files this board is, measured from the population it
    // was actually built from. sections.js needs it to link the page holding a
    // given entity's row, and taking it from here rather than recomputing it
    // from the entity's own `of` is what stops a link pointing at a -page-N
    // this build never wrote.
    slot[b.end] = { href: b.href, title: b.title, pages: pageCountFor(b.result?.rows?.length ?? 0) }
  }
  return idx
}

/**
 * The three slices of the index that apply to one entity, by reference — no
 * copying, because this runs 10,230 times inside the shard workers. The shape is
 * exactly what src/render/sections.js:rankedBoard reads: cohort, then metric
 * key, then { top, bottom }.
 */
export const rankingLinksFor = (idx, e) => {
  const byScope = idx?.[e.level]
  if (!byScope) return null
  const links = {
    state: byScope.state ?? null,
    region: byScope[`region:${regionPath(e.regionId)}`] ?? null,
    county: byScope[`county:${slugify(e.county ?? '')}`] ?? null,
  }
  return links.state || links.region || links.county ? links : null
}

/**
 * The link list a hub shows for its own population: every board in `kept`
 * that covers this scope, exactly as `kept` hands it over. This function does
 * no filtering by `end` at all, on purpose — see the hub-side coverage in
 * test/render/hubs.test.js proving a hub links whatever it is given, in
 * order. Which boards a hub actually gets to show is decided upstream, once,
 * in rankings-page.js's rankingCatalogue (Rule 3, `goodEnd`): a metric now
 * contributes exactly one board — the flattering end — so a region or county
 * page naturally shows "highest overall score" without ever needing to know
 * that a "lowest overall score" board was never built to filter out. Keeping
 * that decision in one place, upstream of every hub, is what stops a future
 * hub template from having to remember the rule for itself.
 */
export const rankingBoardsFor = (kept, scope) =>
  kept
    .filter((b) => {
      const k = b.scope.kind === 'state' ? 'state' : `${b.scope.kind}:${b.scope.countySlug ?? b.scope.id}`
      return k === scope
    })
    .map((b) => ({
      href: b.href,
      label: b.title,
      // Never a bare number: a link to a ranked list with no n is the same
      // unlabelled boast a rank with no n is.
      meta: `${b.n.toLocaleString('en-US')} ${b.level === 'campus' ? 'campuses' : 'districts'}`,
    }))

/* ------------------------------------------------------------------- main -- */
/* ------------------------------------------------------------------- main -- */

const DATASETS = {
  entities: ['id', 'level', 'name', 'district_id', 'district_name', 'county', 'county_id', 'region_id',
             'region_name', 'entity_type', 'campus_type', 'is_charter', 'is_alternative', 'enrollment',
             'rating', 'score', 'eco_dis_pct'],
  ratings: ['id', 'level', 'name', 'year', 'method', 'rating', 'score'],
  profile: ['id', 'level', 'name', 'school_year', 'students', 'eco_dis_pct', 'sped_pct', 'eng_lrn_pct',
            'attendance_pct', 'chronically_absent_pct', 'avg_teacher_salary'],
}

export async function prerender({ concurrency } = {}) {
  const started = Date.now()
  const dir = await snapshotDir()
  const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8'))
  const snapshotDate = humanDate(manifest.fetchedAt)

  // The bare snapshot folder name ('2026-08', not the human-formatted
  // snapshotDate above) and the content-hashed payload `npm run export` wrote
  // before this step ran. Read here, early, rather than where the bulk-data
  // section used to read it (after rankings.html was already written): the
  // FILE the export step produced has been on disk the entire time this
  // function runs — `npm run site` always runs export before prerender, and
  // no resetDir call below touches site/data itself (only site/data/entity) —
  // so the only thing that was ever missing was the JS variable holding its
  // name, not the file. Hoisting the read is what lets the interactive
  // rankings tool (`tool` below, and the bulk-data section further down) both
  // use the same payload href without either one re-deriving it.
  const snapshotName = dir.slice('data/raw/'.length)
  const payloadName = existsSync('build/payload-name.txt')
    ? readFileSync('build/payload-name.txt', 'utf8').trim()
    : null
  const payloadHref = payloadName && existsSync(`site/data/${payloadName}`) ? `/data/${payloadName}` : null

  const entities = ndjson('entities')
  const allRatings = ndjson('ratings')
  const profile = ndjson('profile')
  const rawDistricts = gz(dir, 'districts')
  const subjects = [...new Set(cleanAchievement(gz(dir, 'student_achievement_tab')).flatMap((a) => a.subject ?? []))]

  const byId = new Map(entities.map((e) => [e.id, e]))
  const regionNames = new Map(rawDistricts.map((d) => [regionPath(d.region_id), d.region]))
  // county id -> name, for renderRankingsIndexPage's data-rankings-lookups tag
  // (see the call below): the same normalized field countyRankingScopes and
  // rankingRow already read off `entities`, just collected once here rather
  // than requiring a second load of the raw snapshot.
  const countyNames = new Map()
  for (const e of entities) {
    if (e.countyId && e.county && !countyNames.has(e.countyId)) countyNames.set(e.countyId, e.county)
  }
  const years = [...new Set(allRatings.map((r) => r.year))].sort().reverse()
  const { districts, regions, counties, state } = hubPlan(entities, regionNames)
  const campuses = entities.filter((e) => e.level === 'campus')

  // site/data holds the content-hashed dashboard payload that `npm run export`
  // just wrote; only the entity subdirectory is ours to clear.
  await Promise.all([
    resetDir('site/district'),
    resetDir('site/campus'),
    resetDir('site/region'),
    resetDir('site/county'),
    resetDir('site/districts'),
    resetDir('site/data/entity'),
    resetDir('site/data/pins'),
    resetDir('site/search'),
    resetDir('site/rankings'),
  ])

  /* --- the ranking plan, before anything is rendered ------------------------ */
  //
  // Planned first because every other page depends on knowing which boards will
  // exist: the entity pages need the link index inside the shard workers, and
  // the hubs need the boards scoped to their own region or county. Only the PLAN
  // is computed here — the board pages themselves are rendered further down,
  // after the workers have finished, so ~600 renders do not compete with ten
  // CPU-bound shards for the same cores.

  // The whole snapshot in one Map, built once here and passed to every ranking:
  // rankingBundles extends metrics.js:sourceBundles with the same extractors, so
  // a figure in a ranked table and the same figure on the entity's own page come
  // from one place and cannot drift.
  const tables = loadTables(dir)
  const bundles = rankingBundles({ ...tables, regionNames })

  // Pin comparisons need each selected entity's current measures, but putting
  // those measures in the statewide search payload would make every name search
  // pay for data it never displays. Publish one lazy file per district instead:
  // it holds that district and its campuses, so 8,066 campuses cost 1,020 files
  // and a second pin from the same district reuses the same request.
  const pinPayloads = pinMetricPayloads({ entities, bundles, subjects })
  if (pinPayloads.size !== districts.length) {
    throw new Error(`pin metric payload count ${pinPayloads.size} does not match ${districts.length} published districts`)
  }
  const pinEntityIds = new Set()
  let pinPayloadBytes = 0
  for (const [districtId, payload] of pinPayloads) {
    for (const entityId of Object.keys(payload.entities)) {
      if (pinEntityIds.has(entityId)) throw new Error(`pin metrics publish ${entityId} more than once`)
      pinEntityIds.add(entityId)
    }
    const body = JSON.stringify(payload)
    pinPayloadBytes += Buffer.byteLength(body)
    await writeFile(`site/data/pins/${districtId}.json`, body)
  }
  const publishedEntityIds = new Set(entities.map((entity) => entity.id))
  if (
    pinEntityIds.size !== publishedEntityIds.size ||
    [...pinEntityIds].some((entityId) => !publishedEntityIds.has(entityId))
  ) {
    throw new Error(
      `pin metrics contain ${pinEntityIds.size} entities, but this build publishes ${publishedEntityIds.size}; ` +
      'refusing to leak excluded or omit published entities'
    )
  }
  const pinPayloadStats = { files: pinPayloads.size, entities: pinEntityIds.size, bytes: pinPayloadBytes }

  const { kept, suppressed } = planRankings({
    entities,
    bundles,
    regions,
    counties,
    latestYear: tables.latestYear,
  })

  const rankIndex = rankingIndex(kept)
  const rankingsIndexHref = RANKINGS_HREF
  const boardsFor = (scope) => rankingBoardsFor(kept, scope)

  // The interactive rankings tool's starting ranking: statewide districts,
  // overall score, highest first — the same catalogue entry `kept` already
  // carries for site/rankings/texas-districts/overall-score-highest.html.
  // Found now, while `kept` is fresh, so the write loop below can recognize
  // it by reference (`b === toolEntry`) and capture the exact rows/meta that
  // loop computes for that board — never a second, independently-computed
  // ranking that could drift from the static page it duplicates.
  const toolEntry = kept.find(
    (b) => b.scope.kind === 'state' && b.level === 'district' && b.metric.key === 'score' && b.end === 'top'
  )
  let toolSource = null

  /* --- entity pages, striped across workers (see the PERFORMANCE note) ------ */

  // One fewer worker than cores, measured rather than assumed: on a 10-core
  // machine 9 workers rendered this snapshot in 117 s and 10 in 124 s. The
  // shards are CPU-bound and each writes its own files, so oversubscribing
  // costs more in contention than the idle main thread saves.
  const stride = Math.max(1, Math.min(concurrency ?? availableParallelism() - 1, 16))
  const shards = await Promise.all(
    Array.from({ length: stride }, (_, index) =>
      new Promise((resolve, reject) => {
        const w = new Worker(fileURLToPath(import.meta.url), {
          workerData: { tag: SHARD_TAG, dir, index, stride, snapshotDate, rankIndex, rankingsIndex: rankingsIndexHref },
        })
        w.once('message', resolve)
        w.once('error', reject)
        w.once('exit', (code) => code !== 0 && reject(new Error(`prerender worker ${index} exited ${code}`)))
      })
    )
  )

  const entityStats = shards.reduce(
    (a, s) => ({
      pages: a.pages + s.pages,
      district: a.district + s.district,
      campus: a.campus + s.campus,
      dataFiles: a.dataFiles + s.dataFiles,
      htmlBytes: a.htmlBytes + s.htmlBytes,
      dataBytes: a.dataBytes + s.dataBytes,
      linked: a.linked + (s.linked ?? 0),
      largest: !a.largest || (s.largest && s.largest.bytes > a.largest.bytes) ? s.largest : a.largest,
    }),
    { pages: 0, district: 0, campus: 0, dataFiles: 0, htmlBytes: 0, dataBytes: 0, linked: 0, largest: null }
  )

  if (entityStats.pages !== entities.length) {
    throw new Error(`rendered ${entityStats.pages} pages for ${entities.length} entities`)
  }

  /* --- hubs ----------------------------------------------------------------- */

  const written = []
  const write = async (path, body) => {
    await writeFile(`site/${path}`, body)
    written.push({ path, bytes: Buffer.byteLength(body) })
    return body
  }

  for (const r of regions) {
    await write(
      `region/${r.id}.html`,
      renderRegionPage({
        regionId: r.id,
        regionName: r.name,
        districts: r.rows,
        snapshotDate,
        stateAvg: state.avg,
        stateN: state.n,
        rankings: boardsFor(`region:${r.id}`),
        rankingsIndex: rankingsIndexHref,
      })
    )
  }

  for (const c of counties) {
    await write(
      `county/${c.slug}.html`,
      renderCountyPage({
        countyName: c.name,
        countySlug: c.slug,
        regionId: c.regionId,
        regionName: c.regionName,
        districts: c.rows,
        snapshotDate,
        stateAvg: state.avg,
        stateN: state.n,
        rankings: boardsFor(`county:${c.slug}`),
        rankingsIndex: rankingsIndexHref,
      })
    )
  }

  const letterCounts = new Map(ALPHABET.map((l) => [l, 0]))
  for (const d of districts) {
    const l = String(d.name ?? '').trim().slice(0, 1).toLowerCase()
    if (letterCounts.has(l)) letterCounts.set(l, letterCounts.get(l) + 1)
  }
  for (const letter of ALPHABET) {
    await write(`districts/${letter}.html`, renderLetterPage({ letter, districts, snapshotDate }))
  }

  const enrolled = districts.map((d) => d.enrollment).filter(finite)

  // The front page carries the statewide boards, and at most six of them: the
  // headline metrics first (the overall score and its change over time — the two
  // orderings a newsroom actually asks for), then whatever else is statewide, and
  // /rankings carries the other ~250. The front page is a doorway to the ranked
  // lists, not a directory of them. Region and county boards are reached from the
  // region and county pages, where the reader asking "the best districts in my
  // county" already is.
  //
  // Each metric contributes exactly one board to `kept` now — its flattering
  // end only, decided once in rankings-page.js's rankingCatalogue (Rule 3) —
  // so headlineHrefs holds one href per headline metric (score, its five-year
  // change) rather than a pair, and slice(0, 6) below has nothing to split:
  // there is no second, unpublished 'bottom' entry riding along beside it to
  // worry about cutting in half.
  const statewide = boardsFor('state')
  const headlineHrefs = new Set(
    kept.filter((b) => b.scope.kind === 'state' && isHeadlineMetric(b.metric)).map((b) => b.href)
  )
  const homeRankings = [
    ...statewide.filter((r) => headlineHrefs.has(r.href)),
    ...statewide.filter((r) => !headlineHrefs.has(r.href)),
  ].slice(0, 6)

  await write(
    'index.html',
    renderHomePage({
      rankings: homeRankings,
      rankingsIndex: rankingsIndexHref,
      regions: regions.map((r) => ({ id: r.id, name: r.name, districtCount: r.districtCount })),
      letters: ALPHABET.map((letter) => ({ letter, count: letterCounts.get(letter) })),
      counts: { districts: districts.length, campuses: campuses.length },
      snapshotDate,
      stats: [
        ['Districts', districts.length, 'Every Texas public school district in this snapshot'],
        ['Campuses', campuses.length, 'Individual schools, each with a page of its own'],
        ['Counties', counties.length, 'Counties with at least one district or campus'],
        ['Academic years', years.length, `Rating history from ${years.at(-1)} to ${years[0]}`],
        [
          'Average district score',
          state.avg,
          `Mean of the ${state.n.toLocaleString('en-US')} districts TEA gave a ${years[0]} score`,
        ],
        [
          'Students enrolled',
          enrolled.reduce((a, b) => a + b, 0),
          `Across the ${enrolled.length.toLocaleString('en-US')} districts reporting enrollment`,
        ],
      ],
    })
  )

  /* --- site-wide search: the lazy index, the client script, the no-JS pages -- */

  // 27 static pages (the landing page plus one per letter) so a reader with
  // JavaScript off still lands somewhere real — see src/render/search.js for why.
  // The index itself is never inlined into a page; it is fetched on first
  // keystroke from the URL the search control carries in data-search-index.
  await write('data/search-index.json', searchIndexJson(entities))
  await write('search.js', searchClientJs())
  await write('address.js', addressClientJs())
  await write('search.html', renderSearchPage({ districts, campuses, snapshotDate }))
  for (const l of SEARCH_LETTERS) {
    await write(`search/${l}.html`, renderSearchPage({ districts, campuses, letter: l, snapshotDate }))
  }

  /* --- the ranked lists ------------------------------------------------------ */

  // Static HTML, every one of them. A ranked list is the page a newsroom cites
  // and a crawler has to be able to read, so "the table sorts once JavaScript
  // loads" is not an option for the indexable ones — site/rankings.js enhances
  // these pages, it does not supply them.
  // A board's path is /rankings/<population>/<metric>-<end>, so each population
  // is a directory of its own that has to exist before the first write into it.
  // Directories cost nothing against the asset cap — only files are counted.
  for (const dirName of new Set(kept.map((b) => b.file.slice(0, b.file.lastIndexOf('/'))))) {
    await mkdir(`site/${dirName}`, { recursive: true })
  }

  // `relatedFor` is given the KEPT catalogue, not the planned one, so a cross-link
  // can only ever point at a page this run wrote — the same rule the entity-page
  // link index follows, applied to the rankings' own navigation.
  //
  // Every board ships a CSV beside its HTML, from rankings-page.js:rankingCsv —
  // rankingCsv({ metric, scope, rows, meta, snapshotDate, end }), same filename
  // as the HTML with the extension swapped (rankings/.../overall-score-highest
  // .html -> .csv), so a reader who wants the numbers behind a table does not
  // have to fall back to the whole-dataset download for one board. `rows` and
  // `meta` are computed once and handed to both renderers, so the CSV and the
  // HTML can never disagree about what they counted. See the note on the
  // rankingsPageModule import above: if the export has not landed yet, this
  // loop writes the HTML as before and silently skips the CSV rather than
  // failing every board over one missing function.
  const rankingCsv = rankingsPageModule.rankingCsv
  let rankingCsvFiles = 0
  // Every page of every board, in the order boardPages returned them, so the
  // sitemap below lists page 9 of a campus ordering exactly when that file was
  // written. `kept` still holds one entry per BOARD — the catalogue, the
  // cross-links, the hub link lists and MAX_RANKING_PAGES all count boards, and
  // pagination deliberately does not change any of those. Only files multiply.
  const rankingPageFiles = []
  for (const b of kept) {
    const rows = rankingRows(b.result, b.end)
    const meta = rankingMeta(b.result, tables.latestYear)
    // The interactive tool's starting ranking is the SAME rows/meta this
    // board's own static page and CSV are about to be built from — captured
    // here rather than recomputed after the loop, so the tool's SSR fallback
    // and the board it duplicates (overall-score-highest) can never drift
    // apart, even if one of the two call sites is edited later and the other
    // is not.
    if (b === toolEntry) toolSource = { metric: b.metric, scope: b.scope, rows, meta }
    const pages = boardPages({
      metric: b.metric,
      scope: b.scope,
      rows,
      meta,
      related: relatedFor(kept, b),
      end: b.end,
      snapshotDate,
    })
    // Page 1 is b.file — the board's own path, unchanged — so nothing that
    // already links this board has to know pagination happened.
    for (const p of pages) {
      await write(p.file, p.html)
      rankingPageFiles.push(p.file)
    }
    // One CSV per board, not per page: it is the WHOLE ordering in one file,
    // which is exactly what a reader who does not want to walk 16 pages came
    // for. Splitting it would be a download that needs assembling.
    if (typeof rankingCsv === 'function') {
      await write(
        rankingCsvFile(b.file),
        rankingCsv({ metric: b.metric, scope: b.scope, rows, meta, snapshotDate, end: b.end })
      )
      rankingCsvFiles += 1
    }
  }

  // The interactive tool's starting ranking, in the exact shape
  // renderRankingsIndexPage's `tool` parameter documents. `payloadHref` was
  // read at the top of this function (see the note there); `toolSource` was
  // captured in the write loop above from the SAME rankBy result the
  // overall-score-highest board and its CSV were just built from. Either one
  // missing (no payload on disk, or — effectively never, at ~1,184 rated
  // districts — the board itself suppressed by MIN_POPULATION) degrades to
  // `tool: null`, which renderRankingsIndexPage already renders as "no tool
  // section" rather than a half-wired one: see its own "omits the tool"
  // tests.
  //
  // `defaults` is stated here, in the payload's own vocabulary
  // ('score.latest', decoded client-side from years[0]), not the data
  // layer's ('score', toolSource.metric.key) — the two name the same figure
  // and this is how the two layers already talk elsewhere on this site. Two
  // values are NOT simply site/rankings.js's own built-in defaults:
  //   aea: 'include', not that file's internal 'exclude' — planRankings
  //     calls rankBy/changeMetrics for every catalogue entry with no filters
  //     override, so EVERY static board on this site (including the one this
  //     tool starts on) is computed with alternative-education districts
  //     included. Declaring 'exclude' here would make the served table
  //     silently shrink the instant the payload loads and site/rankings.js's
  //     own script recomputes with its own default filter — the exact
  //     "rewrites itself the moment the payload lands" failure that file's
  //     header comment warns against.
  //   n: '50', not the design spec's literal "top twenty" — SIZES
  //     (site/rankings.js) has no '20' option, and its own DEFAULTS.n is
  //     already '50'. A declared '20' would be silently rejected by
  //     readState's validation and produce the same rewrite-on-load bug.
  const tool =
    payloadHref && toolSource
      ? {
          payloadHref,
          snapshot: snapshotName,
          defaults: {
            metric: 'score.latest',
            level: 'district',
            scope: 'state',
            aea: 'include',
            order: 'top',
            n: '50',
          },
          metric: toolSource.metric,
          scope: toolSource.scope,
          end: 'top',
          rows: toolSource.rows,
          meta: toolSource.meta,
        }
      : null

  await write(
    'rankings.html',
    renderRankingsIndexPage({
      pages: kept,
      snapshotDate,
      note: suppressed.length
        ? `${suppressed.length.toLocaleString('en-US')} further orderings were computed and not published: each covered ` +
          `fewer than ${MIN_POPULATION} rated entities, and a placement out of nine is not a placement. ` +
          `Those populations are listed in full on their region and county pages.`
        : null,
      // Names for all 20 regions and 253 counties, from data this step
      // already loads for other pages — renderRankingsIndexPage's own
      // data-rankings-lookups script tag (site/rankings.js's documented
      // contract: {"regions":{"01":"Region 01: Edinburg"},
      // "counties":{"001":"Anderson"}}) reads it whenever `tool` is present.
      lookups: {
        regions: Object.fromEntries(regionNames),
        counties: Object.fromEntries(countyNames),
      },
      // How many of Texas's counties get NO board of their own (too few
      // rated districts) — countyRankingScopes already decides which ones
      // clear that bar; this is just its denominator, for the "the other N
      // counties..." sentence renderRankingsIndexPage now prints.
      countiesTotal: counties.length,
      tool,
    })
  )

  /* --- bulk data, then the pages that link it -------------------------------- */

  const entityRow = (e) => ({
    id: e.id, level: e.level, name: e.name, district_id: e.districtId, district_name: e.districtName,
    county: e.county, county_id: e.countyId, region_id: e.regionId,
    region_name: regionNames.get(regionPath(e.regionId)) ?? null,
    entity_type: e.entityType, campus_type: e.campusType, is_charter: e.isCharter, is_alternative: e.isAlt,
    enrollment: e.enrollment, rating: e.rating, score: e.score,
    eco_dis_pct: null,
  })

  const ecoDis = new Map(profile.map((p) => [p.id, p.ecoDisPct]))
  const entityRows = entities.map((e) => ({ ...entityRow(e), eco_dis_pct: ecoDis.get(e.id) ?? null }))

  const ratingRows = allRatings.map((r) => ({
    id: r.id, level: byId.get(r.id)?.level ?? null, name: byId.get(r.id)?.name ?? null,
    year: r.year, method: r.method, rating: r.rating, score: r.score,
  }))

  const profileRows = profile.map((p) => ({
    id: p.id, level: byId.get(p.id)?.level ?? null, name: byId.get(p.id)?.name ?? null,
    school_year: p.schoolYear, students: p.total, eco_dis_pct: p.ecoDisPct, sped_pct: p.specEdPct,
    eng_lrn_pct: p.engLrnPct, attendance_pct: p.attendance, chronically_absent_pct: p.absenteeism,
    avg_teacher_salary: p.avgSalary,
  }))

  const bulk = [
    ['entities', entityRows, 'One row per district and campus: identity, current rating, score, enrollment and economically disadvantaged share.'],
    ['ratings', ratingRows, `One row per entity, year and scoring method — ${years.length} years, including the pre-2023 original scoring of 2021-22 where TEA published it.`],
    ['profile', profileRows, 'One row per entity: student demographics, attendance and average teacher salary.'],
  ]

  const files = []
  for (const [name, rows, description] of bulk) {
    const body = await write(`data/${name}.csv`, datasetCsv(rows, { columns: DATASETS[name], dataset: name, snapshotDate }))
    files.push({
      href: `/data/${name}.csv`,
      label: `${name}.csv`,
      format: 'csv',
      rows: rows.length,
      bytes: Buffer.byteLength(body),
      description,
    })
  }

  // payloadName / payloadHref were resolved once, near the top of this
  // function — see the note there. Only the byte size is looked up here.
  if (payloadHref) {
    files.push({
      href: `/data/${payloadName}`,
      label: payloadName,
      format: 'json',
      rows: entities.length,
      bytes: (await stat(`site/data/${payloadName}`)).size,
      description:
        'The column-oriented file the front page loads: every entity and every year of scores and grades in one request. Content-hashed, so the name changes when the data does.',
    })
  }

  files.push({
    href: '/data/entity/057905.csv',
    label: '/data/entity/<district id>.csv and .json',
    format: 'csv + json',
    rows: null,
    bytes: null,
    description:
      `One file per district (${districts.length.toLocaleString('en-US')} of each), long format, every metric with its cohort and denominator. ` +
      `Districts only — the ${campuses.length.toLocaleString('en-US')} campuses are not pre-generated, because ${entities.length.toLocaleString('en-US')} entities in two formats is ${(entities.length * 2).toLocaleString('en-US')} assets, on top of everything else this site publishes, and this site is capped at 20,000. ` +
      'A campus record is in the bulk files above.',
  })

  await write(
    'download.html',
    renderDownloadPage({
      files,
      snapshotDate,
      counts: {
        districts: districts.length,
        campuses: campuses.length,
        ratingYears: years.length,
        metricsCompared: metricSpecs({ subjects }).length,
        // Key names are humanised for display (`ratingYears` -> `Rating years`),
        // so an acronym in one would come out as `Tea source files`.
        sourceFiles: Object.keys(manifest.files ?? {}).length,
      },
    })
  )

  await write(
    'about.html',
    renderAboutPage({
      snapshotDate,
      counts: {
        districts: districts.length,
        campuses: campuses.length,
        years: years.length,
        metrics: metricSpecs({ subjects }).length,
      },
      sources: Object.entries(manifest.files ?? {}).map(([name, f]) => ({ name, rows: f.rows })),
    })
  )

  /* --- the state map ---------------------------------------------------- */
  //
  // Geometry comes from the committed archive (data/boundaries), not the
  // network: CI has no network, and src/boundaries.js is the manual step that
  // refreshes it. A build with no archive writes no map and says so, rather
  // than failing the whole site over one page.
  //
  // Values come from the SAME rankBy() cache the ranking boards were built
  // from, so a district's shade and its row on a board can never disagree.
  let mapWritten = 0
  const topo = await readBoundaries()
  const topoLo = await readBoundaries(BOUNDARY_FILE_LO)
  // Census returns a Unified School District GEOID after an address lookup.
  // Map that public id to the local TEA profile through the same archived bridge
  // the map uses. An empty file is still written when the optional archive is
  // absent, so the client can show Census's district name instead of a 404.
  await write('data/district-locator.json', districtLocatorJson({ topo, districts }))
  if (!topo) {
    console.log('  (no data/boundaries archive — /map skipped; run `npm run fetch:boundaries`)')
  } else {
    const teaToGeoid = new Map(Object.entries(topo.txschools?.teaToGeoid ?? {}))
    const regionLabel = new Map(regions.map((r) => [r.id, r.name]))
    // mappableDistricts drops the ones with an NCES id but no polygon, so this
    // list — and therefore `order` — is exactly what renderMapPage will draw.
    // Every layer below is indexed by position in it.
    const drawable = mappableDistricts(
      topo,
      districts
        .filter((d) => teaToGeoid.has(String(d.id)))
        .map((d) => ({
          teaId: String(d.id),
          geoid: teaToGeoid.get(String(d.id)),
          name: d.name,
          href: `/district/${entitySlug(d)}`,
          // For the zoom-to-region control: the id groups the districts, the
          // name is what the <option> says.
          region: d.regionId ?? null,
          regionName: regionLabel.get(d.regionId) ?? null,
        }))
    )
    const order = drawable.map((d) => d.teaId)

    const ratings = new Map(districts.map((d) => [String(d.id), d.rating]))
    const rating = buildRatingLayer({ ratings, order })

    const mapLayers = []
    for (const m of rankingMetrics().filter((x) => x.kind !== 'change')) {
      const result = rankBy({
        entities, bundles, metric: m, scope: 'state', level: 'district', latestYear: tables.latestYear,
      })
      const values = new Map(result.rows.map((r) => [String(r.id), r.value]))
      if (values.size < MIN_POPULATION) continue
      mapLayers.push(
        buildLayer({
          key: m.key, label: m.label, fmt: m.fmt,
          dir: m.dir,
          values, order,
        })
      )
    }

    // The sharper geometry is a separate asset so a phone never downloads it
    // and a desktop caches it independently of the page.
    const hiFiHref = topoLo ? '/map-hi.json' : null
    if (hiFiHref) {
      await write('map-hi.json', JSON.stringify(hiFiPaths({ topo, districts: drawable })))
    }
    await write(
      MAP_FILE,
      renderMapPage({ topo, topoLo, districts: drawable, layers: mapLayers, rating, snapshotDate, hiFiHref })
    )
    mapWritten = mapLayers.length + 1
    console.log(
      `  map: ${drawable.length} districts drawn, ${mapWritten} layers` +
        (topoLo ? ' (1% inline, 3% fetched on wide screens)' : ' (single fidelity)')
    )
  }

  // The 404 page was hand-written in the first commit and never regenerated, so it
  // was the only page on the site carrying the txschools.net name without the
  // non-affiliation statement, the header, or a route back. Generate it like
  // everything else. It is deliberately NOT in the sitemap.
  await write(
    '404.html',
    shell({
      title: 'Page not found',
      description: 'No district or campus at this address.',
      canonical: `${SITE_ORIGIN}/404`,
      crumbs: [],
      sections: [
        `<section class="hero">
  <p class="eyebrow">404</p>
  <h1>No page at this address</h1>
  <p class="lede">That district or school is not in this snapshot, or the address has changed.
  Every page here is named for the entity plus its TEA id, so a link that drops the id will not resolve.</p>
  <p class="downloads"><a href="/">Start from the state</a> &middot;
     <a href="/districts/a">Browse districts A&ndash;Z</a> &middot;${
       rankingsIndexHref ? `\n     <a href="${rankingsIndexHref}">Ranked lists</a> &middot;` : ''
     }
     <a href="/about">What this site is</a> &middot;
     <a href="/download">Download the data</a></p>
</section>`,
      ],
    })
  )

  /* --- favicon, share card, home-screen icon -------------------------------- */

  // Deliberately not in the sitemap and not counted as pages: they are the site's
  // identity, not documents. Three files, once, for all 10,230 entity pages.
  const brand = await writeBrandAssets('site')

  /* --- sitemap -------------------------------------------------------------- */

  // Ranked lists are in the sitemap alongside everything else, and they are the
  // entries most worth crawling: a profile page is one school's record, but
  // "Texas districts with the largest rating gains" is a page another site links
  // to, and crawl demand for the other 10,230 follows the links that arrive.
  const paths = [
    '',
    'about.html',
    'download.html',
    'search.html',
    'rankings.html',
    // Written only when the boundary archive is present; a sitemap entry for a
    // file this build did not write would be a 404 advertised to every crawler.
    ...(mapWritten ? [MAP_FILE] : []),
    // Every page of every board, not just each board's first: pages 2+ hold
    // rows that appear nowhere else on the site, and each one is its own
    // canonical (rankings-page.js), so leaving them out would ask a crawler to
    // find 6,783 of 7,283 campuses by following pager links alone.
    ...rankingPageFiles,
    ...regions.map((r) => `region/${r.id}.html`),
    ...counties.map((c) => `county/${c.slug}.html`),
    ...ALPHABET.map((l) => `districts/${l}.html`),
    ...SEARCH_LETTERS.map((l) => `search/${l}.html`),
    ...entities.map(entityPath),
  ]
  await write('sitemap.xml', renderSitemap(paths))

  // A _redirects left behind by an older build is not inert — Cloudflare follows
  // its rules ahead of asset lookup (see the note at the top of this file), so a
  // stale copy would keep the 2,398 district files unreachable in production
  // forever after. resetDir does not reach top-level files, so remove it here.
  await rm('site/_redirects', { force: true })

  const total = await countFiles('site')
  // "Largest page" means a page: the bulk CSVs are bigger than any of them and
  // would win a comparison that did not say what it was comparing.
  const largest = [entityStats.largest, ...written.filter((w) => w.path.endsWith('.html'))]
    .filter(Boolean)
    .sort((a, b) => b.bytes - a.bytes)[0]
  const elapsed = (Date.now() - started) / 1000

  report({
    entityStats, regions, counties, entities, elapsed, total, largest, stride, files, brand,
    pinPayloadStats,
    rankings: {
      boards: kept.length,
      pages: rankingPageFiles.length,
      index: 1,
      suppressed: suppressed.length,
      linked: entityStats.linked,
      csv: rankingCsvFiles,
    },
  })
  return { pages: entityStats.pages + written.length, files: total, elapsed, largest, brand }
}

async function countFiles(dir) {
  let n = 0
  for (const e of await readdir(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? await countFiles(`${dir}/${e.name}`) : 1
  }
  return n
}

const mb = (b) => `${(b / 1e6).toFixed(1)} MB`

function report({ entityStats, regions, counties, entities, elapsed, total, largest, stride, brand = [], rankings = null, pinPayloadStats = null }) {
  const rows = [
    ['district pages', entityStats.district],
    ['campus pages', entityStats.campus],
    ['region pages', regions.length],
    ['county pages', counties.length],
    ['letter pages', ALPHABET.length],
    // A board is one ordering; a page is one file. They stopped being the same
    // number when long orderings started paging instead of truncating, and the
    // file budget is spent in pages, so pages is what this row counts.
    ['ranking pages', (rankings?.pages ?? rankings?.boards ?? 0) + (rankings?.index ?? 0)],
    ['ranking CSVs', rankings?.csv ?? 0],
    ['home / about / download', 3],
    ['per-district CSV + JSON', entityStats.dataFiles],
    ['pin metric bundles', pinPayloadStats?.files ?? 0],
    ['bulk CSVs', 3],
    ['favicon + share images', brand.length],
  ]

  console.log(`\n=== MEASUREMENT: prerender (design §11) ===`)
  for (const [label, n] of rows) console.log(`  ${label.padEnd(26)}${n.toLocaleString('en-US').padStart(7)}`)
  console.log(`  ${'-'.repeat(33)}`)
  console.log(`  ${'files in site/'.padEnd(26)}${total.toLocaleString('en-US').padStart(7)}   limit 18,000 (CI) / 20,000 (Workers)`)
  console.log(`  ${'html'.padEnd(26)}${mb(entityStats.htmlBytes).padStart(7)}`)
  console.log(`  ${'per-district data'.padEnd(26)}${mb(entityStats.dataBytes).padStart(7)}`)
  if (pinPayloadStats) {
    console.log(
      `  ${'pin metric data'.padEnd(26)}${mb(pinPayloadStats.bytes).padStart(7)}   ` +
        `${pinPayloadStats.entities.toLocaleString('en-US')} published entities in ${pinPayloadStats.files.toLocaleString('en-US')} district bundles`
    )
  }
  console.log(`  ${'largest page'.padEnd(26)}${(largest.bytes / 1024).toFixed(1).padStart(7)} KB   /${largest.path.replace(/\.html$/, '')}`)
  if (rankings) {
    if (rankings.pages && rankings.pages !== rankings.boards) {
      console.log(
        `  ${'from ranked orderings'.padEnd(26)}${rankings.boards.toLocaleString('en-US').padStart(7)}   ` +
          `boards, paged at ${PAGE_ROWS} rows — every ranked row is printed, none truncated`
      )
    }
    console.log(
      `  ${'entity pages linking a'.padEnd(26)}${rankings.linked.toLocaleString('en-US').padStart(7)}   ` +
        `of ${entities.length.toLocaleString('en-US')} — a rank on a page now links the list it came from`
    )
    if (rankings.suppressed) {
      console.log(
        `  ${'orderings not published'.padEnd(26)}${rankings.suppressed.toLocaleString('en-US').padStart(7)}   ` +
          `fewer than ${MIN_POPULATION} rated entities — no page, no sitemap entry, no link`
      )
    }
    if (!rankings.csv && rankings.boards) {
      console.log(
        `  ${'ranking CSVs'.padEnd(26)}${'0'.padStart(7)}   rankingCsv() is not exported by src/render/rankings-page.js ` +
          `in this build — every board's HTML wrote, its CSV was skipped`
      )
    }
  }
  for (const b of brand) {
    console.log(`  ${b.path.padEnd(26)}${(b.bytes / 1024).toFixed(1).padStart(7)} KB`)
  }
  console.log(`  ${'elapsed'.padEnd(26)}${elapsed.toFixed(1).padStart(7)} s   ${stride} workers, ${((elapsed * stride * 1000) / entities.length).toFixed(0)} ms/entity/core`)
}

/* --------------------------------------------------------------- entry points */

// A worker thread re-imports this module. The tag keeps that branch from firing
// inside anything else that runs modules in workers — vitest's default pool does
// exactly that, and an untagged `!isMainThread` check would start a full render
// the moment a test imported this file.
if (!isMainThread && workerData?.tag === SHARD_TAG) {
  parentPort.postMessage(await renderShard(workerData))
}

// `isMainThread` is load-bearing, not decoration: a worker inherits process.argv
// from the process that spawned it, so inside a shard worker this file IS
// argv[1] and the CLI guard alone fires — every worker would start a second full
// prerender, spawn nine more workers, and resetDir the directories the others
// were writing into.
if (isMainThread && import.meta.url === `file://${process.argv[1]}`) {
  await prerender()
}
