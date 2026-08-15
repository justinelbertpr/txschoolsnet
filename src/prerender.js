import { readFile, writeFile } from 'node:fs/promises'
import { preferredRatings } from './normalize/ratings.js'
import { resetDir } from './lib/reset-dir.js'

export const SITE_ORIGIN = 'https://txschools.net'

export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export const entityPath = (e) => `${e.level}/${e.id}.html`

export function renderEntity(e, history) {
  const name = escapeHtml(e.name ?? e.id)
  const sector = e.isCharter ? 'Charter' : 'Traditional'
  const kind = e.level === 'district' ? 'District' : 'Campus'
  const rows = history
    .map((h) => `<tr><td>${escapeHtml(h.year)}</td><td>${escapeHtml(h.rating ?? '—')}</td><td>${h.score ?? '—'}</td></tr>`)
    .join('')
  // history.length, not a hardcoded count: there are five distinct academic
  // years (2021-22 What If is the same year under post-2023 rules, not a
  // separate one — design §5), and the table has one row per history entry.
  const yearsPhrase = history.length === 1 ? '1 year of history' : `${history.length} years of history`

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
  <p>${kind} · ${sector}${e.county ? ` · ${escapeHtml(e.county)} County` : ''}${e.enrollment ? ` · ${e.enrollment.toLocaleString('en-US')} students` : ''}${e.isAlt ? ' · Alternative Education Accountability' : ''}</p>
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

  // Clear whatever a previous run left behind before regenerating (see
  // resetDir for why), rather than only ever adding files. Scoped to
  // site/district and site/campus only — never site/ itself, which also
  // holds the hand-authored index.html/404.html/style.css/_headers.
  await resetDir('site/district')
  await resetDir('site/campus')

  const paths = []
  for (const e of entities) {
    const path = entityPath(e)
    await writeFile(`site/${path}`, renderEntity(e, history.get(e.id) ?? []))
    paths.push(path)
  }
  await writeFile('site/sitemap.xml', renderSitemap(paths))

  const elapsed = (Date.now() - started) / 1000
  console.log(`\n=== MEASUREMENT: prerender (design §11) ===`)
  console.log(`  pages     ${paths.length}`)
  console.log(`  elapsed   ${elapsed.toFixed(1)} s`)
  return { pages: paths.length, elapsed }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await prerender()
}
