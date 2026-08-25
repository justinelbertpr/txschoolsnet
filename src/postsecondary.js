// Following-fall Texas public higher-education outcomes from the Texas Higher
// Education Coordinating Board. The source includes only districts/high schools
// with more than 25 graduates and does not see out-of-state, private, military,
// employment or later enrollment. Those limits travel with every page value.

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { gzipSync, gunzipSync } from 'node:zlib'
import { xlsxRows } from './xlsx.js'

export const POSTSECONDARY_ROOT = 'data/postsecondary'
export const POSTSECONDARY_LANDING_URL =
  'https://www.txhighereddata.org/high-school-graduates/hsgradsenrolled/'
export const POSTSECONDARY_SOURCES = Object.freeze([
  Object.freeze({
    level: 'district',
    url: 'https://reportcenter.highered.texas.gov/hsgradsenrolled-district-2024-xls',
    file: 'district-2024.xlsx',
    minRows: 800,
  }),
  Object.freeze({
    level: 'campus',
    url: 'https://reportcenter.highered.texas.gov/hsgradsenrolled-campus-2024-xls',
    file: 'campus-2024.xlsx',
    minRows: 1200,
  }),
])

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const clean = (value) => String(value ?? '').trim().replace(/\s+/g, ' ')

const studentCount = (value, row) => {
  const text = clean(value)
  if (!/^\d+$/.test(text)) throw new Error(`THECB row ${row}: invalid student count ${JSON.stringify(value)}`)
  const n = Number(text)
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`THECB row ${row}: student count is outside the safe range`)
  return n
}

export function parsePostsecondaryRows(rows, { level }) {
  if (!['district', 'campus'].includes(level)) throw new Error(`invalid postsecondary level ${level}`)
  const header = (rows ?? []).findIndex((row) => {
    const values = row.map(clean)
    return values.includes('Code') && values.includes('Institution') && values.includes('Students')
  })
  if (header < 0) throw new Error(`THECB ${level} workbook has no Code/Institution/Students header`)
  const names = rows[header].map(clean)
  const at = (name) => {
    const indexes = names.flatMap((value, i) => (value === name ? [i] : []))
    if (indexes.length !== 1) throw new Error(`THECB ${level} header expected one ${name} column`)
    return indexes[0]
  }
  const codeAt = at('Code')
  const institutionAt = at('Institution')
  const studentsAt = at('Students')
  const idLength = level === 'district' ? 6 : 9
  const grouped = new Map()
  for (let i = header + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row?.some((value) => clean(value))) continue
    const footer = row.length === 1 ? clean(row[0]) : ''
    if (footer.startsWith('Source: THECB and TEA') || footer.startsWith('Source:  THECB and TEA') || footer.startsWith('Generated from Server\\')) continue
    const code = clean(row[codeAt])
    if (!/^\d+$/.test(code) || code.length > idLength) throw new Error(`THECB row ${i + 1}: invalid ${level} code ${code}`)
    const id = code.padStart(idLength, '0')
    const institution = clean(row[institutionAt])
    if (!institution) throw new Error(`THECB row ${i + 1}: missing institution label`)
    const students = studentCount(row[studentsAt], i + 1)
    const group = grouped.get(id) ?? { id, level, items: [] }
    group.items.push({ institution, students })
    grouped.set(id, group)
  }

  const out = []
  for (const group of grouped.values()) {
    const totals = group.items.filter((item) => /^Total high school graduates$/i.test(item.institution))
    if (totals.length !== 1) throw new Error(`THECB ${level} ${group.id}: expected one total-graduates row`)
    const graduates = totals[0].students
    if (graduates <= 25) throw new Error(`THECB ${level} ${group.id}: source included only ${graduates} graduates`)
    const valueOf = (pattern) => group.items.find((item) => pattern.test(item.institution))?.students ?? 0
    const notFound = valueOf(/^Not found$/i)
    const notTrackable = valueOf(/^Not trackable$/i)
    const institutionRows = group.items.filter(
      (item) => !/^Total high school graduates$|^Not found$|^Not trackable$/i.test(item.institution)
    )
    const enrolledPublic = institutionRows.reduce((sum, item) => sum + item.students, 0)
    if (enrolledPublic + notFound + notTrackable !== graduates) {
      throw new Error(
        `THECB ${level} ${group.id}: destinations (${enrolledPublic}) + not found (${notFound}) + not trackable (${notTrackable}) != graduates (${graduates})`
      )
    }
    const destinations = institutionRows
      .filter((item) => !/^Other Public /i.test(item.institution))
      .sort((a, b) => b.students - a.students || a.institution.localeCompare(b.institution))
      .slice(0, 3)
    out.push({
      id: group.id,
      level,
      graduateYear: '2023-24',
      fallTerm: 'Fall 2024',
      graduates,
      enrolledPublic,
      rate: Number(((enrolledPublic / graduates) * 100).toFixed(1)),
      notFound,
      notTrackable,
      destinations,
    })
  }
  const floor = POSTSECONDARY_SOURCES.find((source) => source.level === level)?.minRows ?? 1
  if (out.length < floor) throw new Error(`THECB ${level} workbook returned only ${out.length} entities`)
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

export function latestPostsecondarySnapshot(names, hasManifest = () => true) {
  const dirs = (names ?? []).filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name) && hasManifest(name)).sort()
  if (!dirs.length) throw new Error('no postsecondary snapshot found — run `npm run fetch:public`')
  return dirs.at(-1)
}

export async function loadPostsecondaryRows(dir) {
  const rows = JSON.parse(gunzipSync(await readFile(`${dir}/postsecondary.json.gz`)).toString('utf8'))
  if (!Array.isArray(rows) || rows.length < 2000) throw new Error(`${dir}: postsecondary.json.gz is incomplete`)
  return rows
}

export async function verifyPostsecondarySnapshot(dir) {
  const problems = []
  let manifest
  try {
    manifest = JSON.parse(await readFile(`${dir}/manifest.json`, 'utf8'))
  } catch (error) {
    return { dir, checked: 0, problems: [`manifest: ${error.message}`], fetchedAt: null }
  }
  let checked = 0
  for (const file of [...POSTSECONDARY_SOURCES.map((source) => source.file), 'postsecondary.json.gz']) {
    try {
      const bytes = await readFile(`${dir}/${file}`)
      checked++
      if (sha256(bytes) !== manifest.files?.[file]?.sha256) problems.push(`${file}: checksum mismatch`)
    } catch (error) {
      problems.push(`${file}: ${error.message}`)
    }
  }
  try {
    const rows = await loadPostsecondaryRows(dir)
    if (rows.length !== manifest.rows) problems.push(`row count ${rows.length} does not match manifest ${manifest.rows}`)
  } catch (error) {
    problems.push(error.message)
  }
  for (const source of POSTSECONDARY_SOURCES) {
    if (manifest.sources?.[source.level] !== source.url) problems.push(`${source.level}: source URL mismatch`)
  }
  return { dir, checked, problems, fetchedAt: manifest.fetchedAt ?? null }
}

export async function fetchPostsecondary({
  date = new Date().toISOString().slice(0, 10),
  root = POSTSECONDARY_ROOT,
  fetchImpl = fetch,
  log = console.log,
} = {}) {
  const dir = `${root}/${date}`
  await mkdir(dir, { recursive: true })
  const files = {}
  const all = []
  for (const source of POSTSECONDARY_SOURCES) {
    const response = await fetchImpl(source.url, {
      headers: { 'User-Agent': 'txschools.net data refresh (+https://txschools.net/about)' },
    })
    if (!response.ok) throw new Error(`${source.url} -> HTTP ${response.status}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    await writeFile(`${dir}/${source.file}`, bytes)
    const rows = parsePostsecondaryRows(await xlsxRows(`${dir}/${source.file}`), { level: source.level })
    all.push(...rows)
    files[source.file] = { bytes: bytes.length, sha256: sha256(bytes), rows: rows.length }
    log(`postsecondary ${source.level}: ${rows.length} entities`)
  }
  const normalized = gzipSync(Buffer.from(JSON.stringify(all)), { level: 9 })
  await writeFile(`${dir}/postsecondary.json.gz`, normalized)
  files['postsecondary.json.gz'] = { bytes: normalized.length, sha256: sha256(normalized), rows: all.length }
  const manifest = {
    fetchedAt: new Date().toISOString(),
    landing: POSTSECONDARY_LANDING_URL,
    graduateYear: '2023-24',
    fallTerm: 'Fall 2024',
    rows: all.length,
    sources: Object.fromEntries(POSTSECONDARY_SOURCES.map((source) => [source.level, source.url])),
    files,
  }
  await writeFile(`${dir}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n')
  return { dir, rows: all }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await fetchPostsecondary()
}
