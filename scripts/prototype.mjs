// Renders ONE entity page from the committed snapshot so the design can be looked at
// before it is wired into the 10,230-page build. Throwaway scaffolding: the real
// version reads build/*.ndjson. Usage: node scripts/prototype.mjs [id]

import { gunzipSync } from 'node:zlib'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { renderEntityPage } from '../src/render/entity-page.js'
import { toRatings, preferredRatings } from '../src/normalize/ratings.js'
import { toDomains, DOMAIN_LABELS } from '../src/normalize/domains.js'
import { toFinance } from '../src/normalize/finance.js'
import { toProfile } from '../src/normalize/profile.js'
import { toEntities } from '../src/normalize/entities.js'

const DIR = 'data/raw/2026-08'
const rd = (n) => JSON.parse(gunzipSync(readFileSync(`${DIR}/${n}.json.gz`)).toString('utf8'))
const ID = process.argv[2] ?? '057905'

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')

const rawDistricts = rd('districts')
const rawSchools = rd('schools')
const entities = toEntities(rawDistricts, rawSchools)
const byId = new Map(entities.map((e) => [e.id, e]))
const ent = byId.get(ID)
if (!ent) throw new Error(`no entity ${ID}`)

const ratings = preferredRatings(toRatings(rd('change_over_time')))
const allRatings = toRatings(rd('change_over_time'))
const domains = toDomains(rd('overview'))
const finance = [...toFinance(rd('finance_district')), ...toFinance(rd('finance_school'))]
const profiles = new Map(toProfile(rd('profile_tab')).map((p) => [p.id, p]))
const rawById = new Map([...rawDistricts, ...rawSchools].map((r) => [r.id, r]))

const history = ratings.filter((r) => r.id === ID).sort((a, b) => b.year.localeCompare(a.year))
const latestYear = history[0]?.year

// Rank within level, and within region, on the latest year.
const peersSameLevel = ratings.filter(
  (r) => r.year === latestYear && byId.get(r.id)?.level === ent.level && r.score !== null
)
const sorted = [...peersSameLevel].sort((a, b) => b.score - a.score)
const rank = sorted.findIndex((r) => r.id === ID) + 1

const inRegion = sorted.filter((r) => byId.get(r.id)?.regionId === ent.regionId)
const regionRank = inRegion.findIndex((r) => r.id === ID) + 1

const stateByYear = {}
for (const r of ratings) {
  if (byId.get(r.id)?.level !== ent.level || r.score === null) continue
  ;(stateByYear[r.year] ??= []).push(r.score)
}
for (const [y, xs] of Object.entries(stateByYear)) {
  stateByYear[y] = Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10
}

const original = allRatings.find((r) => r.id === ID && r.method === 'original')
const fin = finance.filter((f) => f.id === ID).sort((a, b) => a.year.localeCompare(b.year))
const latestFin = fin.at(-1)
const raw = rawById.get(ID)
const prof = profiles.get(ID)

const dom = domains
  .filter((d) => d.id === ID && d.year === '2025-26')
  .map((d) => ({ ...d, label: DOMAIN_LABELS[d.domain] }))
const ORDER = ['achievement', 'progress', 'gaps', 'progress_growth', 'progress_relative']
dom.sort((a, b) => ORDER.indexOf(a.domain) - ORDER.indexOf(b.domain))

const campuses =
  ent.level === 'district'
    ? entities
        .filter((c) => c.level === 'campus' && c.districtId === ID)
        .map((c) => ({ ...c, slug: `${slug(c.name)}-${c.id}` }))
        .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
    : []

const view = {
  ...ent,
  slug: `${slug(ent.name)}-${ent.id}`,
  districtSlug: `${slug(ent.districtName ?? '')}-${ent.districtId}`,
  countySlug: slug(ent.county ?? ''),
  regionName: raw?.region ?? `Region ${ent.regionId}`,
  history,
  stateByYear,
  stateAvg: stateByYear[latestYear],
  rank,
  rankOf: sorted.length,
  regionRank,
  regionRankOf: inRegion.length,
  notRated: ent.rating === 'Not Rated',
  originalScore: original?.score ?? null,
  originalRating: original?.rating ?? null,
  domains: dom,
  profile: prof ? { ...prof, teachers: raw?.Full_Time_Teachers, stuPerStaff: prof.stuPerStaff } : null,
  raceShare: raw && profiles.get(ID) ? rd('profile_tab').find((p) => p.id === ID)?.Enrollment : null,
  staffYears: rd('profile_tab').find((p) => p.id === ID)?.Staff_Years ?? null,
  finance: fin.length
    ? {
        years: fin.map((f) => f.year),
        spendEntity: fin.map((f) => f.spendEntity),
        spendPeer: fin.map((f) => f.spendPeer),
        spendState: fin.map((f) => f.spendState),
        vsPeer:
          latestFin?.spendEntity != null && latestFin?.spendPeer != null
            ? latestFin.spendEntity - latestFin.spendPeer
            : null,
      }
    : null,
  campuses,
  snapshotDate: '15 August 2026',
}

// profile_tab carries teacher counts and the student/staff ratio under raw keys.
const rawProf = rd('profile_tab').find((p) => p.id === ID)
if (view.profile && rawProf) {
  view.profile.teachers = rawProf.Full_Time_Teachers
  view.profile.stuPerStaff = rawProf.Stu_Per_Staff
}

mkdirSync(`site/${ent.level}`, { recursive: true })
const out = `site/${ent.level}/${view.slug}.html`
writeFileSync(out, renderEntityPage(view))
console.log(`\n  ${ent.name}  →  ${out}`)
console.log(`  rank ${rank}/${sorted.length} statewide · ${regionRank}/${inRegion.length} in region`)
console.log(`  ${(Buffer.byteLength(renderEntityPage(view)) / 1024).toFixed(1)} KB\n`)
