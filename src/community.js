// Community context for traditional school-district boundaries from the U.S.
// Census Bureau's Small Area Income and Poverty Estimates (SAIPE). This is
// about children who live inside the geographic district, not children enrolled
// by the district. The distinction is part of every rendered explanation.

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { gzipSync, gunzipSync } from 'node:zlib'

export const COMMUNITY_ROOT = 'data/community'
export const COMMUNITY_YEAR = 2024
export const COMMUNITY_URL =
  'https://www2.census.gov/programs-surveys/saipe/datasets/2024/2024-school-districts/sd24-tx.txt'
export const COMMUNITY_LAYOUT_URL =
  'https://www2.census.gov/programs-surveys/saipe/technical-documentation/file-layouts/school-district/2024-district-layout.txt'
export const COMMUNITY_LANDING_URL =
  'https://www.census.gov/data/datasets/2024/demo/saipe/2024-school-districts.html'

const sha256 = (value) => createHash('sha256').update(value).digest('hex')

const count = (value, name, line) => {
  const text = String(value).trim()
  if (!/^\d+$/.test(text)) throw new Error(`SAIPE line ${line}: invalid ${name} ${JSON.stringify(value)}`)
  const n = Number(text)
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`SAIPE line ${line}: ${name} is outside the safe range`)
  return n
}

/** Parse Census's documented fixed-width Texas file. */
export function parseCommunityText(text, { year = COMMUNITY_YEAR } = {}) {
  const rows = []
  const seen = new Set()
  for (const [index, raw] of String(text ?? '').split(/\r?\n/).entries()) {
    if (!raw.trim()) continue
    const line = index + 1
    if (raw.length < 108) throw new Error(`SAIPE line ${line}: record is truncated`)
    const state = raw.slice(0, 2)
    const district = raw.slice(3, 8)
    if (state !== '48' || !/^\d{5}$/.test(district)) {
      throw new Error(`SAIPE line ${line}: invalid Texas district key ${JSON.stringify(raw.slice(0, 8))}`)
    }
    const geoid = `${state}${district}`
    if (seen.has(geoid)) throw new Error(`SAIPE line ${line}: duplicate district ${geoid}`)
    seen.add(geoid)
    const totalPopulation = count(raw.slice(82, 90), 'total population', line)
    const schoolAgePopulation = count(raw.slice(91, 99), 'school-age population', line)
    const schoolAgePoverty = count(raw.slice(100, 108), 'school-age poverty count', line)
    if (schoolAgePoverty > schoolAgePopulation) {
      throw new Error(`SAIPE line ${line}: poverty count exceeds the school-age population`)
    }
    rows.push({
      geoid,
      year,
      name: raw.slice(9, 81).trim(),
      totalPopulation,
      schoolAgePopulation,
      schoolAgePoverty,
      schoolAgePovertyRate:
        schoolAgePopulation > 0 ? Number(((schoolAgePoverty / schoolAgePopulation) * 100).toFixed(1)) : null,
    })
  }
  if (rows.length < 900) throw new Error(`SAIPE Texas file returned only ${rows.length} school districts`)
  return rows.sort((a, b) => a.geoid.localeCompare(b.geoid))
}

export function latestCommunitySnapshot(names, hasManifest = () => true) {
  const dirs = (names ?? []).filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name) && hasManifest(name)).sort()
  if (!dirs.length) throw new Error('no community snapshot found — run `npm run fetch:public`')
  return dirs.at(-1)
}

export async function loadCommunityRows(dir) {
  const rows = JSON.parse(gunzipSync(await readFile(`${dir}/community.json.gz`)).toString('utf8'))
  if (!Array.isArray(rows) || rows.length < 900) throw new Error(`${dir}: community.json.gz is incomplete`)
  return rows
}

export async function verifyCommunitySnapshot(dir) {
  const problems = []
  let manifest
  try {
    manifest = JSON.parse(await readFile(`${dir}/manifest.json`, 'utf8'))
  } catch (error) {
    return { dir, checked: 0, problems: [`manifest: ${error.message}`], fetchedAt: null }
  }
  let checked = 0
  for (const file of ['sd24-tx.txt.gz', 'community.json.gz']) {
    try {
      const bytes = await readFile(`${dir}/${file}`)
      checked++
      if (sha256(bytes) !== manifest.files?.[file]?.sha256) problems.push(`${file}: checksum mismatch`)
    } catch (error) {
      problems.push(`${file}: ${error.message}`)
    }
  }
  try {
    const source = gunzipSync(await readFile(`${dir}/sd24-tx.txt.gz`)).toString('utf8')
    const parsed = parseCommunityText(source)
    const normalized = await loadCommunityRows(dir)
    if (parsed.length !== normalized.length || parsed.length !== manifest.rows) problems.push('community row count mismatch')
    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) problems.push('normalized community rows do not match source text')
  } catch (error) {
    problems.push(error.message)
  }
  if (manifest.source !== COMMUNITY_URL) problems.push('manifest source URL does not match the official Census file')
  return { dir, checked, problems, fetchedAt: manifest.fetchedAt ?? null }
}

export async function fetchCommunity({
  date = new Date().toISOString().slice(0, 10),
  root = COMMUNITY_ROOT,
  fetchImpl = fetch,
  log = console.log,
} = {}) {
  const response = await fetchImpl(COMMUNITY_URL, {
    headers: { 'User-Agent': 'txschools.net data refresh (+https://txschools.net/about)' },
  })
  if (!response.ok) throw new Error(`${COMMUNITY_URL} -> HTTP ${response.status}`)
  const source = Buffer.from(await response.arrayBuffer())
  const rows = parseCommunityText(source.toString('utf8'))
  const dir = `${root}/${date}`
  await mkdir(dir, { recursive: true })
  const raw = gzipSync(source, { level: 9 })
  const normalized = gzipSync(Buffer.from(JSON.stringify(rows)), { level: 9 })
  await Promise.all([
    writeFile(`${dir}/sd24-tx.txt.gz`, raw),
    writeFile(`${dir}/community.json.gz`, normalized),
  ])
  const manifest = {
    fetchedAt: new Date().toISOString(),
    source: COMMUNITY_URL,
    landing: COMMUNITY_LANDING_URL,
    layout: COMMUNITY_LAYOUT_URL,
    estimateYear: COMMUNITY_YEAR,
    rows: rows.length,
    files: {
      'sd24-tx.txt.gz': { bytes: raw.length, sha256: sha256(raw), sourceBytes: source.length, sourceSha256: sha256(source) },
      'community.json.gz': { bytes: normalized.length, sha256: sha256(normalized) },
    },
  }
  await writeFile(`${dir}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n')
  log(`community: ${rows.length} Census school-district estimates`)
  return { dir, rows }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await fetchCommunity()
}
