import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  TRANSFER_BROKER_URL,
  TRANSFER_MAP_KEY,
  TRANSFER_MAP_LABEL,
  TRANSFER_MAP_NOTE,
  TRANSFER_SOURCES,
  buildTransferManifest,
  fetchTransfers,
  latestTransferSnapshot,
  loadTransferRows,
  parseTransferReport,
  summarizeDistrictTransfers,
  transferMapData,
  transferRequest,
  verifyTransferSnapshot,
} from '../src/transfers.js'

const scratchDirs = []
const scratchDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tea-transfers-'))
  scratchDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(scratchDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const DISTRICT_HEADER = [
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
]

const CAMPUS_HEADER = [
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
]

const csv = (value) => {
  const string = String(value ?? '')
  return `"${string.replaceAll('"', '""')}"`
}
const csvRow = (values) => values.map(csv).join(',')

function footer(width) {
  const records = [
    '-999 indicates counts or percentages are not available (i.e. masked) to comply with the Family Educational Rights and Privacy Act (FERPA).',
    'Masked numbers are typically small although larger numbers may be masked to prevent imputation.',
    'The REPORT_NUMBER column and the LINE_GROUP_NUMBER column are added to assist sorting and filtering of rows in the file.',
  ]
  return records.map((text) => csvRow([text, ...Array(width - 1).fill('')])).join('\r\n')
}

function districtReport({
  source = TRANSFER_SOURCES.find((item) => item.level === 'district'),
  rows,
  header = DISTRICT_HEADER,
} = {}) {
  const start = Number(source.year.slice(0, 4))
  const reportRows = rows ?? [
    {
      report: 'SPRING ISD  -  101919',
      direction: 'Transfers In From',
      reportNumber: 100,
      lineGroup: 100,
      counterpart: 'KLEIN ISD  -  101915',
      transfers: '-999',
    },
    {
      report: 'SPRING ISD  -  101919',
      direction: 'Transfers In From',
      reportNumber: 100,
      lineGroup: 200,
      counterpart: '',
      transfers: '.',
    },
    {
      report: 'SPRING ISD  -  101919',
      direction: 'Transfers In From',
      reportNumber: 100,
      lineGroup: 200,
      counterpart: 'Total Transfers In',
      transfers: 812,
    },
    {
      report: 'SPRING ISD  -  101919',
      direction: 'Transfers Out To',
      reportNumber: 200,
      lineGroup: 100,
      counterpart: 'KLEIN ISD  -  101915',
      transfers: 14,
    },
    {
      report: 'SPRING ISD  -  101919',
      direction: 'Transfers Out To',
      reportNumber: 200,
      lineGroup: 200,
      counterpart: 'Total Transfers Out',
      transfers: 537,
    },
  ]
  const lines = [
    'T E X A S  E D U C A T I O N  A G E N C Y',
    '',
    'Region Level Transfer Report',
    '',
    'PEIMS Student Transfer Report',
    '',
    csvRow(header),
  ]
  for (const row of reportRows) {
    const values = {
      YEAR: `${start}-${start + 1}`,
      REPORT_REGION: source.region,
      REPORT_REGION_NAME: `REGION ${source.region}`,
      REPORT_DISTNAME_NUMBER: row.report,
      REPORT_CHARTER_STATUS: 'Traditional ISD/CSD',
      REPORT_NUMBER: row.reportNumber,
      REPORT_TYPE: row.direction,
      LINE_GROUP_NUMBER: row.lineGroup,
      DISTNAME_NUMBER_RES_ATTEND: row.counterpart,
      TRANSFERS_IN_OUT: row.transfers,
    }
    lines.push(csvRow(header.map((column) => values[column] ?? '')))
  }
  lines.push('', footer(header.length), '')
  return lines.join('\r\n')
}

function campusReport({
  source = TRANSFER_SOURCES.find((item) => item.level === 'campus'),
  rows,
  header = CAMPUS_HEADER,
} = {}) {
  const start = Number(source.year.slice(0, 4))
  const reportRows = rows ?? [
    {
      reportDistrict: '25906',
      reportCampus: '25906001',
      direction: 'Transfers In From',
      reportNumber: 100,
      lineGroup: 100,
      counterpartDistrict: '1902',
      counterpartCampus: '1902001',
      transfers: '<10',
    },
    {
      reportDistrict: '25906',
      reportCampus: '25906001',
      direction: 'Transfers Out To',
      reportNumber: 200,
      lineGroup: 100,
      counterpartDistrict: '25909',
      counterpartCampus: '25909101',
      transfers: 12,
    },
    {
      reportDistrict: '25906',
      reportCampus: '25906001',
      direction: '',
      reportNumber: 200,
      lineGroup: 200,
      counterpartDistrict: '',
      counterpartCampus: '',
      transfers: '.',
    },
  ]
  const lines = [
    'T E X A S  E D U C A T I O N  A G E N C Y',
    '',
    'Campus Level Transfer Report',
    '',
    'PEIMS Student Transfer Report',
    '',
    csvRow(header),
  ]
  for (const row of reportRows) {
    const values = {
      YEAR: `${start}-${start + 1}`,
      REPORT_REGION: source.region ?? 15,
      REPORT_DISTRICT: row.reportDistrict,
      REPORT_DISTRICT_NAME: 'ZEPHYR ISD',
      REPORT_CAMPUS: row.reportCampus,
      REPORT_CAMPUS_NAME: 'ZEPHYR SCHOOL',
      REPORT_NUMBER: row.reportNumber,
      REPORT_TYPE: row.direction,
      LINE_GROUP_NUMBER: row.lineGroup,
      DISTRICT_RES_OR_ATTEND: row.counterpartDistrict,
      DISTNAME_RES_OR_ATTEND: 'OTHER ISD',
      CAMPUS_RES_OR_ATTEND: row.counterpartCampus,
      CAMPNAME_RES_OR_ATTEND: 'OTHER SCHOOL',
      TRANSFERS_IN_OUT: row.transfers,
      TRANSFERS_IN_OR_OUT: row.transfers,
    }
    if (row.lineGroup === 200) {
      values.DISTNAME_RES_OR_ATTEND = ''
      values.CAMPNAME_RES_OR_ATTEND = ''
    }
    lines.push(csvRow(header.map((column) => values[column] ?? '')))
  }
  lines.push('', footer(header.length), '')
  return lines.join('\r\n')
}

function fullDistrictReport(source) {
  const rows = []
  for (let entity = 0; entity < source.minEntities; entity++) {
    const reportId = `${source.region}${String(entity + 1).padStart(4, '0')}`
    for (let detail = 0; detail < 9; detail++) {
      rows.push({
        report: `REPORT ${entity}  -  ${reportId}`,
        direction: 'Transfers In From',
        reportNumber: 100,
        lineGroup: 100,
        counterpart: `OTHER ${detail}  -  ${String(200000 + detail).padStart(6, '0')}`,
        transfers: detail === 0 ? '-999' : detail + 10,
      })
    }
    rows.push({
      report: `REPORT ${entity}  -  ${reportId}`,
      direction: 'Transfers In From',
      reportNumber: 100,
      lineGroup: 200,
      counterpart: 'Total Transfers In',
      transfers: 123,
    })
  }
  return districtReport({ source, rows })
}

function fullCampusReport(source) {
  const rows = []
  for (let entity = 0; entity < source.minEntities; entity++) {
    const reportDistrict = String(100000 + Math.floor(entity / 999))
    const suffix = String((entity % 999) + 1).padStart(3, '0')
    for (let detail = 0; detail < 10; detail++) {
      const counterpartDistrict = String(200000 + detail)
      rows.push({
        reportDistrict,
        reportCampus: `${reportDistrict}${suffix}`,
        direction: 'Transfers In From',
        reportNumber: 100,
        lineGroup: 100,
        counterpartDistrict,
        counterpartCampus: `${counterpartDistrict}${suffix}`,
        transfers: detail === 0 ? '-999' : 10 + detail,
      })
    }
  }
  return campusReport({ source, rows })
}

function fullReport(source) {
  return source.level === 'district' ? fullDistrictReport(source) : fullCampusReport(source)
}

describe('parseTransferReport', () => {
  it('normalizes district detail and official total rows while preserving masks', () => {
    const source = TRANSFER_SOURCES.find((item) => item.level === 'district' && item.region === '04')
    expect(parseTransferReport(districtReport({ source }), source)).toEqual([
      {
        id: '101919',
        name: 'SPRING ISD',
        level: 'district',
        year: '2021-22',
        direction: 'in',
        counterpartId: '101915',
        counterpartName: 'KLEIN ISD',
        transfers: null,
        total: false,
      },
      {
        id: '101919',
        name: 'SPRING ISD',
        level: 'district',
        year: '2021-22',
        direction: 'in',
        counterpartId: null,
        counterpartName: null,
        transfers: 812,
        total: true,
      },
      {
        id: '101919',
        name: 'SPRING ISD',
        level: 'district',
        year: '2021-22',
        direction: 'out',
        counterpartId: '101915',
        counterpartName: 'KLEIN ISD',
        transfers: 14,
        total: false,
      },
      {
        id: '101919',
        name: 'SPRING ISD',
        level: 'district',
        year: '2021-22',
        direction: 'out',
        counterpartId: null,
        counterpartName: null,
        transfers: 537,
        total: true,
      },
    ])
  })

  it('restores leading zeroes stripped from older campus CSV identifiers', () => {
    const source = TRANSFER_SOURCES.find((item) => item.level === 'campus')
    const legacyHeader = [...CAMPUS_HEADER.slice(0, -1), 'TRANSFERS_IN_OR_OUT']
    expect(parseTransferReport(campusReport({ source, header: legacyHeader }), source)).toEqual([
      {
        id: '025906001',
        level: 'campus',
        year: '2021-22',
        direction: 'in',
        counterpartId: '001902001',
        transfers: null,
        total: false,
      },
      {
        id: '025906001',
        level: 'campus',
        year: '2021-22',
        direction: 'out',
        counterpartId: '025909101',
        transfers: 12,
        total: false,
      },
    ])
  })

  it('repairs a truncated embedded district ID only from an unambiguous same-year campus crosswalk', () => {
    const source = TRANSFER_SOURCES.find((item) => item.level === 'district')
    const row = {
      report: 'BROWNSVILLE ISD  -  031901',
      direction: 'Transfers Out To',
      reportNumber: 200,
      lineGroup: 100,
      counterpart: 'HARMONY PUBLIC SCHOOLS - SOUTH TEXAS  -  0158',
      transfers: 975,
    }
    const districtDirectory = new Map([
      ['HARMONY PUBLIC SCHOOLS - SOUTH TEXAS', new Set(['015828'])],
    ])
    expect(parseTransferReport(districtReport({ source, rows: [row] }), source, { districtDirectory })[0])
      .toMatchObject({ id: '031901', counterpartId: '015828', transfers: 975 })
    const missingId = {
      ...row,
      counterpart: 'HARMONY PUBLIC SCHOOLS - SOUTH TEXAS  -',
    }
    expect(parseTransferReport(districtReport({ source, rows: [missingId] }), source, { districtDirectory })[0])
      .toMatchObject({ counterpartId: '015828' })
    const missingSeparator = {
      ...row,
      counterpart: 'HARMONY PUBLIC SCHOOLS - SOUTH TEXAS',
    }
    expect(parseTransferReport(districtReport({ source, rows: [missingSeparator] }), source, { districtDirectory })[0])
      .toMatchObject({ counterpartId: '015828' })
    const truncatedNameDirectory = new Map([
      ['HENRY FORD ACADEMY ALAMEDA SCHOOL FOR ART + DESIGN', new Set(['015833'])],
    ])
    const truncatedName = {
      ...row,
      counterpart: 'HENRY FORD ACADEMY ALAMEDA SCHOOL FOR ART + D',
    }
    expect(parseTransferReport(
      districtReport({ source, rows: [truncatedName] }),
      source,
      { districtDirectory: truncatedNameDirectory }
    )[0]).toMatchObject({ counterpartId: '015833' })
    expect(() => parseTransferReport(districtReport({ source, rows: [row] }), source))
      .toThrow(/cannot be resolved uniquely/)
  })

  it('maps every documented masking form to null but preserves a real zero', () => {
    const source = TRANSFER_SOURCES.find((item) => item.level === 'district')
    const rows = ['-999', '-9999999', 'N/A', 'n/a', '<10', '<20', '*', '', 0].map((transfers, index) => ({
      report: 'EXAMPLE ISD  -  001902',
      direction: 'Transfers In From',
      reportNumber: 100,
      lineGroup: 100,
      counterpart: `OTHER ${index}  -  ${String(100000 + index).padStart(6, '0')}`,
      transfers,
    }))
    expect(parseTransferReport(districtReport({ source, rows }), source).map((row) => row.transfers)).toEqual([
      null, null, null, null, null, null, null, null, 0,
    ])
  })

  it('rejects unknown negatives, decimals, and malformed identifiers', () => {
    const district = TRANSFER_SOURCES.find((item) => item.level === 'district')
    const base = {
      report: 'EXAMPLE ISD  -  001902',
      direction: 'Transfers In From',
      reportNumber: 100,
      lineGroup: 100,
      counterpart: 'OTHER ISD  -  001903',
    }
    for (const transfers of ['-1', '12.5']) {
      expect(() => parseTransferReport(districtReport({ source: district, rows: [{ ...base, transfers }] }), district))
        .toThrow(/transfer count/)
    }
    const campus = TRANSFER_SOURCES.find((item) => item.level === 'campus')
    expect(() =>
      parseTransferReport(
        campusReport({ source: campus, rows: [{
          reportDistrict: '25906',
          reportCampus: '123',
          direction: 'Transfers In From',
          reportNumber: 100,
          lineGroup: 100,
          counterpartDistrict: '25909',
          counterpartCampus: '25909101',
          transfers: 12,
        }] }),
        campus
      )
    ).toThrow(/invalid REPORT_CAMPUS/)
  })

  it('strictly validates the year, region, header, direction, and official footer', () => {
    const source = TRANSFER_SOURCES.find((item) => item.level === 'district' && item.region === '04')
    expect(() => parseTransferReport(districtReport({ source }).replaceAll('2021-2022', '2020-2021'), source))
      .toThrow(/reports year "2020-2021"/)
    expect(() => parseTransferReport(districtReport({ source }).replaceAll('"04"', '"03"'), source))
      .toThrow(/reports region 03/)
    expect(() => parseTransferReport(districtReport({ source, header: DISTRICT_HEADER.slice(0, -1) }), source))
      .toThrow(/header is missing/)
    expect(() => parseTransferReport(districtReport({ source }).replace('"100","Transfers In From"', '"200","Transfers In From"'), source))
      .toThrow(/conflicts with in direction/)
    expect(() => parseTransferReport(districtReport({ source }).replace('The REPORT_NUMBER column', 'A SORTING column'), source))
      .toThrow(/missing official footer/)
  })

  it('collapses identical duplicates but rejects conflicting pair counts', () => {
    const source = TRANSFER_SOURCES.find((item) => item.level === 'district')
    const row = {
      report: 'EXAMPLE ISD  -  001902',
      direction: 'Transfers In From',
      reportNumber: 100,
      lineGroup: 100,
      counterpart: 'OTHER ISD  -  001903',
      transfers: 15,
    }
    expect(parseTransferReport(districtReport({ source, rows: [row, row] }), source)).toHaveLength(1)
    expect(() => parseTransferReport(districtReport({ source, rows: [row, { ...row, transfers: 16 }] }), source))
      .toThrow(/conflicting duplicate/)
  })
})

describe('summarizeDistrictTransfers', () => {
  const entities = [
    { id: '101902', level: 'district', name: 'Aldine ISD' },
    { id: '101915', level: 'district', name: 'Klein ISD' },
    { id: '101919', level: 'district', name: 'Spring ISD' },
    { id: '101919001', level: 'campus', name: 'Spring HS' },
  ]
  const total = (year, direction, transfers, id = '101919') => ({
    id,
    name: id === '101919' ? 'SPRING ISD' : 'KLEIN ISD',
    level: 'district',
    year,
    direction,
    counterpartId: null,
    counterpartName: null,
    transfers,
    total: true,
  })
  const detail = ({
    year = '2025-26',
    direction,
    counterpartId,
    counterpartName,
    transfers,
    id = '101919',
  }) => ({
    id,
    name: id === '101919' ? 'SPRING ISD' : 'KLEIN ISD',
    level: 'district',
    year,
    direction,
    counterpartId,
    counterpartName,
    transfers,
    total: false,
  })

  it('uses only official totals and produces a neutral five-year Spring ISD summary', () => {
    const history = [
      ['2021-22', 150, 4636],
      ['2022-23', 141, 5055],
      ['2023-24', 164, 4739],
      ['2024-25', 122, 5837],
      ['2025-26', 106, 6502],
    ].flatMap(([year, transfersIn, transfersOut]) => [
      total(year, 'in', transfersIn),
      total(year, 'out', transfersOut),
    ])
    const rows = [
      ...history,
      detail({ direction: 'in', counterpartId: '101915', counterpartName: 'KLEIN ISD', transfers: 11 }),
      detail({ direction: 'in', counterpartId: '101902', counterpartName: 'ALDINE ISD', transfers: null }),
      detail({ direction: 'out', counterpartId: '015827', counterpartName: 'SCHOOL OF SCIENCE AND TECHNOLOGY', transfers: 1579 }),
      detail({ direction: 'out', counterpartId: '101915', counterpartName: 'KLEIN ISD', transfers: 467 }),
      detail({ direction: 'out', counterpartId: '101902', counterpartName: 'ALDINE ISD', transfers: null }),
      // Campus detail exists in the archive but has no official total and is
      // intentionally outside the district summarizer.
      {
        id: '101919001', level: 'campus', year: '2025-26', direction: 'in',
        counterpartId: '101915001', transfers: 30, total: false,
      },
    ]
    const spring = summarizeDistrictTransfers(rows, entities, { topLimit: 2 })
      .find((summary) => summary.id === '101919')

    expect(spring.current).toMatchObject({
      year: '2025-26',
      transfersIn: 106,
      transfersOut: 6502,
      net: -6396,
      coverage: {
        officialTotals: { in: 'reported', out: 'reported' },
        origins: { published: 2, reported: 1, masked: 1 },
        destinations: { published: 3, reported: 2, masked: 1 },
      },
    })
    // The published total is 106. It is never replaced by the visible detail
    // sum (11), because the other origin is FERPA-masked.
    expect(spring.current.transfersIn).not.toBe(11)
    expect(spring.current.topOrigins).toEqual([
      { id: '101915', name: 'Klein ISD', transfers: 11 },
    ])
    expect(spring.current.topDestinations).toEqual([
      { id: '015827', name: 'SCHOOL OF SCIENCE AND TECHNOLOGY', transfers: 1579 },
      { id: '101915', name: 'Klein ISD', transfers: 467 },
    ])
    expect(spring.history).toHaveLength(5)
    expect(spring.changeSinceFirst).toEqual({
      fromYear: '2021-22',
      toYear: '2025-26',
      transfersInChange: -44,
      transfersOutChange: 1866,
      netChange: -1910,
    })
    expect(spring.netLabel).toMatch(/arithmetic context only; not a quality measure/i)
  })

  it('keeps masked and absent totals null, exposes coverage, and never returns campus summaries', () => {
    const rows = [
      total('2025-26', 'in', null, '101915'),
      total('2025-26', 'out', 4, '101915'),
      detail({ id: '101915', direction: 'in', counterpartId: '101919', counterpartName: 'SPRING ISD', transfers: null }),
      { id: '101919001', level: 'campus', year: '2025-26', direction: 'in', counterpartId: '101915001', transfers: 9, total: false },
      // A valid but unpublished district is filtered rather than surfaced.
      total('2025-26', 'in', 20, '999999'),
    ]
    const summaries = summarizeDistrictTransfers(rows, entities)
    const klein = summaries.find((summary) => summary.id === '101915')
    const spring = summaries.find((summary) => summary.id === '101919')
    expect(klein.current).toMatchObject({
      transfersIn: null,
      transfersOut: 4,
      net: null,
      coverage: {
        officialTotals: { in: 'masked', out: 'reported' },
        origins: { published: 1, reported: 0, masked: 1 },
      },
    })
    expect(spring.current).toMatchObject({
      transfersIn: null,
      transfersOut: null,
      net: null,
      coverage: { officialTotals: { in: 'not_reported', out: 'not_reported' } },
    })
    expect(summaries.every((summary) => summary.level === 'district')).toBe(true)
    expect(summaries.some((summary) => summary.id === '101919001' || summary.id === '999999')).toBe(false)
  })

  it('collapses identical source duplicates but rejects conflicting totals and flows', () => {
    const same = total('2025-26', 'in', 12)
    expect(() => summarizeDistrictTransfers([same, { ...same }], entities)).not.toThrow()
    expect(() => summarizeDistrictTransfers([same, { ...same, transfers: 13 }], entities))
      .toThrow(/conflicting in total/)
    const flow = detail({ direction: 'out', counterpartId: '101915', counterpartName: 'KLEIN ISD', transfers: 3 })
    expect(() => summarizeDistrictTransfers([flow, { ...flow, transfers: 4 }], entities))
      .toThrow(/conflicting out flow/)
  })

  it('builds one neutral latest-year statewide map value per published district', () => {
    const summaries = summarizeDistrictTransfers([
      total('2024-25', 'in', 40, '101919'),
      total('2024-25', 'out', 20, '101919'),
      total('2025-26', 'in', 106, '101919'),
      total('2025-26', 'out', 6502, '101919'),
      total('2024-25', 'in', 20, '101915'),
      total('2024-25', 'out', 25, '101915'),
      total('2025-26', 'in', 41, '101915'),
      total('2025-26', 'out', 13, '101915'),
    ], entities)

    const map = transferMapData(summaries)
    expect(map).toMatchObject({
      key: TRANSFER_MAP_KEY,
      label: TRANSFER_MAP_LABEL,
      year: '2025-26',
      unit: 'students',
      center: 0,
      calculation: 'transfers in minus transfers out',
      direction: TRANSFER_MAP_NOTE,
      coverage: { districts: 3, reported: 2, masked: 0, notReported: 1 },
    })
    expect(map.values).toEqual(new Map([
      ['101902', null],
      ['101915', 28],
      ['101919', -6396],
    ]))
    expect(map.details.get('101915')).toEqual({
      id: '101915',
      name: 'Klein ISD',
      year: '2025-26',
      transfersIn: 41,
      transfersOut: 13,
      net: 28,
      status: 'reported',
      officialTotals: { in: 'reported', out: 'reported' },
    })
    expect(map.direction).toMatch(/not a rating or measure of district quality/i)
  })

  it('keeps masked totals null and never falls back to an older reported year', () => {
    const summaries = summarizeDistrictTransfers([
      total('2024-25', 'in', 20, '101915'),
      total('2024-25', 'out', 25, '101915'),
      total('2025-26', 'in', null, '101915'),
      total('2025-26', 'out', 13, '101915'),
      // Spring has a complete older year but no 2025-26 source rows. The map
      // must not compare that older balance with Klein's newer balance.
      total('2024-25', 'in', 40, '101919'),
      total('2024-25', 'out', 20, '101919'),
    ], entities)

    const map = transferMapData(summaries)
    expect(map.year).toBe('2025-26')
    expect(map.values.get('101915')).toBeNull()
    expect(map.details.get('101915')).toMatchObject({
      year: '2025-26',
      net: null,
      status: 'masked',
      officialTotals: { in: 'masked', out: 'reported' },
    })
    expect(map.values.get('101919')).toBeNull()
    expect(map.details.get('101919')).toMatchObject({
      year: '2025-26',
      transfersIn: null,
      transfersOut: null,
      net: null,
      status: 'not_reported',
      officialTotals: { in: 'not_reported', out: 'not_reported' },
    })
    expect(map.coverage).toEqual({ districts: 3, reported: 0, masked: 1, notReported: 2 })
  })

  it('rejects inconsistent net values and non-district or duplicate inputs', () => {
    const summary = summarizeDistrictTransfers([
      total('2025-26', 'in', 41, '101915'),
      total('2025-26', 'out', 13, '101915'),
    ], entities).find((item) => item.id === '101915')

    const inconsistent = structuredClone(summary)
    inconsistent.history[0].net = 99
    expect(() => transferMapData([inconsistent])).toThrow(/expected 28 from its official totals/)
    expect(() => transferMapData([summary, summary])).toThrow(/appears more than once/)
    expect(() => transferMapData([{ ...summary, level: 'campus' }])).toThrow(/expected a district summary/)
  })
})

describe('transfer snapshot selection and provenance', () => {
  it('selects the newest real date with a manifest and rejects no complete snapshot', () => {
    const complete = new Set(['2026-08-23', '2026-08-24'])
    expect(latestTransferSnapshot(
      ['2026-08-23', '2026-08-24', '2026-08-25', '2026-99-99', 'notes'],
      (name) => complete.has(name)
    )).toBe('2026-08-24')
    expect(() => latestTransferSnapshot(['2026-08-24'], () => false)).toThrow(/no complete transfer snapshot/)
  })

  it('records raw-response hashes, exact GET provenance, coverage, and caveats', () => {
    const source = TRANSFER_SOURCES.find((item) => item.level === 'district')
    const body = Buffer.from(districtReport({ source }))
    const manifest = buildTransferManifest([{
      source,
      body,
      rows: 4,
      entities: 1,
      detailRows: 2,
      totalRows: 2,
      maskedRows: 1,
    }], '2026-08-24T12:00:00.000Z')
    const entry = manifest.files[source.key]
    expect(entry.sha256).toBe(createHash('sha256').update(body).digest('hex'))
    expect(entry.bytes).toBe(body.length)
    expect(entry.request).toEqual(transferRequest(source))
    expect(entry.request).toMatchObject({
      method: 'GET',
      url: TRANSFER_BROKER_URL,
      query: {
        _program: 'adhoc.download_transfer_report.sas',
        scope: 'Region',
        agg_level: 'region',
        school_year: '2022',
        report_format: 'csv',
        selected_id: source.region,
      },
    })
    expect(manifest.caveats.campus).toMatch(/no totals.*cannot be derived/i)
  })
})

describe('fetch, verify, and load transfer snapshots', () => {
  it('archives all 105 reports, writes the manifest last, verifies, and loads canonical rows', async () => {
    const root = await scratchDir()
    const fetchImpl = vi.fn(async (url, options) => {
      const parsed = new URL(url)
      const year = parsed.searchParams.get('school_year')
      const scope = parsed.searchParams.get('scope')
      const source = TRANSFER_SOURCES.find((candidate) =>
        candidate.schoolYear === year &&
        (scope === 'Campus'
          ? candidate.level === 'campus'
          : candidate.level === 'district' && candidate.region === parsed.searchParams.get('selected_id'))
      )
      const body = Buffer.from(fullReport(source))
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        arrayBuffer: async () => body,
        requestMethod: options.method,
      }
    })
    const { dir, manifest } = await fetchTransfers({
      date: new Date('2026-08-24T12:00:00.000Z'),
      root,
      fetchImpl,
      log: () => {},
    })
    expect(fetchImpl).toHaveBeenCalledTimes(105)
    expect(Object.keys(manifest.files)).toHaveLength(105)
    expect(existsSync(join(dir, 'manifest.json'))).toBe(true)
    const verified = await verifyTransferSnapshot(dir)
    expect(verified.checked).toBe(105)
    expect(verified.problems).toEqual([])
    const rows = await loadTransferRows(dir)
    const expectedRows = TRANSFER_SOURCES.reduce((sum, source) => sum + source.minRows, 0)
    expect(rows).toHaveLength(expectedRows)
    expect(rows.some((row) => row.level === 'district' && row.total)).toBe(true)
    expect(rows.some((row) => row.level === 'campus' && row.transfers === null)).toBe(true)
  }, 30_000)

  it('removes an old manifest before requesting data so a failed refresh stays incomplete', async () => {
    const root = await scratchDir()
    const dir = join(root, '2026-08-24')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'manifest.json'), '{"stale":true}')
    const source = TRANSFER_SOURCES[0]
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      arrayBuffer: async () => Buffer.from(campusReport({ source })),
    })
    await expect(fetchTransfers({
      date: new Date('2026-08-24T12:00:00.000Z'),
      root,
      fetchImpl,
      log: () => {},
    })).rejects.toThrow(/below completeness floor/)
    expect(existsSync(join(dir, 'manifest.json'))).toBe(false)
  })

  it('reports tampering and names missing archives instead of returning partial history', async () => {
    const root = await scratchDir()
    const source = TRANSFER_SOURCES.find((item) => item.level === 'district')
    const body = Buffer.from(fullReport(source))
    const manifest = buildTransferManifest([{
      source,
      body,
      rows: source.minRows,
      entities: source.minEntities,
      detailRows: source.minRows - source.minEntities,
      totalRows: source.minEntities,
      maskedRows: source.minEntities,
    }], '2026-08-24T12:00:00.000Z')
    await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest))
    await writeFile(join(root, source.file), gzipSync(Buffer.from(`${body.toString('utf8')}tampered`)))
    const verified = await verifyTransferSnapshot(root)
    expect(verified.problems.some((problem) => problem.includes('sha256'))).toBe(true)
    const empty = await scratchDir()
    await expect(loadTransferRows(empty)).rejects.toThrow(/2021-22-campus\.csv\.gz/)
  })
})
