// Fails the build before Cloudflare does.
//
// The Free plan caps a Worker version at 20,000 assets. The guard sits at 18,000
// so a breach is caught with room to fix it rather than at deploy time.
//
// What the site actually generates (see the FILE BUDGET note in src/prerender.js):
//
//     entity pages                           9,086   1,020 districts + 8,066 campuses
//     region/county/letter/search hubs         325
//     per-district reporter CSV + JSON       2,040   1,020 districts x 2 formats
//     pin metric bundles                     1,020   one per district, campuses inside
//     ranking board pages + CSVs               391
//     bulk CSVs                                  3
//     shell/map/search/address/data assets       26
//     ------------------------------------------
//                                           12,891   5,109 under the guard
//
// Measured from the 2026-08 traditional-public-school build. The line that
// matters is the per-entity one. Campus CSV and JSON are NOT
// generated: 9,086 entities x 2 formats is 18,172 files on its own, past the
// hard cap before a single page is counted. If a future change starts writing
// per-campus data files, this guard is what stops it — read the note in
// src/prerender.js before raising the limit rather than after. Pin measures fit
// because they are grouped into 1,020 district bundles, not 8,066 campus files.

import { readdir } from 'node:fs/promises'

const LIMIT = 18_000 // Free plan caps at 20,000 assets per Worker version

async function count(dir) {
  let n = 0
  for (const e of await readdir(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? await count(`${dir}/${e.name}`) : 1
  }
  return n
}

/** Per-directory, so a breach names the thing that grew instead of just a total. */
async function breakdown(dir) {
  const out = []
  let loose = 0
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) out.push([`${e.name}/`, await count(`${dir}/${e.name}`)])
    else loose += 1
  }
  out.push(['(top level)', loose])
  return out.sort((a, b) => b[1] - a[1])
}

const n = await count('site')

console.log(`site/ contains ${n.toLocaleString('en-US')} files (limit ${LIMIT.toLocaleString('en-US')})`)
for (const [name, c] of await breakdown('site')) {
  console.log(`  ${name.padEnd(14)}${c.toLocaleString('en-US').padStart(7)}`)
}

if (n > LIMIT) {
  console.error(
    `\nFAIL: ${n.toLocaleString('en-US')} files exceeds ${LIMIT.toLocaleString('en-US')}.\n` +
      `The Free plan's hard cap is 20,000 and the Paid plan raises it to 100,000 (design §3).\n` +
      `Before raising this number, read the FILE BUDGET note at the top of src/prerender.js —\n` +
      `the usual cause is per-entity data files, which do not fit at any ratio for campuses.`
  )
  process.exit(1)
}
