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

/* The four assertions the page exists to satisfy. */

describe('non-affiliation', () => {
  it('states plainly that the site is not TEA', () => {
    expect(page).toContain('not affiliated with, endorsed by, or operated by')
    expect(page).toContain('Texas Education Agency')
  })

  it('calls itself unofficial', () => {
    expect(page).toMatch(/unofficial presentation of data/i)
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
    expect(page).toMatch(/the official one is right and this one is wrong/i)
  })
})

describe('the 2023 methodology refresh', () => {
  it('names the refresh and the What If label', () => {
    expect(page).toMatch(/2023/)
    expect(page).toMatch(/methodolog/i)
    expect(page).toContain('2021-22 What If')
  })

  it('gives the Cayuga example, A/94 under the old rules and B/87 under the new', () => {
    expect(page).toContain('Cayuga ISD')
    expect(page).toMatch(/94/)
    expect(page).toMatch(/87/)
  })

  it('says which figure the site uses', () => {
    expect(page).toMatch(/uses the re-scored figure/i)
  })

  it('explains that six labels are five academic years', () => {
    expect(page).toMatch(/six year labels/i)
    expect(page).toMatch(/five academic\s+years/i)
  })
})

describe('the peer cohort', () => {
  it('defines the band as 10 percentage points of eco-dis share', () => {
    expect(page).toMatch(/within 10 percentage points/i)
    expect(page).toMatch(/economically disadvantaged/i)
  })

  it('gives the poverty-gradient evidence that justifies it, with a denominator', () => {
    expect(page).toContain('4.34')
    expect(page).toContain('0.75')
    expect(page).toContain('8,242')
    expect(page).toContain('2023-24')
    expect(page).toContain('2025-26')
  })

  it('says the state average measures demographics as much as performance', () => {
    expect(page).toMatch(/composition of a school's intake at\s+least as much/i)
  })

  it('admits what the band does not control for', () => {
    expect(page).toMatch(/does not control for/i)
  })
})

/* The remaining methodology the page is required to carry. */

describe('other methodology', () => {
  it('flags Alternative Education Accountability with its counts', () => {
    expect(page).toContain('Alternative Education Accountability')
    expect(page).toMatch(/30 districts and 416 campuses/)
    expect(page).toMatch(/flagged, not hidden/i)
  })

  it('treats Not Rated as a TEA status, excluded rather than zeroed', () => {
    expect(page).toContain('Not Rated')
    expect(page).toMatch(/excluded from averages rather than counted as zero/i)
  })

  it('reports ties', () => {
    expect(page).toMatch(/shared ceiling is not a sole first place/i)
  })

  it('describes checksummed provenance', () => {
    expect(page).toMatch(/sha256/i)
    expect(page).toContain('2026-08-15')
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
    const body = page.slice(page.indexOf('<main'), page.indexOf('</main>'))
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
