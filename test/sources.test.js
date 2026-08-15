import { describe, it, expect } from 'vitest'
import { SOURCES, BASE_URL } from '../src/sources.js'

describe('SOURCES', () => {
  it('lists all 14 TEA source files', () => {
    expect(SOURCES).toHaveLength(14)
  })

  it('gives every source a name, level and row floor', () => {
    for (const s of SOURCES) {
      expect(s.name, `${s.name} name`).toMatch(/^[a-z_]+$/)
      expect(['district', 'campus', 'both'], `${s.name} level`).toContain(s.level)
      expect(s.minRows, `${s.name} minRows`).toBeGreaterThan(0)
    }
  })

  it('has unique names', () => {
    expect(new Set(SOURCES.map((s) => s.name)).size).toBe(SOURCES.length)
  })

  it('points at the public TEA host over https', () => {
    expect(BASE_URL).toBe('https://txschools.gov/data')
  })
})
