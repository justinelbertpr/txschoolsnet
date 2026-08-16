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
//     entity pages                        10,230
//     hubs (20 region + 253 county
//           + 26 letter + home)              300
//     about, download                         2
//     search (search.html + 26 letter
//       pages + search.js + the index)       29
//     sitemap.xml                             1
//     404 / style.css / app.js / _headers     4
//     favicon.svg, og.png,
//       apple-touch-icon.png                  3
//     dashboard payload                       1
//     bulk CSVs                               3
//     ------------------------------------------
//     floor before any per-entity file    10,573
//
// That leaves 7,427 slots under the CI guard and 9,427 under the hard cap — and
// there are 10,230 entities. So *one* file per entity does not fit in either
// budget, let alone the two (CSV and JSON) an entity page could link.
// 10,230 x 2 = 20,460 extra files is 31,033 total: past the hard cap by 55%.
//
// The same arithmetic is why there is ONE share image rather than one per entity:
// 10,230 og:images is half the cap on its own. See writeBrandAssets below. It is
// also why the search index is one lazy-loaded JSON file rather than 10,230
// names inlined into every page — see src/render/search.js.
//
// The decision: per-entity CSV + JSON for the 1,199 districts only.
//
//     10,573 + (1,199 x 2 = 2,398) = 12,971 files, 5,029 under the CI guard.
//
// Districts win the slots because they are the low-cardinality half (1,199 vs
// 9,031) and the half people download — a district's record is the unit a comms
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
import { readdir, writeFile, stat, rm } from 'node:fs/promises'

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
import { APPLE_TOUCH_ICON, BRAND, MARK_BARS, OG_IMAGE, faviconSvg, shell } from './render/shell.js'
import { renderAboutPage } from './render/about.js'
import { renderDownloadPage, datasetCsv, entityCsv, entityJson } from './render/downloads.js'

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

/** One stripe of the entity list: pages, plus data files for the districts in it. */
async function renderShard({ dir, index, stride, snapshotDate }) {
  const t = loadTables(dir)
  const stats = { pages: 0, district: 0, campus: 0, dataFiles: 0, htmlBytes: 0, dataBytes: 0, largest: null }

  for (let i = index; i < t.entities.length; i += stride) {
    const e = t.entities[i]
    const vm = viewModelFor(t, e, snapshotDate)
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

  const entities = ndjson('entities')
  const allRatings = ndjson('ratings')
  const profile = ndjson('profile')
  const rawDistricts = gz(dir, 'districts')
  const subjects = [...new Set(cleanAchievement(gz(dir, 'student_achievement_tab')).flatMap((a) => a.subject ?? []))]

  const byId = new Map(entities.map((e) => [e.id, e]))
  const regionNames = new Map(rawDistricts.map((d) => [regionPath(d.region_id), d.region]))
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
    resetDir('site/search'),
  ])

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
          workerData: { tag: SHARD_TAG, dir, index, stride, snapshotDate },
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
      largest: !a.largest || (s.largest && s.largest.bytes > a.largest.bytes) ? s.largest : a.largest,
    }),
    { pages: 0, district: 0, campus: 0, dataFiles: 0, htmlBytes: 0, dataBytes: 0, largest: null }
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

  await write(
    'index.html',
    renderHomePage({
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
  await write('search.html', renderSearchPage({ districts, campuses, snapshotDate }))
  for (const l of SEARCH_LETTERS) {
    await write(`search/${l}.html`, renderSearchPage({ districts, campuses, letter: l, snapshotDate }))
  }

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

  const payloadName = existsSync('build/payload-name.txt')
    ? readFileSync('build/payload-name.txt', 'utf8').trim()
    : null
  if (payloadName && existsSync(`site/data/${payloadName}`)) {
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
      `Districts only — the ${campuses.length.toLocaleString('en-US')} campuses are not pre-generated, because 10,230 entities in two formats is 20,460 assets and this site is capped at 20,000. ` +
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
     <a href="/districts/a">Browse districts A&ndash;Z</a> &middot;
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

  const paths = [
    '',
    'about.html',
    'download.html',
    'search.html',
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

  report({ entityStats, regions, counties, entities, elapsed, total, largest, stride, files, brand })
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

function report({ entityStats, regions, counties, entities, elapsed, total, largest, stride, brand = [] }) {
  const rows = [
    ['district pages', entityStats.district],
    ['campus pages', entityStats.campus],
    ['region pages', regions.length],
    ['county pages', counties.length],
    ['letter pages', ALPHABET.length],
    ['home / about / download', 3],
    ['per-district CSV + JSON', entityStats.dataFiles],
    ['bulk CSVs', 3],
    ['favicon + share images', brand.length],
  ]

  console.log(`\n=== MEASUREMENT: prerender (design §11) ===`)
  for (const [label, n] of rows) console.log(`  ${label.padEnd(26)}${n.toLocaleString('en-US').padStart(7)}`)
  console.log(`  ${'-'.repeat(33)}`)
  console.log(`  ${'files in site/'.padEnd(26)}${total.toLocaleString('en-US').padStart(7)}   limit 18,000 (CI) / 20,000 (Workers)`)
  console.log(`  ${'html'.padEnd(26)}${mb(entityStats.htmlBytes).padStart(7)}`)
  console.log(`  ${'per-district data'.padEnd(26)}${mb(entityStats.dataBytes).padStart(7)}`)
  console.log(`  ${'largest page'.padEnd(26)}${(largest.bytes / 1024).toFixed(1).padStart(7)} KB   /${largest.path.replace(/\.html$/, '')}`)
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
