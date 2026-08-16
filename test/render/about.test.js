import { describe, it, expect } from 'vitest'
import { renderAboutPage } from '../../src/render/about.js'

const COUNTS = { districts: 1199, campuses: 9031, years: 5, metrics: 42 }
const SOURCES = [
  { name: 'districts', rows: 1199 },
  { name: 'schools', rows: 9031 },
  { name: 'change_over_time', rows: 58984 },
  { name: 'profile_tab', rows: 10230 },
]

const page = renderAboutPage({ snapshotDate: '2026-08-15', counts: COUNTS, sources: SOURCES })

/**
 * Prose assertions run against the rendered TEXT with whitespace collapsed, not
 * against the markup. A sentence that happens to wrap across two source lines is
 * the same sentence to a reader, and a test that fails when a paragraph is
 * re-flowed tests the indentation rather than the claim.
 */
const body = page.slice(page.indexOf('<main'), page.indexOf('</main>'))
const text = body
  .replace(/<[^>]+>/g, ' ')
  .replace(/&[a-z]+;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
const words = text.split(' ').filter(Boolean).length

/* The four assertions the page exists to satisfy. */

describe('non-affiliation', () => {
  it('states plainly that the site is not TEA', () => {
    expect(text).toContain('not affiliated with, endorsed by, or operated by')
    expect(text).toContain('Texas Education Agency')
  })

  it('calls itself unofficial', () => {
    expect(text).toMatch(/unofficial presentation of data/i)
  })

  it('puts the disclaimer above every other section', () => {
    const disclaimer = page.indexOf('not affiliated with, endorsed by, or operated by')
    const methodology = page.indexOf('methodology-refresh')
    expect(disclaimer).toBeGreaterThan(-1)
    expect(disclaimer).toBeLessThan(methodology)
  })

  it('never claims TEA endorsement or partnership', () => {
    expect(page).not.toMatch(/in partnership with|official site of|endorsed by the Texas Education Agency\b(?!\.)/i)
  })
})

describe('the official source', () => {
  it('links txschools.gov', () => {
    expect(page).toContain('href="https://txschools.gov"')
  })

  it('says the official figure wins in a disagreement', () => {
    expect(text).toMatch(/the official one is right and this one is wrong/i)
  })
})

describe('the 2023 methodology refresh', () => {
  it('names the refresh and the What If label', () => {
    expect(text).toMatch(/2023/)
    expect(text).toMatch(/methodolog/i)
    expect(text).toContain('2021-22 What If')
  })

  it('gives the Cayuga example, A/94 under the old rules and B/87 under the new', () => {
    expect(text).toContain('Cayuga ISD')
    expect(text).toMatch(/94/)
    expect(text).toMatch(/87/)
  })

  it('says which figure the site uses', () => {
    expect(text).toMatch(/uses the re-scored figure/i)
  })

  it('explains that six labels are five academic years', () => {
    expect(text).toMatch(/six year labels/i)
    expect(text).toMatch(/five academic years/i)
  })
})

describe('the peer cohort', () => {
  it('defines the band as 10 percentage points of eco-dis share', () => {
    expect(text).toMatch(/within 10 percentage points/i)
    expect(text).toMatch(/economically disadvantaged/i)
  })

  it('gives the poverty-gradient evidence that justifies it, with a denominator', () => {
    expect(text).toContain('4.34')
    expect(text).toContain('0.75')
    expect(text).toContain('8,242')
    expect(text).toContain('2023-24')
    expect(text).toContain('2025-26')
  })

  it('says the state average measures demographics as much as performance', () => {
    expect(text).toMatch(/composition of a school's intake at least as much/i)
  })

  it('admits what the band does not control for', () => {
    expect(text).toMatch(/does not control for/i)
  })
})

/* The remaining methodology the page is required to carry. */

describe('other methodology', () => {
  it('flags Alternative Education Accountability with its counts', () => {
    expect(text).toContain('Alternative Education Accountability')
    expect(text).toMatch(/30 districts and 416 campuses/)
    expect(text).toMatch(/flagged, not hidden/i)
  })

  it('treats Not Rated as a TEA status, excluded rather than zeroed', () => {
    expect(text).toContain('Not Rated')
    expect(text).toMatch(/excluded from averages rather than counted as zero/i)
  })

  it('says ranks carry a denominator and that ties are shared', () => {
    expect(text).toMatch(/the number of entities in that group/i)
    expect(text).toMatch(/share a score they share a rank, and the page says how many/i)
  })

  it('describes checksummed provenance', () => {
    expect(text).toMatch(/sha256/i)
    expect(text).toContain('2026-08-15')
  })
})

/*
 * The edit. Four auditors read this page as real users; the verdict was
 * "over-written and under-edited... the second paragraph restates the first".
 * These assertions hold the page to the cut rather than trusting it to stay cut.
 */

describe('the edit holds', () => {
  it('stays inside a length a reader will finish', () => {
    // 1,507 words when four auditors read it; 1,082 after the cut. The cap is a
    // ratchet, not a target — it exists so the page cannot quietly grow back.
    expect(words).toBeLessThan(1150)
  })

  it('reaches the reader before it reaches its own prose style', () => {
    // The disclaimer is the first thing a reader needs, so it arrives in the
    // first 40 words rather than after a paragraph of throat-clearing.
    expect(text.split(' ').slice(0, 40).join(' ')).toMatch(/not affiliated with/i)
  })

  it('drops the house aphorisms the auditors flagged', () => {
    expect(text).not.toMatch(/a single year is a photograph/i)
    expect(text).not.toMatch(/an independent reading of data/i)
    expect(text).not.toMatch(/boast/i)
    expect(text).not.toMatch(/its own wording, its own corrections and its own authority/i)
  })

  it('states each commitment once rather than three times', () => {
    const once = (re) => (text.match(re) ?? []).length
    expect(once(/within 10 percentage points/gi)).toBe(1)
    expect(once(/sha256/gi)).toBe(1)
    expect(once(/2021-22 What If/g)).toBe(2) // named, then explained: six labels, five years
    expect(once(/Not Rated/g)).toBe(2) // the heading and the value it names
  })
})

/* Shape and robustness. */

describe('page shape', () => {
  it('renders one h1 and a canonical about URL', () => {
    expect(page.match(/<h1>/g)).toHaveLength(1)
    expect(page).toContain('<link rel="canonical" href="https://txschools.net/about">')
  })

  it('lists every source file with its row count', () => {
    for (const s of SOURCES) expect(page).toContain(s.name)
    expect(page).toContain('58,984')
    expect(page).toMatch(/the 4 files below/)
  })

  it('shows the pass-through counts', () => {
    expect(page).toContain('1,199')
    expect(page).toContain('9,031')
  })

  it('needs no JavaScript to be readable', () => {
    expect(body).not.toContain('<script')
  })

  it('escapes source names rather than trusting them', () => {
    const hostile = renderAboutPage({
      snapshotDate: '<img src=x onerror=alert(1)>',
      sources: [{ name: '<script>alert(1)</script>', rows: 1 }],
    })
    expect(hostile).not.toContain('<script>alert(1)</script>')
    expect(hostile).not.toContain('<img src=x')
    expect(hostile).toContain('&lt;script&gt;')
  })

  it('renders with no counts and no sources', () => {
    const bare = renderAboutPage({ snapshotDate: '2026-08-15' })
    expect(bare).toContain('not affiliated with, endorsed by, or operated by')
    expect(bare).not.toContain('<table')
    expect(bare).not.toContain('<dl class="stats">')
  })

  it('renders with no arguments at all', () => {
    expect(() => renderAboutPage()).not.toThrow()
    expect(renderAboutPage()).toContain('txschools.gov')
  })
})
