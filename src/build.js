import { existsSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { toEntities } from './normalize/entities.js'
import { toRatings } from './normalize/ratings.js'
import { toProfile } from './normalize/profile.js'
import {
  ENROLLMENT_LANDING_URL,
  ENROLLMENT_ROOT,
  latestEnrollmentSnapshot,
  loadEnrollmentRows,
} from './enrollment.js'
import {
  ACTION_ROOT,
  latestActionSnapshot,
  loadActionFlags,
} from './action-flags.js'
import {
  COMMUNITY_ROOT,
  latestCommunitySnapshot,
  loadCommunityRows,
} from './community.js'
import {
  POSTSECONDARY_ROOT,
  latestPostsecondarySnapshot,
  loadPostsecondaryRows,
} from './postsecondary.js'
import {
  TRANSFER_ROOT,
  latestTransferSnapshot,
  loadTransferRows,
  summarizeDistrictTransfers,
} from './transfers.js'
import {
  EDUCATOR_ROOT,
  latestEducatorSnapshot,
  loadEducatorRows,
} from './educators.js'
import {
  DISCIPLINE_ROOT,
  latestDisciplineSnapshot,
  loadDisciplineRows,
} from './discipline.js'
import { BOUNDARY_FILE } from './boundaries.js'
import {
  ACCOUNTABILITY_LANDING_URL,
  ACCOUNTABILITY_MASKING_URL,
  latestAccountabilityArchive,
  loadAccountabilityContext,
} from './accountability.js'

/**
 * Picks the newest YYYY-MM directory name.
 *
 * `fetchAll` (src/fetch.js) writes each data file as it goes and writes
 * manifest.json LAST, so manifest.json's presence is the only reliable
 * signal that a snapshot finished — a directory can have the right file
 * names and still be a fetch that died partway through. Rather than have
 * this function stat the filesystem itself (which would make it impossible
 * to unit test without touching disk), it takes a `hasManifest` predicate:
 * build() supplies one backed by fs.existsSync, tests supply a fake. A
 * directory the predicate rejects is treated as if it doesn't exist, so a
 * newer-but-partial snapshot is passed over in favor of the newest complete
 * one — or, if none are complete, produces the same "no snapshot" error an
 * empty data/raw would.
 */
export function latestSnapshot(names, hasManifest = () => true) {
  const dirs = names.filter((n) => /^\d{4}-\d{2}$/.test(n) && hasManifest(n)).sort()
  if (dirs.length === 0) throw new Error('no snapshot found under data/raw — run `npm run fetch`')
  return dirs[dirs.length - 1]
}

export function assertIntegrity(entities, tables) {
  const known = new Set(entities.map((e) => e.id))
  for (const [table, rows] of Object.entries(tables)) {
    const orphans = rows.filter((r) => !known.has(r.id))
    if (orphans.length > 0) {
      const sample = [...new Set(orphans.map((o) => o.id))].slice(0, 3).join(', ')
      throw new Error(`${table}: ${orphans.length} orphan rows not in entities (e.g. ${sample})`)
    }
  }
}

export const toNdjson = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')

/**
 * Filters rows down to those whose id is in `knownIds`, reporting how many
 * were dropped and the distinct set of ids that were dropped. A pure,
 * reusable primitive so every child table can be checked against `entities`
 * the same way, and so "drop rather than crash" is unit-testable without
 * going through the full build().
 */
export function dropOrphans(rows, knownIds) {
  const kept = []
  const dropped = []
  for (const r of rows) (knownIds.has(r.id) ? kept : dropped).push(r)
  return { rows: kept, dropped: dropped.length, droppedIds: [...new Set(dropped.map((r) => r.id))] }
}

/**
 * Asserts the *set* of dropped orphan ids, not merely a count.
 *
 * `ratings` carries one row per entity-year (see toRatings/explode), so the
 * same handful of orphan ids produces a row count that scales with however
 * many year labels TEA happens to publish this year. A row-count guard tied
 * to today's label count (4 ids x 6 labels = 24) breaks the next time TEA
 * adds a label — not because the orphan ids changed, but because arithmetic
 * did. Asserting the id set instead is invariant to that: the same four ids
 * dropping 24 rows this year and 28 next year both pass, while a genuinely
 * new or missing orphan id — the thing actually worth investigating — still
 * throws, naming exactly which id was unexpected or which went missing.
 */
export function assertOrphanIdSet(table, actualIds, expectedIds) {
  const actual = new Set(actualIds)
  const expected = new Set(expectedIds)
  const unexpected = [...actual].filter((id) => !expected.has(id))
  const missing = [...expected].filter((id) => !actual.has(id))
  if (unexpected.length > 0 || missing.length > 0) {
    const parts = []
    if (unexpected.length > 0) parts.push(`unexpected orphan ids: ${unexpected.join(', ')}`)
    if (missing.length > 0) parts.push(`expected orphan ids no longer dropped: ${missing.join(', ')}`)
    throw new Error(`${table}: orphan id set changed — ${parts.join('; ')} — investigate before proceeding`)
  }
}

// TEA's change_over_time and profile_tab exports both carry rows for these
// four campus ids, absent from districts.json/schools.json — TEA publishes
// historical rating and profile data for these campuses but no current
// accountability/directory record for them. Observed 2026-08.
export const KNOWN_ORPHAN_IDS = ['221801026', '227901029', '227901054', '227901157']

/**
 * Section B's stable, non-additive headline rows. A student can appear in more
 * than one category and can receive more than one action, so neither the build
 * nor the UI may sum these headings. "ALL DISCIPLINE" is TEA's own distinct
 * total and is the only headline used for the five-year trend.
 */
export const DISCIPLINE_HEADLINES = Object.freeze([
  Object.freeze({ key: 'allDiscipline', heading: 'ALL DISCIPLINE', label: 'All discipline' }),
  Object.freeze({ key: 'inSchoolSuspensions', heading: 'IN SCHOOL SUSPENSIONS', label: 'In-school suspensions' }),
  Object.freeze({ key: 'outOfSchoolSuspensions', heading: 'OUT OF SCHOOL SUSPENSIONS', label: 'Out-of-school suspensions' }),
  Object.freeze({ key: 'daepPlacements', heading: 'DAEP PLACEMENTS', label: 'DAEP placements' }),
  Object.freeze({ key: 'mandatoryDaepPlacements', heading: 'MANDATORY DAEP PLACEMENTS', label: 'Mandatory DAEP placements' }),
  Object.freeze({ key: 'discretionaryDaepPlacements', heading: 'DISCRETIONARY DAEP PLACEMENTS', label: 'Discretionary DAEP placements' }),
  Object.freeze({ key: 'jjaepPlacements', heading: 'JJAEP PLACEMENTS', label: 'JJAEP placements' }),
  Object.freeze({ key: 'mandatoryJjaepPlacements', heading: 'MANDATORY JJAEP PLACEMENTS', label: 'Mandatory JJAEP placements' }),
  Object.freeze({ key: 'discretionaryJjaepPlacements', heading: 'DISCRETIONARY JJAEP PLACEMENTS', label: 'Discretionary JJAEP placements' }),
  Object.freeze({ key: 'expulsions', heading: 'EXPULSIONS', label: 'Expulsions' }),
  Object.freeze({ key: 'mandatoryExpulsions', heading: 'MANDATORY EXPULSIONS', label: 'Mandatory expulsions' }),
  Object.freeze({ key: 'discretionaryExpulsions', heading: 'DISCRETIONARY EXPULSIONS', label: 'Discretionary expulsions' }),
])

const DISCIPLINE_BY_HEADING = new Map(DISCIPLINE_HEADLINES.map((item) => [item.heading, item]))
const DISCIPLINE_ENROLLMENT_HEADING = 'CUMULATIVE YEAR END ENROLLMENT'
const DISCIPLINE_SECTION = 'B-DISCIPLINE DATA'

export const DISCIPLINE_OVERLAP_CAVEAT =
  'Categories overlap: a student may appear in more than one category and may receive more than one action. Do not add the categories together.'
export const DISCIPLINE_2020_21_CAVEAT =
  'School operations and in-person attendance were disrupted by COVID-19 in 2020–21, so differences involving that year may reflect changes in students’ time on campus as well as changes in discipline practices.'

/** Keep only the matching full-year denominator and the twelve Section B headlines. */
export const isDisciplineSummaryRow = (row) =>
  (row?.section === DISCIPLINE_SECTION &&
    DISCIPLINE_BY_HEADING.has(row?.heading) &&
    ['students', 'actions'].includes(row?.measure)) ||
  (String(row?.section ?? '').startsWith('A-') &&
    row?.heading === DISCIPLINE_ENROLLMENT_HEADING &&
    row?.measure === 'students')

const disciplineDatum = (row) => ({
  count: Number.isSafeInteger(row?.count) && row.count >= 0 ? row.count : null,
  status: ['reported', 'suppressed', 'not-reported'].includes(row?.status) ? row.status : 'not-reported',
  mask: typeof row?.mask === 'string' && row.mask ? row.mask : null,
})

const disciplineRate = (row, denominator, kind) => {
  const datum = disciplineDatum(row)
  const rate =
    datum.status === 'reported' &&
    denominator.status === 'reported' &&
    datum.count != null &&
    denominator.count > 0
      ? Math.round((datum.count / denominator.count) * 10_000) / 100
      : null
  return kind === 'students'
    ? { ...datum, ratePct: rate }
    : { ...datum, ratePer100: rate }
}

function sameDisciplineSourceRow(a, b) {
  return a.count === b.count && a.status === b.status && a.mask === b.mask
}

/**
 * Reduces Section A/B source rows to one compact object per entity.
 *
 * History contains TEA's explicit ALL DISCIPLINE student/action totals only.
 * The latest year additionally carries all twelve explicit headlines. Rates
 * are calculated only when that entity/year's Section A cumulative year-end
 * enrollment is itself reported. Student ratePct and action ratePer100 have
 * deliberately different names because an action is not a student.
 */
export function summarizeDisciplineRows(sourceRows) {
  const groups = new Map()
  const years = new Set()

  for (const row of sourceRows ?? []) {
    if (!isDisciplineSummaryRow(row)) continue
    if (!['district', 'campus'].includes(row.level)) {
      throw new Error(`discipline summary: invalid level ${JSON.stringify(row.level)} for ${row.id ?? 'unknown id'}`)
    }
    years.add(row.year)
    const groupKey = `${row.level}:${row.id}:${row.year}`
    const group = groups.get(groupKey) ?? {
      id: row.id,
      level: row.level,
      year: row.year,
      enrollment: null,
      categories: new Map(),
    }
    groups.set(groupKey, group)

    if (row.heading === DISCIPLINE_ENROLLMENT_HEADING && String(row.section).startsWith('A-')) {
      if (row.measure !== 'students') continue
      if (group.enrollment && !sameDisciplineSourceRow(group.enrollment, row)) {
        throw new Error(`discipline summary: conflicting cumulative enrollment for ${row.id} in ${row.year}`)
      }
      group.enrollment = row
      continue
    }

    const headline = DISCIPLINE_BY_HEADING.get(row.heading)
    if (!headline || !['students', 'actions'].includes(row.measure)) continue
    const category = group.categories.get(headline.key) ?? {}
    if (category[row.measure] && !sameDisciplineSourceRow(category[row.measure], row)) {
      throw new Error(
        `discipline summary: conflicting ${row.measure} count for ${row.id}, ${row.year}, ${row.heading}`
      )
    }
    category[row.measure] = row
    group.categories.set(headline.key, category)
  }

  const orderedYears = [...years].filter(Boolean).sort()
  const latestYear = orderedYears.at(-1) ?? null
  const byEntity = new Map()
  for (const group of groups.values()) {
    const key = `${group.level}:${group.id}`
    const entity = byEntity.get(key) ?? { id: group.id, level: group.level, groups: new Map() }
    entity.groups.set(group.year, group)
    byEntity.set(key, entity)
  }

  const rows = [...byEntity.values()].map((entity) => {
    const history = orderedYears.flatMap((year) => {
      const group = entity.groups.get(year)
      if (!group) return []
      const enrollment = disciplineDatum(group.enrollment)
      const all = group.categories.get('allDiscipline') ?? {}
      return [{
        year,
        cumulativeEnrollment: enrollment,
        students: disciplineRate(all.students, enrollment, 'students'),
        actions: disciplineRate(all.actions, enrollment, 'actions'),
      }]
    })

    const currentGroup = latestYear ? entity.groups.get(latestYear) : null
    let latest = null
    if (currentGroup) {
      const cumulativeEnrollment = disciplineDatum(currentGroup.enrollment)
      const categories = {}
      for (const headline of DISCIPLINE_HEADLINES) {
        const category = currentGroup.categories.get(headline.key) ?? {}
        categories[headline.key] = {
          students: disciplineRate(category.students, cumulativeEnrollment, 'students'),
          actions: disciplineRate(category.actions, cumulativeEnrollment, 'actions'),
        }
      }
      latest = { year: latestYear, cumulativeEnrollment, categories }
    }

    return { id: entity.id, level: entity.level, history, latest }
  })

  rows.sort((a, b) => a.level.localeCompare(b.level) || a.id.localeCompare(b.id))
  return { rows, years: orderedYears, latestYear }
}

/**
 * Reconciles the separate PEIMS enrollment archive with the current entity
 * universe. Historical reports legitimately contain schools that later closed,
 * changed ids, or are outside the current canonical directory snapshot, so
 * those rows are reported and dropped rather than forced through the four-id
 * orphan invariant used by txschools.gov's current exports.
 *
 * The latest PEIMS ALL ENROLLMENT count becomes the site's canonical current
 * count as well as the last point in the history. That avoids showing one
 * current number in the hero and another at the end of the chart merely because
 * two TEA products took their snapshots through different publication paths.
 */
export function mergeEnrollmentHistory({ entities, profile, enrollmentRows }) {
  const byId = new Map(entities.map((entity) => [entity.id, entity]))
  const years = [...new Set((enrollmentRows ?? []).map((row) => row.year).filter(Boolean))].sort()
  if (years.length === 0) throw new Error('enrollment: no school years were loaded')
  const latestYear = years.at(-1)

  const enrollment = []
  const droppedIds = new Set()
  const latest = new Map()
  const latestSeen = new Set()
  for (const row of enrollmentRows ?? []) {
    const entity = byId.get(row.id)
    if (!entity) {
      droppedIds.add(row.id)
      continue
    }
    if (row.level !== entity.level) {
      throw new Error(
        `enrollment: ${row.id} is ${entity.level} in entities but ${row.level} in the PEIMS report`
      )
    }
    enrollment.push(row)
    if (row.year === latestYear) {
      latestSeen.add(row.id)
      latest.set(row.id, row.enrollment)
    }
  }

  const missing = entities.filter((entity) => !latestSeen.has(entity.id))
  if (missing.length > 0) {
    throw new Error(
      `enrollment: ${missing.length} current entities are absent from the ${latestYear} PEIMS report ` +
        `(e.g. ${missing.slice(0, 3).map((entity) => entity.id).join(', ')})`
    )
  }

  let changed = 0
  const mergedEntities = entities.map((entity) => {
    const current = latest.get(entity.id)
    if (!Number.isSafeInteger(current) || current < 0) return entity
    if (entity.enrollment !== current) changed++
    return { ...entity, enrollment: current }
  })

  const profileIds = new Set(profile.map((row) => row.id))
  const missingProfile = entities.filter((entity) => !profileIds.has(entity.id))
  if (missingProfile.length > 0) {
    throw new Error(
      `enrollment: ${missingProfile.length} current entities have no profile row to receive the canonical count ` +
        `(e.g. ${missingProfile.slice(0, 3).map((entity) => entity.id).join(', ')})`
    )
  }
  const mergedProfile = profile.map((row) => ({
    ...row,
    total: Number.isSafeInteger(latest.get(row.id)) && latest.get(row.id) >= 0 ? latest.get(row.id) : row.total,
    schoolYear: latestYear,
  }))

  return {
    entities: mergedEntities,
    profile: mergedProfile,
    enrollment,
    latestYear,
    changed,
    maskedCurrent: entities.filter((entity) => latest.get(entity.id) == null).length,
    dropped: (enrollmentRows ?? []).length - enrollment.length,
    droppedIds: [...droppedIds],
  }
}

const readSource = async (dir, name) =>
  JSON.parse(gunzipSync(await readFile(`${dir}/${name}.json.gz`)).toString('utf8'))

async function latestArchive(root, latest) {
  const names = await readdir(root)
  const snapshot = latest(names, (name) => existsSync(`${root}/${name}/manifest.json`))
  const dir = `${root}/${snapshot}`
  const manifest = JSON.parse(await readFile(`${dir}/manifest.json`, 'utf8'))
  return { snapshot, dir, manifest }
}

/** Join Census/NCES GEOIDs back to the site's canonical six-digit TEA ids. */
export async function communityForEntities(rows, entities, file = BOUNDARY_FILE) {
  const topo = JSON.parse(gunzipSync(await readFile(file)).toString('utf8'))
  const teaToGeoid = new Map(Object.entries(topo.txschools?.teaToGeoid ?? {}))
  const byGeoid = new Map((rows ?? []).map((row) => [String(row.geoid), row]))
  const out = []
  for (const entity of entities ?? []) {
    if (entity.level !== 'district') continue
    const geoid = teaToGeoid.get(String(entity.id))
    const row = geoid ? byGeoid.get(String(geoid)) : null
    if (row) out.push({ id: entity.id, ...row })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

/** Exact id+level join: an id collision across levels is never accepted. */
export function accountabilityForEntities(rows, entities) {
  const entityKeys = new Set((entities ?? []).map((entity) => `${entity.level}:${entity.id}`))
  const seen = new Set()
  const out = []
  for (const row of rows ?? []) {
    const key = `${row.level}:${row.id}`
    if (seen.has(key)) throw new Error(`accountability: duplicate ${key}`)
    seen.add(key)
    if (entityKeys.has(key)) out.push(row)
  }
  const missing = [...entityKeys].filter((key) => !seen.has(key))
  if (missing.length) {
    throw new Error(`accountability: missing ${missing.length} canonical entities (first: ${missing.slice(0, 5).join(', ')})`)
  }
  return out.sort((a, b) => a.level.localeCompare(b.level) || a.id.localeCompare(b.id))
}

export async function build() {
  const names = await readdir('data/raw')
  const hasManifest = (name) => existsSync(`data/raw/${name}/manifest.json`)
  const snapshot = latestSnapshot(names, hasManifest)
  const dir = `data/raw/${snapshot}`
  console.log(`Building from ${dir}`)

  const enrollmentNames = await readdir(ENROLLMENT_ROOT)
  const hasEnrollmentManifest = (name) => existsSync(`${ENROLLMENT_ROOT}/${name}/manifest.json`)
  const enrollmentSnapshot = latestEnrollmentSnapshot(enrollmentNames, hasEnrollmentManifest)
  const enrollmentDir = `${ENROLLMENT_ROOT}/${enrollmentSnapshot}`
  const accountabilityArchive = await latestAccountabilityArchive()

  const [
    actionArchive,
    communityArchive,
    postsecondaryArchive,
    transferArchive,
    educatorArchive,
    disciplineArchive,
  ] = await Promise.all([
    latestArchive(ACTION_ROOT, latestActionSnapshot),
    latestArchive(COMMUNITY_ROOT, latestCommunitySnapshot),
    latestArchive(POSTSECONDARY_ROOT, latestPostsecondarySnapshot),
    latestArchive(TRANSFER_ROOT, latestTransferSnapshot),
    latestArchive(EDUCATOR_ROOT, latestEducatorSnapshot),
    latestArchive(DISCIPLINE_ROOT, latestDisciplineSnapshot),
  ])

  const [
    districts,
    schools,
    cot,
    profileRaw,
    enrollmentRaw,
    enrollmentManifest,
    actionRaw,
    communityRaw,
    postsecondaryRaw,
    transferRaw,
    educatorRaw,
    disciplineRaw,
    accountabilityRaw,
  ] = await Promise.all([
    readSource(dir, 'districts'),
    readSource(dir, 'schools'),
    readSource(dir, 'change_over_time'),
    readSource(dir, 'profile_tab'),
    loadEnrollmentRows(enrollmentDir),
    readFile(`${enrollmentDir}/manifest.json`, 'utf8').then(JSON.parse),
    loadActionFlags(actionArchive.dir),
    loadCommunityRows(communityArchive.dir),
    loadPostsecondaryRows(postsecondaryArchive.dir),
    loadTransferRows(transferArchive.dir),
    loadEducatorRows(educatorArchive.dir),
    loadDisciplineRows(disciplineArchive.dir, { filter: isDisciplineSummaryRow }),
    accountabilityArchive ? loadAccountabilityContext(accountabilityArchive.dir) : Promise.resolve([]),
  ])

  let entities = toEntities(districts, schools)
  const known = new Set(entities.map((e) => e.id))

  // The canonical entity set contains both traditional and open-enrollment
  // charter schools. Only the small, hand-verified set of current-export
  // anomalies may fall out of the child tables below; a charter id is a
  // first-class entity and must never be mistaken for an orphan.
  const ratingsDrop = dropOrphans(toRatings(cot), known)
  assertOrphanIdSet('ratings', ratingsDrop.droppedIds, KNOWN_ORPHAN_IDS)

  // profile_tab is one row per entity. Assert the ids here as well so four
  // different rows cannot silently replace the four known anomalies while
  // preserving the same count.
  const profileDrop = dropOrphans(toProfile(profileRaw), known)
  assertOrphanIdSet('profile', profileDrop.droppedIds, KNOWN_ORPHAN_IDS)

  const ratings = ratingsDrop.rows
  let profile = profileDrop.rows

  const enrollmentMerge = mergeEnrollmentHistory({ entities, profile, enrollmentRows: enrollmentRaw })
  entities = enrollmentMerge.entities
  profile = enrollmentMerge.profile
  const enrollment = enrollmentMerge.enrollment
  console.log(
    `  enrollment        ${enrollmentMerge.latestYear}; ${enrollmentMerge.changed.toLocaleString('en-US')} current counts reconciled, ` +
      `${enrollmentMerge.maskedCurrent.toLocaleString('en-US')} current counts suppressed, ` +
      `${enrollmentMerge.dropped.toLocaleString('en-US')} historical rows outside the published entity set dropped`
  )

  const publishedIds = new Set(entities.map((entity) => entity.id))
  const actionFlags = actionRaw.filter((row) => publishedIds.has(row.id))
  const postsecondary = postsecondaryRaw.filter((row) => publishedIds.has(row.id))
  const community = await communityForEntities(communityRaw, entities)
  const transfers = summarizeDistrictTransfers(transferRaw, entities)
  const publishedById = new Map(entities.map((entity) => [entity.id, entity]))
  const educators = educatorRaw.filter((row) => {
    const entity = publishedById.get(row.id)
    if (!entity) return false
    if (entity.level !== row.level) {
      throw new Error(`educators: ${row.id} is ${entity.level} in entities but ${row.level} in TAPR`)
    }
    return true
  })
  const disciplinePublished = disciplineRaw.filter((row) => {
    const entity = publishedById.get(row.id)
    if (!entity) return false
    if (entity.level !== row.level) {
      throw new Error(`discipline: ${row.id} is ${entity.level} in entities but ${row.level} in PEIMS`)
    }
    return true
  })
  const disciplineBuild = summarizeDisciplineRows(disciplinePublished)
  const discipline = disciplineBuild.rows
  const accountability = accountabilityForEntities(accountabilityRaw, entities)
  console.log(
    `  public context    ${actionFlags.length.toLocaleString('en-US')} campus notices; ` +
      `${community.length.toLocaleString('en-US')} district Census estimates; ` +
      `${postsecondary.length.toLocaleString('en-US')} postsecondary records; ` +
      `${transfers.length.toLocaleString('en-US')} district transfer summaries; ` +
      `${educators.length.toLocaleString('en-US')} educator records; ` +
      `${discipline.length.toLocaleString('en-US')} discipline summaries; ` +
      `${accountability.length.toLocaleString('en-US')} accountability context records`
  )

  assertIntegrity(entities, {
    ratings,
    profile,
    enrollment,
    actionFlags,
    community,
    postsecondary,
    transfers,
    educators,
    discipline,
    accountability,
  })

  await mkdir('build', { recursive: true })
  const tables = {
    entities,
    ratings,
    profile,
    enrollment,
    actionFlags,
    community,
    postsecondary,
    transfers,
    educators,
    discipline,
    accountability,
  }
  for (const [name, rows] of Object.entries(tables)) {
    await writeFile(`build/${name}.ndjson`, toNdjson(rows))
    console.log(`  ${name.padEnd(10)} ${String(rows.length).padStart(7)} rows`)
  }
  await writeFile('build/snapshot.txt', snapshot + '\n')
  await writeFile(
    'build/enrollment-meta.json',
    `${JSON.stringify({
      snapshot: enrollmentSnapshot,
      fetchedAt: enrollmentManifest.fetchedAt ?? null,
      source: enrollmentManifest.source ?? ENROLLMENT_LANDING_URL,
      definitions: enrollmentManifest.definitions ?? null,
      latestYear: enrollmentMerge.latestYear,
      reports: Object.keys(enrollmentManifest.files ?? {}).length,
      rows: enrollment.length,
      droppedRows: enrollmentMerge.dropped,
      droppedIds: enrollmentMerge.droppedIds.length,
      currentCountsReconciled: enrollmentMerge.changed,
      currentCountsSuppressed: enrollmentMerge.maskedCurrent,
    }, null, 2)}\n`
  )
  await writeFile(
    'build/accountability-meta.json',
    `${JSON.stringify(accountabilityArchive ? {
      snapshot: accountabilityArchive.snapshot,
      fetchedAt: accountabilityArchive.manifest.fetchedAt ?? null,
      year: 2026,
      schoolYear: '2025-26',
      rows: accountability.length,
      sourceRows: accountabilityRaw.length,
      rowsOutsideCanonicalEntitySet: accountabilityRaw.length - accountability.length,
      source: accountabilityArchive.manifest.source ?? ACCOUNTABILITY_LANDING_URL,
      masking: accountabilityArchive.manifest.masking ?? ACCOUNTABILITY_MASKING_URL,
      reports: Object.keys(accountabilityArchive.manifest.files ?? {}).length,
      fieldsAreContextOnly: true,
    } : {
      snapshot: null,
      fetchedAt: null,
      rows: 0,
      sourceRows: 0,
      rowsOutsideCanonicalEntitySet: 0,
      source: ACCOUNTABILITY_LANDING_URL,
      masking: ACCOUNTABILITY_MASKING_URL,
      reports: 0,
      fieldsAreContextOnly: true,
    }, null, 2)}\n`
  )
  await writeFile(
    'build/public-data-meta.json',
    `${JSON.stringify({
      actionFlags: {
        snapshot: actionArchive.snapshot,
        fetchedAt: actionArchive.manifest.fetchedAt ?? null,
        rows: actionFlags.length,
        sources: actionArchive.manifest.sources ?? null,
      },
      community: {
        snapshot: communityArchive.snapshot,
        fetchedAt: communityArchive.manifest.fetchedAt ?? null,
        estimateYear: communityArchive.manifest.estimateYear ?? null,
        rows: community.length,
        source: communityArchive.manifest.source ?? null,
        landing: communityArchive.manifest.landing ?? null,
      },
      postsecondary: {
        snapshot: postsecondaryArchive.snapshot,
        fetchedAt: postsecondaryArchive.manifest.fetchedAt ?? null,
        graduateYear: postsecondaryArchive.manifest.graduateYear ?? null,
        fallTerm: postsecondaryArchive.manifest.fallTerm ?? null,
        rows: postsecondary.length,
        sources: postsecondaryArchive.manifest.sources ?? null,
        landing: postsecondaryArchive.manifest.landing ?? null,
      },
      transfers: {
        snapshot: transferArchive.snapshot,
        fetchedAt: transferArchive.manifest.fetchedAt ?? null,
        years: [...new Set(transfers.flatMap((row) => row.history.map((point) => point.year)))].sort(),
        latestYear:
          [...new Set(transfers.flatMap((row) => row.history.map((point) => point.year)))].sort().at(-1) ??
          null,
        rows: transfers.length,
        source: transferArchive.manifest.source ?? null,
        definitions: transferArchive.manifest.definitions ?? null,
        caveats: transferArchive.manifest.caveats ?? null,
        reports: Object.keys(transferArchive.manifest.files ?? {}).length,
        scope: 'District only: campus reports have no official total rows, so no campus summary is published.',
      },
      educators: {
        snapshot: educatorArchive.snapshot,
        fetchedAt: educatorArchive.manifest.fetchedAt ?? null,
        years: [...new Set(educators.map((row) => row.year))].sort(),
        latestYear: educators.reduce((latest, row) => (row.year > latest ? row.year : latest), ''),
        rows: educators.length,
        source: educatorArchive.manifest.source ?? null,
        currentDownload: educatorArchive.manifest.currentDownload ?? null,
        glossary: educatorArchive.manifest.glossary ?? null,
        scope: educatorArchive.manifest.scope ?? null,
      },
      discipline: {
        snapshot: disciplineArchive.snapshot,
        fetchedAt: disciplineArchive.manifest.fetchedAt ?? null,
        years: disciplineBuild.years,
        latestYear: disciplineBuild.latestYear,
        rows: discipline.length,
        source: disciplineArchive.manifest.source ?? null,
        download: disciplineArchive.manifest.download ?? null,
        definitions: disciplineArchive.manifest.definitions ?? null,
        sourceCaveat: disciplineArchive.manifest.caveat ?? null,
        overlapCaveat: DISCIPLINE_OVERLAP_CAVEAT,
        pandemicCaveat: DISCIPLINE_2020_21_CAVEAT,
        headlineCategories: DISCIPLINE_HEADLINES,
      },
      accountability: accountabilityArchive ? {
        snapshot: accountabilityArchive.snapshot,
        fetchedAt: accountabilityArchive.manifest.fetchedAt ?? null,
        year: 2026,
        schoolYear: '2025-26',
        rows: accountability.length,
        sourceRows: accountabilityRaw.length,
        rowsOutsideCanonicalEntitySet: accountabilityRaw.length - accountability.length,
        source: accountabilityArchive.manifest.source ?? ACCOUNTABILITY_LANDING_URL,
        masking: accountabilityArchive.manifest.masking ?? ACCOUNTABILITY_MASKING_URL,
        fieldsAreContextOnly: true,
      } : null,
    }, null, 2)}\n`
  )
  return tables
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await build()
}
