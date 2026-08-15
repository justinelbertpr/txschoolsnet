import { describe, it, expect } from 'vitest'
import { renderEntity, entityPath, renderSitemap, escapeHtml } from '../src/prerender.js'

const entity = { id: '001902', level: 'district', name: 'Cayuga ISD', county: 'Anderson',
                 isCharter: false, enrollment: 574, rating: 'B', score: 89 }
const history = [
  { year: '2025-26', rating: 'B', score: 89 },
  { year: '2024-25', rating: 'B', score: 88 },
]

describe('entityPath', () => {
  it('routes districts and campuses separately', () => {
    expect(entityPath(entity)).toBe('district/001902.html')
    expect(entityPath({ ...entity, level: 'campus' })).toBe('campus/001902.html')
  })
})

describe('renderEntity', () => {
  const html = renderEntity(entity, history)

  it('puts the name in the title', () => {
    expect(html).toMatch(/<title>Cayuga ISD/)
  })

  it('inlines the history rather than linking a data file', () => {
    expect(html).toContain('2024-25')
    expect(html).not.toMatch(/payload-[a-f0-9]{8}\.json/)
  })

  it('declares a canonical URL', () => {
    expect(html).toMatch(/<link rel="canonical" href="https:\/\/[^"]+\/district\/001902">/)
  })

  it('sets lang and viewport for mobile and screen readers', () => {
    expect(html).toMatch(/<html lang="en">/)
    expect(html).toMatch(/name="viewport"/)
  })

  it('labels the sector', () => {
    expect(renderEntity({ ...entity, isCharter: true }, history)).toContain('Charter')
  })

  it('labels alternative-education campuses so their bar is not mistaken for a comprehensive one', () => {
    expect(renderEntity({ ...entity, isAlt: true }, history)).toContain('Alternative Education Accountability')
  })

  it('does not label a non-AEA entity', () => {
    expect(renderEntity({ ...entity, isAlt: false }, history)).not.toContain('Alternative Education Accountability')
  })

  it('escapes HTML in names', () => {
    expect(renderEntity({ ...entity, name: 'A & B <script>' }, history)).toContain('A &amp; B &lt;script&gt;')
  })

  it('states the history count in the description, matching the number of rows passed in', () => {
    expect(html).toContain('2 years of history')
  })
})

describe('renderEntity — description year count', () => {
  // A hardcoded count (e.g. the "six years" this replaces) would pass at
  // most one of these, since each uses a different history length.
  it('reflects a longer history', () => {
    const longHistory = [
      { year: '2025-26', rating: 'B', score: 89 },
      { year: '2024-25', rating: 'B', score: 88 },
      { year: '2023-24', rating: 'B', score: 85 },
      { year: '2022-23', rating: 'B', score: 87 },
      { year: '2021-22', rating: 'B', score: 87 },
    ]
    expect(renderEntity(entity, longHistory)).toContain('5 years of history')
  })

  it('uses the singular for exactly one year', () => {
    expect(renderEntity(entity, [{ year: '2025-26', rating: 'B', score: 89 }])).toContain('1 year of history')
    expect(renderEntity(entity, [{ year: '2025-26', rating: 'B', score: 89 }])).not.toContain('1 years of history')
  })

  it('handles an entity with no history', () => {
    expect(renderEntity(entity, [])).toContain('0 years of history')
  })
})

describe('escapeHtml', () => {
  it('escapes the five significant characters', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;')
  })
})

describe('renderSitemap', () => {
  it('emits one url element per path', () => {
    const xml = renderSitemap(['district/001902.html'])
    expect(xml).toContain('<loc>https://txschools.net/district/001902</loc>')
    expect(xml.match(/<url>/g)).toHaveLength(1)
  })
})
