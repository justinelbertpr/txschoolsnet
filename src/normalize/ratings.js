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
