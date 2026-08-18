/**
 * test/render/rail-layout.test.js
 *
 * One CSS ordering rule, tested because breaking it disabled a whole control
 * without breaking anything a renderer test could see.
 *
 * The rail is a sticky, viewport-clamped, scrolling column on a wide screen,
 * and a plain block of tools printed after the article on a phone. The narrow
 * case therefore has to undo the clamp — `max-height: none; overflow: visible`
 * — and it did, in a `@media (max-width: 1023.98px)` block.
 *
 * An UNCONDITIONAL `.rail { max-height: calc(100vh …) }` then appeared later in
 * the file. Later source order wins at equal specificity, so on a phone the
 * rail was clamped to one viewport height again while still carrying
 * `overflow: visible` from the reset that had won for that property. Its last
 * ~300px — the entire pinner: search box, results list, pinned entries —
 * rendered outside the rail's box and underneath the footer, on screen and
 * unclickable. Measured on a 390px viewport: rail box 739px, content 1056px,
 * footer painted from y=731 over results sitting at y=809-1017.
 *
 * Nothing else catches this. The markup is correct, every unit test passes,
 * the page looks fine on a laptop, and the control is simply unusable on the
 * device most readers use.
 */

import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

const css = readFileSync('site/style.css', 'utf8')

/** Every top-level (unnested) `.rail { … }` rule, with where it starts. */
const topLevelRailRules = () => {
  const out = []
  let depth = 0
  for (let i = 0; i < css.length; i++) {
    const ch = css[i]
    if (ch === '{') {
      // A `{` at depth 0 opens a rule; check what selector precedes it.
      if (depth === 0) {
        const selector = css.slice(css.lastIndexOf('}', i - 1) + 1, i).trim().split('\n').pop().trim()
        if (/(^|,)\s*\.rail\s*$/.test(selector)) {
          const end = css.indexOf('}', i)
          out.push({ at: i, line: css.slice(0, i).split('\n').length, body: css.slice(i + 1, end) })
        }
      }
      depth++
    } else if (ch === '}') depth--
  }
  return out
}

describe('the rail’s viewport clamp', () => {
  it('is never re-applied unconditionally after the narrow layout resets it', () => {
    // An unconditional `.rail` clamp BEFORE the reset is fine — the reset wins
    // on source order, which is exactly how the base rule and the narrow
    // override are meant to interact. One AFTER it is the bug: same
    // specificity, later position, so it silently wins on a phone too.
    const reset = css.indexOf('@media (max-width: 1023.98px)')
    expect(reset).toBeGreaterThan(-1)
    const offenders = topLevelRailRules()
      .filter((r) => r.at > reset && /max-height\s*:/.test(r.body))
      .map((r) => `line ${r.line}: ${r.body.match(/max-height[^;]*/)[0].trim()}`)
    expect(offenders).toEqual([])
  })

  it('still clamps the sticky rail on a wide screen', () => {
    // The clamp is what makes the rail scroll independently beside a long
    // article; dropping it entirely would be the opposite regression.
    expect(css).toMatch(/@media \(min-width: 1024px\) \{\s*\.rail \{[^}]*max-height:[^}]*\}/)
  })

  it('resets the clamp for the narrow layout', () => {
    const narrow = css.slice(css.indexOf('@media (max-width: 1023.98px)'))
    expect(narrow.slice(0, narrow.indexOf('\n}\n'))).toMatch(/\.rail \{[^}]*max-height: none/)
  })
})
