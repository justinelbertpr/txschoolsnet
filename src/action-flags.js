// Actionable campus notices from two official TEA publications:
//   * 2026 Schools Identified for Improvement (CSI, TSI and ATS)
//   * the final 2026-27 Public Education Grant list
//
// These are statuses and family rights, not scores. A campus can be absent
// because it was not identified; absence never becomes a positive rating.

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { gzipSync, gunzipSync } from 'node:zlib'
import { xlsxRows } from './xlsx.js'

export const ACTION_ROOT = 'data/action-flags'
export const ACTION_LANDING_URL =
  'https://tea2.tea.texas.gov/school-district-leaders/reporting-and-accountability'
export const IMPROVEMENT_URL =
  'https://tea2.tea.texas.gov/school-and-district-leaders/accountability/academic-accountability/performance-reporting/2026-schools-identified-for-improvement.xlsx'
export const PEG_URL =
  'https://tea.texas.gov/texas-schools/accountability/academic-accountability/performance-reporting/peg-list-2025-final.pdf'
export const PEG_PROGRAM_URL =
  'https://tea.texas.gov/school-and-district-leaders/accountability/academic-accountability/performance-reporting/public-education-grant'

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const clean = (value) => String(value ?? '').trim().replace(/\s+/g, ' ')

function campusId(value, where) {
  const digits = clean(value)
  if (!/^\d{9}$/.test(digits)) throw new Error(`${where}: invalid campus number ${JSON.stringify(value)}`)
  return digits
}

const columnMap = (header, required, where) => {
  const names = header.map(clean)
  const out = {}
  for (const name of required) {
    const indexes = names.flatMap((value, i) => (value === name ? [i] : []))
    if (indexes.length !== 1) throw new Error(`${where}: expected one ${name} column, found ${indexes.length}`)
    out[name] = indexes[0]
  }
  return out
}

/** Parse the three worksheet row arrays returned by xlsxRows(). */
export function parseImprovementSheets(sheets) {
  const kinds = ['CSI', 'TSI', 'ATS']
  const required = [
    'District Number',
    'District Name',
    'Campus Number',
    'Campus Name',
    'Support Label',
    'Identification Reason',
    'Track Year',
    'Title I Status',
  ]
  const rows = []
  const seen = new Set()
  for (const kind of kinds) {
    const sheet = sheets?.[kind]
    if (!Array.isArray(sheet) || sheet.length < 1) throw new Error(`2026 improvement workbook: ${kind} sheet is empty`)
    const at = columnMap(sheet[0], required, `${kind} header`)
    for (let i = 1; i < sheet.length; i++) {
      const row = sheet[i]
      if (!row?.some((value) => clean(value))) continue
      const id = campusId(row[at['Campus Number']], `${kind} row ${i + 1}`)
      if (seen.has(id)) throw new Error(`2026 improvement workbook: campus ${id} appears in more than one sheet`)
      seen.add(id)
      const districtId = clean(row[at['District Number']])
      if (!/^\d{6}$/.test(districtId) || id.slice(0, 6) !== districtId) {
        throw new Error(`${kind} row ${i + 1}: campus ${id} does not belong to district ${districtId}`)
      }
      const track = clean(row[at['Track Year']])
      if (track && !/^\d+$/.test(track)) throw new Error(`${kind} row ${i + 1}: invalid track year ${track}`)
      rows.push({
        id,
        districtId,
        year: '2026',
        kind,
        supportLabel: clean(row[at['Support Label']]),
        reason: clean(row[at['Identification Reason']]),
        trackYear: track ? Number(track) : null,
        titleI: clean(row[at['Title I Status']]) === 'Title I',
      })
    }
  }
  if (rows.length < 100) throw new Error(`2026 improvement workbook returned only ${rows.length} campuses`)
  return rows.sort((a, b) => a.id.localeCompare(b.id))
}

/**
 * Parse text extracted from TEA's final PEG PDF. Names are deliberately not
 * reconstructed from PDF spacing; campus id is the stable join and the local
 * directory supplies the current human-readable name.
 */
export function parsePegText(text) {
  const source = String(text ?? '')
  if (!/2026\s*[-–]\s*2027 Public Education Grant/i.test(source) || !/Final/i.test(source)) {
    throw new Error('PEG text is not the final 2026-27 TEA list')
  }
  const ids = [...new Set(source.match(/\b\d{9}\b/g) ?? [])].sort()
  if (ids.length < 100) throw new Error(`final 2026-27 PEG list returned only ${ids.length} campus ids`)
  return ids.map((id) => ({ id, schoolYear: '2026-27', final: true }))
}

export function mergeActionFlags({ improvement, peg }) {
  const out = new Map()
  for (const row of improvement ?? []) out.set(row.id, { id: row.id, improvement: row, peg: null })
  for (const row of peg ?? []) {
    const rec = out.get(row.id) ?? { id: row.id, improvement: null, peg: null }
    rec.peg = row
    out.set(row.id, rec)
  }
  return [...out.values()].sort((a, b) => a.id.localeCompare(b.id))
}

export function latestActionSnapshot(names, hasManifest = () => true) {
  const dirs = (names ?? []).filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name) && hasManifest(name)).sort()
  if (!dirs.length) throw new Error('no action-flags snapshot found — run `npm run fetch:public`')
  return dirs.at(-1)
}

export async function loadActionFlags(dir) {
  const body = gunzipSync(await readFile(`${dir}/action-flags.json.gz`)).toString('utf8')
  const rows = JSON.parse(body)
  if (!Array.isArray(rows) || rows.length < 100) throw new Error(`${dir}: action-flags.json.gz is incomplete`)
  return rows
}

export async function verifyActionSnapshot(dir) {
  const problems = []
  let manifest
  try {
    manifest = JSON.parse(await readFile(`${dir}/manifest.json`, 'utf8'))
  } catch (error) {
    return { dir, checked: 0, problems: [`manifest: ${error.message}`], fetchedAt: null }
  }
  let checked = 0
  for (const file of ['improvement.xlsx', 'peg-final.pdf', 'action-flags.json.gz']) {
    try {
      const bytes = await readFile(`${dir}/${file}`)
      checked++
      if (sha256(bytes) !== manifest.files?.[file]?.sha256) problems.push(`${file}: checksum mismatch`)
    } catch (error) {
      problems.push(`${file}: ${error.message}`)
    }
  }
  try {
    const rows = await loadActionFlags(dir)
    if (rows.length !== manifest.rows) problems.push(`row count ${rows.length} does not match manifest ${manifest.rows}`)
  } catch (error) {
    problems.push(error.message)
  }
  if (manifest.sources?.improvement !== IMPROVEMENT_URL || manifest.sources?.peg !== PEG_URL) {
    problems.push('manifest source URLs do not match the official publications')
  }
  return { dir, checked, problems, fetchedAt: manifest.fetchedAt ?? null }
}

/**
 * Fetch and normalize. PDF text extraction is injected because Node has no PDF
 * text API; the CLI supplies a clear error unless a maintainer provides one.
 */
export async function fetchActionFlags({
  date = new Date().toISOString().slice(0, 10),
  root = ACTION_ROOT,
  fetchImpl = fetch,
  extractPdfText = null,
  log = console.log,
} = {}) {
  if (typeof extractPdfText !== 'function') {
    throw new Error('fetchActionFlags requires extractPdfText(pdfBuffer); use the repository refresh helper')
  }
  const dir = `${root}/${date}`
  await mkdir(dir, { recursive: true })
  const get = async (url) => {
    const response = await fetchImpl(url, { headers: { 'User-Agent': 'txschools.net data refresh (+https://txschools.net/about)' } })
    if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`)
    return Buffer.from(await response.arrayBuffer())
  }
  const [workbook, pdf] = await Promise.all([get(IMPROVEMENT_URL), get(PEG_URL)])
  await Promise.all([
    writeFile(`${dir}/improvement.xlsx`, workbook),
    writeFile(`${dir}/peg-final.pdf`, pdf),
  ])
  const [csi, tsi, ats, pegText] = await Promise.all([
    xlsxRows(`${dir}/improvement.xlsx`, 1),
    xlsxRows(`${dir}/improvement.xlsx`, 2),
    xlsxRows(`${dir}/improvement.xlsx`, 3),
    extractPdfText(pdf),
  ])
  const improvement = parseImprovementSheets({ CSI: csi, TSI: tsi, ATS: ats })
  const peg = parsePegText(pegText)
  const rows = mergeActionFlags({ improvement, peg })
  const normalized = gzipSync(Buffer.from(JSON.stringify(rows)), { level: 9 })
  await writeFile(`${dir}/action-flags.json.gz`, normalized)
  const files = {
    'improvement.xlsx': { bytes: workbook.length, sha256: sha256(workbook) },
    'peg-final.pdf': { bytes: pdf.length, sha256: sha256(pdf) },
    'action-flags.json.gz': { bytes: normalized.length, sha256: sha256(normalized) },
  }
  await writeFile(
    `${dir}/manifest.json`,
    JSON.stringify(
      {
        fetchedAt: new Date().toISOString(),
        rows: rows.length,
        improvementRows: improvement.length,
        pegRows: peg.length,
        sources: { landing: ACTION_LANDING_URL, improvement: IMPROVEMENT_URL, peg: PEG_URL, pegProgram: PEG_PROGRAM_URL },
        files,
      },
      null,
      2
    ) + '\n'
  )
  log(`action flags: ${improvement.length} improvement statuses; ${peg.length} final PEG campuses`)
  return { dir, rows }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const names = existsSync(ACTION_ROOT) ? await readdir(ACTION_ROOT) : []
  const latest = names.length ? latestActionSnapshot(names, (name) => existsSync(`${ACTION_ROOT}/${name}/manifest.json`)) : null
  if (latest) console.log(`Latest archived action-flags snapshot: ${ACTION_ROOT}/${latest}`)
  else console.error('No archived action-flags snapshot. Run the repository public-data refresh helper.')
}
