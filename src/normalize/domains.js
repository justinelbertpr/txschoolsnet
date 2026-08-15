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
  { domain: 'achievement', score: 'ach_score', min: 'ach_min' },
  { domain: 'progress', score: 'prog_score', min: 'prog_min' },
  { domain: 'gaps', score: 'ctg_score', min: 'ctg_min' },
  { domain: 'progress_growth', score: 'proga_score', min: 'proga_min' },
  { domain: 'progress_relative', score: 'progb_score', min: 'progb_min' },
]

export function toDomains(records) {
  return records.flatMap((rec) =>
    SOURCES.filter((s) => Array.isArray(rec[s.score])).flatMap((s) => {
      const cutScore = num(rec[s.min])
      return explode(rec, { school_year: 'year', [s.score]: 'score' }, { domain: s.domain }).map(
        ({ id, year, score, domain }) => {
          const value = num(score)
          return {
            id,
            year,
            domain,
            score: value,
            cutScore,
            margin: value === null || cutScore === null ? null : value - cutScore,
          }
        }
      )
    })
  )
}
