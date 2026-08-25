// Official student transfer flows from TEA's PEIMS Transfer Reports.
//
// District history comes from the 20 regional district reports because TEA
// does not publish one statewide district CSV. Campus history comes from the
// statewide campus CSV that TEA has published since 2020-21. Responses are
// archived byte-for-byte inside gzip; manifest hashes always describe the
// uncompressed bytes returned by TEA.

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { gzipSync, gunzipSync } from 'node:zlib'
import { parseCsv } from './enrollment.js'

export const TRANSFER_ROOT = 'data/transfers'
export const TRANSFER_LANDING_URL =
  'https://rptsvr1.tea.texas.gov/adhocrpt/Standard_Reports/Transfer_Reports/transfer_reports.html'
export const TRANSFER_DEFINITIONS_URL =
  'https://rptsvr1.tea.texas.gov/adhocrpt/Standard_Reports/About/about_transfer_reports.html'
export const TRANSFER_BROKER_URL = 'https://rptsvr1.tea.texas.gov/cgi/sas/broker'

export const TRANSFER_YEARS = Object.freeze([
  Object.freeze({ year: '2021-22', schoolYear: '2022' }),
  Object.freeze({ year: '2022-23', schoolYear: '2023' }),
  Object.freeze({ year: '2023-24', schoolYear: '2024' }),
  Object.freeze({ year: '2024-25', schoolYear: '2025' }),
  Object.freeze({ year: '2025-26', schoolYear: '2026' }),
])

export const TRANSFER_REGIONS = Object.freeze(
  Array.from({ length: 20 }, (_, index) => String(index + 1).padStart(2, '0'))
)

// A complete TEA response ends with three known footer notes. These floors
// are therefore a second guardrail, primarily catching a valid-looking error
// or unexpectedly narrowed report rather than ordinary transport truncation.
export const TRANSFER_MIN_ROWS = Object.freeze({ district: 20, campus: 10_000 })
export const TRANSFER_MIN_ENTITIES = Object.freeze({ district: 2, campus: 1_000 })

export const TRANSFER_SOURCES = Object.freeze(
  TRANSFER_YEARS.flatMap(({ year, schoolYear }) => [
    // Campus comes first intentionally. Some older regional files truncate an
    // identifier after a long district name; the same year's statewide campus
    // file supplies the exact name-to-ID crosswalk used to repair only those
    // source defects without guessing.
    Object.freeze({
      key: `${year}-campus`,
      file: `${year}-campus.csv.gz`,
      year,
      schoolYear,
      level: 'campus',
      region: null,
      minRows: TRANSFER_MIN_ROWS.campus,
      minEntities: TRANSFER_MIN_ENTITIES.campus,
    }),
    ...TRANSFER_REGIONS.map((region) =>
      Object.freeze({
        key: `${year}-district-region-${region}`,
        file: `${year}-district-region-${region}.csv.gz`,
        year,
        schoolYear,
        level: 'district',
        region,
        minRows: TRANSFER_MIN_ROWS.district,
        minEntities: TRANSFER_MIN_ENTITIES.district,
      })
    ),
  ])
)

const SOURCE_BY_KEY = new Map(TRANSFER_SOURCES.map((source) => [source.key, source]))
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const cleanHeader = (value) => String(value).trim().replace(/\s+/g, ' ').toUpperCase()

const DISTRICT_HEADER = Object.freeze([
  'YEAR',
  'REPORT_REGION',
  'REPORT_REGION_NAME',
  'REPORT_DISTNAME_NUMBER',
  'REPORT_CHARTER_STATUS',
  'REPORT_NUMBER',
  'REPORT_TYPE',
  'LINE_GROUP_NUMBER',
  'DISTNAME_NUMBER_RES_ATTEND',
  'TRANSFERS_IN_OUT',
])

const CAMPUS_HEADER = Object.freeze([
  'YEAR',
  'REPORT_REGION',
  'REPORT_DISTRICT',
  'REPORT_DISTRICT_NAME',
  'REPORT_CAMPUS',
  'REPORT_CAMPUS_NAME',
  'REPORT_NUMBER',
  'REPORT_TYPE',
  'LINE_GROUP_NUMBER',
  'DISTRICT_RES_OR_ATTEND',
  'DISTNAME_RES_OR_ATTEND',
  'CAMPUS_RES_OR_ATTEND',
  'CAMPNAME_RES_OR_ATTEND',
  'TRANSFERS_IN_OUT',
])

// TEA renamed this one column for 2025-26. Both spellings are official and
// their otherwise identical schemas remain validated in exact order.
const CAMPUS_HEADER_LEGACY = Object.freeze([
  ...CAMPUS_HEADER.slice(0, -1),
  'TRANSFERS_IN_OR_OUT',
])

const FOOTER_PREFIXES = Object.freeze([
  '-999 indicates counts or percentages are not available',
  'Masked numbers are typically small although larger numbers may be masked',
  'The REPORT_NUMBER column and the LINE_GROUP_NUMBER column are added',
])

function expectedLongYear(year) {
  const match = /^(\d{4})-(\d{2})$/.exec(year)
  if (!match) throw new Error(`invalid academic year ${JSON.stringify(year)}; expected YYYY-YY`)
  const start = Number(match[1])
  const end = Number(match[2])
  if ((start + 1) % 100 !== end) {
    throw new Error(`invalid academic year ${JSON.stringify(year)}; years must be consecutive`)
  }
  return `${start}-${start + 1}`
}

function validateSource({ year, level, region }) {
  expectedLongYear(year)
  if (level !== 'district' && level !== 'campus') {
    throw new Error(`invalid transfer level ${JSON.stringify(level)}; expected district or campus`)
  }
  if (level === 'district' && !/^\d{2}$/.test(String(region))) {
    throw new Error(`invalid district transfer region ${JSON.stringify(region)}; expected two digits`)
  }
  if (level === 'district' && !TRANSFER_REGIONS.includes(String(region))) {
    throw new Error(`invalid district transfer region ${JSON.stringify(region)}; expected 01 through 20`)
  }
}

function normalizeNumericId(raw, width, label, rowNumber) {
  const value = String(raw).trim()
  // Older campus CSVs emitted identifier columns as unquoted numbers, which
  // removed one or more leading zeroes. Padding is required to restore the
  // official six- and nine-digit TEA identifiers.
  const minimum = width === 6 ? 4 : 7
  if (!new RegExp(`^\\d{${minimum},${width}}$`).test(value)) {
    throw new Error(
      `CSV row ${rowNumber}: invalid ${label} ${JSON.stringify(value)}; expected at most ${width} digits`
    )
  }
  return value.padStart(width, '0')
}

function normalizedName(raw) {
  return cleanHeader(raw)
}

function addDirectoryEntry(directory, nameRaw, id) {
  if (!(directory instanceof Map)) return
  const name = normalizedName(nameRaw)
  if (!name) return
  if (!directory.has(name)) directory.set(name, new Set())
  directory.get(name).add(id)
}

function namedDistrict(raw, label, rowNumber, directory) {
  const value = String(raw).trim()
  const match = /^(.*?)\s+-\s*(\d{0,6})$/.exec(value)
  if (match && !match[1].trim()) {
    throw new Error(`CSV row ${rowNumber}: invalid ${label} ${JSON.stringify(value)}; expected NAME - 000000`)
  }
  // A few especially long 2021-22 values are truncated before even the
  // separator. In that case the entire field is the name and the exact ID can
  // still be recovered from the campus report's unambiguous name crosswalk.
  const name = (match?.[1] ?? value).trim()
  const rawId = match?.[2] ?? ''
  if (!name) {
    throw new Error(`CSV row ${rowNumber}: invalid ${label} ${JSON.stringify(value)}; expected a district name`)
  }
  if (rawId.length === 6) return { name, id: rawId }

  // Unlike numeric campus-report columns, embedded IDs are strings and do
  // not lose leading zeroes. A short embedded ID is truncated on the right by
  // TEA's older report formatter. Resolve it only when the official statewide
  // campus report for the same year has exactly one matching name and ID
  // prefix; otherwise stop instead of manufacturing an identifier.
  const key = normalizedName(name)
  let nameMatches = directory?.has(key) ? [directory.get(key)] : []
  if (nameMatches.length === 0 && key.length >= 20 && directory instanceof Map) {
    // The same fixed-width defect can cut off the end of an unusually long
    // name as well as its ID. A prefix is accepted only when it resolves to
    // one official ID in the same-year campus directory.
    nameMatches = [...directory.entries()]
      .filter(([candidateName]) => candidateName.startsWith(key))
      .map(([, ids]) => ids)
  }
  const candidates = [...new Set(nameMatches.flatMap((ids) => [...ids]))]
    .filter((candidate) => candidate.startsWith(rawId))
  if (candidates.length !== 1) {
    throw new Error(
      `CSV row ${rowNumber}: truncated ${label} ID ${JSON.stringify(rawId)} for ${JSON.stringify(name)} ` +
      `cannot be resolved uniquely from the same-year campus report`
    )
  }
  return { name, id: candidates[0] }
}

function transferValue(raw, rowNumber) {
  const value = String(raw).trim()
  if (
    value === '' ||
    value === '-999' ||
    value === '-9999999' ||
    /^(?:N\/?A|NOT AVAILABLE|-|\*)$/i.test(value) ||
    /^<\s*\d+$/.test(value)
  ) return null
  if (/^-\d+$/.test(value)) {
    throw new Error(`CSV row ${rowNumber}: unexpected negative transfer count ${JSON.stringify(value)}`)
  }
  const normalized = /^\d{1,3}(?:,\d{3})+$/.test(value) ? value.replaceAll(',', '') : value
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`CSV row ${rowNumber}: invalid transfer count ${JSON.stringify(value)}`)
  }
  const count = Number(normalized)
  if (!Number.isSafeInteger(count)) {
    throw new Error(`CSV row ${rowNumber}: transfer count is outside the safe integer range`)
  }
  return count
}

function directionValue(raw, rowNumber, { allowBlank = false } = {}) {
  const value = cleanHeader(raw)
  if (allowBlank && value === '') return null
  if (value === 'TRANSFERS IN FROM') return 'in'
  if (value === 'TRANSFERS OUT TO') return 'out'
  throw new Error(`CSV row ${rowNumber}: invalid REPORT_TYPE ${JSON.stringify(String(raw).trim())}`)
}

function integerCell(raw, label, rowNumber) {
  const value = String(raw).trim()
  if (!/^\d+$/.test(value)) {
    throw new Error(`CSV row ${rowNumber}: invalid ${label} ${JSON.stringify(value)}`)
  }
  return Number(value)
}

function normalizedRegion(raw, rowNumber) {
  const value = String(raw).trim()
  if (!/^\d{1,2}$/.test(value)) {
    throw new Error(`CSV row ${rowNumber}: invalid REPORT_REGION ${JSON.stringify(value)}`)
  }
  const region = value.padStart(2, '0')
  if (!TRANSFER_REGIONS.includes(region)) {
    throw new Error(`CSV row ${rowNumber}: REPORT_REGION ${JSON.stringify(value)} is outside 01 through 20`)
  }
  return region
}

function isFooter(record) {
  const first = String(record[0] ?? '').trim()
  return FOOTER_PREFIXES.some((prefix) => first.startsWith(prefix)) &&
    record.slice(1).every((cell) => String(cell).trim() === '')
}

function requireOfficialFooters(text, context) {
  for (const prefix of FOOTER_PREFIXES) {
    if (!text.includes(prefix)) throw new Error(`${context}: response is missing official footer ${JSON.stringify(prefix)}`)
  }
}

function rowKey(row) {
  return [
    row.level,
    row.id,
    row.year,
    row.direction,
    row.total ? 'total' : row.counterpartId,
  ].join(':')
}

function addUnique(rows, seen, row, context) {
  const key = rowKey(row)
  if (seen.has(key)) {
    const previous = seen.get(key)
    if (previous !== row.transfers) {
      throw new Error(
        `${context}: conflicting duplicate ${key} has ${previous ?? 'missing'} and ${row.transfers ?? 'missing'} transfers`
      )
    }
    return
  }
  seen.set(key, row.transfers)
  rows.push(row)
}

function parserColumns(records, allowed, context) {
  const variants = Array.isArray(allowed[0]) ? allowed : [allowed]
  const candidates = records
    .map((record, index) => ({ index, header: record.map(cleanHeader) }))
    .filter(({ header }) => variants.some((variant) =>
      header.length === variant.length && header.every((name, column) => name === variant[column])
    ))
  if (candidates.length === 0) {
    throw new Error(`${context}: CSV header is missing or unsupported; expected ${variants[0].join(', ')}`)
  }
  if (candidates.length > 1) throw new Error(`${context}: CSV contains more than one matching header row`)
  const { index, header } = candidates[0]
  return { headerIndex: index, header, at: Object.fromEntries(header.map((name, column) => [name, column])) }
}

function parseDistrictRow(record, at, source, rowNumber, districtDirectory) {
  const direction = directionValue(record[at.REPORT_TYPE], rowNumber)
  const reportNumber = integerCell(record[at.REPORT_NUMBER], 'REPORT_NUMBER', rowNumber)
  const expectedNumber = direction === 'in' ? 100 : 200
  if (reportNumber !== expectedNumber) {
    throw new Error(`CSV row ${rowNumber}: REPORT_NUMBER ${reportNumber} conflicts with ${direction} direction`)
  }

  const lineGroup = integerCell(record[at.LINE_GROUP_NUMBER], 'LINE_GROUP_NUMBER', rowNumber)
  const report = namedDistrict(
    record[at.REPORT_DISTNAME_NUMBER],
    'REPORT_DISTNAME_NUMBER',
    rowNumber,
    districtDirectory
  )
  const counterpartRaw = String(record[at.DISTNAME_NUMBER_RES_ATTEND]).trim()
  const transfersRaw = String(record[at.TRANSFERS_IN_OUT]).trim()

  if (lineGroup === 100) {
    const counterpart = namedDistrict(
      counterpartRaw,
      'DISTNAME_NUMBER_RES_ATTEND',
      rowNumber,
      districtDirectory
    )
    return {
      id: report.id,
      name: report.name,
      level: 'district',
      year: source.year,
      direction,
      counterpartId: counterpart.id,
      counterpartName: counterpart.name,
      transfers: transferValue(transfersRaw, rowNumber),
      total: false,
    }
  }

  if (lineGroup === 200 && counterpartRaw === `Total Transfers ${direction === 'in' ? 'In' : 'Out'}`) {
    return {
      id: report.id,
      name: report.name,
      level: 'district',
      year: source.year,
      direction,
      counterpartId: null,
      counterpartName: null,
      transfers: transferValue(transfersRaw, rowNumber),
      total: true,
    }
  }

  if (
    (lineGroup === 200 || lineGroup === 300) &&
    counterpartRaw === '' &&
    (transfersRaw === '.' || transfersRaw === '')
  ) return null

  throw new Error(
    `CSV row ${rowNumber}: unexpected district line group ${lineGroup} with counterpart ${JSON.stringify(counterpartRaw)}`
  )
}

function parseCampusRow(record, at, source, rowNumber, districtDirectory) {
  const reportDistrictId = normalizeNumericId(record[at.REPORT_DISTRICT], 6, 'REPORT_DISTRICT', rowNumber)
  const reportCampusId = normalizeNumericId(record[at.REPORT_CAMPUS], 9, 'REPORT_CAMPUS', rowNumber)
  if (!reportCampusId.startsWith(reportDistrictId)) {
    throw new Error(`CSV row ${rowNumber}: REPORT_CAMPUS ${reportCampusId} is not in REPORT_DISTRICT ${reportDistrictId}`)
  }
  addDirectoryEntry(districtDirectory, record[at.REPORT_DISTRICT_NAME], reportDistrictId)

  const lineGroup = integerCell(record[at.LINE_GROUP_NUMBER], 'LINE_GROUP_NUMBER', rowNumber)
  const direction = directionValue(record[at.REPORT_TYPE], rowNumber, { allowBlank: lineGroup !== 100 })
  const reportNumber = integerCell(record[at.REPORT_NUMBER], 'REPORT_NUMBER', rowNumber)
  const counterpartFields = [
    record[at.DISTRICT_RES_OR_ATTEND],
    record[at.DISTNAME_RES_OR_ATTEND],
    record[at.CAMPUS_RES_OR_ATTEND],
    record[at.CAMPNAME_RES_OR_ATTEND],
  ]
  const transferColumn = at.TRANSFERS_IN_OUT ?? at.TRANSFERS_IN_OR_OUT
  const transfersRaw = String(record[transferColumn]).trim()

  if (lineGroup === 200 && direction === null) {
    if (
      (reportNumber === 100 || reportNumber === 200) &&
      counterpartFields.every((cell) => String(cell).trim() === '') &&
      (transfersRaw === '.' || transfersRaw === '')
    ) return null
    throw new Error(`CSV row ${rowNumber}: malformed campus spacer row`)
  }
  if (lineGroup !== 100 || direction === null) {
    throw new Error(`CSV row ${rowNumber}: unexpected campus LINE_GROUP_NUMBER ${lineGroup}`)
  }

  const expectedNumber = direction === 'in' ? 100 : 200
  if (reportNumber !== expectedNumber) {
    throw new Error(`CSV row ${rowNumber}: REPORT_NUMBER ${reportNumber} conflicts with ${direction} direction`)
  }
  const counterpartDistrictId = normalizeNumericId(
    counterpartFields[0],
    6,
    'DISTRICT_RES_OR_ATTEND',
    rowNumber
  )
  const counterpartId = normalizeNumericId(counterpartFields[2], 9, 'CAMPUS_RES_OR_ATTEND', rowNumber)
  if (!counterpartId.startsWith(counterpartDistrictId)) {
    throw new Error(
      `CSV row ${rowNumber}: CAMPUS_RES_OR_ATTEND ${counterpartId} is not in district ${counterpartDistrictId}`
    )
  }
  addDirectoryEntry(districtDirectory, counterpartFields[1], counterpartDistrictId)
  return {
    id: reportCampusId,
    level: 'campus',
    year: source.year,
    direction,
    counterpartId,
    transfers: transferValue(transfersRaw, rowNumber),
    total: false,
  }
}

/**
 * Normalize one official TEA transfer report.
 *
 * District reports include exact official total rows in addition to each
 * district-to-district flow. Campus reports include detail flows only; their
 * totals cannot be reconstructed exactly because masked cells are unknown.
 */
export function parseTransferReport(text, source, { districtDirectory } = {}) {
  if (typeof text !== 'string') throw new TypeError('transfer CSV input must be a string')
  validateSource(source)
  const context = `${source.year} ${source.level}${source.region ? ` region ${source.region}` : ''}`
  requireOfficialFooters(text, context)
  const expectedYear = expectedLongYear(source.year)
  const required = source.level === 'district' ? DISTRICT_HEADER : [CAMPUS_HEADER_LEGACY, CAMPUS_HEADER]
  const records = parseCsv(text)
  const { headerIndex, header, at } = parserColumns(records, required, context)
  const rows = []
  const seen = new Map()

  for (let index = headerIndex + 1; index < records.length; index++) {
    const record = records[index]
    if (record.every((cell) => String(cell).trim() === '') || isFooter(record)) continue
    const rowNumber = index + 1
    if (record.length !== header.length) {
      throw new Error(`${context}: CSV row ${rowNumber} has ${record.length} columns; header has ${header.length}`)
    }
    const reportedYear = String(record[at.YEAR]).trim()
    if (reportedYear !== expectedYear) {
      throw new Error(
        `${context}: CSV row ${rowNumber} reports year ${JSON.stringify(reportedYear)}, expected ${expectedYear}`
      )
    }
    const region = normalizedRegion(record[at.REPORT_REGION], rowNumber)
    if (source.level === 'district' && region !== source.region) {
      throw new Error(`${context}: CSV row ${rowNumber} reports region ${region}, expected ${source.region}`)
    }

    const row = source.level === 'district'
      ? parseDistrictRow(record, at, source, rowNumber, districtDirectory)
      : parseCampusRow(record, at, source, rowNumber, districtDirectory)
    if (row) addUnique(rows, seen, row, context)
  }

  if (rows.length === 0) throw new Error(`${context}: report contains no transfer rows`)
  return rows
}

const TRANSFER_NET_LABEL =
  'Transfers in minus transfers out (arithmetic context only; not a quality measure)'

/**
 * Statewide map copy is deliberately descriptive rather than evaluative.
 *
 * A positive balance can reflect capacity, program offerings, geography,
 * district size, family moves, or many other circumstances the transfer
 * report does not explain. Calling positive green/good or negative red/bad
 * would turn an arithmetic difference into a quality claim the source cannot
 * support.
 */
export const TRANSFER_MAP_KEY = 'transfer-balance'
export const TRANSFER_MAP_LABEL = 'Student transfer balance'
export const TRANSFER_MAP_NOTE =
  'Positive values mean more students transferred in than out; negative values mean more transferred out than in. ' +
  'The balance is arithmetic context only, not a rating or measure of district quality.'

function transferStatus(row) {
  if (!row) return 'not_reported'
  return row.transfers === null ? 'masked' : 'reported'
}

function detailCoverage(rows) {
  const reported = rows.filter((row) => row.transfers !== null).length
  return { published: rows.length, reported, masked: rows.length - reported }
}

function difference(current, first) {
  return Number.isSafeInteger(current) && Number.isSafeInteger(first) ? current - first : null
}

function topReportedFlows(rows, limit, nameById) {
  return rows
    .filter((row) => Number.isSafeInteger(row.transfers))
    .map((row) => ({
      id: row.counterpartId,
      name: nameById.get(row.counterpartId) ?? row.counterpartName ?? null,
      transfers: row.transfers,
    }))
    .sort((a, b) =>
      b.transfers - a.transfers ||
      String(a.name ?? '').localeCompare(String(b.name ?? '')) ||
      a.id.localeCompare(b.id)
    )
    .slice(0, limit)
}

/**
 * Builds UI-ready five-year summaries for the site's published districts.
 *
 * Totals come exclusively from rows TEA labels "Total Transfers In" and
 * "Total Transfers Out" (`total: true`). Detail rows are never summed into a
 * total because FERPA-masked cells make that arithmetic unknowable. A missing
 * or masked total therefore remains null, with its status exposed separately.
 * Campus rows are deliberately ignored: TEA's statewide campus files contain
 * detail flows but no official total rows, so this function returns no campus
 * summary rather than imply an exact total.
 *
 * `publishedEntities` supplies the districts the site actually publishes and
 * preferred display names. A counterpart outside that set (commonly a charter)
 * keeps the official name parsed from the district transfer report when one is
 * available; otherwise its exact TEA ID remains available with `name: null`.
 */
export function summarizeDistrictTransfers(rows, publishedEntities, { topLimit = 5 } = {}) {
  if (!Array.isArray(rows)) throw new TypeError('transfer rows must be an array')
  if (!Array.isArray(publishedEntities)) throw new TypeError('published entities must be an array')
  if (!Number.isInteger(topLimit) || topLimit < 1) {
    throw new TypeError('topLimit must be a positive integer')
  }

  const entityById = new Map()
  for (const entity of publishedEntities) {
    if (entity?.level !== 'district') continue
    if (!/^\d{6}$/.test(String(entity.id))) {
      throw new Error(`published district has invalid TEA ID ${JSON.stringify(entity?.id)}`)
    }
    if (entityById.has(entity.id)) throw new Error(`published district ${entity.id} appears more than once`)
    entityById.set(entity.id, entity)
  }
  const nameById = new Map(
    publishedEntities
      .filter((entity) => /^\d{6}$/.test(String(entity?.id)) && entity?.name)
      .map((entity) => [entity.id, entity.name])
  )

  const districtRows = rows.filter((row) =>
    row?.level === 'district' && entityById.has(row.id) && typeof row.year === 'string'
  )
  const years = [...new Set(districtRows.map((row) => row.year))].sort().slice(-5)
  const yearSet = new Set(years)
  const grouped = new Map()

  for (const row of districtRows) {
    if (!yearSet.has(row.year)) continue
    if (row.direction !== 'in' && row.direction !== 'out') {
      throw new Error(`transfer summary: ${row.id} ${row.year} has invalid direction ${JSON.stringify(row.direction)}`)
    }
    if (row.transfers !== null && (!Number.isSafeInteger(row.transfers) || row.transfers < 0)) {
      throw new Error(`transfer summary: ${row.id} ${row.year} has invalid transfer count ${row.transfers}`)
    }
    const groupKey = `${row.id}:${row.year}`
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, { totals: { in: null, out: null }, details: { in: new Map(), out: new Map() } })
    }
    const group = grouped.get(groupKey)
    if (row.total === true) {
      if (row.counterpartId !== null) {
        throw new Error(`transfer summary: ${row.id} ${row.year} total row has a counterpart ID`)
      }
      const previous = group.totals[row.direction]
      if (previous && previous.transfers !== row.transfers) {
        throw new Error(`transfer summary: conflicting ${row.direction} total for ${row.id} ${row.year}`)
      }
      group.totals[row.direction] = row
      continue
    }

    if (!/^\d{6}$/.test(String(row.counterpartId))) {
      throw new Error(
        `transfer summary: ${row.id} ${row.year} detail row has invalid counterpart ${JSON.stringify(row.counterpartId)}`
      )
    }
    const previous = group.details[row.direction].get(row.counterpartId)
    if (previous && previous.transfers !== row.transfers) {
      throw new Error(
        `transfer summary: conflicting ${row.direction} flow for ${row.id} ${row.year} and ${row.counterpartId}`
      )
    }
    if (!previous) group.details[row.direction].set(row.counterpartId, row)
  }

  return [...entityById.values()]
    .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')) || a.id.localeCompare(b.id))
    .map((entity) => {
      const history = years.map((year) => {
        const group = grouped.get(`${entity.id}:${year}`) ?? {
          totals: { in: null, out: null },
          details: { in: new Map(), out: new Map() },
        }
        const inTotal = group.totals.in?.transfers ?? null
        const outTotal = group.totals.out?.transfers ?? null
        const origins = [...group.details.in.values()]
        const destinations = [...group.details.out.values()]
        return {
          year,
          transfersIn: inTotal,
          transfersOut: outTotal,
          net: Number.isSafeInteger(inTotal) && Number.isSafeInteger(outTotal) ? inTotal - outTotal : null,
          coverage: {
            officialTotals: {
              in: transferStatus(group.totals.in),
              out: transferStatus(group.totals.out),
            },
            origins: detailCoverage(origins),
            destinations: detailCoverage(destinations),
          },
        }
      })

      let current = null
      if (history.length > 0) {
        const base = history.at(-1)
        const group = grouped.get(`${entity.id}:${base.year}`) ?? {
          details: { in: new Map(), out: new Map() },
        }
        current = {
          ...base,
          topOrigins: topReportedFlows([...group.details.in.values()], topLimit, nameById),
          topDestinations: topReportedFlows([...group.details.out.values()], topLimit, nameById),
        }
      }

      const first = history[0] ?? null
      const changeSinceFirst = first && current
        ? {
            fromYear: first.year,
            toYear: current.year,
            transfersInChange: difference(current.transfersIn, first.transfersIn),
            transfersOutChange: difference(current.transfersOut, first.transfersOut),
            netChange: difference(current.net, first.net),
          }
        : null

      return {
        id: entity.id,
        name: entity.name ?? null,
        level: 'district',
        netLabel: TRANSFER_NET_LABEL,
        history,
        current,
        changeSinceFirst,
      }
    })
}

const TRANSFER_TOTAL_STATUSES = new Set(['reported', 'masked', 'not_reported'])

/**
 * Builds the compact, source-faithful input for a statewide transfer layer.
 *
 * All districts are compared in one statewide academic year: the latest year
 * present anywhere in the supplied summaries. A district with no row in that
 * year is retained with `null`, rather than quietly falling back to an older
 * year and mixing vintages on the same map.
 *
 * `values` and `details` are keyed by the published six-digit TEA district ID.
 * A net value exists only when TEA reports BOTH official totals. Detail rows
 * are never summed, and a masked total remains null. The per-direction status
 * is copied into `details` so the renderer can distinguish FERPA masking from
 * an absent report without trying to infer either from the number.
 */
export function transferMapData(summaries) {
  if (!Array.isArray(summaries)) throw new TypeError('transfer summaries must be an array')

  const byId = new Map()
  const years = new Set()
  for (const summary of summaries) {
    if (summary?.level !== 'district') {
      throw new Error(`transfer map: expected a district summary, got ${JSON.stringify(summary?.level)}`)
    }
    const id = String(summary.id ?? '')
    if (!/^\d{6}$/.test(id)) {
      throw new Error(`transfer map: invalid TEA district ID ${JSON.stringify(summary?.id)}`)
    }
    if (byId.has(id)) throw new Error(`transfer map: district ${id} appears more than once`)
    byId.set(id, summary)

    for (const row of summary.history ?? []) {
      if (typeof row?.year !== 'string') continue
      expectedLongYear(row.year)
      years.add(row.year)
    }
    if (typeof summary.current?.year === 'string') {
      expectedLongYear(summary.current.year)
      years.add(summary.current.year)
    }
  }

  const year = [...years].sort().at(-1) ?? null
  const values = new Map()
  const details = new Map()
  let counted = 0
  let masked = 0

  for (const [id, summary] of byId) {
    const history = Array.isArray(summary.history) ? summary.history : []
    const matching = history.filter((row) => row?.year === year)
    if (matching.length > 1) {
      throw new Error(`transfer map: district ${id} has more than one ${year} summary row`)
    }
    const row = matching[0] ?? (summary.current?.year === year ? summary.current : null)
    const officialTotals = {
      in: row?.coverage?.officialTotals?.in ?? 'not_reported',
      out: row?.coverage?.officialTotals?.out ?? 'not_reported',
    }
    for (const [direction, status] of Object.entries(officialTotals)) {
      if (!TRANSFER_TOTAL_STATUSES.has(status)) {
        throw new Error(
          `transfer map: district ${id} has invalid ${direction} total status ${JSON.stringify(status)}`
        )
      }
    }

    const transfersIn = Number.isSafeInteger(row?.transfersIn) && row.transfersIn >= 0
      ? row.transfersIn
      : null
    const transfersOut = Number.isSafeInteger(row?.transfersOut) && row.transfersOut >= 0
      ? row.transfersOut
      : null
    if (officialTotals.in === 'reported' && transfersIn === null) {
      throw new Error(`transfer map: district ${id} marks its ${year} transfers-in total reported without a count`)
    }
    if (officialTotals.out === 'reported' && transfersOut === null) {
      throw new Error(`transfer map: district ${id} marks its ${year} transfers-out total reported without a count`)
    }
    if (officialTotals.in !== 'reported' && transfersIn !== null) {
      throw new Error(`transfer map: district ${id} has a ${year} transfers-in count with status ${officialTotals.in}`)
    }
    if (officialTotals.out !== 'reported' && transfersOut !== null) {
      throw new Error(`transfer map: district ${id} has a ${year} transfers-out count with status ${officialTotals.out}`)
    }

    const bothReported = officialTotals.in === 'reported' && officialTotals.out === 'reported'
    const net = bothReported ? transfersIn - transfersOut : null
    if (row?.net != null && row.net !== net) {
      throw new Error(
        `transfer map: district ${id} has ${year} net ${row.net}, expected ${net} from its official totals`
      )
    }
    const status = bothReported
      ? 'reported'
      : officialTotals.in === 'masked' || officialTotals.out === 'masked'
        ? 'masked'
        : 'not_reported'

    if (status === 'reported') counted += 1
    if (status === 'masked') masked += 1
    values.set(id, net)
    details.set(id, {
      id,
      name: summary.name ?? null,
      year,
      transfersIn,
      transfersOut,
      net,
      status,
      officialTotals,
    })
  }

  return {
    key: TRANSFER_MAP_KEY,
    label: TRANSFER_MAP_LABEL,
    year,
    unit: 'students',
    center: 0,
    calculation: 'transfers in minus transfers out',
    direction: TRANSFER_MAP_NOTE,
    values,
    details,
    coverage: {
      districts: values.size,
      reported: counted,
      masked,
      notReported: values.size - counted - masked,
    },
  }
}

export function transferRequest(source) {
  const canonical = SOURCE_BY_KEY.get(source?.key)
  if (!canonical) throw new Error(`unknown transfer source ${source?.key ?? '—'}`)
  const common = {
    _service: 'marykay',
    _program: 'adhoc.download_transfer_report.sas',
    scope: canonical.level === 'campus' ? 'Campus' : 'Region',
    agg_level: canonical.level === 'campus' ? 'campus' : 'region',
    _debug: '0',
    school_year: canonical.schoolYear,
    report_format: 'csv',
  }
  const query = canonical.level === 'campus'
    ? {
        ...common,
        RptClass: 'transfer',
        Campus_Transfer_Report: 'Get a Campus Transfer Report',
      }
    : {
        ...common,
        selected_id: canonical.region,
        Region_District_Xfr_Report: 'Get a Region District Transfer Report',
      }
  return { method: 'GET', url: TRANSFER_BROKER_URL, query }
}

export function transferSnapshotDir(date, root = TRANSFER_ROOT) {
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) throw new TypeError('snapshot date must be a valid Date')
  return `${root}/${date.toISOString().slice(0, 10)}`
}

function isSnapshotName(name) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(name)
  if (!match) return false
  const date = new Date(`${name}T00:00:00.000Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === name
}

/** Picks the newest complete YYYY-MM-DD directory, skipping partial fetches. */
export function latestTransferSnapshot(names, hasManifest = () => true) {
  const dirs = names.filter((name) => isSnapshotName(name) && hasManifest(name)).sort()
  if (dirs.length === 0) {
    throw new Error('no complete transfer snapshot found under data/transfers — run `node src/transfers.js`')
  }
  return dirs[dirs.length - 1]
}

function coverage(rows, source) {
  const entities = new Set(rows.map((row) => row.id)).size
  const totals = rows.filter((row) => row.total).length
  const masked = rows.filter((row) => row.transfers === null).length
  if (rows.length < source.minRows) {
    throw new Error(`${source.key}: got ${rows.length} rows, below completeness floor ${source.minRows}`)
  }
  if (entities < source.minEntities) {
    throw new Error(`${source.key}: got ${entities} reporting entities, below completeness floor ${source.minEntities}`)
  }
  if (source.level === 'district' && totals < entities) {
    throw new Error(`${source.key}: got ${totals} official total rows for ${entities} reporting districts`)
  }
  if (source.level === 'campus' && totals !== 0) {
    throw new Error(`${source.key}: campus report unexpectedly contains total rows`)
  }
  return { rows: rows.length, entities, detailRows: rows.length - totals, totalRows: totals, maskedRows: masked }
}

export function buildTransferManifest(entries, fetchedAt) {
  const files = {}
  for (const entry of entries) {
    const body = Buffer.isBuffer(entry.body) ? entry.body : Buffer.from(entry.body)
    files[entry.source.key] = {
      file: entry.source.file,
      sha256: sha256(body),
      bytes: body.length,
      rows: entry.rows,
      entities: entry.entities,
      detailRows: entry.detailRows,
      totalRows: entry.totalRows,
      maskedRows: entry.maskedRows,
      year: entry.source.year,
      level: entry.source.level,
      region: entry.source.region,
      request: transferRequest(entry.source),
      etag: entry.etag ?? null,
      lastModified: entry.lastModified ?? null,
    }
  }
  return {
    schemaVersion: 1,
    fetchedAt,
    source: TRANSFER_LANDING_URL,
    definitions: TRANSFER_DEFINITIONS_URL,
    caveats: {
      meaning: 'A transfer is a mismatch between the public district or campus of residence and attendance; it does not identify why the student attends elsewhere.',
      masks: 'TEA values suppressed under FERPA are null; they are never converted to zero or estimated.',
      district: 'District reports include TEA-published total rows and pair-level flows.',
      campus: 'Campus reports contain pair-level flows but no totals; exact totals cannot be derived when detail cells are masked.',
      charters: 'A charter cannot be a district or campus of residence, so TEA does not publish Transfers Out To listings for charters.',
      coverage: 'Public districts and charter schools are included; private schools are not included.',
    },
    files,
  }
}

async function fetchTransferSource(source, fetchImpl, districtDirectory) {
  const request = transferRequest(source)
  const url = `${request.url}?${new URLSearchParams(request.query)}`
  const response = await fetchImpl(url, {
    method: request.method,
    headers: {
      Accept: 'text/csv,*/*;q=0.8',
      'User-Agent': 'txschools.net transfer fetch (+https://txschools.net/about)',
    },
  })
  if (!response.ok) throw new Error(`${source.key}: HTTP ${response.status} from ${request.url}`)
  const body = Buffer.from(await response.arrayBuffer())
  let stats
  try {
    stats = coverage(parseTransferReport(body.toString('utf8'), source, { districtDirectory }), source)
  } catch (err) {
    throw new Error(`${source.key}: ${err.message}`)
  }
  return {
    source,
    body,
    ...stats,
    etag: response.headers?.get?.('etag') ?? null,
    lastModified: response.headers?.get?.('last-modified') ?? null,
  }
}

/**
 * Fetch all 105 official reports and write manifest.json only after every
 * report has parsed and passed its coverage checks. A failed run remains an
 * incomplete snapshot because its old manifest is removed before requests.
 */
export async function fetchTransfers({
  date = new Date(),
  root = TRANSFER_ROOT,
  fetchImpl = fetch,
  log = console.log,
} = {}) {
  const dir = transferSnapshotDir(date, root)
  await mkdir(dir, { recursive: true })
  await rm(`${dir}/manifest.json`, { force: true })
  const entries = []
  const districtDirectories = new Map()
  for (const source of TRANSFER_SOURCES) {
    if (source.level === 'campus') districtDirectories.set(source.year, new Map())
    const districtDirectory = districtDirectories.get(source.year)
    const entry = await fetchTransferSource(source, fetchImpl, districtDirectory)
    await writeFile(`${dir}/${source.file}`, gzipSync(entry.body, { level: 9 }))
    entries.push(entry)
    log(
      `  ${source.key.padEnd(34)} ${String(entry.rows).padStart(7)} rows  ` +
      `${String(entry.entities).padStart(5)} entities`
    )
  }
  const manifest = buildTransferManifest(entries, date.toISOString())
  await writeFile(`${dir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`)
  log(`\nWrote ${entries.length} transfer reports to ${dir}`)
  return { dir, manifest }
}

/** Read and normalize every report in one complete transfer snapshot. */
export async function loadTransferRows(dir) {
  const rows = []
  const seen = new Map()
  const districtDirectories = new Map()
  for (const source of TRANSFER_SOURCES) {
    let text
    try {
      text = gunzipSync(await readFile(`${dir}/${source.file}`)).toString('utf8')
    } catch (err) {
      throw new Error(`${dir}/${source.file}: ${err.message}`)
    }
    if (source.level === 'campus') districtDirectories.set(source.year, new Map())
    const parsed = parseTransferReport(text, source, {
      districtDirectory: districtDirectories.get(source.year),
    })
    coverage(parsed, source)
    for (const row of parsed) addUnique(rows, seen, row, dir)
  }
  return rows.sort(
    (a, b) => a.year.localeCompare(b.year) ||
      a.level.localeCompare(b.level) ||
      a.id.localeCompare(b.id) ||
      a.direction.localeCompare(b.direction) ||
      Number(a.total) - Number(b.total) ||
      String(a.counterpartId).localeCompare(String(b.counterpartId))
  )
}

function sameRequest(actual, expected) {
  if (actual?.method !== expected.method || actual?.url !== expected.url) return false
  const a = actual?.query ?? {}
  const e = expected.query
  const aKeys = Object.keys(a).sort()
  const eKeys = Object.keys(e).sort()
  return aKeys.length === eKeys.length && eKeys.every((key, index) => aKeys[index] === key && a[key] === e[key])
}

/** Verify hashes, exact requests, source semantics, coverage, and file set. */
export async function verifyTransferSnapshot(dir) {
  const manifestPath = `${dir}/manifest.json`
  if (!existsSync(manifestPath)) {
    return { dir, checked: 0, problems: [`${dir}: no manifest.json — snapshot is incomplete`] }
  }
  let manifest
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch (err) {
    return { dir, checked: 0, problems: [`${manifestPath}: ${err.message}`] }
  }

  const problems = []
  if (manifest.schemaVersion !== 1) problems.push(`${manifestPath}: schemaVersion is not 1`)
  if (typeof manifest.fetchedAt !== 'string' || Number.isNaN(Date.parse(manifest.fetchedAt))) {
    problems.push(`${manifestPath}: fetchedAt is not a valid timestamp`)
  }
  if (manifest.source !== TRANSFER_LANDING_URL) problems.push(`${manifestPath}: unexpected source URL`)
  if (manifest.definitions !== TRANSFER_DEFINITIONS_URL) problems.push(`${manifestPath}: unexpected definitions URL`)
  const described = Object.keys(manifest.files ?? {})
  if (described.length === 0) {
    return { dir, checked: 0, problems: [`${manifestPath}: no files described`], fetchedAt: manifest.fetchedAt ?? null }
  }
  for (const source of TRANSFER_SOURCES) {
    if (!described.includes(source.key)) problems.push(`${dir}: manifest does not describe ${source.key}`)
  }
  for (const key of described) {
    if (!SOURCE_BY_KEY.has(key)) problems.push(`${dir}: manifest describes unexpected source ${key}`)
  }

  let onDisk = []
  try {
    onDisk = (await readdir(dir)).filter((name) => name.endsWith('.csv.gz'))
  } catch (err) {
    return { dir, checked: 0, problems: [`${dir}: ${err.message}`], fetchedAt: manifest.fetchedAt ?? null }
  }
  const expectedFiles = new Set(TRANSFER_SOURCES.map((source) => source.file))
  for (const file of onDisk) {
    if (!expectedFiles.has(file)) problems.push(`${dir}: ${file} is on disk but is not an expected transfer report`)
  }

  let checked = 0
  const districtDirectories = new Map()
  for (const source of TRANSFER_SOURCES) {
    const expected = manifest.files?.[source.key]
    if (!expected) continue
    const path = `${dir}/${source.file}`
    if (expected.file !== source.file) problems.push(`${source.key}: manifest file is ${expected.file}, expected ${source.file}`)
    if (expected.year !== source.year) problems.push(`${source.key}: manifest year is ${expected.year}, expected ${source.year}`)
    if (expected.level !== source.level) problems.push(`${source.key}: manifest level is ${expected.level}, expected ${source.level}`)
    if (expected.region !== source.region) problems.push(`${source.key}: manifest region is ${expected.region}, expected ${source.region}`)
    for (const field of ['rows', 'entities', 'detailRows', 'totalRows', 'maskedRows', 'bytes']) {
      if (!Number.isInteger(expected[field]) || expected[field] < 0) problems.push(`${source.key}: manifest ${field} is invalid`)
    }
    if (!/^[a-f0-9]{64}$/.test(String(expected.sha256))) problems.push(`${source.key}: manifest sha256 is invalid`)
    if (!sameRequest(expected.request, transferRequest(source))) {
      problems.push(`${source.key}: manifest request provenance does not match the official TEA broker request`)
    }
    if (!existsSync(path)) {
      problems.push(`${path}: described in manifest but missing from disk`)
      continue
    }
    let body
    try {
      body = gunzipSync(await readFile(path))
    } catch (err) {
      problems.push(`${path}: cannot gunzip (${err.message})`)
      continue
    }
    checked++
    const actualSha = sha256(body)
    if (actualSha !== expected.sha256) {
      problems.push(`${source.key}: sha256 ${actualSha.slice(0, 12)}… != manifest ${String(expected.sha256).slice(0, 12)}…`)
    }
    if (body.length !== expected.bytes) problems.push(`${source.key}: ${body.length} bytes != manifest ${expected.bytes}`)
    try {
      if (source.level === 'campus') districtDirectories.set(source.year, new Map())
      const stats = coverage(parseTransferReport(body.toString('utf8'), source, {
        districtDirectory: districtDirectories.get(source.year),
      }), source)
      for (const field of ['rows', 'entities', 'detailRows', 'totalRows', 'maskedRows']) {
        if (stats[field] !== expected[field]) {
          problems.push(`${source.key}: ${stats[field]} ${field} != manifest ${expected[field]}`)
        }
      }
    } catch (err) {
      problems.push(`${source.key}: ${err.message}`)
    }
  }
  return { dir, checked, problems, fetchedAt: manifest.fetchedAt ?? null }
}

if (import.meta.url === `file://${process.argv[1]}`) await fetchTransfers()
