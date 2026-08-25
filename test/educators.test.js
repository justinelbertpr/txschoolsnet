import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CLASS_SIZE_FIELDS,
  EDUCATOR_BROKER_URL,
  EDUCATOR_SOURCES,
  buildEducatorManifest,
  educatorRequest,
  fetchEducators,
  latestEducatorSnapshot,
  loadEducatorRows,
  parseEducatorReport,
  verifyEducatorSnapshot,
} from '../src/educators.js'

const scratchDirs = []
const scratchDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tea-educators-'))
  scratchDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(scratchDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const classFields = Object.values(CLASS_SIZE_FIELDS)

function districtReport({
  current = false,
  rows = [{ id: '001902', rate: 14.7 }],
  header = ['DISTRICT', 'DPSTURNR'],
} = {}) {
  const output = []
  if (current) output.push(header.map((name) => `Human ${name}`).join(','))
  output.push(header.join(','))
  for (const row of rows) {
    const values = { DISTRICT: current ? row.id : `"'${row.id}"`, DPSTURNR: row.rate ?? '' }
    output.push(header.map((field) => values[field] ?? '').join(','))
  }
  return `${output.join('\r\n')}\r\n`
}

function campusReport({
  current = false,
  rows = [{ id: '001902103', value: 15.2 }],
  header = ['CAMPUS', ...classFields],
} = {}) {
  const output = []
  if (current) output.push(header.map((name) => `Human ${name}`).join(','))
  output.push(header.join(','))
  for (const row of rows) {
    const values = { CAMPUS: current ? row.id : `"'${row.id}"` }
    for (const field of classFields) values[field] = row.values?.[field] ?? row.value ?? ''
    output.push(header.map((field) => values[field] ?? '').join(','))
  }
  return `${output.join('\r\n')}\r\n`
}

function fullReport(source) {
  const rows = Array.from({ length: source.minRows }, (_, index) => ({
    id: String(index + 1).padStart(source.level === 'district' ? 6 : 9, '0'),
    rate: index < source.minReportedRows ? 10 + (index % 50) / 10 : null,
    value: index < source.minReportedRows ? 10 + (index % 30) / 10 : null,
  }))
  return source.level === 'district'
    ? districtReport({ current: source.endpoint === 'current', rows })
    : campusReport({ current: source.endpoint === 'current', rows })
}

describe('parseEducatorReport', () => {
  it('parses the legacy district turnover rate and removes only the CSV-protection apostrophe', () => {
    const source = EDUCATOR_SOURCES.find((item) => item.key === '2020-21-district-turnover')
    expect(parseEducatorReport(districtReport(), source)).toEqual([
      { id: '001902', level: 'district', year: '2020-21', teacherTurnoverRate: 14.7 },
    ])
  })

  it('finds the variable-code header below the current human-readable header', () => {
    const source = EDUCATOR_SOURCES.find((item) => item.key === '2024-25-district-turnover')
    expect(parseEducatorReport(districtReport({ current: true }), source)[0]).toMatchObject({
      id: '001902',
      year: '2024-25',
      teacherTurnoverRate: 14.7,
    })
  })

  it('keeps all twelve campus class-size categories separate and creates no overall average', () => {
    const source = EDUCATOR_SOURCES.find((item) => item.key === '2022-23-campus-class-size')
    const values = Object.fromEntries(classFields.map((field, index) => [field, 10 + index / 10]))
    const [row] = parseEducatorReport(campusReport({ rows: [{ id: '101919001', values }] }), source)
    expect(row).toEqual({
      id: '101919001',
      districtId: '101919',
      level: 'campus',
      year: '2022-23',
      classSize: {
        kindergarten: 10,
        grade1: 10.1,
        grade2: 10.2,
        grade3: 10.3,
        grade4: 10.4,
        grade5: 10.5,
        grade6: 10.6,
        secondaryEnglish: 10.7,
        secondaryLanguagesOtherThanEnglish: 10.8,
        secondaryMath: 10.9,
        secondaryScience: 11,
        secondarySocialStudies: 11.1,
      },
    })
    expect(row).not.toHaveProperty('averageClassSize')
  })

  it('maps every documented TAPR missing or masked form to null, never zero', () => {
    const source = EDUCATOR_SOURCES.find((item) => item.key === '2024-25-campus-class-size')
    const masks = ['', '.', '-', '•', '*', '-1', '-2', '-3', '-999', '-9999999', 'N/A', '<10']
    const values = Object.fromEntries(classFields.map((field, index) => [field, masks[index]]))
    const [row] = parseEducatorReport(campusReport({ current: true, rows: [{ id: '001902103', values }] }), source)
    expect(Object.values(row.classSize)).toEqual(Array(12).fill(null))

    const [zero] = parseEducatorReport(campusReport({ rows: [{ id: '001902103', value: 0 }] }), source)
    expect(Object.values(zero.classSize)).toEqual(Array(12).fill(0))

    const district = EDUCATOR_SOURCES.find((item) => item.key === '2024-25-district-turnover')
    for (const mask of ['NA', 'NOT AVAILABLE', 'MASKED', '< 20']) {
      expect(parseEducatorReport(districtReport({ rows: [{ id: '001902', rate: mask }] }), district)[0])
        .toHaveProperty('teacherTurnoverRate', null)
    }
  })

  it('rejects unknown negatives, invalid numbers, and values outside measure ranges', () => {
    const district = EDUCATOR_SOURCES.find((item) => item.key === '2024-25-district-turnover')
    expect(() => parseEducatorReport(districtReport({ rows: [{ id: '001902', rate: -4 }] }), district)).toThrow(
      /unexpected negative teacher turnover rate/
    )
    expect(() => parseEducatorReport(districtReport({ rows: [{ id: '001902', rate: 'twelve' }] }), district)).toThrow(
      /invalid teacher turnover rate/
    )
    expect(() => parseEducatorReport(districtReport({ rows: [{ id: '001902', rate: 100.1 }] }), district)).toThrow(
      /outside the expected range/
    )

    const campus = EDUCATOR_SOURCES.find((item) => item.key === '2024-25-campus-class-size')
    expect(() => parseEducatorReport(campusReport({ rows: [{ id: '001902103', value: 1000.1 }] }), campus)).toThrow(
      /outside the expected range/
    )
  })

  it('strictly validates identifiers, required fields, row width, and unique code headers', () => {
    const district = EDUCATOR_SOURCES.find((item) => item.key === '2024-25-district-turnover')
    expect(() => parseEducatorReport(districtReport({ rows: [{ id: '1902', rate: 12 }] }), district)).toThrow(
      /expected 6 digits/
    )
    expect(() => parseEducatorReport('DISTRICT\r\n001902\r\n', district)).toThrow(/header is missing/)
    expect(() => parseEducatorReport('DISTRICT,DPSTURNR\r\n001902,12,extra\r\n', district)).toThrow(
      /has 3 columns; header has 2/
    )
    expect(() =>
      parseEducatorReport('DISTRICT,DPSTURNR\r\nDISTRICT,DPSTURNR\r\n001902,12\r\n', district)
    ).toThrow(/more than one matching header/)
  })

  it('collapses identical duplicate entity-years and rejects conflicting values', () => {
    const source = EDUCATOR_SOURCES.find((item) => item.key === '2024-25-district-turnover')
    expect(
      parseEducatorReport(
        districtReport({
          rows: [
            { id: '001902', rate: 14.7 },
            { id: '001902', rate: 14.7 },
          ],
        }),
        source
      )
    ).toHaveLength(1)
    expect(() =>
      parseEducatorReport(
        districtReport({
          rows: [
            { id: '001902', rate: 14.7 },
            { id: '001902', rate: 14.8 },
          ],
        }),
        source
      )
    ).toThrow(/conflicting duplicate 001902/)
  })
})

describe('educator snapshot selection and request provenance', () => {
  it('selects the newest real date with a manifest and skips partial directories', () => {
    const complete = new Set(['2026-08-22', '2026-08-24'])
    expect(
      latestEducatorSnapshot(
        ['2026-08-22', '2026-08-24', '2026-08-25', '2026-02-30', 'notes'],
        (name) => complete.has(name)
      )
    ).toBe('2026-08-24')
    expect(() => latestEducatorSnapshot(['notes'])).toThrow(/no complete educator snapshot/)
  })

  it('uses the exact legacy selected-data request for the three older years', () => {
    const district = EDUCATOR_SOURCES.find((item) => item.key === '2022-23-district-turnover')
    expect(educatorRequest(district)).toEqual({
      method: 'GET',
      url: `${EDUCATOR_BROKER_URL}/DSTAF`,
      query: expect.objectContaining({
        year4: '2023',
        year2: '23',
        prgopt: '2023/xplore/getdata.sas',
        dsname: 'DSTAF',
        sumlev: 'D',
        dist0: '999999',
        datafmt: 'C',
        key: 'MISC ',
      }),
    })

    const campus = EDUCATOR_SOURCES.find((item) => item.key === '2022-23-campus-class-size')
    expect(educatorRequest(campus)).toMatchObject({
      method: 'GET',
      url: `${EDUCATOR_BROKER_URL}/CSTUD`,
      query: { dsname: 'CSTUD', camp0: '999999', key: 'PCT ', datafmt: 'C' },
    })
  })

  it('uses the exact current TAPR requests and never requests campus turnover', () => {
    const district = EDUCATOR_SOURCES.find((item) => item.key === '2024-25-district-turnover')
    expect(educatorRequest(district)).toMatchObject({
      method: 'POST',
      url: `${EDUCATOR_BROKER_URL}/`,
      form: { ccyy: '2025', tapr: 'all_d', dsname: 'STAF', sumlev: 'D', key: 'STURN', datafmt: 'csv' },
    })
    const campus = EDUCATOR_SOURCES.find((item) => item.key === '2024-25-campus-class-size')
    const request = educatorRequest(campus)
    expect(request.form).toMatchObject({ ccyy: '2025', tapr: 'all_c', dsname: 'STUD', sumlev: 'C' })
    expect(request.form.key.split('|')).toHaveLength(12)
    expect(request.form.key).not.toContain('STURN')
  })

  it('hashes raw response bytes and stores source-level definitions and caveats', () => {
    const source = EDUCATOR_SOURCES[0]
    const body = Buffer.from(districtReport())
    const manifest = buildEducatorManifest(
      [{ source, body, rows: 1, reportedRows: 1 }],
      '2026-08-24T12:00:00.000Z'
    )
    expect(manifest.files[source.key]).toMatchObject({
      sha256: createHash('sha256').update(body).digest('hex'),
      bytes: body.length,
      rows: 1,
      reportedRows: 1,
      request: educatorRequest(source),
      sourcePage: source.sourcePage,
      dictionary: source.dictionary,
      glossary: source.glossary,
      masking: source.masking,
    })
    expect(manifest.scope.teacherTurnover).toMatch(/District only/)
    expect(manifest.scope.classSize).toMatch(/no synthetic campus-wide average/)
  })
})

describe('fetch, verify, and load educator snapshots', () => {
  it('archives all ten official responses, writes the manifest last, verifies, and loads rows', async () => {
    const root = await scratchDir()
    const calls = []
    const fetchImpl = vi.fn(async (url, options) => {
      const parsed = new URL(url)
      const parameters = options.method === 'GET' ? Object.fromEntries(parsed.searchParams) : Object.fromEntries(options.body)
      calls.push({ url: `${parsed.origin}${parsed.pathname}`, method: options.method, parameters })
      const source = EDUCATOR_SOURCES.find((candidate) => {
        if (candidate.endYear !== (parameters.year4 ?? parameters.ccyy)) return false
        if (candidate.endpoint === 'legacy') return candidate.level === (parameters.dsname === 'DSTAF' ? 'district' : 'campus')
        return candidate.level === (parameters.tapr === 'all_d' ? 'district' : 'campus')
      })
      const body = Buffer.from(fullReport(source))
      return {
        ok: true,
        status: 200,
        headers: { get: (name) => (name === 'content-type' ? 'text/csv' : null) },
        arrayBuffer: async () => body,
      }
    })

    const { dir, manifest } = await fetchEducators({
      date: new Date('2026-08-24T12:00:00.000Z'),
      root,
      fetchImpl,
      log: () => {},
    })
    expect(calls).toHaveLength(10)
    expect(calls.filter((call) => call.method === 'GET')).toHaveLength(6)
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(4)
    expect(Object.keys(manifest.files)).toHaveLength(10)
    expect(existsSync(join(dir, 'manifest.json'))).toBe(true)

    const verified = await verifyEducatorSnapshot(dir)
    expect(verified.checked).toBe(10)
    expect(verified.problems).toEqual([])

    const rows = await loadEducatorRows(dir)
    expect(rows).toHaveLength(EDUCATOR_SOURCES.reduce((sum, source) => sum + source.minRows, 0))
    expect(rows.find((row) => row.id === '000001' && row.year === '2020-21')).toMatchObject({
      level: 'district',
      teacherTurnoverRate: 10,
    })
    expect(rows.find((row) => row.id === '000000001' && row.year === '2020-21')).toMatchObject({
      districtId: '000000',
      level: 'campus',
      classSize: { kindergarten: 10 },
    })
  }, 30_000)

  it('invalidates an old manifest before fetching so a failed refresh remains incomplete', async () => {
    const root = await scratchDir()
    const dir = join(root, '2026-08-24')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'manifest.json'), '{"stale":true}')
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      arrayBuffer: async () => Buffer.from(districtReport()),
    })
    await expect(
      fetchEducators({ date: new Date('2026-08-24T12:00:00.000Z'), root, fetchImpl, log: () => {} })
    ).rejects.toThrow(/below completeness floor/)
    expect(existsSync(join(dir, 'manifest.json'))).toBe(false)
  })

  it('reports raw-response tampering and missing reports rather than accepting a partial archive', async () => {
    const root = await scratchDir()
    const source = EDUCATOR_SOURCES[0]
    const body = Buffer.from(fullReport(source))
    const manifest = buildEducatorManifest(
      [{ source, body, rows: source.minRows, reportedRows: source.minReportedRows }],
      '2026-08-24T12:00:00.000Z'
    )
    await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest))
    await writeFile(join(root, source.file), gzipSync(Buffer.from(`${body.toString('utf8')}tampered`)))
    const verified = await verifyEducatorSnapshot(root)
    expect(verified.problems.some((problem) => problem.includes('sha256'))).toBe(true)
    expect(verified.problems.some((problem) => problem.includes('manifest does not describe'))).toBe(true)
  })

  it('names the first missing archive file while loading', async () => {
    const dir = await scratchDir()
    await expect(loadEducatorRows(dir)).rejects.toThrow(/2020-21-district-turnover\.csv\.gz/)
  })
})
