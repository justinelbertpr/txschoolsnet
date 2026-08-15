import { explode } from '../explode.js'
import { num, str } from './entities.js'

const WHAT_IF = ' What If'
const REFRESH_YEAR = '2022-23' // first year published under the refreshed methodology

/**
 * TEA labels the back-published re-scoring of 2021-22 as "2021-22 What If".
 * It is the same year under the post-2023 rules, not a separate year.
 */
export function parseYear(label) {
  if (label.endsWith(WHAT_IF)) {
    return { year: label.slice(0, -WHAT_IF.length), method: 'what_if' }
  }
  return { year: label, method: label < REFRESH_YEAR ? 'original' : 'current' }
}

export function toRatings(records) {
  return records.flatMap((rec) =>
    explode(rec, { academic_year: 'label', overall_rating: 'rating', score: 'score' }).map(
      ({ id, label, rating, score }) => ({
        id,
        ...parseYear(label),
        rating: str(rating),
        score: num(score),
      })
    )
  )
}

/**
 * Precedence for picking ONE rating per entity-year for a trend line.
 *
 * `what_if` wins over `original` because it re-scores 2021-22 under the
 * post-2023 rules, making it comparable with every later year. Taking
 * `original` instead reintroduces the methodology break and produces a
 * phantom collapse between 2021-22 and 2022-23 that no school caused.
 */
export const METHOD_PRECEDENCE = ['current', 'what_if', 'original']

// A method absent from METHOD_PRECEDENCE ranks after all known methods
// (rather than indexOf's -1, which would rank it before all of them). That
// keeps a recognized method always in charge; an unrecognized one is only
// kept when it's the sole row for that entity-year, instead of silently
// outranking real data.
const rank = (method) => {
  const i = METHOD_PRECEDENCE.indexOf(method)
  return i === -1 ? METHOD_PRECEDENCE.length : i
}

/** Reduce a rating set to one row per entity-year, using METHOD_PRECEDENCE. */
export function preferredRatings(rows) {
  const best = new Map()
  for (const row of rows) {
    const key = `${row.id}|${row.year}`
    const held = best.get(key)
    if (!held || rank(row.method) < rank(held.method)) {
      best.set(key, row)
    }
  }
  return [...best.values()]
}
