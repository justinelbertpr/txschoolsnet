/** '' -> null, otherwise the trimmed string. */
export const str = (v) => {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v)
  return s === '' ? null : s
}

/** Non-numeric -> null. Never returns NaN. */
export const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * TEA percentage fields use negative numbers as missing-value sentinels. Parse
 * those fields separately from ordinary numbers so a sentinel can never become
 * a real rate, while measurements where a negative is meaningful keep using
 * `num` unchanged.
 */
export const percentage = (v) => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  if (!s) return null
  const raw = s.endsWith('%') ? s.slice(0, -1).trim() : s
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null
}

export function toEntity(rec, level) {
  return {
    id: rec.id,
    level,
    districtId: str(rec.district_id),
    districtName: str(rec.district_name),
    name: str(rec.name),
    regionId: str(rec.region_id),
    countyId: str(rec.county_id),
    county: str(rec.county),
    entityType: str(rec.entity_type),
    isCharter: str(rec.entity_type) === 'Charter',
    isAlt: str(rec.alt_standards) === 'Yes',
    campusType: str(rec.campus_type),
    enrollment: num(rec.enrollment),
    website: str(rec.website),
    rating: str(rec.rating),
    score: num(rec.score),
    lat: num(rec.latitude),
    lon: num(rec.longitude),
    multYear: num(rec.mult_year) ?? 0,
    pairedId: str(rec.paired_id),
  }
}

export const toEntities = (districts, schools) => [
  ...districts.map((r) => toEntity(r, 'district')),
  ...schools.map((r) => toEntity(r, 'campus')),
]
