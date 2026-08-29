import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  ACCOUNTABILITY_KEYS, ACCOUNTABILITY_SOURCES, accountabilityUrl,
  fetchAccountability, latestAccountabilityArchive, normalizeAccountabilityContext, parseAccountabilitySummary, verifyAccountabilitySnapshot,
} from '../src/accountability.js'

const headers = {
  district: ['DISTRICT', 'DISTNAME', 'D_RATING', 'DPETALLC', 'DPETLEPC', 'DPETECOC', 'DPETSPEC'],
  campus: ['CAMPUS', 'CAMPNAME', 'DISTRICT', 'DISTNAME', 'C_RATING', 'CPETALLC', 'CPETLEPC', 'CPETECOC', 'CPETSPEC'],
}

function csv(source, count = 1) {
  const variables = headers[source.level]
  const lines = [variables.map((value) => `Label ${value}`).join(','), variables.join(',')]
  for (let i = 1; i <= count; i++) {
    const district = String(i).padStart(6, '0')
    const campus = `${district}${String((i % 999) + 1).padStart(3, '0')}`
    const values = source.level === 'district'
      ? [district, `District ${i}`, i === 1 ? 'Not Rated' : 'B', '0', '*', '52.6', '-']
      : [campus, `Campus ${i}`, district, `District ${i}`, 'B', '100', '*', '41.2', '-']
    lines.push(values.join(','))
  }
  return `${lines.join('\n')}\n`
}

const response = (body, status = 200, extraHeaders = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => extraHeaders[name.toLowerCase()] ?? null },
  arrayBuffer: async () => Buffer.from(body),
})

describe('official accountability bulk ingestion', () => {
  it('is optional before the first complete snapshot exists', async () => {
    const root = join(await mkdtemp(join(tmpdir(), 'no-accountability-')), 'missing')
    expect(await latestAccountabilityArchive(root)).toBeNull()
  })
  it('builds the exact bulk request with repeated ordered key parameters', () => {
    const url = new URL(accountabilityUrl(ACCOUNTABILITY_SOURCES[0]))
    expect(url.searchParams.get('sumlev')).toBe('D')
    expect(url.searchParams.getAll('key')).toEqual(ACCOUNTABILITY_KEYS)
    expect([...url.searchParams.keys()].at(-1)).toBe('prgopt')
    expect(url.searchParams.get('prgopt')).toBe('reports/acct/dd/dd_get_data.sas')
  })

  it('preserves identifiers, true zeroes, masking tokens, and variable codes', () => {
    const parsed = parseAccountabilitySummary(csv(ACCOUNTABILITY_SOURCES[0]), ACCOUNTABILITY_SOURCES[0])
    expect(parsed.rows[0]).toMatchObject({ id: '000001', level: 'district', accountabilityYear: 2026 })
    expect(parsed.rows[0].values).toMatchObject({ DPETALLC: '0', DPETLEPC: '*', DPETECOC: '52.6', DPETSPEC: '-' })
    expect(parsed.variables).toEqual(headers.district)
  })

  it('rejects HTML, malformed widths, invalid IDs, and conflicting duplicates', () => {
    const source = ACCOUNTABILITY_SOURCES[0]
    expect(() => parseAccountabilitySummary('<html>busy</html>', source)).toThrow(/HTML/)
    expect(() => parseAccountabilitySummary(csv(source).replace('0,\*,52.6,-', '0,*'), source)).toThrow(/columns/)
    expect(() => parseAccountabilitySummary(csv(source).replace('000001,District', '1,District'), source)).toThrow(/invalid DISTRICT/)
    expect(() => parseAccountabilitySummary(`${csv(source).trim()}\n000001,Other,B,0,*,52.6,-\n`, source)).toThrow(/conflicting duplicate/)
  })

  it('normalizes novel context without confusing zero, masking, and non-reporting', () => {
    const context = normalizeAccountabilityContext({
      id: '001902001', level: 'campus', values: {
        CPETALLC: '195', CPETLEPC: '*', CPETECOC: '85', CPETSPEC: '', CPE0312C: '195',
        CPETLEPP: '*', CPETSPEP: '', CPE0312P: '100', CPETECHC: '0', CPETECHP: '0',
        CPETPTEC: '-', CPETPTEP: '•', CPEMALLC: '20', CPEMALLT: '203', CPEMALLP: '9.9',
        CFLCHART: 'N', CFLEEK: '', CFLNEWCAMP: 'Y', CFLAEC: 'N', CFLAEATYPE: 'RESIDENTIAL FACILITY',
        CFLG3NOTNEW: 'N', CFLDAEP: 'N', CFLJJ: 'N', CFLALTED: 'N', CFLRTF: 'Y', CFLSUBG: 'N',
      },
    })
    expect(context.students.emergentBilingual).toEqual({ value: null, status: 'masked-small', raw: '*' })
    expect(context.students.specialEducation).toEqual({ value: null, status: 'not-reported', raw: null })
    expect(context.programs.earlyCollegeHighSchool.count).toEqual({ value: 0, status: 'reported', raw: '0' })
    expect(context.programs.pathwaysInTechnologyEarlyCollegeHighSchool.count).toEqual({ value: null, status: 'not-available', raw: '-' })
    expect(context.programs.pathwaysInTechnologyEarlyCollegeHighSchool.sharePct).toEqual({ value: null, status: 'not-available', raw: '•' })
    expect(context.mobility).toMatchObject({ year: '2024-25', mobileStudents: { value: 20 }, ratePct: { value: 9.9 } })
    expect(context.flags).toMatchObject({ charterSchool: { value: false }, newCampus: { value: true }, alternativeEducationType: { value: 'residential-facility' } })
  })

  it('implements TEA download masks without treating unavailable data as a FERPA mask', () => {
    const context = normalizeAccountabilityContext({ id: '000001', level: 'district', values: {
      DPETALLC: '-1', DPETLEPC: '-3', DPETECOC: '•', DPETSPEC: '-', DPE0312C: '',
      DPETLEPP: '*', DPETSPEP: '**', DPE0312P: 'N/A', DPETECHC: '0', DPETECHP: '0',
      DPETPTEC: '0', DPETPTEP: '0', DFLRTF: 'N', DFLNEWDIST: 'N', DFLNEWCHARTDIST: 'N', DFLSUBG: 'N',
    } })
    expect(context.students.all).toEqual({ value: null, status: 'masked-small', raw: '-1' })
    expect(context.students.emergentBilingual).toEqual({ value: null, status: 'masked-complementary', raw: '-3' })
    expect(context.students.economicallyDisadvantaged).toEqual({ value: null, status: 'not-available', raw: '•' })
    expect(context.students.specialEducation).toEqual({ value: null, status: 'not-available', raw: '-' })
    expect(context.students.grades3to12).toEqual({ value: null, status: 'not-reported', raw: null })
    expect(context.shares.emergentBilingualPct.status).toBe('masked-small')
    expect(context.shares.specialEducationPct.status).toBe('masked-complementary')
    expect(context.shares.grades3to12Pct.status).toBe('not-available')
  })

  it('strictly rejects impossible percentages, fractional counts, and unknown flags', () => {
    const base = { id: '000001', level: 'district', values: {
      DPETALLC: '1', DPETLEPC: '1', DPETECOC: '1', DPETSPEC: '1', DPE0312C: '1', DPETLEPP: '1', DPETSPEP: '1', DPE0312P: '1',
      DPETECHC: '1', DPETECHP: '1', DPETPTEC: '1', DPETPTEP: '1', DFLRTF: 'N', DFLNEWDIST: 'N', DFLNEWCHARTDIST: 'N', DFLSUBG: 'N',
    } }
    expect(() => normalizeAccountabilityContext({ ...base, values: { ...base.values, DPETALLC: '1.5' } })).toThrow(/DPETALLC/)
    expect(() => normalizeAccountabilityContext({ ...base, values: { ...base.values, DPETLEPP: '101' } })).toThrow(/DPETLEPP/)
    expect(() => normalizeAccountabilityContext({ ...base, values: { ...base.values, DFLRTF: 'MAYBE' } })).toThrow(/DFLRTF/)
  })

  it('retries throttling, writes both raw reports, then writes a verifiable manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'accountability-'))
    const bodies = new Map(ACCOUNTABILITY_SOURCES.map((source) => [source.sumlev, csv(source, source.minRows)]))
    let calls = 0
    const sleeps = []
    const fetchImpl = async (url) => {
      calls++
      if (calls === 1) return response('', 429, { 'retry-after': '2' })
      const level = new URL(url).searchParams.get('sumlev')
      return response(bodies.get(level), 200, { etag: `"${level}"` })
    }
    const { dir, manifest } = await fetchAccountability({
      date: new Date('2026-08-28T12:00:00Z'), root, fetchImpl,
      sleep: async (ms) => sleeps.push(ms), random: () => 0, log: () => {},
    })
    expect(calls).toBe(3)
    expect(sleeps).toEqual([2000, 10000])
    expect(Object.keys(manifest.files)).toEqual(ACCOUNTABILITY_SOURCES.map((source) => source.key))
    expect(JSON.parse(await readFile(`${dir}/manifest.json`, 'utf8')).schemaVersion).toBe(1)
    expect(gunzipSync(await readFile(`${dir}/${ACCOUNTABILITY_SOURCES[0].file}`)).toString()).toBe(bodies.get('D'))
    expect(await verifyAccountabilitySnapshot(dir)).toMatchObject({ checked: 2, problems: [] })

    const campusPath = `${dir}/${ACCOUNTABILITY_SOURCES[1].file}`
    await writeFile(campusPath, await readFile(`${dir}/${ACCOUNTABILITY_SOURCES[0].file}`))
    expect((await verifyAccountabilitySnapshot(dir)).problems.join('\n')).toMatch(/sha256|district-summary|campus-summary/)
  })
})
