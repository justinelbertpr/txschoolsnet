import { cohortMetrics, metricSpecs } from './render/metrics.js'

/**
 * The pinner searches statewide, but a campus's current measures are too large
 * to duplicate in the statewide search payload. Group them by the six-digit
 * district id instead: one small lazy asset per district, not one asset per
 * campus. A selected campus therefore costs one request, and a second campus in
 * the same district reuses the browser/client cache.
 *
 * District records ride in the same asset. That gives the client one lookup
 * rule for both entity levels and keeps the stable `/data/pins/<district>.json`
 * contract independent of the larger reporter-facing entity JSON format.
 */
export function pinMetricPayloads({ entities = [], bundles = new Map(), subjects = [] } = {}) {
  const districts = entities.filter((entity) => entity.level === 'district')
  const payloads = new Map(
    districts.map((district) => [
      district.id,
      { version: 1, districtId: district.id, entities: {} },
    ])
  )
  const specs = {
    standard: metricSpecs({ subjects, isAlt: false }),
    alternative: metricSpecs({ subjects, isAlt: true }),
  }

  for (const entity of entities) {
    const districtId = entity.level === 'district' ? entity.id : entity.districtId
    const payload = payloads.get(districtId)
    if (!payload) {
      throw new Error(`cannot publish pin metrics for ${entity.id}: district ${districtId ?? 'missing'} is not published`)
    }
    payload.entities[entity.id] = cohortMetrics(
      entity.isAlt ? specs.alternative : specs.standard,
      bundles,
      [entity.id]
    )
  }

  return payloads
}
