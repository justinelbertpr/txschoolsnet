// Local preview that mimics how Cloudflare Workers Static Assets serves this site,
// so what you see here is what production does.
//
// Three behaviours from wrangler.jsonc and the asset layer are reproduced
// deliberately:
//   html_handling: "auto-trailing-slash"  -> /district/<slug> serves district/<slug>.html
//   not_found_handling: "404-page"        -> unknown paths serve 404.html with a 404 status
//   _headers / _redirects are config, not assets, and are never served as files
//
// There is no _redirects file to reproduce. src/prerender.js used to write one
// containing `/data/entity/* /download 302`; Cloudflare's docs state that
// "Redirects are always followed, regardless of whether or not an asset matches
// the incoming request" (developers.cloudflare.com/workers/static-assets/redirects/,
// § Structure → Per file), so that rule shadowed the 2,398 real per-district data
// files rather than only the unmatched campus ids. The site no longer emits the
// file, and every entity page links only files that exist — so this server and
// production now agree in both directions, with no redirect table on either side.
//
// `wrangler dev` is the more faithful check when it runs. This exists because it
// does not run everywhere, and because a 40-line server has no failure modes.

import { createServer } from 'node:http'
import { readFile, stat, readdir } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const ROOT = 'site'
const PORT = Number(process.argv[2] ?? 8788)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
}

// Parsed by the asset layer as configuration and "not itself served as a static
// asset" — a request for /_headers is a 404 in production, so it is one here.
const NOT_ASSETS = new Set(['_headers', '_redirects'])

const exists = async (p) => {
  try {
    return (await stat(p)).isFile()
  } catch {
    return false
  }
}

/** Resolve a request path the way Cloudflare's asset layer would. */
async function resolve(urlPath) {
  // Reject traversal before touching the filesystem.
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.[/\\])+/, '')
  if (NOT_ASSETS.has(clean.slice(1))) return null
  const candidates =
    clean === '/' ? ['index.html'] : [clean.slice(1), `${clean.slice(1)}.html`, join(clean.slice(1), 'index.html')]

  for (const c of candidates) {
    const p = join(ROOT, c)
    if (p.startsWith(ROOT) && (await exists(p))) return p
  }
  return null
}

createServer(async (req, res) => {
  const path = await resolve(req.url)
  if (!path) {
    const body = await readFile(join(ROOT, '404.html')).catch(() => 'Not found')
    res.writeHead(404, { 'content-type': TYPES['.html'] })
    return res.end(body)
  }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' })
  res.end(await readFile(path))
}).listen(PORT, async () => {
  console.log(`\n  txschools.net preview → http://localhost:${PORT}`)
  for (const line of await hints()) console.log(`  ${line}`)
  console.log('')
})

/**
 * Sampled from site/ rather than hard-coded. The URL scheme is name-slug + id
 * (`/district/dallas-isd-057905`), and a hint listing ids alone — the shape this
 * file advertised until the slugs landed — sends the first reader of a fresh
 * checkout straight to the 404 page.
 */
async function hints() {
  const sample = async (dir, n) => {
    const names = await readdir(join(ROOT, dir)).catch(() => [])
    const pages = names.filter((f) => f.endsWith('.html')).sort()
    if (!pages.length) return []
    const step = Math.max(1, Math.floor(pages.length / n))
    return Array.from({ length: Math.min(n, pages.length) }, (_, i) => `/${dir}/${pages[i * step].slice(0, -5)}`)
  }

  const [districts, campuses] = await Promise.all([sample('district', 2), sample('campus', 1)])
  if (!districts.length && !campuses.length) {
    return ['site/ has no entity pages yet — run `npm run site` first.']
  }
  const data = districts.length ? [`/data/entity/${districts[0].split('-').at(-1)}.csv`] : []
  return [
    `try: /  ·  ${[...districts, ...campuses].join('  ·  ')}`,
    `     /download  ·  /about  ·  /sitemap.xml${data.length ? `  ·  ${data[0]}` : ''}`,
  ]
}
