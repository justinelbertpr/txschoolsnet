// Fails the build before Cloudflare does.
//
// The Free plan caps a Worker version at 20,000 assets. The guard sits at 18,000
// so a breach is caught with room to fix it rather than at deploy time.
//
// What the site actually generates (see the FILE BUDGET note in src/prerender.js):
//
//     entity pages                          10,230   one per district and campus
//     county pages                             253
//     letter pages                              26   /districts/a .. /z
//     search letter pages                       26   /search/a .. /z
//     region pages                              20
//     per-district CSV + JSON                2,398   1,199 districts x 2 formats
//     bulk CSVs                                  3
//     home, about, download, search               4
//     sitemap.xml, _headers                      2   _redirects is deliberately
//                                                     never written — see the note
//                                                     at the top of src/prerender.js
//     404.html, style.css, app.js, search.js     4
//     dashboard payload, search index            2
//     favicon.svg, og.png,
//       apple-touch-icon.png                     3
//     ranking boards + CSVs                    229   115 boards (metric x scope,
//                                                     ONE flattering end per
//                                                     ordering — the site owner's
//                                                     call not to compile a
//                                                     "worst of" list; see Rule 3,
//                                                     src/render/rankings-page.js)
//                                                     + 114 CSVs beside them — see
//                                                     THE FILE BUDGET in
//                                                     src/prerender.js
//     ------------------------------------------
//                                           13,200   4,800 under the guard
//
// The rows above the ranking-boards one are not re-measured here; they were
// already approximate before this edit and are not what changed. The ranking
// row is: it used to publish both ends of every ordering (513 files) and now
// publishes one (229) — see THE FILE BUDGET in src/prerender.js for the
// measured breakdown this halving comes from.
//
// The line that matters is the per-entity one. Campus CSV and JSON are NOT
// generated: 10,230 entities x 2 formats is 20,460 files on its own, past the
// hard cap before a single page is counted. If a future change starts writing
// per-campus data files, this guard is what stops it — read the note in
// src/prerender.js before raising the limit rather than after.

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
