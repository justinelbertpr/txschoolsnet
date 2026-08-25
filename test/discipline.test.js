import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DISCIPLINE_BROKER_URL,
  DISCIPLINE_SOURCES,
  buildDisciplineManifest,
  disciplineCsvRecords,
  disciplineRequest,
  fetchDiscipline,
  inspectDisciplineReport,
  latestDisciplineSnapshot,
  loadDisciplineRows,
  parseDisciplineReport,
  verifyDisciplineSnapshot,
} from '../src/discipline.js'

const scratchDirs = []
const scratchDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tea-discipline-'))
  scratchDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(scratchDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function csv(value) {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function entityRows({ level, id, name = level === 'district' ? 'Example ISD' : 'Example School', values } = {}) {
  const supplied = values ?? [
    ['A-' + (level === 'district' ? 'DISTRICT' : 'CAMPUS') + ' CUMULATIVE YEAR END ENROLLMENT', 'CUMULATIVE YEAR END ENROLLMENT', 'STUDENT COUNTS', '574'],
    ['B-DISCIPLINE DATA', 'ALL DISCIPLINE', 'STUDENT COUNTS', '31'],
    ['B-DISCIPLINE DATA', 'ALL DISCIPLINE', 'ACTION COUNTS', '42'],
    ['H-REASON INCIDENT COUNTS', '21-VIOLATED LOCAL CODE OF CONDUCT', 'INCIDENT COUNTS', '40'],
  ]
  return supplied.map(([section, heading, indicator, value]) => ({ id, name, section, heading, indicator, value }))
}

function report({ year = '2020-21', level = 'district', rows, header } = {}) {
  const start = Number(year.slice(0, 4))
  const columns =
    header ??
    (level === 'district'
      ? ['AGGREGATION LEVEL', 'REGION', 'DISTNAME', 'DISTRICT', 'CHARTER_STATUS', 'SECTION', 'HEADING NAME', 'INDICATOR', 'VALUE']
      : [
          'AGGREGATION LEVEL',
          'CAMPUS',
          'REGION',
          'DISTRICT NAME AND NUMBER',
          'CHARTER_STATUS',
          'CAMPUS NAME AND NUMBER',
          'SECTION',
          'HEADING NAME',
          'INDICATOR',
          'VALUE',
        ])
  const actualRows = rows ?? entityRows({ level, id: level === 'district' ? '001902' : '001902001' })
  const lines = [
    'T E X A S  E D U C A T I O N  A G E N C Y',
    '',
    `${level === 'district' ? 'Region District' : 'Campus'} Level Annual Discipline Summary`,
    '',
    `PEIMS Discipline Data for ${start}-${start + 1}`,
    '',
    columns.map(csv).join(','),
  ]
  for (const row of actualRows) {
    const districtId = level === 'district' ? row.id : row.id.slice(0, 6)
    const values = {
      'AGGREGATION LEVEL': level === 'district' ? 'DISTRICT SUMMARY' : 'CAMPUS SUMMARY',
      REGION: '07',
      DISTNAME: row.name,
      DISTRICT: row.id,
      CHARTER_STATUS: 'TRADITIONAL ISD/CSD',
      CAMPUS: row.id,
      'DISTRICT NAME AND NUMBER': `Example ISD ${districtId}`,
      'CAMPUS NAME AND NUMBER': `${row.name} ${row.id}`,
      SECTION: row.section,
      'HEADING NAME': row.heading,
      INDICATOR: row.indicator,
      VALUE: row.value,
    }
    lines.push(columns.map((column) => csv(values[column])).join(','))
  }
  return `${lines.join('\r\n')}\r\n\r\n-999 and ranges (e.g. <10 and <20) indicate counts are not available (masked) to comply with Family Educational Rights and Privacy Act (FERPA).\r\n\r\nMasked numbers are typically small although larger numbers may be masked to prevent imputation.\r\n`
}

function fullReport(source) {
  const digits = source.level === 'district' ? 6 : 9
  const rows = []
  for (let i = 0; i < source.minEntities; i++) {
    const id = String(i + 1).padStart(digits, '0')
    rows.push(...entityRows({ level: source.level, id, name: `${source.level} ${i + 1}` }))
  }
  return report({ year: source.year, level: source.level, rows })
}

describe('disciplineCsvRecords', () => {
  it('streams quoted commas, escaped quotes, embedded newlines, and CRLF correctly', () => {
    expect([...disciplineCsvRecords('a,"b,b","said ""hello""","two\nlines"\r\n1,2,3,4\r\n')]).toEqual([
      { record: ['a', 'b,b', 'said "hello"', 'two\nlines'], line: 1 },
      { record: ['1', '2', '3', '4'], line: 3 },
    ])
  })

  it('rejects malformed quoting instead of shifting columns', () => {
    expect(() => [...disciplineCsvRecords('a,"unterminated')]).toThrow(/unterminated quoted field/)
    expect(() => [...disciplineCsvRecords('a,"done"oops')]).toThrow(/after closing quote/)
  })
})

describe('parseDisciplineReport', () => {
  it('keeps unique students, actions, and incidents as separate measures', () => {
    const rows = parseDisciplineReport(report(), { year: '2020-21', level: 'district' })
    expect(rows).toEqual([
      expect.objectContaining({ id: '001902', level: 'district', year: '2020-21', measure: 'students', count: 574 }),
      expect.objectContaining({ id: '001902', heading: 'ALL DISCIPLINE', measure: 'students', count: 31 }),
      expect.objectContaining({ id: '001902', heading: 'ALL DISCIPLINE', measure: 'actions', count: 42 }),
      expect.objectContaining({ id: '001902', section: 'H-REASON INCIDENT COUNTS', measure: 'incidents', count: 40 }),
    ])
  })

  it('preserves campus and district identifiers and strips only repeated suffix ids from names', () => {
    const rows = parseDisciplineReport(
      report({ level: 'campus', rows: entityRows({ level: 'campus', id: '001902001', name: 'Cayuga, "Central" H S' }) }),
      { year: '2020-21', level: 'campus' }
    )
    expect(rows[0]).toMatchObject({
      id: '001902001',
      districtId: '001902',
      name: 'Cayuga, "Central" H S',
      districtName: 'Example ISD',
      region: '07',
    })
  })

  it('retains TEA mask tokens as suppressed missing values, never zero or a midpoint', () => {
    const values = [
      ['B-DISCIPLINE DATA', 'MASKED -999', 'STUDENT COUNTS', '-999'],
      ['B-DISCIPLINE DATA', 'MASKED RANGE', 'ACTION COUNTS', '< 10'],
      ['H-REASON INCIDENT COUNTS', 'MASKED RANGE 20', 'INCIDENT COUNTS', '<20'],
      ['B-DISCIPLINE DATA', 'MASKED LARGE RANGE', 'ACTION COUNTS', '<3,110'],
      ['B-DISCIPLINE DATA', 'ACTUAL ZERO', 'ACTION COUNTS', '0'],
      ['B-DISCIPLINE DATA', 'NOT REPORTED', 'STUDENT COUNTS', ''],
    ]
    const rows = parseDisciplineReport(report({ rows: entityRows({ level: 'district', id: '001902', values }) }), {
      year: '2020-21',
      level: 'district',
    })
    expect(rows.map(({ count, status, mask }) => ({ count, status, mask }))).toEqual([
      { count: null, status: 'suppressed', mask: '-999' },
      { count: null, status: 'suppressed', mask: '<10' },
      { count: null, status: 'suppressed', mask: '<20' },
      { count: null, status: 'suppressed', mask: '<3,110' },
      { count: 0, status: 'reported', mask: null },
      { count: null, status: 'not-reported', mask: null },
    ])
  })

  it('rejects unknown negative values, decimals, and invented measure types', () => {
    const one = (indicator, value) =>
      report({
        rows: entityRows({
          level: 'district',
          id: '001902',
          values: [['B-DISCIPLINE DATA', 'ALL DISCIPLINE', indicator, value]],
        }),
      })
    expect(() => parseDisciplineReport(one('STUDENT COUNTS', '-1'), { year: '2020-21', level: 'district' })).toThrow(
      /unexpected negative count/
    )
    expect(() => parseDisciplineReport(one('STUDENT COUNTS', '12.5'), { year: '2020-21', level: 'district' })).toThrow(
      /invalid count/
    )
    expect(() => parseDisciplineReport(one('DISCIPLINE RATE', '12'), { year: '2020-21', level: 'district' })).toThrow(
      /unknown indicator/
    )
  })

  it('strictly validates year title, aggregation, ids, repeated campus metadata, and headers', () => {
    expect(() =>
      parseDisciplineReport(report().replace('2020-2021', '2019-2020'), { year: '2020-21', level: 'district' })
    ).toThrow(/missing "PEIMS Discipline Data for 2020-2021"/)
    expect(() =>
      parseDisciplineReport(report().replace('DISTRICT SUMMARY', 'CAMPUS SUMMARY'), {
        year: '2020-21',
        level: 'district',
      })
    ).toThrow(/aggregation "CAMPUS SUMMARY"/)
    expect(() =>
      parseDisciplineReport(report({ rows: entityRows({ level: 'district', id: '1902' }) }), {
        year: '2020-21',
        level: 'district',
      })
    ).toThrow(/invalid district id/)
    const mismatchedCampus = report({ level: 'campus' }).replaceAll('Example School 001902001', 'Example School 001902002')
    expect(() => parseDisciplineReport(mismatchedCampus, { year: '2020-21', level: 'campus' })).toThrow(
      /repeats campus id 001902002/
    )
    const missing = report({ header: ['AGGREGATION LEVEL', 'REGION', 'DISTNAME', 'DISTRICT'] })
    expect(() => parseDisciplineReport(missing, { year: '2020-21', level: 'district' })).toThrow(/header is missing/)
  })

  it('collapses identical duplicates and fails conflicting duplicates', () => {
    const base = entityRows({ level: 'district', id: '001902' })
    expect(parseDisciplineReport(report({ rows: [...base, base[0]] }), { year: '2020-21', level: 'district' })).toHaveLength(4)
    expect(() =>
      parseDisciplineReport(
        report({ rows: [...base, { ...base[0], value: '575' }] }),
        { year: '2020-21', level: 'district' }
      )
    ).toThrow(/conflicting duplicate discipline row/)
  })

  it('inspects schema and suppression coverage without returning row objects', () => {
    const stats = inspectDisciplineReport(report(), { year: '2020-21', level: 'district' })
    expect(stats).toMatchObject({
      rows: 4,
      entities: 1,
      measures: { students: 2, actions: 1, incidents: 1 },
      statuses: { reported: 4, suppressed: 0, 'not-reported': 0 },
      dimensions: 4,
    })
    expect(stats.dimensionsSha256).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('discipline snapshot selection and provenance', () => {
  it('selects the newest complete real date', () => {
    const complete = new Set(['2026-08-23', '2026-08-24'])
    expect(
      latestDisciplineSnapshot(['2026-08-23', '2026-08-24', '2026-99-99', 'notes'], (name) => complete.has(name))
    ).toBe('2026-08-24')
    expect(() => latestDisciplineSnapshot(['notes'])).toThrow(/no complete discipline snapshot/)
  })

  it('records exact GET provenance and hashes the raw response bytes', () => {
    const source = DISCIPLINE_SOURCES[0]
    const body = Buffer.from(report({ year: source.year, level: source.level }))
    const stats = inspectDisciplineReport(body.toString('utf8'), source)
    const manifest = buildDisciplineManifest([{ source, body, stats }], '2026-08-24T12:00:00.000Z')
    const entry = manifest.files[source.key]
    expect(entry.sha256).toBe(createHash('sha256').update(body).digest('hex'))
    expect(entry.bytes).toBe(body.length)
    expect(entry.request).toEqual(disciplineRequest(source))
    expect(entry.request).toMatchObject({ method: 'GET', url: DISCIPLINE_BROKER_URL })
    expect(entry.request.query).toMatchObject({
      _service: 'marykay',
      _program: 'adhoc.download_static_summary.sas',
      agg_level: 'allDISTRICT',
      school_yr: '21',
      report_type: 'csv',
      Download_All_Districts_Summaries: 'Next',
    })
  })
})

describe('fetch, verify, and load discipline snapshots', () => {
  it('archives all ten reports, verifies their semantics, and supports memory-bounded filtering', async () => {
    const root = await scratchDir()
    const calls = []
    const fetchImpl = vi.fn(async (url, options) => {
      const query = Object.fromEntries(url.searchParams)
      calls.push({ url: url.origin + url.pathname, method: options.method, query })
      const source = DISCIPLINE_SOURCES.find(
        (candidate) => candidate.schoolYear === query.school_yr && candidate.aggregation === query.agg_level
      )
      const body = Buffer.from(fullReport(source))
      return { ok: true, status: 200, headers: { get: () => null }, arrayBuffer: async () => body }
    })

    const { dir, manifest } = await fetchDiscipline({
      date: new Date('2026-08-24T12:00:00.000Z'),
      root,
      fetchImpl,
      log: () => {},
    })
    expect(calls).toHaveLength(10)
    expect(calls.every((call) => call.url === DISCIPLINE_BROKER_URL && call.method === 'GET')).toBe(true)
    expect(Object.keys(manifest.files)).toHaveLength(10)
    expect(existsSync(join(dir, 'manifest.json'))).toBe(true)

    const verified = await verifyDisciplineSnapshot(dir)
    expect(verified).toMatchObject({ checked: 10, problems: [] })

    const rows = await loadDisciplineRows(dir, { filter: (row) => row.section === 'B-DISCIPLINE DATA' })
    expect(rows).toHaveLength(DISCIPLINE_SOURCES.reduce((sum, source) => sum + source.minEntities * 2, 0))
    expect(rows[0]).toMatchObject({ year: '2020-21', level: 'campus', id: '000000001', measure: 'actions', count: 42 })
    expect(rows.find((row) => row.year === '2024-25' && row.level === 'district' && row.id === '000001')).toMatchObject({
      heading: 'ALL DISCIPLINE',
      status: 'reported',
    })
  }, 30_000)

  it('removes a stale manifest before a failed refresh', async () => {
    const root = await scratchDir()
    const dir = join(root, '2026-08-24')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'manifest.json'), '{"stale":true}')
    const tiny = Buffer.from(report())
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      arrayBuffer: async () => tiny,
    })
    await expect(
      fetchDiscipline({ date: new Date('2026-08-24T12:00:00.000Z'), root, fetchImpl, log: () => {} })
    ).rejects.toThrow(/below completeness floor/)
    expect(existsSync(join(dir, 'manifest.json'))).toBe(false)
  })

  it('reports raw-response tampering and missing expected reports', async () => {
    const root = await scratchDir()
    const source = DISCIPLINE_SOURCES[0]
    const body = Buffer.from(fullReport(source))
    const stats = inspectDisciplineReport(body.toString('utf8'), source)
    const manifest = buildDisciplineManifest([{ source, body, stats }], '2026-08-24T12:00:00.000Z')
    await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest))
    await writeFile(join(root, source.file), gzipSync(Buffer.from(`${body.toString('utf8')}tampered`)))
    const verified = await verifyDisciplineSnapshot(root)
    expect(verified.problems.some((problem) => problem.includes('sha256'))).toBe(true)
    expect(verified.problems.some((problem) => problem.includes('manifest does not describe 2020-21-campus'))).toBe(true)
  })

  it('names a missing report while loading instead of returning a partial history', async () => {
    const dir = await scratchDir()
    await expect(loadDisciplineRows(dir)).rejects.toThrow(/2020-21-district\.csv\.gz/)
  })
})
