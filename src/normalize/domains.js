// src/normalize/domains.js
import { explode } from '../explode.js'
import { num } from './entities.js'

/**
 * TEA's five reported domains. D2 carries two sub-domains — growth and
 * relative performance — and a school takes the better of the two.
 */
export const DOMAIN_LABELS = {
  achievement: 'Student Achievement',
  progress: 'School Progress',
  gaps: 'Closing the Gaps',
  progress_growth: 'Academic Growth',
  progress_relative: 'Relative Performance',
}

const SOURCES = [
  { domain: 'achievement', score: 'ach_score' },
  { domain: 'progress', score: 'prog_score' },
  { domain: 'gaps', score: 'ctg_score' },
  { domain: 'progress_growth', score: 'proga_score' },
  { domain: 'progress_relative', score: 'progb_score' },
]

/**
 * TEA's scaled scores follow these bands exactly: verified against 46,048
 * published domain grades, 45,978 matching (99.85%).
 *
 * All 70 exceptions are entities TEA labels "Not Rated" — the score always
 * agrees, only the letter is withheld, and 27 of the 29 affected entities are
 * alternative-education campuses. That is an administrative status this module
 * cannot see. Consumers that DO have entity metadata must suppress the derived
 * grade for a Not Rated entity rather than publishing a letter the state did
 * not issue.
 */
const BANDS = [
  ['A', 90],
  ['B', 80],
  ['C', 70],
  ['D', 60],
  ['F', 0],
]

const gradeFor = (score) => BANDS.find(([, lo]) => score >= lo)?.[0] ?? null

/** Points needed to reach the next letter grade, or null at A. */
const toNextGrade = (score) => {
  if (score === null) return null
  const i = BANDS.findIndex(([, lo]) => score >= lo)
  return i <= 0 ? null : BANDS[i - 1][1] - score
}

export function toDomains(records) {
  return records.flatMap((rec) =>
    SOURCES.filter((s) => Array.isArray(rec[s.score])).flatMap((s) =>
      explode(rec, { school_year: 'year', [s.score]: 'score' }, { domain: s.domain }).map(
        ({ id, year, score, domain }) => {
          const value = num(score)
          return {
            id,
            year,
            domain,
            score: value,
            grade: value === null ? null : gradeFor(value),
            toNextGrade: toNextGrade(value),
          }
        }
      )
    )
  )
}
