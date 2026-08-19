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
npm run fetch      download the 14 TEA source files into data/raw/<YYYY-MM>/
npm run fetch:addresses  refresh the self-hosted Census street suggestion index
npm run verify     re-hash the committed snapshot against its manifest
npm run drift      ask TEA whether any source file has changed since the snapshot
npm run build      normalize the newest snapshot into build/*.ndjson
npm run export     build the dashboard payload into site/data/
npm run prerender  render 9,086 entity pages into site/
npm run site       verify + build + export + prerender
npm test           1,085 tests, including the published-figure regression suite
```

`npm run fetch`, `npm run fetch:addresses`, and `npm run drift` are the only commands that touch
the network. The fetch commands are rarely needed — the dated snapshots are committed, so
`npm run site` reproduces the entire site offline.

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

## Architecture

Plain Node 24 ESM. No framework, no bundler, no database, no native dependencies.

There is deliberately no server-side database. The whole normalized dataset is a few megabytes and
the dashboard's cross-filtering needs it resident in the browser anyway, so the site is prerendered
static files on Cloudflare Workers Static Assets — free and unmetered, with zero billable
invocations. Tables are written as NDJSON, which the DuckDB CLI reads directly
(`read_json_auto('build/*.ndjson')`) if you want ad-hoc SQL, without DuckDB being a dependency.

## Data source and provenance

All data originates from the Texas Education Agency, served publicly from
`https://txschools.gov/data/`. This project does not modify the underlying data; it reshapes it for
analysis.

TEA overwrites those files in place on each release, so each fetch is archived under
`data/raw/<YYYY-MM>/` and committed, with a manifest recording a sha256 of every file's
decompressed content alongside the server's ETag. Every published number traces back to the exact
bytes TEA served on a given date.

Two checks keep that claim honest rather than merely stated, because a hash written once and never
read again proves nothing:

**`npm run verify`** re-derives the sha256, byte count and row count of every committed file and
compares them to the manifest. It runs first in `npm run site`, so a corrupted or hand-edited
snapshot fails the build instead of shipping numbers nobody can trace. The row count is checked
alongside the hash because a snapshot that lost records is still valid JSON and still builds — it
just quietly publishes less than TEA released.

**`npm run drift`** answers the other direction: has TEA changed anything since? It sends a HEAD to
each of the 14 URLs and compares the ETag (falling back to Last-Modified) against the manifest, so
it costs 14 requests and no data transfer. `.github/workflows/drift.yml` runs it weekly and fails —
which emails the owner — when something moves. It never re-fetches on its own: drift is reported
for a person to act on with a deliberate `npm run fetch` and a reviewed diff, because an archive
that silently updated itself would not be an archive.

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
