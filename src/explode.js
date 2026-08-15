/**
 * One parallel-array record -> many tidy rows.
 * @param rec    source record, must carry a string `id`
 * @param mapping source array key -> output column name
 * @param extra  scalar columns copied onto every row
 */
export function explode(rec, mapping, extra = {}) {
  const keys = Object.keys(mapping).filter((k) => Array.isArray(rec[k]))
  if (keys.length === 0) return []

  const len = rec[keys[0]].length
  for (const k of keys) {
    if (rec[k].length !== len) {
      throw new Error(
        `${rec.id}: length mismatch — ${keys[0]} has ${len}, ${k} has ${rec[k].length}`
      )
    }
  }

  return Array.from({ length: len }, (_, i) => {
    const row = { id: rec.id, ...extra }
    for (const k of keys) row[mapping[k]] = rec[k][i]
    return row
  })
}
