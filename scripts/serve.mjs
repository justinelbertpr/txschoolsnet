// Local preview that mimics how Cloudflare Workers Static Assets serves this site,
// so what you see here is what production does.
//
// Two behaviours from wrangler.jsonc are reproduced deliberately:
//   html_handling: "auto-trailing-slash"  -> /district/109901 serves district/109901.html
//   not_found_handling: "404-page"        -> unknown paths serve 404.html with a 404 status
//
// `wrangler dev` is the more faithful check when it runs. This exists because it
// does not run everywhere, and because a 30-line server has no failure modes.

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const ROOT = 'site'
const PORT = Number(process.argv[2] ?? 8788)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
}

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
}).listen(PORT, () => {
  console.log(`\n  txschools.net preview → http://localhost:${PORT}`)
  console.log(`  try: /  ·  /district/057905  ·  /district/001902  ·  /campus/001902001  ·  /sitemap.xml\n`)
})
