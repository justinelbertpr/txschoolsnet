import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ENROLLMENT_BROKER_URL,
  ENROLLMENT_SOURCES,
  buildEnrollmentManifest,
  enrollmentRequest,
  fetchEnrollment,
  latestEnrollmentSnapshot,
  loadEnrollmentRows,
  parseCsv,
  parseEnrollmentReport,
  verifyEnrollmentSnapshot,
} from '../src/enrollment.js'

const scratchDirs = []
const scratchDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tea-enrollment-'))
  scratchDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(scratchDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function report({
  year = '2021-22',
  level = 'district',
  rows = [{ id: '001902', enrollment: 574, name: 'Cayuga ISD' }],
  header,
} = {}) {
  const start = Number(year.slice(0, 4))
  const idHeader = level === 'district' ? 'DISTRICT NUMBER' : 'CAMPUS NUMBER'
  const columns = header ?? ['YEAR', 'AGGREGATION LEVEL', idHeader, 'ENTITY NAME', 'ALL ENROLLMENT']
  const lines = [
    `${start}-${start + 1} Student Program and Special Populations`,
    '',
    'Total Enrollment Counts',
    '',
    `PEIMS Data ${start}-${start + 1}`,
    '',
    columns.map((cell) => `"${cell}"`).join(','),
  ]
  for (const row of rows) {
    const values = {
      YEAR: `${start}-${start + 1}`,
      'AGGREGATION LEVEL': level.toUpperCase(),
      [idHeader]: row.id,
      'ENTITY NAME': `"${String(row.name ?? 'Example').replaceAll('"', '""')}"`,
      'ALL ENROLLMENT': row.enrollment ?? '',
    }
    lines.push(columns.map((column) => values[column] ?? '').join(','))
  }
  return `${lines.join('\r\n')}\r\n`
}

function fullReport(source) {
  const digits = source.level === 'district' ? 6 : 9
  const rows = Array.from({ length: source.minRows }, (_, i) => ({
    id: String(i + 1).padStart(digits, '0'),
    enrollment: 100 + i,
    name: `${source.level} ${i + 1}`,
  }))
  return report({ year: source.year, level: source.level, rows })
}

describe('parseCsv', () => {
  it('handles quoted commas, escaped quotes, embedded newlines, and CRLF', () => {
    expect(parseCsv('a,"b,b","said ""hello""","two\nlines"\r\n1,2,3,4\r\n')).toEqual([
      ['a', 'b,b', 'said "hello"', 'two\nlines'],
      ['1', '2', '3', '4'],
    ])
  })

  it('rejects malformed quoting instead of silently shifting columns', () => {
    expect(() => parseCsv('a,"unterminated')).toThrow(/unterminated quoted field/)
    expect(() => parseCsv('a,"done"oops')).toThrow(/after closing quote/)
  })
})

describe('parseEnrollmentReport', () => {
  it('finds the header after TEA preamble lines and preserves zero-padded ids', () => {
    const text = report({
      rows: [{ id: '001902', enrollment: 574, name: 'Cayuga, "Central" ISD' }],
    })
    expect(parseEnrollmentReport(text, { year: '2021-22', level: 'district' })).toEqual([
      { id: '001902', level: 'district', year: '2021-22', enrollment: 574 },
    ])
  })

  it('ignores TEA’s two FERPA footer notes but still rejects an arbitrary short row', () => {
    const footer =
      "\r\n'-999' and ranges (e.g. <10 and <20) indicate counts are not available (i.e. masked) to comply with FERPA.\r\n\r\n" +
      'Masked numbers are typically small although larger numbers may be masked to prevent imputation.\r\n'
    expect(parseEnrollmentReport(report() + footer, { year: '2021-22', level: 'district' })).toHaveLength(1)
    expect(() =>
      parseEnrollmentReport(report() + '\r\nnot,a,valid,row\r\n', {
        year: '2021-22',
        level: 'district',
      })
    ).toThrow(/has 4 columns; header has 5/)
  })

  it('maps TEA masking sentinels and blank values to missing, never zero', () => {
    const text = report({
      rows: [
        { id: '001902', enrollment: '-999' },
        { id: '001903', enrollment: '-9999999' },
        { id: '001904', enrollment: null },
        { id: '001905', enrollment: 0 },
        { id: '001906', enrollment: '<10' },
        { id: '001907', enrollment: '<20' },
        { id: '001908', enrollment: 'N/A' },
      ],
    })
    expect(parseEnrollmentReport(text, { year: '2021-22', level: 'district' }).map((row) => row.enrollment)).toEqual([
      null,
      null,
      null,
      0,
      null,
      null,
      null,
    ])
  })

  it('rejects unknown negatives and non-integer counts', () => {
    expect(() =>
      parseEnrollmentReport(report({ rows: [{ id: '001902', enrollment: '-1' }] }), {
        year: '2021-22',
        level: 'district',
      })
    ).toThrow(/unexpected negative ALL ENROLLMENT/)
    expect(() =>
      parseEnrollmentReport(report({ rows: [{ id: '001902', enrollment: '12.5' }] }), {
        year: '2021-22',
        level: 'district',
      })
    ).toThrow(/invalid ALL ENROLLMENT/)
  })

  it('strictly validates year, aggregation level, id width, and required headers', () => {
    const wrongYear = report().replaceAll('2021-2022', '2020-2021')
    expect(() => parseEnrollmentReport(wrongYear, { year: '2021-22', level: 'district' })).toThrow(
      /reports year "2020-2021"/
    )

    const wrongLevel = report().replace(',DISTRICT,', ',CAMPUS,')
    expect(() => parseEnrollmentReport(wrongLevel, { year: '2021-22', level: 'district' })).toThrow(
      /aggregation level "CAMPUS"/
    )

    expect(() =>
      parseEnrollmentReport(report({ rows: [{ id: '1902', enrollment: 574 }] }), {
        year: '2021-22',
        level: 'district',
      })
    ).toThrow(/expected 6 digits/)

    const missing = report({ header: ['YEAR', 'AGGREGATION LEVEL', 'DISTRICT NUMBER', 'ENTITY NAME'] })
    expect(() => parseEnrollmentReport(missing, { year: '2021-22', level: 'district' })).toThrow(
      /header is missing.*ALL ENROLLMENT/
    )
  })

  it('rejects nonblank rows whose width does not match the header', () => {
    const text = `${report().trimEnd()}\r\nnot,a,valid,row\r\n`
    expect(() => parseEnrollmentReport(text, { year: '2021-22', level: 'district' })).toThrow(
      /has 4 columns; header has 5/
    )
  })

  it('collapses identical duplicates but fails conflicting entity-year counts', () => {
    const same = report({
      rows: [
        { id: '001902', enrollment: 574 },
        { id: '001902', enrollment: 574 },
      ],
    })
    expect(parseEnrollmentReport(same, { year: '2021-22', level: 'district' })).toHaveLength(1)

    const conflict = report({
      rows: [
        { id: '001902', enrollment: 574 },
        { id: '001902', enrollment: 575 },
      ],
    })
    expect(() => parseEnrollmentReport(conflict, { year: '2021-22', level: 'district' })).toThrow(
      /conflicting duplicate 001902/
    )
  })
})

describe('enrollment snapshot selection and provenance', () => {
  it('selects the newest real date with a manifest, skipping partial and malformed directories', () => {
    const complete = new Set(['2026-08-23', '2026-08-24'])
    expect(
      latestEnrollmentSnapshot(
        ['2026-08-23', '2026-08-24', '2026-08-25', '2026-99-99', 'notes'],
        (name) => complete.has(name)
      )
    ).toBe('2026-08-24')
  })

  it('throws when no complete snapshot exists', () => {
    expect(() => latestEnrollmentSnapshot(['2026-08-24'], () => false)).toThrow(/no complete enrollment snapshot/)
  })

  it('records hashes of raw response bytes and the exact official POST request', () => {
    const source = ENROLLMENT_SOURCES[0]
    const body = Buffer.from(report({ year: source.year, level: source.level }))
    const manifest = buildEnrollmentManifest([{ source, body, rows: 1 }], '2026-08-24T12:00:00.000Z')
    const entry = manifest.files[source.key]
    expect(entry.sha256).toBe(createHash('sha256').update(body).digest('hex'))
    expect(entry.bytes).toBe(body.length)
    expect(entry.rows).toBe(1)
    expect(entry.request).toEqual(enrollmentRequest(source))
    expect(entry.request.url).toBe(ENROLLMENT_BROKER_URL)
    expect(entry.request.form).toMatchObject({
      _service: 'marykay',
      _program: 'adhoc.std_driver1.sas',
      RptClass: 'StudPgm',
      SchoolYr: '22',
      report: 'StateDistrict',
      format: 'csv',
    })
  })
})

describe('fetch, verify, and load enrollment snapshots', () => {
  it('archives all ten raw reports, writes the manifest last, verifies them, and loads canonical rows', async () => {
    const root = await scratchDir()
    const calls = []
    const fetchImpl = vi.fn(async (url, options) => {
      const form = Object.fromEntries(options.body)
      calls.push({ url, method: options.method, form })
      const source = ENROLLMENT_SOURCES.find(
        (candidate) => candidate.schoolYear === form.SchoolYr && candidate.report === form.report
      )
      const body = Buffer.from(fullReport(source))
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        arrayBuffer: async () => body,
      }
    })

    const { dir, manifest } = await fetchEnrollment({
      date: new Date('2026-08-24T12:00:00.000Z'),
      root,
      fetchImpl,
      log: () => {},
    })

    expect(calls).toHaveLength(10)
    expect(calls.every((call) => call.url === ENROLLMENT_BROKER_URL && call.method === 'POST')).toBe(true)
    expect(Object.keys(manifest.files)).toHaveLength(10)
    expect(existsSync(join(dir, 'manifest.json'))).toBe(true)

    const verified = await verifyEnrollmentSnapshot(dir)
    expect(verified.checked).toBe(10)
    expect(verified.problems).toEqual([])

    const rows = await loadEnrollmentRows(dir)
    expect(rows).toHaveLength(ENROLLMENT_SOURCES.reduce((sum, source) => sum + source.minRows, 0))
    expect(rows[0]).toMatchObject({ id: '000000001', level: 'campus', year: '2021-22', enrollment: 100 })
    expect(rows.find((row) => row.id === '000001' && row.level === 'district' && row.year === '2021-22')).toMatchObject({
      enrollment: 100,
    })
  })

  it('invalidates an old manifest before requesting data, so a failed refresh remains incomplete', async () => {
    const root = await scratchDir()
    const dir = join(root, '2026-08-24')
    // fetchEnrollment creates the dated directory before invalidating its manifest.
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
      fetchEnrollment({ date: new Date('2026-08-24T12:00:00.000Z'), root, fetchImpl, log: () => {} })
    ).rejects.toThrow(/below completeness floor/)
    expect(existsSync(join(dir, 'manifest.json'))).toBe(false)
  })

  it('reports tampering against the raw-response hash', async () => {
    const root = await scratchDir()
    const source = ENROLLMENT_SOURCES[0]
    const body = Buffer.from(fullReport(source))
    // A deliberately incomplete manifest still lets the verifier report the
    // hash mismatch for the described file alongside the nine missing sources.
    const manifest = buildEnrollmentManifest([{ source, body, rows: source.minRows }], '2026-08-24T12:00:00.000Z')
    await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest))
    await writeFile(join(root, source.file), gzipSync(Buffer.from(`${body.toString('utf8')}tampered`)))

    const verified = await verifyEnrollmentSnapshot(root)
    expect(verified.problems.some((problem) => problem.includes('sha256'))).toBe(true)
  })

  it('names a missing report while loading instead of returning a partial history', async () => {
    const dir = await scratchDir()
    await expect(loadEnrollmentRows(dir)).rejects.toThrow(/2021-22-district\.csv\.gz/)
  })
})
