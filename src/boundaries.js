// Fetches the district boundaries the map page draws, and archives them the way
// this repo archives everything else: a dated, hashed snapshot that the build
// reads offline.
//
// ------------------------------------------------------------ WHY COMMITTED
//
// CI has no network (see .github/workflows/ci.yml — "the build reads the dated
// TEA snapshot committed under data/raw/"). A map that fetched its geometry at
// build time would fail every run. So the DERIVED file is committed, exactly
// like the TEA snapshot, and this script is the manual step that regenerates it
// — annual, alongside the TEA fetch, not part of `npm run site`.
//
// ------------------------------------------------------ WHY *DERIVED*, NOT RAW
//
// The raw TIGER shapefile for Texas is 16 MB zipped and survey-grade: it carries
// coordinate precision for property boundaries, which a 900px-wide map of the
// whole state cannot render and no reader can see. Committing it would put 16 MB
// of unusable precision in the history for every future clone.
//
// What is committed instead is the simplified, projected TopoJSON — ~130 KB
// gzipped — and a manifest recording the sha256 of the ORIGINAL downloads plus
// the exact command used to derive it. So the provenance chain still holds: the
// bytes on disk are re-derivable from the bytes Census and NCES served, and this
// file records how. That is the same standard the TEA snapshot is held to, met
// differently because the source is 100x larger than what the site can use.
//
// ------------------------------------------------------------- THE JOIN KEY
//
// TEA numbers districts with a 6-digit county-district id (Klein ISD = 101915).
// NCES numbers them with a 7-digit LEAID (4823640), which is also the GEOID on
// the TIGER polygons. Nothing in TEA's own data carries the NCES number — but
// NCES's Common Core of Data carries TEA's, as `state_leaid` = "TX-101915". That
// string is the whole bridge, and it is exact: every one of the 1,239 Texas CCD
// records has one, and 1,015 of the site's 1,019 rated traditional districts
// resolve to a polygon through it.
//
// The four that do not are not a defect in the join. South Texas ISD is a magnet
// district with no contiguous territory, Vysehrad ISD is a single-campus rural
// district TIGER folds into its neighbour, and two are university lab schools
// (Texas Tech K-12, UT Austin HS) that enroll statewide. None of them HAS a
// boundary to draw. They are listed by name on the map page rather than silently
// dropped — see src/render/map.js.
//
// Charters are absent for the same honest reason and are not counted as a miss:
// an open-enrollment charter draws students from anywhere, so it has no
// territory. This site does not publish them anyway.

import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { promisify } from 'node:util'

const run = promisify(execFile)

export const BOUNDARY_DIR = 'data/boundaries'
export const BOUNDARY_FILE = `${BOUNDARY_DIR}/tx-districts.topo.json.gz`
export const BOUNDARY_FILE_LO = `${BOUNDARY_DIR}/tx-districts-lo.topo.json.gz`
export const BOUNDARY_MANIFEST = `${BOUNDARY_DIR}/manifest.json`

/**
 * Census TIGER/Line, not the NCES EDGE re-publication of it, for one reason:
 * EDGE ships the whole country in one file and Census ships per state, so this
 * downloads 16 MB rather than 800 MB for the same geometry. EDGE is derived
 * from TIGER — NCES says so — and the GEOID keys are identical.
 *
 * ELSD (elementary) and SCSD (secondary) are deliberately not fetched: Texas has
 * none. Both files exist and both are empty, which is a fact about Texas school
 * governance (independent districts are unified by construction) rather than an
 * oversight, and fetching them would add two requests that can only ever return
 * zero features.
 */
export const TIGER_URL = 'https://www2.census.gov/geo/tiger/TIGER2024/UNSD/tl_2024_48_unsd.zip'

/**
 * The NCES Common Core of Data district directory, through the Urban Institute's
 * mirror of it. Urban republishes NCES's own files unmodified behind a JSON API;
 * NCES's own download is an ASP.NET form that cannot be fetched unattended.
 * Only two fields are read — `leaid` and `state_leaid` — so what is being
 * trusted here is a pair of identifiers, not any statistic.
 */
export const CCD_URL =
  'https://educationdata.urban.org/api/v1/school-districts/ccd/directory/2022/?fips=48&limit=2000'

/**
 * The DESKTOP fidelity, fetched on demand by site/map.js. 476 KB of TopoJSON,
 * 171 KB gzipped. This is where the extra detail actually earns its bytes: on
 * a wide screen the state is drawn 900px+ across and the difference between
 * this and SIMPLIFY_LO is visible in the coastline and the small East Texas
 * districts. 5% costs 35% more again and is not visibly better even there.
 *
 * `keep-shapes` is what stops the smallest districts — the single-campus rural
 * ones — from being simplified out of existence entirely. Without it a
 * percentage this aggressive silently deletes the districts most likely to be
 * someone's own.
 */
export const SIMPLIFY = '3%'

/**
 * The phone fidelity, and the one that ships INLINE in the page.
 *
 * At the ~350px a phone renders the state at, 1% and 3% are indistinguishable
 * — rendered side by side at that width, the coastline, the Panhandle county
 * lines and every district border read identically. The detail 3% carries only
 * becomes visible on a wide screen, so a phone paying 40% more bytes for it is
 * paying for nothing it can see.
 *
 * So 1% is the default everywhere, and site/map.js swaps in the 3% geometry
 * only where the viewport is wide enough to resolve it. Both files are built
 * from the same source in the same projection, and the page computes its
 * projection from the 3% bounds for BOTH, so the swap cannot shift the map.
 */
export const SIMPLIFY_LO = '1%'

/**
 * Albers equal-area, with standard parallels set for Texas.
 *
 * Equal-area matters more than usual on a choropleth: the reader judges "how
 * much of the state is rated D" by the area of the colour, so a projection that
 * inflates the Panhandle relative to the Valley would make the map lie about
 * the very thing it is drawn to show. Plate carrée (raw lon/lat) stretches
 * Texas noticeably east-west at this latitude and is what the source uses.
 */
export const PROJECTION = '+proj=aea +lat_1=27.5 +lat_2=35 +lat_0=31.25 +lon_0=-99 +datum=NAD83'

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

/** TEA district id -> NCES LEAID (which is the TIGER GEOID), from CCD. */
export function crosswalk(ccdResults) {
  const out = new Map()
  for (const r of ccdResults ?? []) {
    const sl = String(r?.state_leaid ?? '')
    if (!sl.startsWith('TX-')) continue
    const tea = sl.slice(3)
    const leaid = String(r?.leaid ?? '')
    if (tea && leaid) out.set(tea, leaid)
  }
  return out
}

/**
 * Node's fetch sends no User-Agent, and the Urban Institute's API answers that
 * with a 403. Identifying the caller is the right thing to do when pulling from
 * someone else's public service anyway: it says who is asking and where to
 * complain, rather than pretending to be a browser.
 */
const UA = 'txschools.net boundary fetch (+https://txschools.net/about)'

async function fetchBuffer(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' } })
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

export async function fetchBoundaries({ dir = BOUNDARY_DIR, log = console.log } = {}) {
  const tmp = `${dir}/.tmp`
  await mkdir(tmp, { recursive: true })

  log('fetching TIGER district polygons…')
  const zip = await fetchBuffer(TIGER_URL)
  await writeFile(`${tmp}/unsd.zip`, zip)
  log(`  ${(zip.length / 1048576).toFixed(1)} MB`)

  log('fetching the NCES CCD id crosswalk…')
  const ccdBuf = await fetchBuffer(CCD_URL)
  const ccd = JSON.parse(ccdBuf.toString('utf8'))
  const bridge = crosswalk(ccd.results)
  log(`  ${bridge.size} Texas districts carry a TX- state_leaid`)
  if (bridge.size < 1000) throw new Error(`CCD returned only ${bridge.size} Texas districts; expected ~1,239`)

  await run('unzip', ['-o', '-q', `${tmp}/unsd.zip`, '-d', tmp])

  // mapshaper is a devDependency and is only ever needed HERE. The build never
  // calls it — it reads the committed output — so a missing install should stop
  // this script with a sentence, not fail somewhere inside the site build.
  const simplifyTo = async (pct, out) => {
    log(`projecting and simplifying (${pct}, equal-area)…`)
    await run('npx', [
      'mapshaper',
      `${tmp}/tl_2024_48_unsd.shp`,
      '-filter-fields', 'GEOID',
      '-proj', PROJECTION,
      '-simplify', pct, 'keep-shapes',
      '-o', 'format=topojson', 'precision=1', out,
    ])
    const parsed = JSON.parse(await readFile(out, 'utf8'))
    const n = Object.values(parsed.objects)[0]?.geometries?.length ?? 0
    if (n < 900) throw new Error(`only ${n} polygons survived ${pct} simplification; expected ~1,017`)
    return parsed
  }

  const topo = await simplifyTo(SIMPLIFY, `${tmp}/tx.topo.json`)
  const topoLo = await simplifyTo(SIMPLIFY_LO, `${tmp}/tx-lo.topo.json`)
  const features = Object.values(topo.objects)[0].geometries.length
  // Both fidelities must cover the SAME districts, or a phone would silently be
  // missing polygons the desktop draws.
  const loCount = Object.values(topoLo.objects)[0].geometries.length
  if (loCount !== features) {
    throw new Error(`fidelities disagree: ${features} polygons at ${SIMPLIFY}, ${loCount} at ${SIMPLIFY_LO}`)
  }

  // The crosswalk travels WITH the geometry. A consumer that has the file has
  // everything it needs to join TEA ids to shapes, with no second lookup and no
  // second network source to keep in step.
  topo.txschools = {
    teaToGeoid: Object.fromEntries([...bridge].sort(([a], [b]) => a.localeCompare(b))),
    projection: PROJECTION,
    simplify: SIMPLIFY,
  }

  topoLo.txschools = { derivedFrom: SIMPLIFY_LO }

  const json = JSON.stringify(topo)
  const gz = gzipSync(Buffer.from(json), { level: 9 })
  const jsonLo = JSON.stringify(topoLo)
  const gzLo = gzipSync(Buffer.from(jsonLo), { level: 9 })
  await mkdir(dir, { recursive: true })
  await writeFile(`${dir}/tx-districts.topo.json.gz`, gz)
  await writeFile(`${dir}/tx-districts-lo.topo.json.gz`, gzLo)

  const manifest = {
    fetchedAt: new Date().toISOString(),
    describes: 'Texas school district boundaries, simplified and projected for the /map page',
    derivedLo: {
      file: 'tx-districts-lo.topo.json.gz',
      bytes: gzLo.length,
      uncompressedBytes: Buffer.byteLength(jsonLo),
      polygons: loCount,
      sha256: sha256(gzLo),
      simplify: SIMPLIFY_LO,
      note: 'Ships inline in /map. Indistinguishable from the full fidelity at phone width.',
    },
    derived: {
      file: 'tx-districts.topo.json.gz',
      bytes: gz.length,
      uncompressedBytes: Buffer.byteLength(json),
      polygons: features,
      sha256: sha256(gz),
      // Everything needed to reproduce the file from the sources below.
      simplify: SIMPLIFY,
      projection: PROJECTION,
      command: `mapshaper tl_2024_48_unsd.shp -filter-fields GEOID -proj "${PROJECTION}" -simplify ${SIMPLIFY} keep-shapes -o format=topojson precision=1`,
    },
    sources: {
      boundaries: {
        url: TIGER_URL,
        bytes: zip.length,
        sha256: sha256(zip),
        publisher: 'US Census Bureau, TIGER/Line 2024',
        note: 'Public domain. NCES EDGE republishes this same geometry with the same GEOID keys.',
      },
      crosswalk: {
        url: CCD_URL,
        bytes: ccdBuf.length,
        sha256: sha256(ccdBuf),
        districts: bridge.size,
        publisher: 'NCES Common Core of Data, via the Urban Institute Education Data API',
        note: 'Read for two fields only: leaid and state_leaid.',
      },
    },
  }
  await writeFile(BOUNDARY_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)
  await rm(tmp, { recursive: true, force: true })

  log(`\nwrote ${BOUNDARY_FILE}`)
  log(`  ${features} polygons at ${SIMPLIFY}, ${(gz.length / 1024).toFixed(0)} KB gzipped (${(json.length / 1024).toFixed(0)} KB raw)`)
  log(`wrote ${BOUNDARY_FILE_LO}`)
  log(`  ${loCount} polygons at ${SIMPLIFY_LO}, ${(gzLo.length / 1024).toFixed(0)} KB gzipped (${(jsonLo.length / 1024).toFixed(0)} KB raw)`)
  return { features, bytes: gz.length, bridge }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  fetchBoundaries().catch((err) => {
    console.error(`\nboundaries: ${err.message}`)
    process.exit(1)
  })
}
