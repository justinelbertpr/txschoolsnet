// The page frame. Owns everything that is identical on every page, so a section
// never renders <head>, chrome, or the disclaimer. Sections are pure functions
// (vm) => html | null; the shell drops the nulls, which is what makes missing
// data and Not Rated entities need no special-casing anywhere else.

export const SITE_ORIGIN = 'https://txschools.net'

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export function shell({ title, description, canonical, crumbs = [], sections }) {
  const body = sections.filter(Boolean).join('\n')
  const trail = crumbs
    .map((c) => `<li><a href="${esc(c.href)}">${esc(c.label)}</a></li>`)
    .join('')

  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<link rel="stylesheet" href="/style.css">
<body>
<a class="skip" href="#main">Skip to content</a>

<header class="site">
  <a class="wordmark" href="/">txschools<span>.net</span></a>
  <p class="unofficial">Unofficial &middot; not affiliated with the Texas Education Agency &middot; <a href="/about">what this is</a></p>
</header>

${crumbs.length ? `<nav aria-label="Breadcrumb"><ol class="crumbs">${trail}<li aria-current="page">${esc(crumbs.at(-1)?.current ?? '')}</li></ol></nav>` : ''}

<main id="main">
${body}
</main>

<footer class="site">
  <p><strong>txschools.net</strong> is an independent, unofficial presentation of data the Texas
  Education Agency publishes publicly. It is not operated by, endorsed by, or connected to TEA.
  The official source is <a href="https://txschools.gov">txschools.gov</a>.
  <a href="/about">How this site works and what it adds</a>.</p>
</footer>
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

/** The page-level cohort switch. Changes every comparison at once. */
export const cohortSwitch = (vm) =>
  !vm.cohorts?.length
    ? ''
    : `<div class="cohort-bar" role="group" aria-label="Compare every figure against">
  <span class="picker-label">Compare everything against</span>
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
