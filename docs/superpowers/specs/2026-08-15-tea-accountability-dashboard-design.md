# Texas Accountability Dashboard — Design

**Date:** 2026-08-15
**Status:** Approved design, ready for implementation planning

## 1. Purpose

A public-facing dashboard showing how Texas public schools are moving through the A–F
accountability system across the six years of available history, with traditional ISDs
and charters comparable at every step.

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

Four stages, each independently runnable and independently testable.

```
fetch.py    → data/raw/<ISO-date>/*.json     verbatim snapshot, dated
build.py    → data/tea.duckdb                normalized tidy tables
export.py   → dashboard/payload.json         slim precomputed payload (~2.5 MB)
publish.py  → self-contained HTML artifact   shareable private URL
```

**Why dated raw snapshots.** TEA overwrites these files in place on each release. Dating the
snapshot directory turns the pipeline into its own longitudinal archive, so a run in August
2027 yields 2026-27 data without depending on TEA preserving history. `fetch.py` is idempotent
within a date and never mutates a prior snapshot.

**Why DuckDB.** The full dataset fits in memory, but the normalized `groups` table reaches
~180k rows and the analysis is heavily aggregate-and-join. DuckDB gives real SQL over the
whole thing with zero server, and the file is portable for ad-hoc querying outside the app.

## 4. Data model

`build.py` explodes the source files' parallel-array structure into tidy long tables. A source
record like `{"academic_year": [...], "overall_rating": [...], "score": [...]}` becomes one row
per year.

| Table | Grain | Approx rows | Key columns |
|---|---|---|---|
| `entities` | district or campus | 10,230 | `id`, `level`, `district_id`, `name`, `region_id`, `county_id`, `is_charter`, `is_alt_standards`, `campus_type`, `enrollment`, `lat`, `lon` |
| `ratings` | entity × year × method | ~60,000 | `id`, `year`, `method`, `rating`, `score` |
| `domains` | entity × year × domain | ~95,000 | `id`, `year`, `domain`, `score`, `grade`, `cut_score` |
| `profile` | entity, current year | 10,234 | `id`, `eco_dis_pct`, `attendance`, `absenteeism`, `enrollment_by_race`, `avg_salary`, `teacher_years` |
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

1. **Statewide shift** — 100% stacked area of grade mix across six years, methodology break marked.
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

**Eco-dis composition:** charter districts median 77.4% vs traditional 59.3%; charter campuses
80.8% vs traditional 65.7%.

**Gain by poverty decile, 2023-24 → 2025-26 (campuses):** bottom decile +4.3 vs top decile +0.8.
Traditional leads in 7 of 10 deciles, by roughly 0.5–1.0 points.

**Supported claims:** statewide recovery since 2023-24; traditional ISDs recovering faster
(+3.0 vs +1.7 at district level); highest-poverty schools gaining most.

**Rejected claim:** traditional ISDs are "the better place for kids." Fails enrollment weighting
and is confounded by sector differences in student poverty. Not asserted anywhere on the site.

## 9. Data caveats to encode in the UI

- Methodology refresh between 2021-22 and 2022-23 (§5).
- `Not Rated` (3,220 entity-years) and `Data Integrity Issues` (6) are distinct from missing data
  and are excluded from mean calculations, never coerced to zero.
- 2022-23 and 2023-24 ratings were released late following litigation.
- 386 campuses are paired (`paired_id`) and share accountability results.
- Entities appear and disappear across years; 9,529 of 10,234 have full six-year history. Trend
  aggregates must state their n, and cohort-based views must hold the cohort constant.

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

## 11. Out of scope

- Live data refresh. The pipeline is run manually; the artifact is rebuilt and republished.
- Campus-level geographic mapping of all 9,031 points. Districts map cleanly; campus mapping is a
  later addition if wanted.
- Multi-state comparison. Texas only.
- Statistical modeling beyond descriptive comparison and simple regression. No causal claims.
