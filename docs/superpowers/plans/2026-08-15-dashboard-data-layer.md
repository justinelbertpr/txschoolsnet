# Dashboard Data Layer — Implementation Plan (Plan 2, Phase A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the pipeline with the domain-score, finance and lookup data the six dashboard views need, and re-measure the payload so the frontend's loading design rests on a number rather than a guess.

**Architecture:** Two new normalizers plus a lookup module, feeding two different destinations. Small, shared, cross-filterable data goes into the dashboard payload. Large per-entity detail is inlined into the already-prerendered entity pages, where it costs nothing at the dashboard route.

**Tech Stack:** Unchanged — plain Node 24 ESM, Vitest, no dependencies.

**Scope:** This is Phase A of Plan 2. Phase B (the six views themselves) is deliberately not planned yet: design §11's discipline is to measure before designing, and the payload size after these additions determines whether the frontend can load one payload or must split per view. Phase B gets written when Task 6 reports its number.

---

## The routing decision that shapes this plan

The six views from design §6 need different data at different granularity:

| View | Data | Destination |
|---|---|---|
| 1 Statewide shift | grades × years, already in payload | payload (no change) |
| 2 Grade flow | grades × years, already in payload | payload (no change) |
| 3 Movers | scores × years, already in payload | payload (no change) |
| 4 Poverty scatter | score + ecoDisPct, already in payload | payload (no change) |
| 5 Regions | **region names** | payload (small lookup) |
| 6 Entity detail | **domain scores, cut scores, finance** | **prerendered page, inlined** |

Views 1–5 cross-filter across all 10,230 entities inside a frame, so their data must be resident in the browser. View 6 shows one entity at a time and already has a prerendered page — inlining there means a visitor arriving from search on one district downloads that district's detail and nothing else, and the dashboard payload never carries 10,230 entities' worth of domain history it would use one row of at a time.

`domains` is roughly 95,000 rows and `finance` roughly 79,000. Putting either in the shared payload would multiply it several times over to serve a view that reads one entity's slice.

---

## File structure

| File | Responsibility |
|---|---|
| `src/normalize/domains.js` | overview + the three change_over_time_* files → `domains` rows |
| `src/normalize/finance.js` | finance_district + finance_school → `finance` rows |
| `src/lookups.js` | region and county id → name maps, derived from the district file |
| `src/build.js` | extended: emit `domains.ndjson`, `finance.ndjson`, `lookups.json` |
| `src/export.js` | extended: add lookups and three entity columns to the payload |
| `src/prerender.js` | extended: inline domain history and finance into each page |

---

### Task 1: Normalize domain scores

**Files:**
- Create: `src/normalize/domains.js`
- Test: `test/normalize/domains.test.js`

TEA splits the overall rating into three domains: Student Achievement (D1), School Progress (D2) and Closing the Gaps (D3). `overview.json` carries three years of each domain's score plus the **cut score** — the minimum needed for the next letter grade — which is what makes "how close is this district to a B" answerable. The three `change_over_time_*` files carry the same domains as graded history.

The `_min` fields in `overview.json` are scalars, not arrays: one cut score per domain, applying to the most recent year.

- [ ] **Step 1: Write the failing test**

```js
// test/normalize/domains.test.js
import { describe, it, expect } from 'vitest'
import { toDomains, DOMAIN_LABELS } from '../../src/normalize/domains.js'

const overview = {
  id: '001902',
  school_year: ['2023-24', '2024-25', '2025-26'],
  ach_score: ['86', '88', '89'], ach_min: '77',
  prog_score: ['85', '86', '90'], prog_min: '76',
  ctg_score: ['84', '89', '88'], ctg_min: '75',
  proga_score: ['73', '84', '81'], proga_min: '64',
  progb_score: ['85', '86', '90'], progb_min: '76',
}

describe('toDomains', () => {
  it('emits one row per entity, year and domain', () => {
    const rows = toDomains([overview])
    expect(rows.filter((r) => r.domain === 'achievement')).toHaveLength(3)
    expect(new Set(rows.map((r) => r.domain))).toEqual(
      new Set(['achievement', 'progress', 'gaps', 'progress_growth', 'progress_relative'])
    )
  })

  it('coerces scores to numbers', () => {
    const r = toDomains([overview]).find((x) => x.domain === 'achievement' && x.year === '2025-26')
    expect(r.score).toBe(89)
  })

  it('attaches the cut score to every year of a domain', () => {
    const rows = toDomains([overview]).filter((r) => r.domain === 'achievement')
    expect(rows.every((r) => r.cutScore === 77)).toBe(true)
  })

  it('exposes the margin above the cut score', () => {
    const r = toDomains([overview]).find((x) => x.domain === 'gaps' && x.year === '2025-26')
    expect(r.score).toBe(88)
    expect(r.cutScore).toBe(75)
    expect(r.margin).toBe(13)
  })

  it('nulls a missing score rather than emitting zero', () => {
    const rows = toDomains([{ ...overview, ach_score: ['', '88', '89'] }])
    expect(rows.find((r) => r.domain === 'achievement' && r.year === '2023-24').score).toBeNull()
  })

  it('nulls the margin when either side is missing', () => {
    const rows = toDomains([{ ...overview, ach_min: '' }])
    expect(rows.find((r) => r.domain === 'achievement').margin).toBeNull()
  })

  it('labels every domain for display', () => {
    expect(DOMAIN_LABELS.achievement).toBe('Student Achievement')
    expect(Object.keys(DOMAIN_LABELS)).toHaveLength(5)
  })

  it('skips a domain absent from the record', () => {
    const rows = toDomains([{ id: 'x', school_year: ['2025-26'], ach_score: ['80'], ach_min: '70' }])
    expect(rows).toHaveLength(1)
    expect(rows[0].domain).toBe('achievement')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/normalize/domains.test.js`
Expected: FAIL — cannot resolve `../../src/normalize/domains.js`

- [ ] **Step 3: Write the implementation**

```js
// src/normalize/domains.js
import { explode } from '../explode.js'
import { num } from './entities.js'

/**
 * TEA's five reported domains. D2 carries two sub-domains — growth and
 * relative performance — and a school takes the better of the two.
 */
export const DOMAIN_LABELS = {
  achievement: 'Student Achievement',
  progress: 'School Progress',
  gaps: 'Closing the Gaps',
  progress_growth: 'Academic Growth',
  progress_relative: 'Relative Performance',
}

const SOURCES = [
  { domain: 'achievement', score: 'ach_score', min: 'ach_min' },
  { domain: 'progress', score: 'prog_score', min: 'prog_min' },
  { domain: 'gaps', score: 'ctg_score', min: 'ctg_min' },
  { domain: 'progress_growth', score: 'proga_score', min: 'proga_min' },
  { domain: 'progress_relative', score: 'progb_score', min: 'progb_min' },
]

export function toDomains(records) {
  return records.flatMap((rec) =>
    SOURCES.filter((s) => Array.isArray(rec[s.score])).flatMap((s) => {
      const cutScore = num(rec[s.min])
      return explode(rec, { school_year: 'year', [s.score]: 'score' }, { domain: s.domain }).map(
        ({ id, year, score, domain }) => {
          const value = num(score)
          return {
            id,
            year,
            domain,
            score: value,
            cutScore,
            margin: value === null || cutScore === null ? null : value - cutScore,
          }
        }
      )
    })
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/normalize/domains.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Verify against the real snapshot**

```bash
node --input-type=module -e "
const {gunzipSync}=await import('node:zlib');
const {readFileSync}=await import('node:fs');
const {toDomains}=await import('./src/normalize/domains.js');
const recs=JSON.parse(gunzipSync(readFileSync('data/raw/2026-08/overview.json.gz')).toString('utf8'));
const rows=toDomains(recs);
console.log('records',recs.length,'-> rows',rows.length);
const byDomain={}; for(const r of rows) byDomain[r.domain]=(byDomain[r.domain]||0)+1;
console.log('by domain',JSON.stringify(byDomain));
console.log('NaN scores',rows.filter(r=>Number.isNaN(r.score)).length);
console.log('null scores',rows.filter(r=>r.score===null).length);
console.log('cayuga',JSON.stringify(rows.filter(r=>r.id==='001902'&&r.year==='2025-26')));
const neg=rows.filter(r=>r.margin!==null&&r.margin<0);
console.log('entity-domains below their cut score:',neg.length);
"
```

Expected: 10,234 records producing roughly 150,000 rows, no NaN, and Cayuga's 2025-26 achievement score 89 against a cut of 77 for a margin of 12. Report the actual output. A negative margin is meaningful, not an error — it identifies a domain scoring below the threshold for its current grade.

- [ ] **Step 6: Commit**

```bash
git add src/normalize/domains.js test/normalize/domains.test.js
git commit -m "Normalize domain scores with their cut-score margins"
```

---

### Task 2: Normalize finance

**Files:**
- Create: `src/normalize/finance.js`
- Test: `test/normalize/finance.test.js`

Eight years of per-pupil spending, each entity against its peer group and the state. This is the data that answers "is this district underfunded relative to comparable districts" — which is the obvious rebuttal to any accountability claim, so having it on the page matters.

- [ ] **Step 1: Write the failing test**

```js
// test/normalize/finance.test.js
import { describe, it, expect } from 'vitest'
import { toFinance } from '../../src/normalize/finance.js'

const rec = {
  id: '001902',
  year: ['2018', '2019', '2020'],
  expenditure_district: [14725, 15931, 16938],
  expenditure_peer: [13378, 14225, 15250],
  expenditure_state: [13054, 13108, 14058],
  revenue_district: [15091, 16519, 18420],
  revenue_peer: [12862, 13889, 14724],
  revenue_state: [11729, 12022, 12500],
}

describe('toFinance', () => {
  it('emits one row per entity-year', () => {
    expect(toFinance([rec])).toHaveLength(3)
  })

  it('carries per-pupil spend for entity, peer and state', () => {
    const r = toFinance([rec]).find((x) => x.year === '2020')
    expect(r.spendEntity).toBe(16938)
    expect(r.spendPeer).toBe(15250)
    expect(r.spendState).toBe(14058)
  })

  it('carries per-pupil revenue', () => {
    const r = toFinance([rec]).find((x) => x.year === '2018')
    expect(r.revenueEntity).toBe(15091)
  })

  it('keeps the year as a string', () => {
    expect(toFinance([rec])[0].year).toBe('2018')
  })

  it('nulls a missing figure rather than emitting zero', () => {
    const rows = toFinance([{ ...rec, expenditure_peer: [null, 14225, 15250] }])
    expect(rows.find((r) => r.year === '2018').spendPeer).toBeNull()
  })

  it('returns nothing for a record with no year array', () => {
    expect(toFinance([{ id: 'x' }])).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/normalize/finance.test.js`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Write the implementation**

```js
// src/normalize/finance.js
import { explode } from '../explode.js'
import { num, str } from './entities.js'

const MAPPING = {
  year: 'year',
  expenditure_district: 'spendEntity',
  expenditure_peer: 'spendPeer',
  expenditure_state: 'spendState',
  revenue_district: 'revenueEntity',
  revenue_peer: 'revenuePeer',
  revenue_state: 'revenueState',
}

const MONEY = ['spendEntity', 'spendPeer', 'spendState', 'revenueEntity', 'revenuePeer', 'revenueState']

export function toFinance(records) {
  return records.flatMap((rec) =>
    explode(rec, MAPPING).map((row) => {
      const out = { id: row.id, year: str(row.year) }
      for (const k of MONEY) out[k] = num(row[k])
      return out
    })
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/normalize/finance.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Verify against the real snapshot**

```bash
node --input-type=module -e "
const {gunzipSync}=await import('node:zlib');
const {readFileSync}=await import('node:fs');
const {toFinance}=await import('./src/normalize/finance.js');
const rd=n=>JSON.parse(gunzipSync(readFileSync('data/raw/2026-08/'+n+'.json.gz')).toString('utf8'));
const rows=[...toFinance(rd('finance_district')), ...toFinance(rd('finance_school'))];
console.log('rows',rows.length);
console.log('years',JSON.stringify([...new Set(rows.map(r=>r.year))].sort()));
console.log('NaN',rows.filter(r=>MONEY_NAN(r)).length);
function MONEY_NAN(r){return Object.values(r).some(v=>typeof v==='number'&&Number.isNaN(v))}
console.log('cayuga 2025',JSON.stringify(rows.find(r=>r.id==='001902'&&r.year==='2025')));
const latest=rows.filter(r=>r.year==='2025'&&r.spendEntity!==null&&r.spendPeer!==null);
const above=latest.filter(r=>r.spendEntity>r.spendPeer).length;
console.log('entities outspending their peer group in 2025:',above,'of',latest.length);
"
```

Expected: roughly 79,000 rows across 2018–2025, no NaN. Report the actual output.

- [ ] **Step 6: Commit**

```bash
git add src/normalize/finance.js test/normalize/finance.test.js
git commit -m "Normalize eight years of per-pupil finance against peer and state"
```

---

### Task 3: Region and county lookups

**Files:**
- Create: `src/lookups.js`
- Test: `test/lookups.test.js`

View 5 groups by the 20 Education Service Center regions and needs their names. The district file already carries both id and label on every row, so no extra source file is needed — but the labels must be derived rather than hardcoded, since a hardcoded list silently rots.

- [ ] **Step 1: Write the failing test**

```js
// test/lookups.test.js
import { describe, it, expect } from 'vitest'
import { buildLookups } from '../src/lookups.js'

const districts = [
  { id: '001902', region_id: '07', region: 'Region 07: Kilgore', county_id: '001', county: 'Anderson' },
  { id: '001903', region_id: '07', region: 'Region 07: Kilgore', county_id: '002', county: 'Andrews' },
  { id: '057905', region_id: '10', region: 'Region 10: Richardson', county_id: '057', county: 'Dallas' },
]

describe('buildLookups', () => {
  it('maps region id to name', () => {
    expect(buildLookups(districts).regions['07']).toBe('Region 07: Kilgore')
  })

  it('maps county id to name', () => {
    expect(buildLookups(districts).counties['057']).toBe('Dallas')
  })

  it('deduplicates repeated ids', () => {
    expect(Object.keys(buildLookups(districts).regions)).toHaveLength(2)
  })

  it('sorts keys so the output is stable across builds', () => {
    const keys = Object.keys(buildLookups(districts).counties)
    expect(keys).toEqual([...keys].sort())
  })

  it('ignores rows with a missing id', () => {
    expect(Object.keys(buildLookups([...districts, { id: 'x' }]).regions)).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lookups.test.js`
Expected: FAIL — cannot resolve `../src/lookups.js`

- [ ] **Step 3: Write the implementation**

```js
// src/lookups.js
import { str } from './normalize/entities.js'

const collect = (rows, idKey, nameKey) => {
  const map = {}
  for (const r of rows) {
    const id = str(r[idKey])
    const name = str(r[nameKey])
    if (id && name) map[id] = name
  }
  // Sorted so a rebuild from identical input produces an identical payload hash.
  return Object.fromEntries(Object.keys(map).sort().map((k) => [k, map[k]]))
}

/** Region and county names, derived from the district file rather than hardcoded. */
export const buildLookups = (districts) => ({
  regions: collect(districts, 'region_id', 'region'),
  counties: collect(districts, 'county_id', 'county'),
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lookups.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lookups.js test/lookups.test.js
git commit -m "Derive region and county names from the district file"
```

---

### Task 4: Wire the new tables into the build

**Files:**
- Modify: `src/build.js`
- Modify: `test/build.test.js`

- [ ] **Step 1: Extend `build()`**

Read `overview`, `finance_district`, `finance_school` alongside the existing sources. Produce `domains` and `finance`, apply the same orphan filtering the existing tables use (the four known phantom ids appear in these files too — verify and report the counts rather than assuming), then write `build/domains.ndjson`, `build/finance.ndjson` and `build/lookups.json`.

`assertIntegrity` must cover the new tables. Do not exempt them.

- [ ] **Step 2: Extend the build test**

Assert that `build()` emits the two new NDJSON files and the lookups JSON, and that integrity holds across all five tables.

- [ ] **Step 3: Run the real build**

Run: `npm run build`
Report the full output including the new row counts and how many orphan rows each new table dropped.

- [ ] **Step 4: Commit**

```bash
git add src/build.js test/build.test.js
git commit -m "Build the domain, finance and lookup tables"
```

---

### Task 5: Inline detail into the prerendered pages

**Files:**
- Modify: `src/prerender.js`
- Modify: `test/prerender.test.js`

Design §6 view 6 wants, per entity: the six-year line (already present), domain decomposition, distance to the next cut score, and finance against the peer group. All of it goes into the page, none into the shared payload.

- [ ] **Step 1: Extend `renderEntity`**

Add, after the existing rating-history table:

- A **domain table** — one row per domain with its label from `DOMAIN_LABELS`, current score, cut score, and margin. Show the margin with an explicit sign so "+12" and "−3" read differently at a glance. A negative margin means the domain sits below the threshold for its grade and should be visually distinguishable without relying on colour alone.
- A **finance table** — the most recent year's per-pupil spend for the entity, its peer group and the state, plus the entity's difference from peer.
- The **consecutive-unacceptable count** when `multYear > 0`, stated plainly: an entity at three or more years is in state-intervention territory and that is the single most consequential fact on its page.

Entities missing any of these must render without the corresponding section rather than showing an empty table. Campuses have finance data; districts have both.

- [ ] **Step 2: Extend the tests**

Cover: a district with all sections; an entity with no finance data omits that section; a negative margin renders with a minus sign; `multYear: 0` produces no intervention notice while `multYear: 3` does.

- [ ] **Step 3: Verify on real pages**

Run `npm run site`, then inspect a district with a known non-zero `multYear` and confirm the notice appears. Report the page count and the new average page size — inlining detail grows every page, and the file-count guard does not catch size growth.

- [ ] **Step 4: Commit**

```bash
git add src/prerender.js test/prerender.test.js
git commit -m "Inline domain, finance and intervention detail into entity pages"
```

---

### Task 6: Extend the payload and re-measure

**Files:**
- Modify: `src/export.js`
- Modify: `test/export.test.js`
- Modify: `test/regression/published.test.js`

- [ ] **Step 1: Add to the payload**

Add `regions` and `counties` from `build/lookups.json`, and three entity columns: `districtId` (so a campus can be traced to its district), `multYear`, and `campusType`. Nothing else — `domains` and `finance` stay out by design.

- [ ] **Step 2: Extend the tests**

Assert the lookups are present and non-empty, that the new columns match the entity count, and that a campus's `districtId` resolves to a district in the same payload.

- [ ] **Step 3: Re-measure**

Run: `npm run site`

**Record the new raw and gzipped payload size and compare against the 1.27 MB / 0.23 MB baseline.** This number decides Phase B's loading design: under roughly 0.5 MB gzipped the frontend loads one payload on the dashboard route; materially above and it splits per view.

- [ ] **Step 4: Commit**

```bash
git add src/export.js test/export.test.js test/regression/published.test.js
git commit -m "Add lookups and district linkage to the payload, and re-measure"
```

---

## Definition of done

- [ ] `npm test` passes with the new suites
- [ ] `npm run site` emits five NDJSON tables plus lookups, and 10,230 enriched pages
- [ ] Referential integrity holds across all five tables with orphan counts reported
- [ ] The payload is re-measured and the figure recorded in design §11
- [ ] Page count still under the 18,000 CI guard, and the new average page size recorded

## Handoff to Phase B

Phase B builds the six views. It should not be planned until Task 6 reports the payload size, because that number determines whether the dashboard loads one file or several — and that choice shapes every view's data access.
