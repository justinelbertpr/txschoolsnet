// src/lookups.js
import { str } from './normalize/entities.js'

const collect = (rows, idKey, nameKey) => {
  const map = {}
  for (const r of rows) {
    const id = str(r[idKey])
    const name = str(r[nameKey])
    if (id && name) map[id] = name
  }
  // Sorted so a rebuild from identical input produces an identical payload hash.
  return Object.fromEntries(Object.keys(map).sort().map((k) => [k, map[k]]))
}

/** Region and county names, derived from the district file rather than hardcoded. */
export const buildLookups = (districts) => ({
  regions: collect(districts, 'region_id', 'region'),
  counties: collect(districts, 'county_id', 'county'),
})
