# txschools.net

A public dashboard tracking how Texas public schools move through the state A–F accountability
system, built on the full statewide dataset published by TEA via txschools.gov.

## Status

Design phase. See
[docs/superpowers/specs/2026-08-15-tea-accountability-dashboard-design.md](docs/superpowers/specs/2026-08-15-tea-accountability-dashboard-design.md)
for the approved design.

## What this is

txschools.gov publishes the entire statewide accountability dataset as static JSON — 1,199
districts, 9,031 campuses, and six years of rating history, 52.5 MB in total. This project
normalizes that into a queryable database and builds a dashboard over it.

The editorial thesis, validated against the data before being adopted:

> Texas public schools are recovering from the pandemic-era trough, traditional ISDs are leading
> that recovery, and the steepest gains are in the highest-poverty schools.

Claims on the site are checked by regression tests against the built database, so a future TEA
release that changes the picture fails the build rather than quietly going stale.

## Data source

All data originates from the Texas Education Agency, served publicly from
`https://txschools.gov/data/`. This project does not modify the underlying data; it reshapes it
for analysis. Source snapshots are dated so the pipeline builds its own longitudinal archive.
