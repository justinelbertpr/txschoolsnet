// src/normalize/finance.js
import { num, str } from './entities.js'

// source array key -> output column name
const SERIES = [
  ['expenditure_district', 'spendEntity'],
  ['expenditure_peer', 'spendPeer'],
  ['expenditure_state', 'spendState'],
  ['revenue_district', 'revenueEntity'],
  ['revenue_peer', 'revenuePeer'],
  ['revenue_state', 'revenueState'],
]

/**
 * Per-pupil finance rows, one per entity-year. Each money series is checked
 * against `year`'s length on its own — unlike `explode`, a mismatch in one
 * series nulls only that series rather than the whole entity. There is no
 * signal for which year a short series is missing, so zipping it by index
 * would silently shift real figures into the wrong year; nulling it is the
 * only honest option. See `financeAlignment` for what got dropped.
 */
export function toFinance(records) {
  const rows = []
  for (const rec of records) {
    if (!Array.isArray(rec.year)) continue
    const yearLen = rec.year.length
    for (let i = 0; i < yearLen; i++) {
      const row = { id: rec.id, year: str(rec.year[i]) }
      for (const [srcKey, outKey] of SERIES) {
        const arr = rec[srcKey]
        row[outKey] = Array.isArray(arr) && arr.length === yearLen ? num(arr[i]) : null
      }
      rows.push(row)
    }
  }
  return rows
}

/**
 * Every series dropped for misalignment: present as an array, but a
 * different length than `year`. One entry per entity-series, keyed by the
 * raw TEA field name so a report is traceable back to the source feed.
 */
export function financeAlignment(records) {
  const dropped = []
  for (const rec of records) {
    if (!Array.isArray(rec.year)) continue
    const yearLen = rec.year.length
    for (const [srcKey] of SERIES) {
      const arr = rec[srcKey]
      if (Array.isArray(arr) && arr.length !== yearLen) {
        dropped.push({ entityId: rec.id, series: srcKey })
      }
    }
  }
  return dropped
}
