// Renders one entity page from the committed snapshot, using the same shell,
// sections and view model the real build will use. Design iteration runs through
// here so it never waits on a 10,230-page rebuild.
//
//   node scripts/prototype.mjs 057905

import { gunzipSync } from 'node:zlib'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { renderEntity } from '../src/render/page.js'
import { buildViewModel, entitySlug } from '../src/render/view-model.js'
import { toEntities } from '../src/normalize/entities.js'
import { toRatings, preferredRatings } from '../src/normalize/ratings.js'
import { toDomains } from '../src/normalize/domains.js'
import { toFinance } from '../src/normalize/finance.js'
import { toProfile } from '../src/normalize/profile.js'

const DIR = 'data/raw/2026-08'
const rd = (n) => JSON.parse(gunzipSync(readFileSync(`${DIR}/${n}.json.gz`)).toString('utf8'))
const ID = process.argv[2] ?? '057905'
const LATEST = '2025-26'

const rawDistricts = rd('districts')
const rawSchools = rd('schools')
const rawById = new Map([...rawDistricts, ...rawSchools].map((r) => [r.id, r]))
const rawProfile = new Map(rd('profile_tab').map((r) => [r.id, r]))

const entities = toEntities(rawDistricts, rawSchools)
const entity = entities.find((e) => e.id === ID)
if (!entity) throw new Error(`no entity ${ID}`)

const allRatings = toRatings(rd('change_over_time'))
const achievement = rd('student_achievement_tab')

// profile_tab carries several fields toProfile deliberately drops; the view model
// takes them off the raw record so the normalized table stays narrow.
const rawMerged = { ...rawById.get(ID), ...rawProfile.get(ID) }

const vm = buildViewModel({
  entity,
  entities,
  ratings: preferredRatings(allRatings),
  allRatings,
  domains: toDomains(rd('overview')),
  finance: [...toFinance(rd('finance_district')), ...toFinance(rd('finance_school'))],
  profile: toProfile(rd('profile_tab')),
  raw: rawMerged,
  achievement,
  snapshotDate: '15 August 2026',
  latestYear: LATEST,
})

const html = renderEntity(vm)
mkdirSync(`site/${entity.level}`, { recursive: true })
const out = `site/${entity.level}/${entitySlug(entity)}.html`
writeFileSync(out, html)

const present = [
  ['trajectory', vm.history.length],
  ['peer band', vm.peerN],
  ['domains', vm.domains.length],
  ['STAAR subjects', vm.staar?.subjects.length ?? 0],
  ['graduation', vm.graduation?.length ?? 0],
  ['CCMR', vm.ccmr?.length ?? 0],
  ['finance years', vm.finance?.years.length ?? 0],
  ['campuses', vm.campuses?.length ?? 0],
]

console.log(`\n  ${vm.name}  →  /${entity.level}/${entitySlug(entity)}`)
console.log(`  ${(Buffer.byteLength(html) / 1024).toFixed(1)} KB · ${(html.match(/<section/g) || []).length} sections`)
console.log(`  rank ${vm.rank}/${vm.rankOf} statewide · ${vm.regionRank}/${vm.regionRankOf} in region`)
console.log(
  `  latest ${vm.history[0]?.score} vs peers ${vm.peerAvg ?? '—'} vs state ${vm.stateAvg ?? '—'}`
)
console.log('  ' + present.map(([k, v]) => `${k} ${v}`).join(' · ') + '\n')
