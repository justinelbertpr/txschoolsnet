import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const raw = readFileSync('wrangler.jsonc', 'utf8')
const config = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''))

describe('wrangler.jsonc', () => {
  it('declares NO main entrypoint — assets-only keeps serving unmetered', () => {
    expect(config.main).toBeUndefined()
  })

  it('declares no per-environment main entrypoint either — `wrangler deploy --env <name>` would honor it', () => {
    for (const [name, env] of Object.entries(config.env ?? {})) {
      expect(env.main, `env.${name}.main must be undefined`).toBeUndefined()
    }
  })

  it('serves the site directory', () => {
    expect(config.assets.directory).toBe('./site')
  })

  it('serves a real 404 page', () => {
    expect(config.assets.not_found_handling).toBe('404-page')
  })

  it('strips .html so /district/109901 resolves', () => {
    expect(config.assets.html_handling).toBe('auto-trailing-slash')
  })

  it('disables workers.dev but keeps preview URLs for the pre-cutover smoke test', () => {
    expect(config.workers_dev).toBe(false)
    expect(config.preview_urls).toBe(true)
  })

  // This assertion was lost once already: it lived on a branch whose commit was
  // never pushed before the PR squash-merged and the branch was deleted. Losing
  // it means the site silently deploys to nothing but a preview URL.
  it('binds the apex domain only, so www cannot compete as duplicate content', () => {
    expect(config.routes).toHaveLength(1)
    expect(config.routes[0]).toEqual({ pattern: 'txschools.net', custom_domain: true })
  })

  it('pins a compatibility date', () => {
    expect(config.compatibility_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
