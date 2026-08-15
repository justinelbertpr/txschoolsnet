# Texas Accountability Dashboard — Design

**Date:** 2026-08-15
**Status:** Approved design, ready for implementation planning

## 1. Purpose

A public-facing dashboard showing how Texas public schools are moving through the A–F
accountability system across the five academic years of available history — 2021-22 through
2025-26 — with traditional ISDs and charters comparable at every step.

(TEA publishes **six** year labels, but two of them are the same year: `2021-22` and
`2021-22 What If` are that year scored under the pre- and post-2023 methodologies. §5 collapses
them. Anything that says "six years" is counting labels, not years.)

### Editorial thesis

> Texas public schools are recovering from the pandemic-era trough, traditional ISDs are
> leading that recovery, and the steepest gains are in the highest-poverty schools.

This thesis was validated against the data before being adopted (§8). An earlier framing —
"traditional ISDs are the better place for kids" — was tested and rejected: it does not
survive enrollment weighting or a poverty control. The site makes claims it can defend.

## 2. Data source

`txschools.gov` is a React SPA backed entirely by static gzipped JSON files served from
`https://txschools.gov/data/`. There is no API, no authentication, and no rate limiting.
The full statewide dataset is 14 files, 52.5 MB raw / 4.5 MB gzipped.

| File | Rows | Contents |
|---|---|---|
| `districts.json` | 1,199 | District identity, current rating, all domain scores, enrollment, geo |
| `schools.json` | 9,031 | Same for campuses, plus campus type and grade span |
| `change_over_time.json` | 10,234 | 6 years of overall rating + score |
| `change_over_time_achievement.json` | 10,682 | 3 years, Domain 1 |
| `change_over_time_progress.json` | 10,682 | 3 years, Domain 2 |
| `change_over_time_gaps.json` | 10,682 | 3 years, Domain 3 |
| `overview.json` | 10,234 | 3 years of domain scores + cut score for each |
| `profile_tab.json` | 10,234 | Demographics, eco-dis, attendance, absenteeism, staff |
| `finance_district.json` | 1,195 | 8 years per-pupil spend/revenue vs peer vs state |
| `finance_school.json` | 8,723 | Campus finance |
| `ctg_districts.json` | 1,199 | Closing-the-Gaps detail by student group |
| `ctg_schools.json` | 9,031 | Campus CTG detail |
| `student_achievement_tab.json` | 9,913 | STAAR approach/meets/masters, CCMR, grad rate |
| `school_progress_tab.json` | 10,234 | Growth and relative-performance detail |

Note: files are served gzip-encoded and some tools will not transparently decompress them.
The fetcher must handle both cases.

## 3. Architecture

Five stages, each independently runnable and independently testable, all executed by one
GitHub Actions job.

```
fetch      14 TEA files  → data/raw/<YYYY-MM>/*.json.gz   verbatim, committed to git
build      raw snapshot  → build/*.ndjson                  normalized tidy tables
export     build/        → site/data/payload-<hash>.json   dashboard route only
prerender  build/        → site/district/<id>.html + campus/<id>.html   10,230 pages
deploy     site/         → Cloudflare Workers Static Assets  via wrangler
```

### No server-side database

The whole dataset is trivially small. All ~430,000 rows are small scalars; the normalized tables
total a few MB, and the dashboard payload built from them measures **1.27 MB raw / 0.23 MB
gzipped** (measured, §11). Both numbers are far below the threshold where moving data to a query
engine beats moving it to the client.

A database earns its place when the query set cannot be enumerated in advance over data too
large to move. Neither holds here: zero user-generated writes, one batch rebuild per year, and a
fully enumerable query set (six views × a fixed cross-product of global toggles, plus 10,230
detail pages). The dashboard's cross-filtering must recompute within a frame, so the payload has
to be resident in the browser regardless — and once it is, a server-side store answers nothing
the client does not already hold.

D1 was evaluated and rejected on specifics: the free tier's 100,000 rows-written/day cannot
absorb a ~430,000-row rebuild (~1.3M written rows with indexes), so it costs $5/month to run
once a year; it bills per row *scanned* in the request path; and imports block the database for
their duration, making the annual refresh an outage. R2 + Parquet + DuckDB-WASM was rejected as
a net loss at this size — the WASM bundle alone exceeds the data.

**No database in the build either.** The pipeline is plain Node with no native dependencies:
430,000 small scalar rows sort and aggregate in memory faster than a database could be installed.
Tables are written as NDJSON, which the DuckDB CLI reads directly via
`read_json_auto('build/*.ndjson')` — so ad-hoc SQL stays available for analysis without DuckDB
being a build dependency or a CI install step. Nothing is served from it.

### Hosting: Cloudflare Workers Static Assets

An assets-only Worker with **no `main` entrypoint**. Static asset requests are free and
unlimited with no storage cost, and with no script there are zero billable invocations — a
traffic spike costs the same as a quiet day. Total: $0/month on the Workers Free plan.

- **File budget:** ~10,230 entity pages + ~200 shell/CSS/JS/sitemap/data files ≈ 10,430 against
  the Free plan's 20,000-files-per-version limit. Per-entity data is inlined into each HTML page
  rather than shipped as a second per-entity JSON file, which would roughly double the count and
  breach the cap. CI fails the build above 18,000 files. The escape hatch is the Paid plan's
  100,000-file limit, which requires Wrangler ≥ 4.34.0 — so Wrangler is pinned to that floor now,
  before the guard ever trips.
- **Payload routing:** the payload (1.27 MB raw / 0.23 MB gzipped, measured) is fetched **only
  on the dashboard route**. Search
  traffic landing on `/district/109901` downloads kilobytes, not megabytes, because that page's
  data is already inlined.
- **Caching:** `/data/*` gets `max-age=31536000, immutable` via `_headers`, safe because payload
  filenames are content-hashed. HTML keeps the default `max-age=0, must-revalidate` + ETag so an
  annual rebuild propagates on next request.
- **Config:** `wrangler.jsonc` with `workers_dev: false` **and `preview_urls: true` set
  explicitly** — `preview_urls` otherwise defaults to the value of `workers_dev`, which would
  silently remove the target the pre-cutover smoke test depends on.

### Ingest runs in CI, not in a Worker

A Worker isolate caps at 128 MB against 52.5 MB of raw JSON that expands several-fold when
parsed, and free-tier cron CPU is 10 ms. GitHub Actions on a public repo is free with a 6-hour
job ceiling. Trigger is `workflow_dispatch` only, with a calendar reminder for the August TEA
release; scheduled workflows in public repos are auto-disabled after 60 days of no *repository*
activity, so a cron for an annual job cannot keep itself alive and is not attempted.

**Why dated raw snapshots are committed.** TEA overwrites these files in place on each release.
Committing each dated snapshot (~4.5 MB/year gzipped, ~27 MB over six years) turns the repo into
the site's own longitudinal archive and its provenance chain: every published claim traces to the
exact bytes TEA served on a given date. Published as per-year files, never one cumulative
archive, to stay under the 25 MiB per-file asset limit.

## 4. Data model

`build.js` explodes the source files' parallel-array structure into tidy long tables. A source
record like `{"academic_year": [...], "overall_rating": [...], "score": [...]}` becomes one row
per year. Row counts below are **measured** from the 2026-08 snapshot, not estimated.

| Table | Grain | Approx rows | Key columns |
|---|---|---|---|
| `entities` | district or campus | 10,230 (measured) | `id`, `level`, `districtId`, `name`, `regionId`, `countyId`, `isCharter`, `isAlt`, `campusType`, `enrollment`, `lat`, `lon` |
| `ratings` | entity × year × method | 58,984 | `id`, `year`, `method`, `rating`, `score` |
| `domains` | entity × year × domain | ~95,000 | `id`, `year`, `domain`, `score`, `grade`, `cut_score` |
| `profile` | entity, current year | 10,230 | `id`, `ecoDisPct`, `attendance`, `absenteeism`, `avgSalary` |
| `finance` | entity × year | ~79,000 | `id`, `year`, `per_pupil_entity`, `per_pupil_peer`, `per_pupil_state` |
| `groups` | entity × student group × measure | ~180,000 | `id`, `group`, `measure`, `value` |

Referential rule: every `id` in every table must exist in `entities`. Violations fail the build
loudly rather than being dropped.

## 5. Classification and methodology decisions

**Charter flag comes from `entity_type`, not the name.** 1,020 Traditional vs 179 Charter
districts. Name-matching on "ISD" would misclassify the 9 traditional districts that are not
ISDs — six CSDs, one MSD, and two others named for their grade span.

**`alt_standards = Yes` is flagged, not filtered.** 30 districts and 416 campuses are judged
under Alternative Education Accountability against a different bar. They are included by default
with a one-click exclude, since mixing them silently into statewide distributions distorts them.

**2021-22 carries a `method` column.** TEA refreshed the A–F methodology in 2023 and back-published
a "what if" rating applying the new rules to 2021-22 data. The same district can be an A under the
old method and a B under the new one at an identical underlying performance level. Trend charts
default to `what_if` as the apples-to-apples baseline; `original` is available as an overlay so
the methodology break is visible rather than hidden. Charts render a vertical rule at the break.

**Two baselines are always distinguishable.** Measured from 2021-22, traditional campuses are
still below where they started. Measured from the 2023-24 trough, they have gained strongly. Both
are true. Every trend view exposes the baseline selector rather than silently picking the
flattering one.

## 6. Dashboard views

1. **Statewide shift** — 100% stacked area of grade mix across the five academic years, methodology break marked.
2. **Grade flow** — transition matrix between any two selected years; separates real movement from
   churn at grade boundaries.
3. **Movers** — every entity ranked by score delta, sparkline per row, searchable and filterable.
4. **Poverty and performance** — score vs eco-dis %, all 10,230 entities, regression line, sector
   split. The view that establishes the site's credibility rather than undermining it.
5. **Regions** — 20 ESC regions as small-multiple trend lines sorted by trajectory.
6. **Entity detail** — search any district or campus; six-year line, domain decomposition,
   distance to next cut score, finance vs peer group.

Additionally surfaced: **`mult_year`**, consecutive unacceptable ratings. 58 districts currently
carry at least one, 8 at three or more years — state-intervention territory. Small n, outsized
consequence.

## 7. Global controls

Persistent across every view, not per-view filters:

- **Sector** — All / Traditional / Charter
- **Level** — Districts / Campuses
- **Weighting** — By entity / By enrollment
- **AEA** — Include / Exclude alt-standards entities
- **Baseline** — 2021-22 (What If) / 2023-24 trough

The weighting control is load-bearing. Entity-weighted and enrollment-weighted comparisons point
in different directions (§8), and a site that offers only one is making a hidden argument.

## 8. Verified findings

Computed from the 2026-08-15 snapshot. These double as regression tests (§10).

**Unweighted district mean score:**

| Year | Traditional | Charter | Gap |
|---|---|---|---|
| 2021-22 What If | 80.6 | 82.3 | −1.7 |
| 2022-23 | 79.2 | 77.2 | +2.0 |
| 2023-24 | 78.7 | 78.0 | +0.7 |
| 2024-25 | 80.3 | 79.1 | +1.2 |
| 2025-26 | 81.7 | 79.7 | +2.1 |

**Enrollment-weighted mean score** — reverses the sector ordering in most years:

| Year | Traditional (districts) | Charter (districts) |
|---|---|---|
| 2021-22 What If | 80.5 | 84.1 |
| 2023-24 | 78.9 | 79.8 |
| 2025-26 | 82.4 | 82.9 |

**Eco-dis composition:** charter districts median 77.4% vs traditional 59.35%; charter campuses
80.8% vs traditional 65.7%. (The traditional district median is stated to two decimals deliberately:
n is even at 1,020, so the median is the mean of 59.3 and 59.4. Rounding it to 59.3 puts it exactly on
the regression suite's ±0.05 tolerance edge, where the assertion passes only by floating-point luck.)

**Gain by poverty decile, 2023-24 → 2025-26 (campuses):** bottom decile +4.3 vs top decile +0.8.
Traditional leads in 7 of 10 deciles, by roughly 0.5–1.0 points.

**Supported claims:** statewide recovery since 2023-24; traditional ISDs recovering faster
(+3.0 vs +1.7 at district level); highest-poverty schools gaining most.

**Rejected claim:** traditional ISDs are "the better place for kids." Fails enrollment weighting
and is confounded by sector differences in student poverty. Not asserted anywhere on the site.

## 9. Data caveats to encode in the UI

- Methodology refresh between 2021-22 and 2022-23 (§5).
- `Not Rated` (3,219 rows, 2,821 distinct entity-years) and `Data Integrity Issues` (6 rows) are
  distinct from missing data and are excluded from mean calculations, never coerced to zero.
- 2022-23 and 2023-24 ratings were released late following litigation.
- 386 campuses are paired (`paired_id`) and share accountability results.
- Entities appear and disappear across years; **9,525 of 10,230 have all five years**. Charter
  district counts in particular rise across the window (166 → 170 → 179) as operators open and
  report. Trend aggregates must state their n, and cohort-based views must hold the cohort
  constant.

## 10. Error handling and testing

**fetch.py** — assert HTTP 200 and non-trivial size per file; handle gzip whether or not the
transport decompresses it; fail the run rather than write a partial snapshot.

**build.py** — assert parallel-array alignment before exploding (mismatched lengths are a hard
error); assert referential integrity against `entities`; assert row counts within expected bounds;
assert no numeric column silently absorbed a sentinel like `*` or `.`.

**export.py** — assert payload under a 4 MB budget; spot-check known fixtures (Cayuga ISD `001902`
= B, score 89, 2025-26).

**Regression tests** — every figure in §8 is recomputed from the built database and asserted. If a
future TEA release changes them, the tests fail and the site's claims get re-validated before
publication rather than after.

### Deploy gates

The pipeline runs once a year. Anything that depends on a human remembering a procedure across a
twelve-month gap is not a control. Every guard below is automated and blocking:

- Fail if any of the 14 source fetches returns non-200 or a trivially small body.
- Fail if entity count drops below 10,000, or if payload size moves more than ~30% year over year.
  A partial TEA publication is the most likely real-world failure and it would otherwise replace
  every page on the site with a plausible-looking subset.
- Fail if `wrangler.jsonc` contains a `main` key. Adding one silently converts an unmetered site
  into a metered one; it is the single config change that breaks the $0 guarantee.
- Fail if the built file count exceeds 18,000.
- After `wrangler versions upload`, fetch three canary URLs against the preview URL — `/`,
  `/district/109901`, and the content-hashed payload — asserting 200 and expected byte length.
  Only then `wrangler versions deploy`. This runs in CI, not by hand.

### Monitoring

An assets-only Worker emits no invocation logs, so `observability` config on it is inert and is
not used. Production signal comes from the post-deploy canary assertions above plus an external
uptime check on the same three URLs. Cloudflare Web Analytics covers traffic; it is a client-side
beacon and deliberately not relied on for error detection.

## 11. Measurements

Three numbers in this design were load-bearing estimates. Two have now been measured against the
2026-08 snapshot; the third has no producer yet.

| Measurement | Estimated | Measured | Consequence |
|---|---|---|---|
| Dashboard payload | ~2.5 MB | **1.27 MB raw / 0.23 MB gzipped** | Comfortably under the 4 MB budget. **No per-view split needed.** Lower bound — `domains`, `finance` and `groups` are deferred and must be re-measured when added. |
| Prerender wall-clock, 10,230 pages | unknown | **~1 s**, 10,236 files total | Far under the 18,000-file CI guard and the 20,000 Free-plan cap. |
| Wrangler upload time | unknown | **not yet taken** | Requires a real deploy. Take it on the first CI run. |

Also outstanding: the served `Content-Encoding` on the real domain, in Chrome and Safari, which
settles whether any compression configuration is needed at all. It cannot be checked before the
site is live.

## 12. Out of scope

- Live data refresh. The pipeline runs on demand; there is no streaming or scheduled ingest.
- Campus-level geographic mapping of all 9,031 points. Districts map cleanly; campus mapping is a
  later addition if wanted.
- Multi-state comparison. Texas only.
- Statistical modeling beyond descriptive comparison and simple regression. No causal claims.
- Per-entity OG images and per-year page variants. Both are attractive and both would breach the
  Free-plan file cap; revisit together with the Paid-plan upgrade if wanted.
