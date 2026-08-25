// Public-data comparison metrics.
//
// The accountability comparison engine in metrics.js covers the current TEA
// rating/profile bundle. The supplemental public datasets are deliberately
// normalized elsewhere and carry different years, units and suppression rules.
// This module gives those facts the SAME cohort membership without pretending
// they came from txschools.gov or forcing unlike source tables into one schema.
//
// Every finite value becomes a stable metric key. buildViewModel merges these
// keys into data-own/data-cohorts, so the browser only ever switches among
// averages the build already published. Missing/suppressed values remain absent;
// they never become zero and each metric keeps its own reporting n.

const finite = (value) => typeof value === 'number' && Number.isFinite(value)

const put = (bundles, id, key, value) => {
  if (!finite(value)) return
  const bundle = bundles.get(String(id))
  if (!bundle) return
  bundle[key] = value
}

const pctOf = (part, whole) =>
  finite(part) && finite(whole) && whole > 0 ? (part / whole) * 100 : null

export const publicMetric = Object.freeze({
  spending: (year) => `public:spending:${year}`,
  enrollment: (year) => `public:enrollment:${year}`,
  transfersIn: (year) => `public:transfers:in:${year}`,
  transfersOut: (year) => `public:transfers:out:${year}`,
  transferBalance: (year) => `public:transfers:balance:${year}`,
  turnover: (year) => `public:educators:turnover:${year}`,
  classSize: (year, category) => `public:educators:class-size:${year}:${category}`,
  disciplineStudents: (year) => `public:discipline:students-rate:${year}`,
  disciplineActions: (year) => `public:discipline:actions-rate:${year}`,
  disciplineCategoryStudents: (year, category) =>
    `public:discipline:category:${year}:${category}:students-rate`,
  disciplineCategoryActions: (year, category) =>
    `public:discipline:category:${year}:${category}:actions-rate`,
  communityPopulation: 'public:community:population',
  communitySchoolAge: 'public:community:school-age',
  communitySchoolAgePoverty: 'public:community:school-age-poverty',
  communitySchoolAgePovertyRate: 'public:community:school-age-poverty-rate',
  postsecondaryGraduates: 'public:postsecondary:graduates',
  postsecondaryEnrolled: 'public:postsecondary:enrolled',
  postsecondaryRate: 'public:postsecondary:rate',
  postsecondaryNotFoundRate: 'public:postsecondary:not-found-rate',
  postsecondaryNotTrackableRate: 'public:postsecondary:not-trackable-rate',
  campusImprovement: 'public:notices:improvement',
  campusPeg: 'public:notices:peg',
  districtCampusCount: 'public:campuses:count',
  districtImprovementCount: 'public:notices:improvement-count',
  districtPegCount: 'public:notices:peg-count',
  districtImprovementShare: 'public:notices:improvement-share',
  districtPegShare: 'public:notices:peg-share',
})

/**
 * Build one small numeric bundle per published entity, once per render worker.
 * The return value is safe to reuse for every page in that worker.
 */
export function buildPublicComparisonBundles({
  entities = [],
  finance = [],
  enrollment = [],
  transfers = [],
  educators = [],
  discipline = [],
  community = [],
  postsecondary = [],
  actionFlags = [],
} = {}) {
  const bundles = new Map(
    entities.map((entity) => [String(entity.id), Object.create(null)])
  )

  for (const row of finance) {
    put(bundles, row.id, publicMetric.spending(row.year), row.spendEntity)
  }
  for (const row of enrollment) {
    put(bundles, row.id, publicMetric.enrollment(row.year), row.enrollment)
  }
  for (const summary of transfers) {
    for (const point of summary?.history ?? []) {
      put(bundles, summary.id, publicMetric.transfersIn(point.year), point.transfersIn)
      put(bundles, summary.id, publicMetric.transfersOut(point.year), point.transfersOut)
      put(bundles, summary.id, publicMetric.transferBalance(point.year), point.net)
    }
  }
  for (const row of educators) {
    if (row.level === 'district') {
      put(bundles, row.id, publicMetric.turnover(row.year), row.teacherTurnoverRate)
    } else if (row.level === 'campus') {
      for (const [category, value] of Object.entries(row.classSize ?? {})) {
        put(bundles, row.id, publicMetric.classSize(row.year, category), value)
      }
    }
  }
  for (const summary of discipline) {
    for (const point of summary?.history ?? []) {
      put(bundles, summary.id, publicMetric.disciplineStudents(point.year), point.students?.ratePct)
      put(bundles, summary.id, publicMetric.disciplineActions(point.year), point.actions?.ratePer100)
    }
    const latest = summary?.latest
    if (!latest?.year) continue
    for (const [category, datum] of Object.entries(latest.categories ?? {})) {
      put(
        bundles,
        summary.id,
        publicMetric.disciplineCategoryStudents(latest.year, category),
        datum?.students?.ratePct
      )
      put(
        bundles,
        summary.id,
        publicMetric.disciplineCategoryActions(latest.year, category),
        datum?.actions?.ratePer100
      )
    }
  }
  for (const row of community) {
    put(bundles, row.id, publicMetric.communityPopulation, row.totalPopulation)
    put(bundles, row.id, publicMetric.communitySchoolAge, row.schoolAgePopulation)
    put(bundles, row.id, publicMetric.communitySchoolAgePoverty, row.schoolAgePoverty)
    put(bundles, row.id, publicMetric.communitySchoolAgePovertyRate, row.schoolAgePovertyRate)
  }
  for (const row of postsecondary) {
    put(bundles, row.id, publicMetric.postsecondaryGraduates, row.graduates)
    put(bundles, row.id, publicMetric.postsecondaryEnrolled, row.enrolledPublic)
    put(bundles, row.id, publicMetric.postsecondaryRate, row.rate)
    put(bundles, row.id, publicMetric.postsecondaryNotFoundRate, pctOf(row.notFound, row.graduates))
    put(
      bundles,
      row.id,
      publicMetric.postsecondaryNotTrackableRate,
      pctOf(row.notTrackable, row.graduates)
    )
  }

  // Every campus gets an explicit 0/100 percentage flag. Without the zero rows, a cohort average
  // would be "among flagged campuses" and always equal 100%, which is the exact
  // opposite of the prevalence context the page needs. Percentage points also
  // keep the resulting mean in the same 0–100 unit the page's pct formatter uses.
  const flags = new Map(actionFlags.map((row) => [String(row.id), row]))
  const campusesByDistrict = new Map()
  for (const entity of entities) {
    if (entity.level !== 'campus') continue
    const flag = flags.get(String(entity.id))
    put(bundles, entity.id, publicMetric.campusImprovement, flag?.improvement ? 100 : 0)
    put(bundles, entity.id, publicMetric.campusPeg, flag?.peg ? 100 : 0)
    const districtId = String(entity.districtId ?? entity.id.slice(0, 6))
    const list = campusesByDistrict.get(districtId) ?? []
    list.push(entity)
    campusesByDistrict.set(districtId, list)
  }
  for (const entity of entities) {
    if (entity.level !== 'district') continue
    const campuses = campusesByDistrict.get(String(entity.id)) ?? []
    const improvement = campuses.filter((campus) => flags.get(String(campus.id))?.improvement).length
    const peg = campuses.filter((campus) => flags.get(String(campus.id))?.peg).length
    put(bundles, entity.id, publicMetric.districtCampusCount, campuses.length)
    put(bundles, entity.id, publicMetric.districtImprovementCount, improvement)
    put(bundles, entity.id, publicMetric.districtPegCount, peg)
    put(bundles, entity.id, publicMetric.districtImprovementShare, pctOf(improvement, campuses.length))
    put(bundles, entity.id, publicMetric.districtPegShare, pctOf(peg, campuses.length))
  }

  return bundles
}

const roundedMean = (values) => {
  const finiteValues = values.filter(finite)
  if (!finiteValues.length) return null
  const mean = finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length
  return Math.round(mean * 10) / 10
}

/**
 * Merge supplemental values into the existing page-wide cohort payload.
 * Only keys the entity itself reports are included, which keeps a campus page
 * from paying for district-only transfer/community metrics and prevents a
 * benchmark from appearing beside a missing own value.
 */
export function mergePublicComparisons({ entityId, own = {}, cohorts = [], cohortIds = {}, bundles = null }) {
  const mine = bundles?.get(String(entityId)) ?? null
  if (!mine) return { own, cohorts }
  const keys = Object.keys(mine).filter((key) => finite(mine[key]))
  if (!keys.length) return { own, cohorts }

  const mergedOwn = { ...own }
  for (const key of keys) mergedOwn[key] = mine[key]

  const mergedCohorts = cohorts.map((cohort) => {
    const metrics = { ...(cohort.metrics ?? {}) }
    const metricN = { ...(cohort.metricN ?? {}) }
    const ids = cohortIds[cohort.key] ?? []
    for (const key of keys) {
      const values = ids.map((id) => bundles.get(String(id))?.[key]).filter(finite)
      const mean = roundedMean(values)
      if (mean == null) continue
      metrics[key] = mean
      metricN[key] = values.length
    }
    return { ...cohort, metrics, metricN }
  })

  return { own: mergedOwn, cohorts: mergedCohorts }
}
