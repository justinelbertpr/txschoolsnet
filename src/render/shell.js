// The page frame. Owns everything that is identical on every page, so a section
// never renders <head>, chrome, or the disclaimer. Sections are pure functions
// (vm) => html | null; the shell drops the nulls, which is what makes missing
// data and Not Rated entities need no special-casing anywhere else.
//
// Imports renderSearch/searchAssets from ./search.js, which itself imports
// esc/navList/num/section/shell/SITE_ORIGIN from here — a real cycle, safe
// because both sides only call into the other from inside function bodies,
// never at module-evaluation time.
import { renderSearch, searchAssets } from './search.js'

export const SITE_ORIGIN = 'https://txschools.net'

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/* ---------------------------------------------------------------- identity -- */

/**
 * The mark, in one place, because three files draw it: this module writes the
 * theme-colour metas, and src/prerender.js writes site/favicon.svg and the two
 * PNGs from the same numbers. A second copy of these coordinates is how the
 * favicon and the share card quietly stop being the same logo.
 *
 * Colours are the palette's own: --accent and --ground/--ink in both schemes
 * (site/style.css:7 and :49). Nothing here encodes a grade — the mark is three
 * ascending bars because the site is a table of scores, and it is one colour, so
 * it says nothing about any particular school.
 */
export const BRAND = {
  tile: '#1d4ed8', // --accent, light scheme
  glyph: '#ffffff',
  tileDark: '#7aa2f7', // --accent, dark scheme
  glyphDark: '#0b1220',
  themeLight: '#eceef2', // --ground, light
  themeDark: '#0b0d10', // --ground, dark
  name: 'txschools.net',
  siteName: 'txschools.net (unofficial)',
  markAlt:
    'txschools.net: three ascending bars on a blue tile. An unofficial site, not affiliated with the Texas Education Agency.',
}

/** Bars on a 32-unit grid; every edge is a multiple of 0.5 so a 16x scale to 512 lands on integers. */
export const MARK_BARS = [
  { x: 6.5, y: 17.5, w: 5, h: 7.5 },
  { x: 13.5, y: 12.5, w: 5, h: 12.5 },
  { x: 20.5, y: 7.5, w: 5, h: 17.5 },
]

/**
 * The favicon, as a string, so the build writes one 563-byte text file and no
 * binary asset at all. The scheme swap lives inside the SVG, where Chrome and
 * Firefox honour a media query in a favicon's own stylesheet; a browser that
 * ignores the query — or ignores SVG favicons entirely — still gets an opaque
 * blue tile with a white glyph, which is legible against light and dark browser
 * chrome alike. Nothing depends on the query working.
 */
export const faviconSvg = () =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-labelledby="t">
<title id="t">${esc(BRAND.name)}</title>
<style>
  .tile { fill: ${BRAND.tile} }
  .bar { fill: ${BRAND.glyph} }
  @media (prefers-color-scheme: dark) {
    .tile { fill: ${BRAND.tileDark} }
    .bar { fill: ${BRAND.glyphDark} }
  }
</style>
<rect class="tile" width="32" height="32" rx="7"/>
${MARK_BARS.map((b) => `<rect class="bar" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx=".75"/>`).join('\n')}
</svg>
`

/**
 * ONE share image for the whole site, 512x512, square, PNG.
 *
 * Not one per entity: 10,230 of them is half the 20,000-asset cap this site is
 * already rationing (src/prerender.js, FILE BUDGET). Not a handful by page type
 * either — a district card and a campus card would differ only in decoration,
 * since the words that actually differ are already in og:title and og:description.
 * So: one file, one meaning, no per-page lie.
 *
 * PNG rather than SVG, even though every other drawing on this site is an SVG the
 * build writes: no major unfurler rasterises SVG for og:image (X, Facebook, Slack
 * and iMessage all take PNG/JPEG/WEBP/GIF), so an SVG card would be a file nobody
 * ever renders. It is drawn by ~40 lines of zlib in src/prerender.js rather than
 * by a dependency, and it is axis-aligned rectangles precisely so that no
 * rasteriser, font or anti-aliasing is needed to draw it.
 */
export const OG_IMAGE = { path: '/og.png', width: 512, height: 512 }
export const APPLE_TOUCH_ICON = { path: '/apple-touch-icon.png', size: 180 }

/**
 * A card field is a headline, not a paragraph: X truncates around 70 characters
 * of title and Slack around 200 of description. Clamping here rather than asking
 * every caller to write two descriptions keeps <title> and <meta name=description>
 * full-length for search, and cuts the card copy on a word.
 */
export const clampText = (s, max) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  const body = space > max * 0.6 ? cut.slice(0, space) : cut
  return `${body.replace(/[\s,;:.–—-]+$/, '')}…`
}

/* -------------------------------------------------------------- navigation -- */

/**
 * A list of links that navigate. `legend()` further down looks identical and is
 * NOT this: a legend labels the colours in a figure, and wrapping site navigation
 * in one tells a screen-reader user that the front page's twenty regions are a
 * chart key. Hubs that need a wrapped row of links (the A-Z strip, the region
 * list) should call this instead — same shape, real semantics.
 *
 * `meta` is a caller-formatted count *with its unit* ("31 districts"), because a
 * bare number beside a name is the same unlabelled boast a rank without an n is.
 */
export const navList = (items, { label = null } = {}) =>
  `<nav class="sitenav"${label ? ` aria-label="${esc(label)}"` : ''}>
  <ul class="navlist">${items
    .map(
      (i) =>
        `<li><a href="${esc(i.href)}"${i.current ? ' aria-current="page"' : ''}>${esc(i.label)}</a>${
          i.meta ? ` <span class="chip-n">${esc(i.meta)}</span>` : ''
        }</li>`
    )
    .join('')}</ul>
</nav>`

/**
 * The primary navigation, on every page. Four destinations, all of which exist as
 * static pages, so this works with JavaScript off and with CSS off. The current
 * item is derived from the canonical URL the caller already passes — no page has
 * to remember to say which one it is.
 */
const PRIMARY_NAV = [
  { href: '/', label: 'Home', match: (p) => p === '/' || p === '' },
  { href: '/districts/a', label: 'Districts A–Z', match: (p) => p.startsWith('/districts/') },
  { href: '/download', label: 'Download data', match: (p) => p === '/download' },
  { href: '/about', label: 'About', match: (p) => p === '/about' },
]

/** Path of a canonical URL; a malformed one simply matches nothing. */
export const pathOf = (canonical) => {
  try {
    return new URL(String(canonical ?? ''), SITE_ORIGIN).pathname
  } catch {
    return ''
  }
}

export const siteNav = (canonical) => {
  const here = pathOf(canonical)
  return navList(
    PRIMARY_NAV.map(({ href, label, match }) => ({ href, label, current: match(here) })),
    { label: 'Site' }
  )
}

/**
 * `rail` and `sticky` are HTML strings or null, and they are the *inner* markup:
 * the shell owns the wrappers (.layout, aside.rail, .col, .stickybar) so every
 * page that has a rail has the same frame around it. A page that passes no rail
 * — the hubs, /about, /download, /404 — gets the single-column document it
 * always got, byte for byte: .layout, .rail and .col are emitted only when a
 * rail exists, so there is no empty grid wrapper to style around.
 *
 * The sticky bar ships `hidden` and is a duplicate of what the hero already
 * says, so a reader with JavaScript off loses nothing by never seeing it.
 *
 * ------------------------------------------------------- THE SHARE CARD
 *
 * Every page emits og: and twitter: tags built from the title, description and
 * canonical URL it already passes, so no caller has to opt in and no page can
 * ship without them. `cardTitle`/`cardDescription` override the clamped title and
 * description when a page wants different words on the card; nothing passes them
 * today and the defaults are correct.
 *
 * twitter:card is `summary`, not `summary_large_image`, and that is a decision
 * about honesty rather than taste. The image is one shared site mark — see
 * OG_IMAGE — because 10,230 per-entity cards would breach the 20,000-asset cap
 * this site already plans around (the FILE BUDGET note in src/prerender.js).
 * `summary_large_image` renders that shared mark as a 2:1 banner above the text,
 * where a reader reasonably reads the picture as being *of this school*; the same
 * banner on 10,230 different schools is a picture that means nothing. `summary`
 * puts it in a small square thumbnail beside the copy — which is what a site mark
 * is for — and leaves the school's name, grade and cohort, all of which are true
 * and per-page, as the dominant text of the card.
 *
 * og:site_name carries "(unofficial)". The card is the one surface where a reader
 * meets this site with no page around it, so it is the one place the
 * non-affiliation line cannot be a footer.
 */
export function shell({
  title,
  description,
  canonical,
  crumbs = [],
  sections,
  rail = null,
  sticky = null,
  cardTitle = null,
  cardDescription = null,
}) {
  const body = sections.filter(Boolean).join('\n')
  const trail = crumbs
    .map((c) => `<li><a href="${esc(c.href)}">${esc(c.label)}</a></li>`)
    .join('')

  const crumbNav = crumbs.length
    ? `<nav aria-label="Breadcrumb"><ol class="crumbs">${trail}<li aria-current="page">${esc(crumbs.at(-1)?.current ?? '')}</li></ol></nav>`
    : ''

  const main = `<main id="main">
${body}
</main>`

  const stickyBar = sticky ? `<div class="stickybar" hidden>${sticky}</div>\n` : ''

  const frame = rail
    ? `<div class="layout">
<aside class="rail" id="rail" aria-label="Page tools">
${rail}
</aside>
<div class="col">
${stickyBar}${crumbNav}

${main}
</div>
</div>`
    : `${crumbNav}

${main}`

  const image = `${SITE_ORIGIN}${OG_IMAGE.path}`
  const ogTitle = clampText(cardTitle ?? title, 70)
  const ogDescription = clampText(cardDescription ?? description, 200)

  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${esc(APPLE_TOUCH_ICON.path)}">
<meta name="theme-color" content="${BRAND.themeLight}" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="${BRAND.themeDark}" media="(prefers-color-scheme: dark)">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(BRAND.siteName)}">
<meta property="og:locale" content="en_US">
<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="${esc(ogDescription)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="${OG_IMAGE.width}">
<meta property="og:image:height" content="${OG_IMAGE.height}">
<meta property="og:image:alt" content="${esc(BRAND.markAlt)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(ogTitle)}">
<meta name="twitter:description" content="${esc(ogDescription)}">
<meta name="twitter:image" content="${esc(image)}">
<meta name="twitter:image:alt" content="${esc(BRAND.markAlt)}">
<link rel="stylesheet" href="/style.css">
<body>
<a class="skip" href="#main">Skip to content</a>

<header class="site">
  <a class="wordmark" href="/">txschools<span>.net</span></a>
  ${renderSearch({ id: 'header-search', variant: 'header', assets: false })}
  ${siteNav(canonical)}
  <p class="unofficial">Unofficial &middot; not affiliated with the Texas Education Agency &middot; <a href="/about">what this is</a></p>
</header>

${frame}

<footer class="site">
  <p><strong>txschools.net</strong> is an independent, unofficial presentation of data the Texas
  Education Agency publishes publicly. It is not operated by, endorsed by, or connected to TEA.
  The official source is <a href="https://txschools.gov">txschools.gov</a>.
  <a href="/about">How this site works and what it adds</a>.</p>
</footer>
${searchAssets({ scriptSrc: '/search.js' })}
<script type="module" src="/app.js"></script>
</body>
</html>
`
}

/* ---------- shared presentation helpers ---------- */

export const num = (v, d = 0) =>
  v === null || v === undefined || Number.isNaN(v)
    ? '—'
    : Number(v).toLocaleString('en-US', { maximumFractionDigits: d })

export const pct = (v, d = 1) => (v === null || v === undefined ? '—' : `${Number(v).toFixed(d)}%`)
export const usd = (v) => (v === null || v === undefined ? '—' : `$${Math.round(v).toLocaleString('en-US')}`)
export const signed = (v, d = 1) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}`)

export const ordinal = (i) => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = i % 100
  return `${i.toLocaleString('en-US')}${s[(v - 20) % 10] || s[v] || s[0]}`
}

/** Grades are never colour-encoded — the letter is the encoding. */
export const grade = (g, score = null, size = '') =>
  `<span class="grade${size ? ` grade-${size}` : ''}"><span class="grade-letter">${esc(g ?? 'NR')}</span>${
    score === null || score === undefined ? '' : `<span class="grade-score">${score}</span>`
  }</span>`

/**
 * The comparison chip. Every published number carries one, rendered server-side
 * against the default cohort and re-rendered client-side when the reader switches
 * cohorts. data-* carries what the swap needs so the client never recomputes a
 * value — only which cohort it reads.
 */
export const cmp = (vm, key, { fmt = 'points', invert = false } = {}) => {
  const mine = vm.own?.[key]
  if (mine == null || !vm.cohorts?.length) return ''
  const active = vm.cohorts[0]
  const other = active.metrics[key]
  if (other == null) return ''
  const d = mine - other
  const good = invert ? d < 0 : d > 0
  return `<span class="cmp${Math.abs(d) < 0.05 ? ' cmp-level' : good ? ' cmp-up' : ' cmp-down'}" data-metric="${esc(key)}" data-fmt="${esc(fmt)}"${invert ? ' data-invert="1"' : ''}>${fmtDelta(d, fmt)} <span class="cmp-vs">vs ${esc(active.short)}</span></span>`
}

export const fmtDelta = (d, fmt) => {
  const sign = d > 0 ? '+' : d < 0 ? '−' : '±'
  const a = Math.abs(d)
  if (fmt === 'usd') return `${sign}$${Math.round(a).toLocaleString('en-US')}`
  if (fmt === 'pct') return `${sign}${a.toFixed(1)} pts`
  if (fmt === 'ratio') return `${sign}${a.toFixed(1)}`
  return `${sign}${a.toFixed(1)}`
}

/**
 * The page-level cohort switch. Changes every comparison at once.
 *
 * It now lives in the rail rather than the hero, under a "Compare against"
 * heading, so the visible `.picker-label` that used to introduce it here would
 * be the same sentence twice in a 15rem column. The heading names the group for
 * a sighted reader and the role/aria-label below names it for a screen reader.
 * Everything the client reads by selector — .cohort-bar, .chip-cohort, and both
 * JSON script tags — is unchanged, because site/app.js finds them that way.
 */
export const cohortSwitch = (vm) =>
  !vm.cohorts?.length
    ? ''
    : `<div class="cohort-bar" role="group" aria-label="Compare every figure against">
  ${vm.cohorts
    .map(
      (c, i) =>
        `<button type="button" class="chip chip-cohort" data-cohort="${esc(c.key)}" aria-pressed="${i === 0}"${c.note ? ` title="${esc(c.note)}"` : ''}>${esc(c.label)}<span class="chip-n">${num(c.n)}</span></button>`
    )
    .join('\n  ')}
  <script type="application/json" data-cohorts>${JSON.stringify(
    vm.cohorts.map((c) => ({ key: c.key, short: c.short, label: c.label, n: c.n, metrics: c.metrics }))
  ).replace(/</g, '\\u003c')}</script>
  <script type="application/json" data-own>${JSON.stringify(vm.own).replace(/</g, '\\u003c')}</script>
</div>`

export const section = (id, heading, inner, lede = '') =>
  `<section id="${id}">
  <h2>${esc(heading)}</h2>${lede ? `\n  <p class="lede">${lede}</p>` : ''}
  ${inner}
</section>`

export const statGrid = (items) =>
  `<dl class="stats">${items
    .filter(Boolean)
    .map(([label, value, note]) =>
      `<div class="stat"><dt>${esc(label)}</dt><dd>${value}</dd>${note ? `<p class="stat-note">${esc(note)}</p>` : ''}</div>`
    )
    .join('')}</dl>`

export const legend = (items) =>
  `<ul class="legend">${items
    .map((i) => `<li><span class="swatch swatch-${esc(i.key)}"></span>${esc(i.label)}</li>`)
    .join('')}</ul>`

export const table = ({ caption, head, rows, className = 'data' }) =>
  `<table class="${className}">
    <caption class="sr-only">${esc(caption)}</caption>
    <thead><tr>${head.map((h) => `<th${h.num ? ' class="num"' : ''}>${esc(h.label ?? h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table>`
