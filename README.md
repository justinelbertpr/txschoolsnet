# txschools.net

A public dashboard tracking how Texas public schools move through the state A–F accountability
system, built on the full statewide dataset published by TEA via txschools.gov.

## Status

**Live at [txschools.net](https://txschools.net).** The ingest, normalization, payload export,
prerenderer, Cloudflare config and CI deploy pipeline are complete, tested, and deploying. Every
merge to `main` rebuilds the site from the committed TEA snapshot and deploys it
(`.github/workflows/refresh.yml`, `push` trigger) — the same workflow's `workflow_dispatch` trigger
also covers the annual path, optionally fetching a fresh snapshot first.

The six dashboard views are **not** built — that is Plan 2. Entity pages are live-ready but
deliberately minimal.

- Design: [docs/superpowers/specs/2026-08-15-tea-accountability-dashboard-design.md](docs/superpowers/specs/2026-08-15-tea-accountability-dashboard-design.md)
- Plan: [docs/superpowers/plans/2026-08-15-data-pipeline-and-deploy.md](docs/superpowers/plans/2026-08-15-data-pipeline-and-deploy.md)

## What this is

txschools.gov publishes the entire statewide accountability dataset as static JSON — 1,199
districts, 9,031 campuses, and five academic years of rating history, 52.5 MB in total. This
project normalizes that into queryable tables and prerenders a page for every district and campus.

This site publishes traditional public school districts only. Open-enrollment charter districts
and campuses are excluded outright, at the normalized-table stage, before any downstream table is
built — not filtered per view, not offered as a toggle. Of TEA's 1,199 districts and 9,031
campuses, 1,020 districts and 8,066 campuses are traditional and appear here; the remaining 179
districts and 965 campuses are charters and appear nowhere on the site.

The editorial thesis, validated against the data before being adopted:

> Texas public schools are recovering from the pandemic-era trough, traditional ISDs are leading
> that recovery, and the steepest gains are in the highest-poverty schools.

An earlier framing — that traditional ISDs are simply "better" — was tested and rejected: it does
not survive enrollment weighting or a poverty control. Claims on the site are gated by regression
tests against the built tables, so a future TEA release that changes the picture fails the build
rather than quietly going stale.

## Commands

```
npm run fetch                 refresh the 14-file txschools.gov accountability snapshot
npm run fetch:automated       refresh the six automatable supplemental archives below
npm run fetch:enrollment      refresh five years of PEIMS enrollment
npm run fetch:transfers       refresh five years of PEIMS transfer flows (105 reports)
npm run fetch:educators       refresh five years of TAPR turnover and class-size data
npm run fetch:discipline      refresh five years of PEIMS discipline summaries
npm run fetch:community       refresh Census SAIPE district-boundary context
npm run fetch:postsecondary   refresh THECB following-fall outcomes
npm run fetch:addresses       refresh the self-hosted Census street suggestion index
npm run verify                verify every committed data archive against its manifest
npm run drift                 ask whether the 14 accountability files have changed
npm run build                 normalize the newest snapshots into build/*.ndjson
npm run export                build the dashboard payload into site/data/
npm run prerender             render 9,086 entity pages into site/
npm run site                  verify + build + export + prerender
npm test                      run unit, integrity and published-figure regressions
```

The `fetch:*` commands and `npm run drift` touch the network. Fetches are rarely needed: dated
snapshots are committed, so `npm run site` reproduces the site offline. `npm run fetch:automated`
runs enrollment, transfers, educators, discipline, community and postsecondary sequentially. It
does **not** refresh action-status flags; that reviewed PDF workflow is documented below.
Fetchers reproduce the source years configured in their modules; when an agency publishes a new
year or changes a schema, update the corresponding source constants and tests before refreshing
rather than silently treating a changed file as comparable.

### Address suggestions

The address finder uses a small, self-hosted street index derived from the U.S. Census Bureau's
Texas TIGER/Line address ranges. Suggestions never need an account, API key, paid service, or
third-party request. The selected address goes directly to the Census geocoder only after the
reader presses **Find my district**; txschools.net does not save it.

`npm run fetch:addresses` is the manual annual refresh. It downloads the 254 Texas county
ADDRFEAT archives, keeps only street names, ZIP codes, and broad house-number range hints, and
writes compact gzip shards plus a provenance manifest under `data/addresses/`. Normal site builds
are offline and publish those committed shards under `site/data/address-streets/`. When Census
publishes a new stable TIGER vintage, update `ADDRESS_SOURCE_YEAR` in `src/addresses.js` as part
of that refresh; the manifest records the exact source URL, archive hashes, and fetch time.

### Enrollment history

The accountability snapshot contains only a current enrollment figure. The five-year district and
campus trend on each entity page therefore comes from TEA's separate
[PEIMS Student Program and Special Populations reports](https://rptsvr1.tea.texas.gov/adhocrpt/adspr.html):
one statewide district and one statewide campus CSV for each school
year from 2021-22 through 2025-26. `npm run fetch:enrollment` archives the ten raw responses under
`data/enrollment/<YYYY-MM-DD>/` with their exact broker request, sha256, byte count and row count.

TEA's FERPA suppression markers and ranges such as `<10` and `<20` remain missing; the site never
turns them into zeroes or estimates. Enrollment growth and decline are presented as context, not as
a school-quality measure. Normal builds read the committed archive and make no network request.

### Other supplemental public data

Each product below has its own dated, checksummed archive and source-specific verifier. These
figures add context that is not available in the txschools.gov accountability download, but they
do not change TEA's accountability ratings.

#### Student transfers

TEA's [PEIMS Transfer Reports](https://rptsvr1.tea.texas.gov/adhocrpt/Standard_Reports/Transfer_Reports/transfer_reports.html)
show mismatches between a student's public district or campus of
residence and attendance for 2021-22 through 2025-26. District coverage is assembled from TEA's 20
regional reports per year; campus coverage comes from one statewide report per year, for 105 raw
reports total. The figures do not explain *why* a student attends elsewhere. District reports have
TEA-published totals, while campus reports contain pair-level flows only; exact campus totals cannot
be reconstructed when any detail cell is FERPA-masked. `npm run fetch:transfers` preserves those
masks as missing and archives the exact broker request and response bytes.

#### Educator context

Five years of [Texas Academic Performance Reports](https://tea.texas.gov/texas-schools/accountability/academic-accountability/performance-reporting/texas-academic-performance-reports)
supply district teacher-turnover rates and twelve
separate campus class-size measures covering elementary grades and secondary subjects. TEA does not
publish campus teacher turnover in this product, and the site does not manufacture a campus-wide
class-size average. `npm run fetch:educators` archives the selected-data responses, their exact
requests, dictionaries, glossaries and masking references.

#### Discipline and removals from class

TEA's annual [PEIMS Discipline Summaries](https://tea.texas.gov/data-reports/student-data/discipline-data-products/discipline-reports)
cover districts and campuses from 2020-21 through 2024-25.
Unique students, disciplinary actions and incidents are different units and remain separate; an
action count is never described as a count or percentage of students. Explicit FERPA masks and
absent categories remain unavailable, not zero. The matching denominator is the report's
cumulative full-year enrollment—not the October enrollment snapshot. School operations and
in-person attendance were disrupted by COVID-19 in 2020-21, so comparisons involving that year
need extra caution. TEA also consolidated its separate Discipline Action Group reports into this
product in 2024-25; stable headline categories can be compared, but detailed reason/action codes
change over time. `npm run fetch:discipline` archives all ten statewide responses.

#### Actionable campus notices

The action-flags archive combines TEA's
[2026 CSI/TSI/ATS improvement workbook](https://tea2.tea.texas.gov/school-and-district-leaders/accountability/academic-accountability/performance-reporting/2026-schools-identified-for-improvement.xlsx)
with its [final 2026-27 Public Education Grant list](https://tea.texas.gov/texas-schools/accountability/academic-accountability/performance-reporting/peg-list-2025-final.pdf).
These are official statuses and family options, not scores;
absence from a list is not a positive rating.

There is deliberately no `npm run fetch:action-flags`. `fetchActionFlags` in
[src/action-flags.js](src/action-flags.js) requires a maintainer-supplied
`extractPdfText(pdfBuffer)` function because
the PEG source is a PDF and its extracted campus IDs must be reviewed before publication. A
maintainer refreshes the pinned workbook and final PDF, supplies a trusted local extractor,
reviews the parsed counts and identifiers, and commits the resulting
`data/action-flags/<YYYY-MM-DD>/` directory. The manifest checksums the original XLSX, original PDF
and normalized archive. The automated GitHub refresh intentionally leaves this archive unchanged.

#### Community context

The U.S. Census Bureau's
[2024 Small Area Income and Poverty Estimates](https://www.census.gov/data/datasets/2024/demo/saipe/2024-school-districts.html)
provide total population,
school-age population and school-age poverty for Texas school-district geography. These describe
children who live inside a geographic boundary, not the students enrolled by an education agency;
that distinction matters for open-enrollment transfers and boundary changes.
`npm run fetch:community` retains Census's fixed-width source file and the deterministic normalized
rows. The current source vintage is pinned to 2024; moving to a newer SAIPE release requires updating
the documented URL, layout and year constants together.

#### Postsecondary outcomes

Texas Higher Education Coordinating Board
[reports](https://www.txhighereddata.org/high-school-graduates/hsgradsenrolled/) show where 2023-24 graduates enrolled in Texas
public higher education in Fall 2024. The source includes only districts and high schools with more
than 25 graduates. Its rate does not capture private or out-of-state colleges, the military,
employment, students who enroll later, or records THECB could not track, so it is labeled as
following-fall Texas-public enrollment rather than a general college-going rate.
`npm run fetch:postsecondary` archives both official workbooks and normalized district/campus
results. The current source URLs are pinned to the 2024 report and must be reviewed when THECB posts
a newer cohort.

## Architecture

Plain Node 24 ESM. No framework, no bundler, no database, no native dependencies.

There is deliberately no server-side database. The whole normalized dataset is a few megabytes and
the dashboard's cross-filtering needs it resident in the browser anyway, so the site is prerendered
static files on Cloudflare Workers Static Assets — free and unmetered, with zero billable
invocations. Tables are written as NDJSON, which the DuckDB CLI reads directly
(`read_json_auto('build/*.ndjson')`) if you want ad-hoc SQL, without DuckDB being a dependency.

## Data source and provenance

Underlying data comes directly from three public agencies:

- the Texas Education Agency for accountability, profile, finance, enrollment, transfer, educator,
  discipline and campus action-status data;
- the U.S. Census Bureau for SAIPE community estimates and TIGER/Line address suggestions; and
- the Texas Higher Education Coordinating Board for following-fall Texas-public enrollment.

The project does not alter published source values. It validates, joins and reshapes them, and any
transparent calculation—such as a percentage whose numerator and denominator are both published—is
identified as derived rather than source-reported.

Every fetch is written to a dated directory and committed with a manifest. Storage differs by
source, so the integrity rule is deliberately source-specific: accountability hashes normalized
JSON text; PEIMS/TAPR broker archives hash the uncompressed response bytes; action flags hash the
original XLSX and PDF plus the normalized archive; Census retains both its fixed-width source and
normalized rows; and THECB retains both official workbooks and normalized output. Manifests also
record available row counts, request parameters, source URLs, response metadata and schema details.

Two checks keep those provenance claims active rather than merely stated:

**`npm run verify`** invokes every archive's own verifier for accountability, enrollment, transfers,
educators, discipline, action flags, community and postsecondary data. It re-derives checksums and
byte/row coverage and, where the archive supports it, replays parsing and normalization. It runs
first in `npm run site`, so a corrupt, partial or hand-edited snapshot fails the build before any
page is published.

**`npm run drift`** answers a narrower question: have the 14 txschools.gov accountability files
changed since the committed snapshot? It sends HEAD requests and compares ETag, falling back to
Last-Modified, so it transfers no datasets. `.github/workflows/drift.yml` runs weekly and reports a
change for human review. Supplemental sources are refreshed deliberately with the commands above;
the action-flags PDF workflow always remains reviewed/manual.

The manual dispatch in `.github/workflows/refresh.yml` can fetch every automatable archive and the
Census address index before rebuilding. Pushes to `main` never fetch: they verify and deploy the
already committed bytes. That separation keeps a deployment reproducible and prevents an upstream
file overwritten in place from silently changing the site.

Note the caveat `.github/workflows/refresh.yml` also documents: GitHub disables scheduled workflows
in public repositories after 60 days without repository activity. If this repo goes quiet, the
weekly check stops silently; `workflow_dispatch` and a calendar reminder are the backstop.

## A note on "six years"

TEA publishes six year labels but only five academic years. `2021-22` and `2021-22 What If` are the
same school year scored under the pre- and post-2023 methodologies — the same district can be an A
under one and a B under the other with no change in what the school did. Charting them as adjacent
years produces a collapse that never happened. `preferredRatings` in
[src/normalize/ratings.js](src/normalize/ratings.js) is the single place that resolves this, and
every consumer goes through it.
