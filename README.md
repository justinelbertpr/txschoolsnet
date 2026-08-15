# txschools.net

A public dashboard tracking how Texas public schools move through the state A–F accountability
system, built on the full statewide dataset published by TEA via txschools.gov.

## Status

**Pipeline and site built; not yet deployed.** The ingest, normalization, payload export,
prerenderer, Cloudflare config and CI deploy pipeline are complete and tested. Deployment needs a
Cloudflare API token to be added to the repository as `CLOUDFLARE_API_TOKEN`, plus
`CLOUDFLARE_ACCOUNT_ID`.

The six dashboard views are **not** built — that is Plan 2. Entity pages are live-ready but
deliberately minimal.

- Design: [docs/superpowers/specs/2026-08-15-tea-accountability-dashboard-design.md](docs/superpowers/specs/2026-08-15-tea-accountability-dashboard-design.md)
- Plan: [docs/superpowers/plans/2026-08-15-data-pipeline-and-deploy.md](docs/superpowers/plans/2026-08-15-data-pipeline-and-deploy.md)

## What this is

txschools.gov publishes the entire statewide accountability dataset as static JSON — 1,199
districts, 9,031 campuses, and five academic years of rating history, 52.5 MB in total. This
project normalizes that into queryable tables and prerenders a page for every district and campus.

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
npm run build      normalize the newest snapshot into build/*.ndjson
npm run export     build the dashboard payload into site/data/
npm run prerender  render 10,230 entity pages into site/
npm run site       build + export + prerender
npm test           141 tests, including the published-figure regression suite
```

`npm run fetch` hits a live government server and is rarely needed — the dated snapshot is
committed, so `npm run site` reproduces the entire site offline.

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

## A note on "six years"

TEA publishes six year labels but only five academic years. `2021-22` and `2021-22 What If` are the
same school year scored under the pre- and post-2023 methodologies — the same district can be an A
under one and a B under the other with no change in what the school did. Charting them as adjacent
years produces a collapse that never happened. `preferredRatings` in
[src/normalize/ratings.js](src/normalize/ratings.js) is the single place that resolves this, and
every consumer goes through it.
