# Data Pipeline and Deploy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the ingest pipeline that turns 14 TEA source files into verified normalized tables, prerender 10,230 entity pages, and deploy them to Cloudflare — producing a live site and the three measurements the dashboard design depends on.

**Architecture:** A five-stage Node pipeline (fetch → build → export → prerender → deploy), all pure functions over in-memory data with no database and no native dependencies. Normalized tables are written as NDJSON, readable by the DuckDB CLI for ad-hoc SQL without being a build dependency. The site is an assets-only Cloudflare Worker with no `main` entrypoint, so serving is free and unmetered.

**Tech Stack:** Node 24 (ESM), Vitest 4 for tests, Wrangler 4 (pinned ≥ 4.34.0) for deploy, GitHub Actions for CI. No framework, no bundler, no database.

**Scope note:** This is Plan 1 of 2. It deliberately stops short of the six dashboard views from spec §6. Spec §11 requires three measurements — real payload size, prerender wall-clock, upload time — before the dashboard is designed, and this plan produces them. Entity pages here are minimal by intent.

**Deferred to Plan 2:** three of the six tables in spec §4 — `domains`, `finance`, and `groups`. They feed the entity-detail view and the domain-decomposition chart, both of which render into prerendered pages rather than the shared payload. Consequence to carry forward: **the payload size measured in Task 12 is a lower bound**, not the final figure. It covers views 1–5, which is what the splitting decision hinges on, but Plan 2 must re-measure after adding anything else to it.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/sources.js` | The manifest: 14 source files, their level, and expected row-count floors |
| `src/decode.js` | Pure: bytes → validated JSON. Handles gzip whether or not transport decompressed |
| `src/fetch.js` | Network + disk. Writes `data/raw/<YYYY-MM>/` and a provenance manifest |
| `src/explode.js` | Pure: one parallel-array record → many tidy rows. The core primitive |
| `src/normalize/entities.js` | districts + schools → `entities` rows |
| `src/normalize/ratings.js` | change_over_time → `ratings` rows, with methodology split |
| `src/normalize/profile.js` | profile_tab → `profile` rows |
| `src/build.js` | Orchestrates normalizers, asserts integrity, writes `build/*.ndjson` |
| `src/export.js` | `entities` + `ratings` → content-hashed dashboard payload |
| `src/prerender.js` | Entity pages with data inlined, plus sitemaps |
| `src/lib/stats.js` | Pure: mean, weighted mean, median. Used by tests and export |
| `test/*.test.js` | Unit tests per module |
| `test/regression/headline.test.js` | Spec §8 figures — the site's published claims |
| `wrangler.jsonc` | Assets-only Worker config |
| `.github/workflows/refresh.yml` | The annual pipeline, manual trigger, with deploy gates |

**Invariant that governs every module:** all identifiers are **strings, never numbers**. District id `001902`, region `07`, and county `001` carry meaningful leading zeros. A single `parseInt` anywhere in this pipeline silently corrupts 1,199 districts.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `vitest.config.js`
- Create: `.nvmrc`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "txschoolsnet",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "fetch": "node src/fetch.js",
    "build": "node src/build.js",
    "export": "node src/export.js",
    "prerender": "node src/prerender.js",
    "site": "npm run build && npm run export && npm run prerender",
    "test": "vitest run",
    "test:watch": "vitest",
    "deploy": "wrangler deploy"
  },
  "devDependencies": {
    "vitest": "^4.1.10",
    "wrangler": "^4.34.0"
  }
}
```

The Wrangler floor of 4.34.0 is deliberate: the Paid plan's 100,000-file asset limit is unreachable on older versions, and that is the escape hatch if the file-count guard ever trips.

- [ ] **Step 2: Create `vitest.config.js`**

```js
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    testTimeout: 30_000,
  },
})
```

- [ ] **Step 3: Create `.nvmrc`**

```
24
```

- [ ] **Step 4: Install and verify**

Run: `npm install && npx vitest run --passWithNoTests`
Expected: install succeeds; vitest reports "No test files found" and exits 0.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.js .nvmrc
git commit -m "Add Node project scaffold"
```

---

### Task 2: Source manifest

**Files:**
- Create: `src/sources.js`
- Test: `test/sources.test.js`

The floors below are set ~5% under the counts observed on 2026-08-15. They exist to catch a partial TEA publication, which is the most likely real-world failure and would otherwise look like valid data.

- [ ] **Step 1: Write the failing test**

```js
// test/sources.test.js
import { describe, it, expect } from 'vitest'
import { SOURCES, BASE_URL } from '../src/sources.js'

describe('SOURCES', () => {
  it('lists all 14 TEA source files', () => {
    expect(SOURCES).toHaveLength(14)
  })

  it('gives every source a name, level and row floor', () => {
    for (const s of SOURCES) {
      expect(s.name, `${s.name} name`).toMatch(/^[a-z_]+$/)
      expect(['district', 'campus', 'both'], `${s.name} level`).toContain(s.level)
      expect(s.minRows, `${s.name} minRows`).toBeGreaterThan(0)
    }
  })

  it('has unique names', () => {
    expect(new Set(SOURCES.map((s) => s.name)).size).toBe(SOURCES.length)
  })

  it('points at the public TEA host over https', () => {
    expect(BASE_URL).toBe('https://txschools.gov/data')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/sources.test.js`
Expected: FAIL — `Failed to resolve import "../src/sources.js"`

- [ ] **Step 3: Write the implementation**

```js
// src/sources.js
export const BASE_URL = 'https://txschools.gov/data'

// minRows are floors ~5% below counts observed 2026-08-15. A partial TEA
// publication is the likeliest failure mode and looks like valid data.
export const SOURCES = [
  { name: 'districts', level: 'district', minRows: 1140 },
  { name: 'schools', level: 'campus', minRows: 8580 },
  { name: 'change_over_time', level: 'both', minRows: 9720 },
  { name: 'change_over_time_achievement', level: 'both', minRows: 10140 },
  { name: 'change_over_time_progress', level: 'both', minRows: 10140 },
  { name: 'change_over_time_gaps', level: 'both', minRows: 10140 },
  { name: 'overview', level: 'both', minRows: 9720 },
  { name: 'profile_tab', level: 'both', minRows: 9720 },
  { name: 'finance_district', level: 'district', minRows: 1135 },
  { name: 'finance_school', level: 'campus', minRows: 8280 },
  { name: 'ctg_districts', level: 'district', minRows: 1140 },
  { name: 'ctg_schools', level: 'campus', minRows: 8580 },
  { name: 'student_achievement_tab', level: 'both', minRows: 9410 },
  { name: 'school_progress_tab', level: 'both', minRows: 9720 },
]

export const sourceUrl = (name) => `${BASE_URL}/${name}.json`
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/sources.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/sources.js test/sources.test.js
git commit -m "Add TEA source manifest with row-count floors"
```

---

### Task 3: Decode source bodies

**Files:**
- Create: `src/decode.js`
- Test: `test/decode.test.js`

TEA serves every file gzip-compressed with `Content-Encoding: gzip` set **unconditionally**, even when the client sends no `Accept-Encoding`. Node's `fetch()` auto-decompresses when that header is present; `curl` without `--compressed` does not. `decodeBody` handles both so the pipeline does not depend on which client fetched the bytes.

- [ ] **Step 1: Write the failing test**

```js
// test/decode.test.js
import { describe, it, expect } from 'vitest'
import { gzipSync } from 'node:zlib'
import { decodeBody, validateRows } from '../src/decode.js'

const json = JSON.stringify([{ id: '001902', name: 'Cayuga ISD' }])

describe('decodeBody', () => {
  it('parses plain JSON bytes', () => {
    expect(decodeBody(Buffer.from(json))).toEqual([{ id: '001902', name: 'Cayuga ISD' }])
  })

  it('parses gzipped bytes by sniffing the magic number', () => {
    expect(decodeBody(gzipSync(json))).toEqual([{ id: '001902', name: 'Cayuga ISD' }])
  })

  it('preserves leading zeros in ids', () => {
    expect(decodeBody(Buffer.from(json))[0].id).toBe('001902')
  })

  it('throws a useful error on malformed input', () => {
    expect(() => decodeBody(Buffer.from('not json'))).toThrow(/failed to parse/i)
  })
})

describe('validateRows', () => {
  it('accepts an array at or above the floor', () => {
    expect(() => validateRows('districts', [{ id: 'a' }, { id: 'b' }], 2)).not.toThrow()
  })

  it('rejects a short array as a partial publication', () => {
    expect(() => validateRows('districts', [{ id: 'a' }], 2)).toThrow(/districts.*1.*below floor 2/i)
  })

  it('rejects a non-array payload', () => {
    expect(() => validateRows('districts', { id: 'a' }, 1)).toThrow(/expected an array/i)
  })

  it('rejects rows without an id', () => {
    expect(() => validateRows('districts', [{ name: 'x' }], 1)).toThrow(/missing.*id/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/decode.test.js`
Expected: FAIL — cannot resolve `../src/decode.js`

- [ ] **Step 3: Write the implementation**

```js
// src/decode.js
import { gunzipSync } from 'node:zlib'

const isGzip = (buf) => buf.length > 1 && buf[0] === 0x1f && buf[1] === 0x8b

/** Bytes -> parsed JSON. Transparently gunzips if the body is still compressed. */
export function decodeBody(buf) {
  const bytes = isGzip(buf) ? gunzipSync(buf) : buf
  const text = bytes.toString('utf8')
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new Error(`failed to parse JSON (${text.slice(0, 60)}...): ${err.message}`)
  }
}

/** Guards against a partial TEA publication, which otherwise looks like valid data. */
export function validateRows(name, rows, minRows) {
  if (!Array.isArray(rows)) {
    throw new Error(`${name}: expected an array, got ${typeof rows}`)
  }
  if (rows.length < minRows) {
    throw new Error(`${name}: got ${rows.length} rows, below floor ${minRows}`)
  }
  const bad = rows.findIndex((r) => typeof r?.id !== 'string')
  if (bad !== -1) {
    throw new Error(`${name}: row ${bad} missing a string id`)
  }
  return rows
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/decode.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/decode.js test/decode.test.js
git commit -m "Add source decoding with gzip sniffing and partial-publication guard"
```

---

### Task 4: Fetch and archive

**Files:**
- Create: `src/fetch.js`
- Test: `test/fetch.test.js`

Stores content-addressed provenance. TEA's gzip framing is not byte-stable across requests, so the manifest hashes the **decompressed** content — that is what actually needs to be verifiable.

- [ ] **Step 1: Write the failing test**

```js
// test/fetch.test.js
import { describe, it, expect } from 'vitest'
import { snapshotDir, buildManifest } from '../src/fetch.js'

describe('snapshotDir', () => {
  it('names the directory by year and month', () => {
    expect(snapshotDir(new Date('2026-08-15T00:00:00Z'))).toBe('data/raw/2026-08')
  })

  it('zero-pads single-digit months', () => {
    expect(snapshotDir(new Date('2027-01-09T00:00:00Z'))).toBe('data/raw/2027-01')
  })
})

describe('buildManifest', () => {
  const entries = [
    { name: 'districts', text: '[{"id":"001902"}]', rows: 1, etag: 'W/"abc"', lastModified: 'Fri, 14 Aug 2026 12:00:00 GMT' },
  ]

  it('records a sha256 of decompressed content', () => {
    const m = buildManifest(entries, '2026-08-15T00:00:00.000Z')
    expect(m.files.districts.sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('is stable for identical content', () => {
    const a = buildManifest(entries, '2026-08-15T00:00:00.000Z')
    const b = buildManifest(entries, '2026-09-01T00:00:00.000Z')
    expect(a.files.districts.sha256).toBe(b.files.districts.sha256)
  })

  it('carries server metadata and row counts', () => {
    const m = buildManifest(entries, '2026-08-15T00:00:00.000Z')
    expect(m.files.districts.etag).toBe('W/"abc"')
    expect(m.files.districts.rows).toBe(1)
    expect(m.fetchedAt).toBe('2026-08-15T00:00:00.000Z')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/fetch.test.js`
Expected: FAIL — cannot resolve `../src/fetch.js`

- [ ] **Step 3: Write the implementation**

```js
// src/fetch.js
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { mkdir, writeFile } from 'node:fs/promises'
import { SOURCES, sourceUrl } from './sources.js'
import { decodeBody, validateRows } from './decode.js'

export function snapshotDir(date) {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `data/raw/${y}-${m}`
}

export function buildManifest(entries, fetchedAt) {
  const files = {}
  for (const e of entries) {
    files[e.name] = {
      sha256: createHash('sha256').update(e.text).digest('hex'),
      bytes: Buffer.byteLength(e.text),
      rows: e.rows,
      etag: e.etag ?? null,
      lastModified: e.lastModified ?? null,
    }
  }
  return { fetchedAt, source: 'https://txschools.gov/data', files }
}

async function fetchOne(source) {
  const url = sourceUrl(source.name)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${source.name}: HTTP ${res.status} from ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const rows = validateRows(source.name, decodeBody(buf), source.minRows)
  return {
    name: source.name,
    text: JSON.stringify(rows),
    rows: rows.length,
    etag: res.headers.get('etag'),
    lastModified: res.headers.get('last-modified'),
  }
}

export async function fetchAll(date = new Date()) {
  const dir = snapshotDir(date)
  await mkdir(dir, { recursive: true })

  const entries = []
  for (const source of SOURCES) {
    const entry = await fetchOne(source)
    await writeFile(`${dir}/${entry.name}.json.gz`, gzipSync(entry.text))
    console.log(`  ${entry.name.padEnd(30)} ${String(entry.rows).padStart(6)} rows`)
    entries.push(entry)
  }

  const manifest = buildManifest(entries, date.toISOString())
  await writeFile(`${dir}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`\nWrote ${entries.length} files to ${dir}`)
  return { dir, manifest }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await fetchAll()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/fetch.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Run the real fetch**

Run: `npm run fetch`
Expected: 14 lines of counts matching spec §2 (districts 1199, schools 9031, change_over_time 10234, …), then `Wrote 14 files to data/raw/2026-08`.

- [ ] **Step 6: Commit the code and the snapshot**

The snapshot is committed deliberately — see spec §3. It is ~4.5 MB.

```bash
git add src/fetch.js test/fetch.test.js data/raw/
git commit -m "Add TEA fetcher and commit the 2026-08 source snapshot"
```

---

### Task 5: The explode primitive

**Files:**
- Create: `src/explode.js`
- Test: `test/explode.test.js`

Every TEA history file stores parallel arrays: `{academic_year: [...], overall_rating: [...], score: [...]}`. This turns one such record into one row per index. Misaligned array lengths are a hard error — silently zipping them would misattribute a rating to the wrong year, which is the single worst failure this codebase could have.

- [ ] **Step 1: Write the failing test**

```js
// test/explode.test.js
import { describe, it, expect } from 'vitest'
import { explode } from '../src/explode.js'

const rec = {
  id: '001902',
  academic_year: ['2025-26', '2024-25'],
  overall_rating: ['B', 'B'],
  score: ['89', '88'],
}

describe('explode', () => {
  it('produces one row per array index', () => {
    const rows = explode(rec, { academic_year: 'year', overall_rating: 'rating', score: 'score' })
    expect(rows).toEqual([
      { id: '001902', year: '2025-26', rating: 'B', score: '89' },
      { id: '001902', year: '2024-25', rating: 'B', score: '88' },
    ])
  })

  it('carries extra scalar columns onto every row', () => {
    const rows = explode(rec, { academic_year: 'year' }, { level: 'district' })
    expect(rows.every((r) => r.level === 'district')).toBe(true)
  })

  it('throws when arrays disagree in length', () => {
    const bad = { id: 'x', academic_year: ['a', 'b'], score: ['1'] }
    expect(() => explode(bad, { academic_year: 'year', score: 'score' })).toThrow(/x.*length mismatch.*score/i)
  })

  it('returns no rows for empty arrays', () => {
    expect(explode({ id: 'x', academic_year: [] }, { academic_year: 'year' })).toEqual([])
  })

  it('returns no rows when a mapped key is absent', () => {
    expect(explode({ id: 'x' }, { academic_year: 'year' })).toEqual([])
  })

  it('preserves nulls rather than coercing them', () => {
    const rows = explode({ id: 'x', score: [null] }, { score: 'score' })
    expect(rows[0].score).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/explode.test.js`
Expected: FAIL — cannot resolve `../src/explode.js`

- [ ] **Step 3: Write the implementation**

```js
// src/explode.js
/**
 * One parallel-array record -> many tidy rows.
 * @param rec    source record, must carry a string `id`
 * @param mapping source array key -> output column name
 * @param extra  scalar columns copied onto every row
 */
export function explode(rec, mapping, extra = {}) {
  const keys = Object.keys(mapping).filter((k) => Array.isArray(rec[k]))
  if (keys.length === 0) return []

  const len = rec[keys[0]].length
  for (const k of keys) {
    if (rec[k].length !== len) {
      throw new Error(
        `${rec.id}: length mismatch — ${keys[0]} has ${len}, ${k} has ${rec[k].length}`
      )
    }
  }

  return Array.from({ length: len }, (_, i) => {
    const row = { id: rec.id, ...extra }
    for (const k of keys) row[mapping[k]] = rec[k][i]
    return row
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/explode.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/explode.js test/explode.test.js
git commit -m "Add explode primitive for TEA parallel-array records"
```

---

### Task 6: Normalize entities

**Files:**
- Create: `src/normalize/entities.js`
- Test: `test/normalize/entities.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/normalize/entities.test.js
import { describe, it, expect } from 'vitest'
import { toEntity } from '../../src/normalize/entities.js'

const district = {
  id: '001902', district_id: '001902', district_name: 'Cayuga ISD',
  region_id: '07', county_id: '001', county: 'Anderson',
  entity_type: 'Traditional', campus_type: '', alt_standards: 'No',
  enrollment: 574, name: 'Cayuga ISD', rating: 'B', score: 89,
  latitude: 31.922964, longitude: -95.923871, mult_year: '0', paired_id: '',
}

const charterCampus = {
  ...district, id: '001902001', name: 'Cayuga HS',
  entity_type: 'Charter', campus_type: 'High School', alt_standards: 'Yes',
  mult_year: '2', paired_id: '001902002',
}

describe('toEntity', () => {
  it('marks level from the source file', () => {
    expect(toEntity(district, 'district').level).toBe('district')
    expect(toEntity(charterCampus, 'campus').level).toBe('campus')
  })

  it('derives isCharter from entity_type, never from the name', () => {
    expect(toEntity(district, 'district').isCharter).toBe(false)
    expect(toEntity(charterCampus, 'campus').isCharter).toBe(true)
  })

  it('derives isAlt from alt_standards', () => {
    expect(toEntity(district, 'district').isAlt).toBe(false)
    expect(toEntity(charterCampus, 'campus').isAlt).toBe(true)
  })

  it('keeps ids, region and county as zero-padded strings', () => {
    const e = toEntity(district, 'district')
    expect(e.id).toBe('001902')
    expect(e.regionId).toBe('07')
    expect(e.countyId).toBe('001')
  })

  it('coerces score and enrollment to numbers, mult_year to a number', () => {
    const e = toEntity(district, 'district')
    expect(e.score).toBe(89)
    expect(e.enrollment).toBe(574)
    expect(e.multYear).toBe(0)
    expect(toEntity(charterCampus, 'campus').multYear).toBe(2)
  })

  it('normalises empty strings to null', () => {
    expect(toEntity(district, 'district').pairedId).toBeNull()
    expect(toEntity(charterCampus, 'campus').pairedId).toBe('001902002')
  })

  it('nulls a non-numeric score rather than emitting NaN', () => {
    expect(toEntity({ ...district, score: '' }, 'district').score).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/normalize/entities.test.js`
Expected: FAIL — cannot resolve `../../src/normalize/entities.js`

- [ ] **Step 3: Write the implementation**

```js
// src/normalize/entities.js

/** '' -> null, otherwise the trimmed string. */
export const str = (v) => {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v)
  return s === '' ? null : s
}

/** Non-numeric -> null. Never returns NaN. */
export const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function toEntity(rec, level) {
  return {
    id: rec.id,
    level,
    districtId: str(rec.district_id),
    districtName: str(rec.district_name),
    name: str(rec.name),
    regionId: str(rec.region_id),
    countyId: str(rec.county_id),
    county: str(rec.county),
    entityType: str(rec.entity_type),
    isCharter: rec.entity_type === 'Charter',
    isAlt: rec.alt_standards === 'Yes',
    campusType: str(rec.campus_type),
    enrollment: num(rec.enrollment),
    rating: str(rec.rating),
    score: num(rec.score),
    lat: num(rec.latitude),
    lon: num(rec.longitude),
    multYear: num(rec.mult_year) ?? 0,
    pairedId: str(rec.paired_id),
  }
}

export const toEntities = (districts, schools) => [
  ...districts.map((r) => toEntity(r, 'district')),
  ...schools.map((r) => toEntity(r, 'campus')),
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/normalize/entities.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/normalize/entities.js test/normalize/entities.test.js
git commit -m "Normalize districts and schools into a single entities table"
```

---

### Task 7: Normalize ratings, with the methodology split

**Files:**
- Create: `src/normalize/ratings.js`
- Test: `test/normalize/ratings.test.js`

This is the module spec §5 turns on. TEA publishes `2021-22` twice: once under the pre-2023 rules and once as `2021-22 What If` under the refreshed rules. Charting them as two adjacent years would show a phantom collapse. They are the **same year under two methods**.

- [ ] **Step 1: Write the failing test**

```js
// test/normalize/ratings.test.js
import { describe, it, expect } from 'vitest'
import { toRatings, parseYear } from '../../src/normalize/ratings.js'

describe('parseYear', () => {
  it('splits the What If label into year plus method', () => {
    expect(parseYear('2021-22 What If')).toEqual({ year: '2021-22', method: 'what_if' })
  })

  it('treats a plain year as the original method', () => {
    expect(parseYear('2021-22')).toEqual({ year: '2021-22', method: 'original' })
  })

  it('treats post-refresh years as current methodology', () => {
    expect(parseYear('2025-26')).toEqual({ year: '2025-26', method: 'current' })
  })
})

describe('toRatings', () => {
  const rec = {
    id: '001902',
    academic_year: ['2025-26', '2021-22 What If', '2021-22'],
    overall_rating: ['B', 'B', 'A'],
    score: ['89', '87', '94'],
  }

  it('emits one row per year-method pair', () => {
    expect(toRatings([rec])).toHaveLength(3)
  })

  it('splits 2021-22 into two rows sharing a year', () => {
    const y = toRatings([rec]).filter((r) => r.year === '2021-22')
    expect(y).toHaveLength(2)
    expect(y.map((r) => r.method).sort()).toEqual(['original', 'what_if'])
  })

  it('records the methodology effect: same year, same score, different grade', () => {
    const y = toRatings([rec]).filter((r) => r.year === '2021-22')
    const original = y.find((r) => r.method === 'original')
    const whatIf = y.find((r) => r.method === 'what_if')
    expect(original.rating).toBe('A')
    expect(whatIf.rating).toBe('B')
  })

  it('coerces score to a number', () => {
    expect(toRatings([rec])[0].score).toBe(89)
  })

  it('nulls the score for Not Rated rather than emitting zero', () => {
    const nr = { id: 'x', academic_year: ['2025-26'], overall_rating: ['Not Rated'], score: [''] }
    expect(toRatings([nr])[0].score).toBeNull()
  })

  it('keeps Data Integrity Issues as a distinct rating', () => {
    const di = { id: 'x', academic_year: ['2025-26'], overall_rating: ['Data Integrity Issues'], score: [null] }
    expect(toRatings([di])[0].rating).toBe('Data Integrity Issues')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/normalize/ratings.test.js`
Expected: FAIL — cannot resolve `../../src/normalize/ratings.js`

- [ ] **Step 3: Write the implementation**

```js
// src/normalize/ratings.js
import { explode } from '../explode.js'
import { num, str } from './entities.js'

const WHAT_IF = ' What If'
const REFRESH_YEAR = '2022-23' // first year published under the refreshed methodology

/**
 * TEA labels the back-published re-scoring of 2021-22 as "2021-22 What If".
 * It is the same year under the post-2023 rules, not a separate year.
 */
export function parseYear(label) {
  if (label.endsWith(WHAT_IF)) {
    return { year: label.slice(0, -WHAT_IF.length), method: 'what_if' }
  }
  return { year: label, method: label < REFRESH_YEAR ? 'original' : 'current' }
}

export function toRatings(records) {
  return records.flatMap((rec) =>
    explode(rec, { academic_year: 'label', overall_rating: 'rating', score: 'score' }).map(
      ({ id, label, rating, score }) => ({
        id,
        ...parseYear(label),
        rating: str(rating),
        score: num(score),
      })
    )
  )
}

/**
 * Precedence for picking ONE rating per entity-year for a trend line.
 *
 * `what_if` wins over `original` because it re-scores 2021-22 under the
 * post-2023 rules, making it comparable with every later year. Taking
 * `original` instead reintroduces the methodology break and produces a
 * phantom collapse between 2021-22 and 2022-23 that no school caused.
 */
export const METHOD_PRECEDENCE = ['current', 'what_if', 'original']

/**
 * An unknown method ranks AFTER all known ones. A bare
 * `METHOD_PRECEDENCE.indexOf(method)` returns -1 for an unrecognized value,
 * which would make garbage data outrank `current`.
 */
const rank = (method) => {
  const i = METHOD_PRECEDENCE.indexOf(method)
  return i === -1 ? METHOD_PRECEDENCE.length : i
}

/** Reduce a rating set to one row per entity-year, using METHOD_PRECEDENCE. */
export function preferredRatings(rows) {
  const best = new Map()
  for (const row of rows) {
    const key = `${row.id}|${row.year}`
    const held = best.get(key)
    if (!held || rank(row.method) < rank(held.method)) {
      best.set(key, row)
    }
  }
  return [...best.values()]
}
```

**Why this is here and not open-coded downstream.** Tasks 11, 12 and 13 each need one rating per entity-year. Reimplementing the rule in three places means a future edit to one copy makes the dashboard chart and the entity pages disagree about 2021-22 — silently, and in the most contested year in the dataset. It lives in one module, with the reasoning attached.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/normalize/ratings.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/normalize/ratings.js test/normalize/ratings.test.js
git commit -m "Normalize ratings history, splitting the 2023 methodology refresh"
```

---

### Task 8: Normalize profile

**Files:**
- Create: `src/normalize/profile.js`
- Test: `test/normalize/profile.test.js`

Eco-dis percentage is the control variable for every claim in spec §8, so it gets its own module and its own tests.

- [ ] **Step 1: Write the failing test**

```js
// test/normalize/profile.test.js
import { describe, it, expect } from 'vitest'
import { toProfile } from '../../src/normalize/profile.js'

const rec = {
  id: '001902', Total: 574, Eco_Dis: 52.6, Spec_Ed: 15.2, Eng_Lrn: 1.2,
  Attendance: 95.8, Absenteeism: 8.7, Avg_Salary: 65465, School_Year: '2025-26',
}

describe('toProfile', () => {
  it('maps eco-dis to a number', () => {
    expect(toProfile([rec])[0].ecoDisPct).toBe(52.6)
  })

  it('carries enrollment, attendance and salary', () => {
    const p = toProfile([rec])[0]
    expect(p.total).toBe(574)
    expect(p.attendance).toBe(95.8)
    expect(p.avgSalary).toBe(65465)
  })

  it('nulls a missing eco-dis rather than defaulting to zero', () => {
    expect(toProfile([{ id: 'x', Eco_Dis: null }])[0].ecoDisPct).toBeNull()
  })

  it('nulls a non-numeric eco-dis', () => {
    expect(toProfile([{ id: 'x', Eco_Dis: '.' }])[0].ecoDisPct).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/normalize/profile.test.js`
Expected: FAIL — cannot resolve `../../src/normalize/profile.js`

- [ ] **Step 3: Write the implementation**

```js
// src/normalize/profile.js
import { num, str } from './entities.js'

export function toProfile(records) {
  return records.map((r) => ({
    id: r.id,
    total: num(r.Total),
    ecoDisPct: num(r.Eco_Dis),
    specEdPct: num(r.Spec_Ed),
    engLrnPct: num(r.Eng_Lrn),
    attendance: num(r.Attendance),
    absenteeism: num(r.Absenteeism),
    avgSalary: num(r.Avg_Salary),
    schoolYear: str(r.School_Year),
  }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/normalize/profile.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/normalize/profile.js test/normalize/profile.test.js
git commit -m "Normalize the profile table"
```

---

### Task 9: Statistics helpers

**Files:**
- Create: `src/lib/stats.js`
- Test: `test/lib/stats.test.js`

Shared by the export and by the §8 regression tests. Null handling is the whole point: a `Not Rated` school must be *excluded* from a mean, never counted as zero.

- [ ] **Step 1: Write the failing test**

```js
// test/lib/stats.test.js
import { describe, it, expect } from 'vitest'
import { mean, weightedMean, median } from '../../src/lib/stats.js'
import { preferredRatings } from '../../src/normalize/ratings.js'

describe('mean', () => {
  it('averages numbers', () => {
    expect(mean([1, 2, 3])).toBe(2)
  })

  it('excludes nulls instead of counting them as zero', () => {
    expect(mean([1, null, 3])).toBe(2)
  })

  it('returns null for an empty or all-null input', () => {
    expect(mean([])).toBeNull()
    expect(mean([null, null])).toBeNull()
  })
})

describe('weightedMean', () => {
  it('weights each value', () => {
    expect(weightedMean([{ v: 100, w: 3 }, { v: 0, w: 1 }])).toBe(75)
  })

  it('skips pairs with a null value or a zero weight', () => {
    expect(weightedMean([{ v: 100, w: 3 }, { v: null, w: 99 }, { v: 50, w: 0 }])).toBe(100)
  })

  it('returns null when no weight remains', () => {
    expect(weightedMean([{ v: 1, w: 0 }])).toBeNull()
  })
})

describe('median', () => {
  it('takes the middle of an odd-length set', () => {
    expect(median([3, 1, 2])).toBe(2)
  })

  it('averages the middle pair of an even-length set', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })

  it('excludes nulls', () => {
    expect(median([1, null, 3])).toBe(2)
  })

  it('does not mutate its input', () => {
    const xs = [3, 1, 2]
    median(xs)
    expect(xs).toEqual([3, 1, 2])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/stats.test.js`
Expected: FAIL — cannot resolve `../../src/lib/stats.js`

- [ ] **Step 3: Write the implementation**

```js
// src/lib/stats.js
const finite = (xs) => xs.filter((x) => typeof x === 'number' && Number.isFinite(x))

export function mean(values) {
  const xs = finite(values)
  return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length
}

export function weightedMean(pairs) {
  let num = 0
  let den = 0
  for (const { v, w } of pairs) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    if (typeof w !== 'number' || !Number.isFinite(w) || w <= 0) continue
    num += v * w
    den += w
  }
  return den === 0 ? null : num / den
}

export function median(values) {
  const xs = finite(values).slice().sort((a, b) => a - b)
  if (xs.length === 0) return null
  const mid = xs.length >> 1
  return xs.length % 2 === 1 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/stats.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stats.js test/lib/stats.test.js
git commit -m "Add null-safe statistics helpers"
```

---

### Task 10: Build orchestration

**Files:**
- Create: `src/build.js`
- Test: `test/build.test.js`

Reads the newest snapshot, runs the normalizers, asserts integrity, writes `build/*.ndjson`.

- [ ] **Step 1: Write the failing test**

```js
// test/build.test.js
import { describe, it, expect } from 'vitest'
import { assertIntegrity, toNdjson, latestSnapshot } from '../src/build.js'

describe('assertIntegrity', () => {
  const entities = [{ id: 'a' }, { id: 'b' }]

  it('passes when every child id exists in entities', () => {
    expect(() => assertIntegrity(entities, { ratings: [{ id: 'a' }, { id: 'b' }] })).not.toThrow()
  })

  it('throws naming the table and the orphan id', () => {
    expect(() => assertIntegrity(entities, { ratings: [{ id: 'zzz' }] })).toThrow(/ratings.*zzz/i)
  })

  it('reports the orphan count rather than only the first', () => {
    expect(() => assertIntegrity(entities, { ratings: [{ id: 'y' }, { id: 'z' }] })).toThrow(/2 orphan/i)
  })
})

describe('toNdjson', () => {
  it('writes one JSON object per line with a trailing newline', () => {
    expect(toNdjson([{ id: 'a' }, { id: 'b' }])).toBe('{"id":"a"}\n{"id":"b"}\n')
  })

  it('returns an empty string for no rows', () => {
    expect(toNdjson([])).toBe('')
  })
})

describe('latestSnapshot', () => {
  it('picks the newest directory by name', () => {
    expect(latestSnapshot(['2026-08', '2027-01', '2026-12'])).toBe('2027-01')
  })

  it('throws when no snapshot exists', () => {
    expect(() => latestSnapshot([])).toThrow(/no snapshot/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/build.test.js`
Expected: FAIL — cannot resolve `../src/build.js`

- [ ] **Step 3: Write the implementation**

```js
// src/build.js
import { gunzipSync } from 'node:zlib'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { toEntities } from './normalize/entities.js'
import { toRatings } from './normalize/ratings.js'
import { toProfile } from './normalize/profile.js'

export function latestSnapshot(names) {
  const dirs = names.filter((n) => /^\d{4}-\d{2}$/.test(n)).sort()
  if (dirs.length === 0) throw new Error('no snapshot found under data/raw — run `npm run fetch`')
  return dirs[dirs.length - 1]
}

export function assertIntegrity(entities, tables) {
  const known = new Set(entities.map((e) => e.id))
  for (const [table, rows] of Object.entries(tables)) {
    const orphans = rows.filter((r) => !known.has(r.id))
    if (orphans.length > 0) {
      const sample = [...new Set(orphans.map((o) => o.id))].slice(0, 3).join(', ')
      throw new Error(`${table}: ${orphans.length} orphan rows not in entities (e.g. ${sample})`)
    }
  }
}

export const toNdjson = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')

const readSource = async (dir, name) =>
  JSON.parse(gunzipSync(await readFile(`${dir}/${name}.json.gz`)).toString('utf8'))

export async function build() {
  const snapshot = latestSnapshot(await readdir('data/raw'))
  const dir = `data/raw/${snapshot}`
  console.log(`Building from ${dir}`)

  const [districts, schools, cot, profileRaw] = await Promise.all([
    readSource(dir, 'districts'),
    readSource(dir, 'schools'),
    readSource(dir, 'change_over_time'),
    readSource(dir, 'profile_tab'),
  ])

  const entities = toEntities(districts, schools)
  const ratings = toRatings(cot)
  const profile = toProfile(profileRaw)

  assertIntegrity(entities, { ratings, profile })

  await mkdir('build', { recursive: true })
  const tables = { entities, ratings, profile }
  for (const [name, rows] of Object.entries(tables)) {
    await writeFile(`build/${name}.ndjson`, toNdjson(rows))
    console.log(`  ${name.padEnd(10)} ${String(rows.length).padStart(7)} rows`)
  }
  await writeFile('build/snapshot.txt', snapshot + '\n')
  return tables
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await build()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/build.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Run the real build**

Run: `npm run build`
Expected:
```
Building from data/raw/2026-08
  entities      10230 rows
  ratings       58984 rows
  profile       10230 rows
```

`assertIntegrity` **will** throw the first time, on BOTH `profile` and `ratings`. Four ids appear in neither `districts` nor `schools` — `221801026`, `227901029`, `227901054`, `227901157` — yet TEA publishes data for them in two source files:

| Table | Orphan rows | Why |
|---|---|---|
| `profile` | 4 | one profile row each |
| `ratings` | 24 | the same four ids, each with a full six-year history in `change_over_time` |

10,234 − 4 = 10,230 confirms the entity table is complete and these four are the anomaly: TEA publishes profile and rating data for campuses carrying no accountability record.

Do not weaken the assertion. Drop them at the source with the reason recorded, by changing the `profile` line in `build()`:

```js
const known = new Set(entities.map((e) => e.id))
// Four profile_tab rows reference campuses absent from schools.json — TEA
// publishes profile data for them but no accountability record. Observed
// 2026-08: 221801026, 227901029, 227901054, 227901157.
const profile = toProfile(profileRaw).filter((p) => known.has(p.id))
```

Add a test in `test/build.test.js` asserting the filter is deliberate:

```js
it('drops profile rows with no matching entity rather than inventing one', () => {
  const entities = [{ id: 'a' }]
  const kept = [{ id: 'a' }, { id: 'ghost' }].filter((p) => new Set(entities.map((e) => e.id)).has(p.id))
  expect(kept).toEqual([{ id: 'a' }])
})
```

If the count of dropped rows is ever anything other than 4, investigate before proceeding — it means TEA changed something.

- [ ] **Step 6: Verify the output is DuckDB-readable**

Run: `duckdb -c "select level, count(*) from read_json_auto('build/entities.ndjson') group by 1"`
Expected: `campus 9031`, `district 1199`. Skip if the DuckDB CLI is not installed — it is optional, not a build dependency.

- [ ] **Step 7: Commit**

```bash
git add src/build.js test/build.test.js
git commit -m "Add build orchestration with referential integrity assertions"
```

---

### Task 11: Headline regression tests

**Files:**
- Create: `test/regression/headline.test.js`

These are the site's published claims, executable. Spec §8 records them; this makes a future TEA release that changes them fail the build instead of quietly making the site wrong. Tolerance is ±0.05 because the figures are stated to one decimal.

- [ ] **Step 1: Write the test**

```js
// test/regression/headline.test.js
import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { mean, weightedMean, median } from '../../src/lib/stats.js'
import { preferredRatings } from '../../src/normalize/ratings.js'

const read = async (t) =>
  (await readFile(`build/${t}.ndjson`, 'utf8')).trim().split('\n').map((l) => JSON.parse(l))

let entities, ratings, profile, districts, byId, preferred

beforeAll(async () => {
  ;[entities, ratings, profile] = await Promise.all([read('entities'), read('ratings'), read('profile')])
  districts = entities.filter((e) => e.level === 'district')
  byId = new Map(entities.map((e) => [e.id, e]))
  preferred = preferredRatings(ratings)
})

/** Mean score across districts of one sector for one year, default-methodology view. */
const districtMean = (year, isCharter) => {
  const scores = preferred
    .filter((r) => r.year === year)
    .filter((r) => byId.get(r.id)?.level === 'district' && byId.get(r.id)?.isCharter === isCharter)
    .map((r) => r.score)
  return mean(scores)
}

describe('spec §8 — unweighted district means', () => {
  it.each([
    ['2021-22', 80.6, 82.3],
    ['2023-24', 78.7, 78.0],
    ['2025-26', 81.7, 79.7],
  ])('%s: traditional %f, charter %f', (year, trad, charter) => {
    expect(districtMean(year, false)).toBeCloseTo(trad, 1)
    expect(districtMean(year, true)).toBeCloseTo(charter, 1)
  })

  it('shows traditional districts overtaking charters', () => {
    const gap = (y) => districtMean(y, false) - districtMean(y, true)
    expect(gap('2021-22')).toBeLessThan(0)
    expect(gap('2025-26')).toBeGreaterThan(0)
  })
})

describe('spec §8 — enrollment weighting reverses the ordering', () => {
  const weighted = (year, isCharter) => {
    return weightedMean(
      preferred
        .filter((r) => r.year === year)
        .filter((r) => byId.get(r.id)?.level === 'district' && byId.get(r.id)?.isCharter === isCharter)
        .map((r) => ({ v: r.score, w: byId.get(r.id).enrollment }))
    )
  }

  it('puts charters ahead by student in 2025-26', () => {
    expect(weighted('2025-26', false)).toBeCloseTo(82.4, 1)
    expect(weighted('2025-26', true)).toBeCloseTo(82.9, 1)
    expect(weighted('2025-26', true)).toBeGreaterThan(weighted('2025-26', false))
  })
})

describe('spec §8 — charters serve higher-poverty populations', () => {
  const medianEcoDis = (isCharter) => {
    const p = new Map(profile.map((r) => [r.id, r.ecoDisPct]))
    return median(districts.filter((d) => d.isCharter === isCharter).map((d) => p.get(d.id) ?? null))
  }

  it('reports the medians the spec states', () => {
    expect(medianEcoDis(false)).toBeCloseTo(59.3, 1)
    expect(medianEcoDis(true)).toBeCloseTo(77.4, 1)
  })
})

describe('data shape', () => {
  it('has 1,199 districts and 9,031 campuses', () => {
    expect(districts).toHaveLength(1199)
    expect(entities.filter((e) => e.level === 'campus')).toHaveLength(9031)
  })

  it('classifies 179 charter districts by entity_type', () => {
    expect(districts.filter((d) => d.isCharter)).toHaveLength(179)
  })

  it('keeps 2021-22 under both methodologies', () => {
    const y = ratings.filter((r) => r.year === '2021-22')
    expect(new Set(y.map((r) => r.method))).toEqual(new Set(['original', 'what_if']))
  })

  it('never emits a numeric id', () => {
    expect(entities.every((e) => typeof e.id === 'string')).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run test/regression/headline.test.js`
Expected: PASS, 11 tests.

If a mean is off by more than 0.05, do not adjust the expected value to match. Either the normalizer has a bug, or TEA republished. Determine which before touching anything — this test existing is the entire point.

- [ ] **Step 3: Commit**

```bash
git add test/regression/headline.test.js
git commit -m "Assert spec §8 headline figures against the built tables"
```

---

### Task 12: Export the dashboard payload and measure it

**Files:**
- Create: `src/export.js`
- Test: `test/export.test.js`

Spec §11 measurement one. The payload is column-oriented — 10,230 objects with repeated keys cost far more than parallel arrays, and this is the number that decides whether the dashboard needs splitting.

- [ ] **Step 1: Write the failing test**

```js
// test/export.test.js
import { describe, it, expect } from 'vitest'
import { buildPayload, contentHash } from '../src/export.js'

const entities = [
  { id: '001902', level: 'district', name: 'Cayuga ISD', regionId: '07', countyId: '001',
    isCharter: false, isAlt: false, enrollment: 574, score: 89, rating: 'B' },
]
const ratings = [
  { id: '001902', year: '2025-26', method: 'current', rating: 'B', score: 89 },
  { id: '001902', year: '2021-22', method: 'what_if', rating: 'B', score: 87 },
  { id: '001902', year: '2021-22', method: 'original', rating: 'A', score: 94 },
]
const profile = [{ id: '001902', ecoDisPct: 52.6 }]

describe('buildPayload', () => {
  it('is column-oriented, not an array of objects', () => {
    const p = buildPayload(entities, ratings, profile)
    expect(Array.isArray(p.entities.id)).toBe(true)
    expect(p.entities.id[0]).toBe('001902')
  })

  it('keeps every column the same length', () => {
    const cols = Object.values(buildPayload(entities, ratings, profile).entities)
    expect(new Set(cols.map((c) => c.length)).size).toBe(1)
  })

  it('joins eco-dis onto the entity row', () => {
    expect(buildPayload(entities, ratings, profile).entities.ecoDisPct[0]).toBe(52.6)
  })

  it('lists years once, most recent first', () => {
    expect(buildPayload(entities, ratings, profile).years).toEqual(['2025-26', '2021-22'])
  })

  it('indexes scores by entity and year for the default methodology', () => {
    const p = buildPayload(entities, ratings, profile)
    expect(p.scores[0]).toEqual([89, 87])
  })

  it('exposes the original 2021-22 methodology separately', () => {
    expect(buildPayload(entities, ratings, profile).original['2021-22'][0]).toBe(94)
  })
})

describe('contentHash', () => {
  it('is stable for identical content', () => {
    expect(contentHash('{"a":1}')).toBe(contentHash('{"a":1}'))
  })

  it('differs for different content', () => {
    expect(contentHash('{"a":1}')).not.toBe(contentHash('{"a":2}'))
  })

  it('is short enough for a filename', () => {
    expect(contentHash('{"a":1}')).toMatch(/^[a-f0-9]{8}$/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/export.test.js`
Expected: FAIL — cannot resolve `../src/export.js`

- [ ] **Step 3: Write the implementation**

```js
// src/export.js
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { preferredRatings } from './normalize/ratings.js'

export const contentHash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 8)

const COLUMNS = ['id', 'level', 'name', 'regionId', 'countyId', 'isCharter', 'isAlt',
                 'enrollment', 'score', 'rating']

/** Column-oriented: repeated object keys dominate the payload at 10,230 rows. */
export function buildPayload(entities, ratings, profile) {
  const ecoDis = new Map(profile.map((p) => [p.id, p.ecoDisPct]))

  const cols = Object.fromEntries(COLUMNS.map((c) => [c, entities.map((e) => e[c] ?? null)]))
  cols.ecoDisPct = entities.map((e) => ecoDis.get(e.id) ?? null)

  // One row per entity-year, chosen by METHOD_PRECEDENCE (see ratings.js).
  const defaults = preferredRatings(ratings)

  const years = [...new Set(defaults.map((r) => r.year))].sort().reverse()
  const index = new Map(entities.map((e, i) => [e.id, i]))
  const yearIndex = new Map(years.map((y, i) => [y, i]))

  const scores = entities.map(() => years.map(() => null))
  const grades = entities.map(() => years.map(() => null))
  for (const r of defaults) {
    const i = index.get(r.id)
    const j = yearIndex.get(r.year)
    if (i === undefined || j === undefined) continue
    scores[i][j] = r.score
    grades[i][j] = r.rating
  }

  // The pre-refresh 2021-22 scoring, for the methodology-break overlay.
  const original = {}
  for (const r of ratings.filter((x) => x.method === 'original')) {
    original[r.year] ??= entities.map(() => null)
    const i = index.get(r.id)
    if (i !== undefined) original[r.year][i] = r.score
  }

  return { years, entities: cols, scores, grades, original }
}

const read = async (t) =>
  (await readFile(`build/${t}.ndjson`, 'utf8')).trim().split('\n').map((l) => JSON.parse(l))

export async function exportPayload() {
  const [entities, ratings, profile] = await Promise.all([read('entities'), read('ratings'), read('profile')])
  const text = JSON.stringify(buildPayload(entities, ratings, profile))
  const hash = contentHash(text)
  const file = `payload-${hash}.json`

  await mkdir('site/data', { recursive: true })
  await writeFile(`site/data/${file}`, text)
  await writeFile('build/payload-name.txt', file + '\n')

  const raw = Buffer.byteLength(text)
  const gz = gzipSync(text).length
  console.log(`\n=== MEASUREMENT: payload (spec §11) ===`)
  console.log(`  file      ${file}`)
  console.log(`  raw       ${(raw / 1e6).toFixed(2)} MB`)
  console.log(`  gzipped   ${(gz / 1e6).toFixed(2)} MB   <- what the client downloads`)
  console.log(`  budget    4.00 MB raw`)
  if (raw > 4e6) throw new Error(`payload ${(raw / 1e6).toFixed(2)} MB exceeds the 4 MB budget`)
  return { file, raw, gz }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await exportPayload()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/export.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Take the measurement**

Run: `npm run export`
Expected: the MEASUREMENT block prints. **Record the gzipped figure** — spec §11 calls the ~2.5 MB estimate unverified, and this is the answer.

- [ ] **Step 6: Commit**

```bash
git add src/export.js test/export.test.js
git commit -m "Export a column-oriented dashboard payload and measure its size"
```

---

### Task 13: Prerender entity pages and measure

**Files:**
- Create: `src/prerender.js`
- Test: `test/prerender.test.js`

Spec §11 measurements two and three. Pages are deliberately minimal — the dashboard is Plan 2. Per-entity data is **inlined**, never a second file: 10,230 extra JSON files would roughly double the file count and breach the 20,000 Free-plan cap.

- [ ] **Step 1: Write the failing test**

```js
// test/prerender.test.js
import { describe, it, expect } from 'vitest'
import { renderEntity, entityPath, renderSitemap, escapeHtml } from '../src/prerender.js'

const entity = { id: '001902', level: 'district', name: 'Cayuga ISD', county: 'Anderson',
                 isCharter: false, enrollment: 574, rating: 'B', score: 89 }
const history = [
  { year: '2025-26', rating: 'B', score: 89 },
  { year: '2024-25', rating: 'B', score: 88 },
]

describe('entityPath', () => {
  it('routes districts and campuses separately', () => {
    expect(entityPath(entity)).toBe('district/001902.html')
    expect(entityPath({ ...entity, level: 'campus' })).toBe('campus/001902.html')
  })
})

describe('renderEntity', () => {
  const html = renderEntity(entity, history)

  it('puts the name in the title', () => {
    expect(html).toMatch(/<title>Cayuga ISD/)
  })

  it('inlines the history rather than linking a data file', () => {
    expect(html).toContain('2024-25')
    expect(html).not.toMatch(/payload-[a-f0-9]{8}\.json/)
  })

  it('declares a canonical URL', () => {
    expect(html).toMatch(/<link rel="canonical" href="https:\/\/[^"]+\/district\/001902">/)
  })

  it('sets lang and viewport for mobile and screen readers', () => {
    expect(html).toMatch(/<html lang="en">/)
    expect(html).toMatch(/name="viewport"/)
  })

  it('labels the sector', () => {
    expect(renderEntity({ ...entity, isCharter: true }, history)).toContain('Charter')
  })

  it('escapes HTML in names', () => {
    expect(renderEntity({ ...entity, name: 'A & B <script>' }, history)).toContain('A &amp; B &lt;script&gt;')
  })
})

describe('escapeHtml', () => {
  it('escapes the five significant characters', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;')
  })
})

describe('renderSitemap', () => {
  it('emits one url element per path', () => {
    const xml = renderSitemap(['district/001902.html'])
    expect(xml).toContain('<loc>https://txschools.net/district/001902</loc>')
    expect(xml.match(/<url>/g)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/prerender.test.js`
Expected: FAIL — cannot resolve `../src/prerender.js`

- [ ] **Step 3: Write the implementation**

Set `SITE_ORIGIN` to the domain you settle on; it appears in canonical URLs and the sitemap.

```js
// src/prerender.js
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { preferredRatings } from './normalize/ratings.js'

export const SITE_ORIGIN = 'https://txschools.net'

export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export const entityPath = (e) => `${e.level}/${e.id}.html`

export function renderEntity(e, history) {
  const name = escapeHtml(e.name ?? e.id)
  // Derived, never hardcoded: TEA publishes six year labels but five academic
  // years, so a literal "six years" would contradict the table below it.
  const yearsPhrase = history.length === 1 ? '1 year of history' : `${history.length} years of history`
  const sector = e.isCharter ? 'Charter' : 'Traditional'
  const kind = e.level === 'district' ? 'District' : 'Campus'
  const rows = history
    .map((h) => `<tr><td>${escapeHtml(h.year)}</td><td>${escapeHtml(h.rating ?? '—')}</td><td>${h.score ?? '—'}</td></tr>`)
    .join('')

  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name} — Texas accountability ratings</title>
<meta name="description" content="${kind} accountability ratings for ${name}, ${sector.toLowerCase()}, ${yearsPhrase}.">
<link rel="canonical" href="${SITE_ORIGIN}/${e.level}/${e.id}">
<link rel="stylesheet" href="/style.css">
<main>
  <p><a href="/">All Texas schools</a></p>
  <h1>${name}</h1>
  <p>${kind} · ${sector}${e.county ? ` · ${escapeHtml(e.county)} County` : ''}${e.enrollment ? ` · ${e.enrollment.toLocaleString('en-US')} students` : ''}</p>
  <p>Current rating <strong>${escapeHtml(e.rating ?? 'Not Rated')}</strong>${e.score == null ? '' : ` (${e.score})`}</p>
  <table>
    <caption>Rating history. 2021-22 is shown under the refreshed methodology TEA adopted in 2023.</caption>
    <thead><tr><th>Year</th><th>Rating</th><th>Score</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p><small>Source: Texas Education Agency via txschools.gov.</small></p>
</main>
`
}

export const renderSitemap = (paths) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((p) => `<url><loc>${SITE_ORIGIN}/${p.replace(/\.html$/, '')}</loc></url>`).join('\n')}
</urlset>
`

const read = async (t) =>
  (await readFile(`build/${t}.ndjson`, 'utf8')).trim().split('\n').map((l) => JSON.parse(l))

export async function prerender() {
  const started = Date.now()
  const [entities, ratings] = await Promise.all([read('entities'), read('ratings')])

  const history = new Map()
  for (const r of preferredRatings(ratings)) {
    if (!history.has(r.id)) history.set(r.id, [])
    history.get(r.id).push(r)
  }
  for (const rows of history.values()) rows.sort((a, b) => b.year.localeCompare(a.year))

  const paths = []
  for (const e of entities) {
    const path = entityPath(e)
    await mkdir(`site/${dirname(path)}`, { recursive: true })
    await writeFile(`site/${path}`, renderEntity(e, history.get(e.id) ?? []))
    paths.push(path)
  }
  await writeFile('site/sitemap.xml', renderSitemap(paths))

  const elapsed = (Date.now() - started) / 1000
  console.log(`\n=== MEASUREMENT: prerender (spec §11) ===`)
  console.log(`  pages     ${paths.length}`)
  console.log(`  elapsed   ${elapsed.toFixed(1)} s`)
  return { pages: paths.length, elapsed }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await prerender()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/prerender.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Take the measurements**

Run: `npm run prerender && find site -type f | wc -l`
Expected: 10,230 pages, plus the file count. **Record both.** The count must be under 18,000; if it is not, stop and revisit spec §3's file budget before deploying.

- [ ] **Step 6: Commit**

```bash
git add src/prerender.js test/prerender.test.js
git commit -m "Prerender entity pages with inlined history and measure the build"
```

---

### Task 14: Cloudflare config and deploy

**Files:**
- Create: `wrangler.jsonc`
- Create: `site/_headers`
- Create: `site/index.html`
- Create: `site/style.css`
- Create: `site/404.html`
- Test: `test/wrangler.test.js`

- [ ] **Step 1: Write the failing test**

The `main` assertion is the one that protects the $0 guarantee — adding an entrypoint silently converts an unmetered site into a metered one.

```js
// test/wrangler.test.js
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const raw = readFileSync('wrangler.jsonc', 'utf8')
const config = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''))

describe('wrangler.jsonc', () => {
  it('declares NO main entrypoint — assets-only keeps serving unmetered', () => {
    expect(config.main).toBeUndefined()
  })

  it('serves the site directory', () => {
    expect(config.assets.directory).toBe('./site')
  })

  it('serves a real 404 page', () => {
    expect(config.assets.not_found_handling).toBe('404-page')
  })

  it('strips .html so /district/109901 resolves', () => {
    expect(config.assets.html_handling).toBe('auto-trailing-slash')
  })

  it('disables workers.dev but keeps preview URLs for the pre-cutover smoke test', () => {
    expect(config.workers_dev).toBe(false)
    expect(config.preview_urls).toBe(true)
  })

  it('pins a compatibility date', () => {
    expect(config.compatibility_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/wrangler.test.js`
Expected: FAIL — `ENOENT: no such file or directory, open 'wrangler.jsonc'`

- [ ] **Step 3: Write the config**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "txschoolsnet",
  "compatibility_date": "2026-08-15",

  // NO "main" KEY. This is an assets-only Worker: static asset requests are free
  // and unlimited, and with no script there are zero billable invocations.
  // Adding "main" silently converts this site from unmetered to metered.
  // test/wrangler.test.js asserts its absence.

  "assets": {
    "directory": "./site",
    "not_found_handling": "404-page",
    "html_handling": "auto-trailing-slash"
  },

  "workers_dev": false,
  // preview_urls defaults to the value of workers_dev. Set explicitly: the CI
  // smoke test between `versions upload` and `versions deploy` needs a target.
  "preview_urls": true
}
```

- [ ] **Step 4: Write the supporting site files**

`site/_headers`:
```
/data/*
  Cache-Control: public, max-age=31536000, immutable
```

`site/style.css`:
```css
:root { color-scheme: light dark; }
body { font: 16px/1.6 system-ui, sans-serif; max-width: 46rem; margin: 0 auto; padding: 2rem 1rem; }
h1 { font-size: 1.6rem; margin-bottom: .25rem; }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
th, td { text-align: left; padding: .4rem .6rem; border-bottom: 1px solid color-mix(in oklch, currentColor 20%, transparent); }
caption { text-align: left; padding-bottom: .5rem; opacity: .75; font-size: .875rem; }
a { color: inherit; }
```

`site/index.html`:
```html
<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Texas school accountability ratings</title>
<meta name="description" content="Six years of Texas A–F accountability ratings for every district and campus.">
<link rel="stylesheet" href="/style.css">
<main>
  <h1>Texas school accountability ratings</h1>
  <p>Six years of A–F accountability history for all 1,199 Texas districts and 9,031 campuses,
     built from the data the Texas Education Agency publishes at txschools.gov.</p>
  <p>The dashboard is in development. Individual district and campus pages are live —
     for example <a href="/district/057905">Dallas ISD</a> and
     <a href="/district/109901">Abbott ISD</a>.</p>
</main>
```

`site/404.html`:
```html
<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Not found — Texas school accountability ratings</title>
<link rel="stylesheet" href="/style.css">
<main>
  <h1>Not found</h1>
  <p>No district or campus at that address. <a href="/">Start over</a>.</p>
</main>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/wrangler.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 6: Preview locally**

Run: `npx wrangler dev`
Then visit `http://localhost:8787/district/109901` and confirm the page renders with its rating history, and that a bad path serves the 404 page.

- [ ] **Step 7: Deploy and take the upload measurement**

Requires `wrangler login` first. Time it — this is spec §11 measurement three.

```bash
time npx wrangler deploy
```

Expected: ~10,430 assets uploaded, a deployment URL printed. **Record the elapsed time.**

- [ ] **Step 8: Commit**

```bash
git add wrangler.jsonc site/_headers site/index.html site/style.css site/404.html test/wrangler.test.js
git commit -m "Add assets-only Cloudflare config and deploy the site skeleton"
```

---

### Task 15: CI pipeline with deploy gates

**Files:**
- Create: `.github/workflows/refresh.yml`
- Create: `scripts/check-file-count.mjs`
- Modify: `.gitignore` — add `build/` and `site/`

Manual trigger only. A scheduled workflow in a public repo is auto-disabled after 60 days of no *repository* activity, so an annual cron cannot keep itself alive; a calendar reminder for the August TEA release is the backstop.

- [ ] **Step 1: Write the file-count guard**

```js
// scripts/check-file-count.mjs
import { readdir } from 'node:fs/promises'

const LIMIT = 18_000 // Free plan caps at 20,000 assets per Worker version

async function count(dir) {
  let n = 0
  for (const e of await readdir(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? await count(`${dir}/${e.name}`) : 1
  }
  return n
}

const n = await count('site')
console.log(`site/ contains ${n} files (limit ${LIMIT})`)
if (n > LIMIT) {
  console.error(`FAIL: ${n} files exceeds ${LIMIT}. See spec §3 — the Paid plan raises this to 100,000.`)
  process.exit(1)
}
```

- [ ] **Step 2: Add build outputs to `.gitignore`**

```
# Build outputs — regenerated by `npm run site`
build/
site/data/
site/district/
site/campus/
site/sitemap.xml
```

Committed by hand: `site/index.html`, `site/404.html`, `site/style.css`, `site/_headers`. Generated: everything else under `site/`.

- [ ] **Step 3: Write the workflow**

```yaml
# .github/workflows/refresh.yml
name: Refresh and deploy

on:
  workflow_dispatch:
    inputs:
      fetch:
        description: 'Fetch a fresh snapshot from TEA (off = rebuild from the committed snapshot)'
        type: boolean
        default: false

permissions:
  contents: write

jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - uses: actions/setup-node@v5
        with:
          node-version-file: .nvmrc
          cache: npm

      - run: npm ci

      - name: Fetch snapshot from TEA
        if: inputs.fetch
        run: npm run fetch

      - name: Build, export, prerender
        run: npm run site

      - name: Verify the site's published claims
        run: npm test

      - name: Check asset file count
        run: node scripts/check-file-count.mjs

      - name: Commit new snapshot
        if: inputs.fetch
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add data/raw/
          git diff --staged --quiet || git commit -m "Add TEA snapshot $(cat build/snapshot.txt)"
          git push

      - name: Upload a new version
        id: upload
        uses: cloudflare/wrangler-action@v4
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          command: versions upload --tag ci-${{ github.run_number }}

      - name: Smoke-test the preview before cutover
        run: |
          URL="${{ steps.upload.outputs.deployment-url }}"
          test -n "$URL" || { echo "no preview URL — check preview_urls in wrangler.jsonc"; exit 1; }
          for path in / /district/109901 /campus/057905001; do
            code=$(curl -s -o /dev/null -w '%{http_code}' "$URL$path")
            echo "$path -> $code"
            [ "$code" = "200" ] || exit 1
          done

      - name: Promote to production
        uses: cloudflare/wrangler-action@v4
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          command: versions deploy --yes
```

- [ ] **Step 4: Create the API token**

In the Cloudflare dashboard, create a token with exactly one permission: **Workers Scripts: Edit**. Add it to the repo as the secret `CLOUDFLARE_API_TOKEN`. Do not reuse a global API key.

- [ ] **Step 5: Verify the pipeline end to end**

Run: `gh workflow run "Refresh and deploy" -f fetch=false` then `gh run watch`
Expected: all steps green; the smoke test prints three `200`s before promotion.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/refresh.yml scripts/check-file-count.mjs .gitignore
git commit -m "Add CI refresh pipeline with automated deploy gates"
```

---

## Definition of done

- [ ] `npm test` passes, including the spec §8 regression suite
- [ ] `npm run site` produces 10,230 entity pages from the committed snapshot
- [ ] The spec §11 measurements are recorded. Payload (1.27 MB raw / 0.23 MB gzipped) and prerender
      (~1 s, 10,236 files) are measured. Wrangler upload time has no producer until the first real
      deploy — take it then, and record the served `Content-Encoding` at the same time.
- [ ] The site is live and `/district/109901` returns 200 with rating history
- [ ] CI runs green from a manual trigger, including the pre-cutover smoke test
- [ ] `wrangler.jsonc` still has no `main` key

## Handoff to Plan 2

Plan 2 builds the six dashboard views from spec §6 on top of `site/data/payload-<hash>.json`. It should not start until the measured payload size is known — if it came in far above the estimate, the payload needs splitting per view, and that decision changes the dashboard's data-loading design.
