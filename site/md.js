/* Hand the whole page over as Markdown, for a reader who is going to paste it
   into an AI tool.
   -------------------------------------------------------------------------
   The use case this exists for: someone in a district communications office
   opens their own district's page and wants every figure on it in one block
   they can drop into a chat window and ask for a draft. Today that means
   selecting a page of nested tables and disclosure widgets by hand and getting
   back a soup of tabs, or downloading a CSV that has the numbers but none of
   the labels that say what they mean.

   THREE DECISIONS WORTH THE WORDS:

   1. The Markdown is built from the rendered DOM, not from a server-side copy
      of the same data. That costs zero bytes on 10,230 entity pages — the
      alternative was embedding a second, Markdown-shaped serialisation of
      every figure in every page, which on this site's scale is megabytes of
      duplicate payload. It also cannot drift: whatever the page says is what
      the export says, because they are the same strings. A server-rendered
      export would be a second thing to keep in step with sections.js, and the
      first time someone changed a label in one place it would stop matching.

   2. It carries provenance in a header before any number appears. A model
      handed a bare table will invent a source and a year for it, and this
      site's whole posture is that every figure traces back to an archived TEA
      snapshot. So the export names TEA as the source, names the snapshot date
      (<meta name="txs:snapshot">, written by src/render/shell.js), gives the
      canonical URL, and says in its own sentence that txschools.net is not TEA
      and that the peer comparisons are this site's own rather than the state's.

   3. There is no no-JS fallback here, deliberately, and that is not a hole in
      the no-JS baseline. Copying to a clipboard IS a client-side act; there is
      nothing for a server to render. The button is created by this script and
      therefore simply does not exist with JavaScript off — no dead control, no
      broken affordance. The reader who has JS off still gets every figure on
      the page as HTML, and the bulk CSV/JSON at /download.

   CSP: this file is same-origin (script-src 'self'). It builds every node with
   createElement/textContent and never assigns .innerHTML, so the enforced
   Trusted Types policy is not involved at all. Blob downloads and
   navigator.clipboard.writeText were both verified against the exact
   production header in site/_headers — neither is blocked by default-src
   'none' (there is no CSP directive governing either).
*/

/* ------------------------------------------------------- DOM → Markdown --- */

/* Nodes that carry no data, or carry it only as decoration:
   - [aria-hidden=true] decoration the page already tells assistive tech to
                        ignore — chart fills, tick marks, the ↗ on an outbound
                        link. Exactly the right test: this site already had to
                        mark every such node for screen readers, so the export
                        gets that classification for free rather than guessing.
   - .sr-only           a caption that exists only for screen readers; the
                        heading above it says the same thing in the export
   - .legend            a colour key for a chart the export cannot include
   - .mobile-compare    the cohort switcher — a control, not a figure. Its
                        <h2>Compare with</h2> would otherwise land in the
                        export as a heading with nothing underneath it.
   - nav/form/button/svg/script/style/template — chrome
   - .rail, .stickybar, .crumbs, .rail-sheet — navigation repeated elsewhere
   - .eyebrow, .place   moved up into the provenance header instead, where
                        "which district, where, how big" belongs
   Charts themselves are dropped with svg/aria-hidden. Nothing is lost: every
   chart on this site is accompanied by the table it was drawn from — that was
   the point of the "expose the data points" work — and the table is kept. */
const SKIP =
  'script,style,template,nav,form,button,svg,[aria-hidden="true"],.sr-only,.legend,' +
  '.rail,.stickybar,.crumbs,.rail-sheet,.sitesearch,.mobile-compare,.md-export,.eyebrow,.place'

const skipped = (el) => el.matches(SKIP)

/**
 * Text of an element, minus any subtree in `drop`.
 *
 * textContent alone is not usable here: it welds adjacent elements together
 * ("88" + "/100" + "2025-26" -> "88/1002025-26"), and it happily reads out
 * decoration the page hides from assistive tech. This walks instead, skipping
 * what SKIP covers, so the callers below can pull a value and its annotations
 * out of one element separately and join them with punctuation of their own.
 */
const raw = (el, drop) => {
  let s = ''
  for (const n of el.childNodes) {
    if (n.nodeType === 3) s += n.nodeValue
    else if (n.nodeType === 1 && !skipped(n) && !drop?.has(n)) s += raw(n, drop)
  }
  return s
}

// Normalised once, at the top — NOT inside the recursion. Trimming each nested
// call eats the significant leading space in markup like `+7<small> pts</small>`
// and welds it into "+7pts".
const text = (el, drop = null) => (el ? raw(el, drop).replace(/\s+/g, ' ').trim() : '')

/** Escape the pipes that would otherwise split a GFM table cell in two. */
const cell = (s) => s.replace(/\|/g, '\\|')

/** `value (annotation · annotation)` — the shape every figure on this site has. */
const withAnnotations = (host, selector) => {
  const annots = [...host.querySelectorAll(selector)]
  const drop = new Set(annots)
  const value = text(host, drop)
  const notes = annots.map((a) => text(a)).filter(Boolean)
  return notes.length ? `${value} (${notes.join(' · ')})` : value
}

const bullet = (label, value) => (label && value ? `- **${label}:** ${value}` : label || value ? `- ${label || value}` : '')

/**
 * A <dl class="stats"> or <dl class="hero-facts"> row as a labelled bullet.
 *
 * Both wrap a figure in annotations that are markup siblings rather than
 * sentence continuations — the comparison chip (.cmp), the caption under a
 * hero fact (a bare <span>), a stat's footnote (.stat-note). Pulling them out
 * and parenthesising them is what turns "+6.4 ptsvs the average of 399" into
 * "+6.4 pts (vs the average of 399 ...)".
 */
const statLines = (dl) =>
  [...dl.children]
    .map((row) => {
      const dd = row.querySelector('dd')
      return bullet(text(row.querySelector('dt')), dd ? withAnnotations(dd, ':scope > span, :scope > .cmp, :scope > .stat-note') : '')
    })
    .filter(Boolean)
    .join('\n')

/**
 * A <ul class="hbars"> — the domain score bars. The bar itself is aria-hidden
 * and drops out; what is left is the label, the score with its letter grade,
 * and the deltas against each cohort.
 */
const barLines = (ul) =>
  [...ul.children]
    .map((li) => {
      const value = text(li.querySelector('.hbar-value'))
      const sub = text(li.querySelector('.hbar-sub'))
      return bullet(text(li.querySelector('.hbar-label')), sub ? `${value} (${sub})` : value)
    })
    .filter(Boolean)
    .join('\n')

/**
 * A GFM pipe table. Header cells keep their two-line form as "Label (sub)" —
 * the sub-line is the unit or the cohort an average belongs to, which is
 * exactly the context a model reading a column of signed numbers needs.
 */
const tableLines = (table) => {
  const head = [...table.querySelectorAll('thead th')].map((th) => {
    const sub = th.querySelector('small')
    return cell(sub ? `${text(th, new Set([sub]))} (${text(sub)})` : text(th))
  })
  const rows = [...table.querySelectorAll('tbody tr')].map((tr) =>
    [...tr.children].map((c) => cell(text(c)))
  )
  if (!rows.length) return ''
  const width = Math.max(head.length, ...rows.map((r) => r.length))
  const pad = (r) => [...r, ...Array(Math.max(0, width - r.length)).fill('')]
  const line = (r) => `| ${pad(r).join(' | ')} |`
  return [
    line(head.length ? head : Array(width).fill('')),
    `| ${Array(width).fill('---').join(' | ')} |`,
    ...rows.map(line),
  ].join('\n')
}

const HEADINGS = { H1: '# ', H2: '## ', H3: '### ', H4: '#### ', H5: '##### ', H6: '###### ' }

/**
 * Walks in document order and emits blocks. Recurses only into containers it
 * has no block-level rendering of its own for, so a <table> inside a <details>
 * is emitted once, as a table — not once by the table branch and again as the
 * flattened text of its parent.
 */
/**
 * A chart's <title> elements, when they carry values rather than series names.
 *
 * The stacked composition charts (demographics, teacher experience) put the
 * whole figure in their segment titles — "Hispanic: 44.6%" — and have no
 * accompanying table, so dropping the SVG wholesale left a heading with nothing
 * under it and lost the only copy of that breakdown. The trajectory chart's
 * titles are series names ("Texas average") with no value in them, and its
 * numbers are already in the table beside it. Requiring a ": " is what tells
 * those two apart without hard-coding either chart's class name.
 */
const chartLines = (svg) => {
  const items = [...svg.querySelectorAll('title')].map((t) => text(t)).filter((s) => /: /.test(s))
  return items.map((s) => `- ${s}`).join('\n')
}

function blocks(root) {
  const out = []
  const walk = (el) => {
    for (const node of el.children) {
      // SVG elements report a lowercase tagName; normalise before matching.
      const tag = node.tagName.toUpperCase()
      // Checked before skipped(), which drops every svg so that text() can
      // never splice chart internals into a neighbouring paragraph.
      if (tag === 'SVG') {
        const t = chartLines(node)
        if (t) out.push(t)
        continue
      }
      if (skipped(node)) continue

      if (HEADINGS[tag]) {
        // The <h1> is the entity's name, which provenance() has already used as
        // the document title. Emitting it again would open every export with
        // the same line twice.
        const t = tag === 'H1' ? '' : text(node)
        if (t) out.push(HEADINGS[tag] + t)
        continue
      }
      if (tag === 'TABLE') {
        const t = tableLines(node)
        if (t) out.push(t)
        continue
      }
      if (tag === 'DL') {
        const t = statLines(node)
        if (t) out.push(t)
        continue
      }
      if (tag === 'P') {
        const t = text(node)
        if (!t) continue
        const cls = node.classList
        // The one outbound link on the page that is itself data. Without the
        // href the line reads "Visit the official district website" and names
        // no website.
        const href = cls.contains('enroll') ? node.querySelector('a[href]')?.href : null
        if (href) out.push(`- **Official website:** ${href}`)
        // .note and .alert are caveats about the figures around them; .lede and
        // .verdict-label introduce the block under them. Italics and bold keep
        // both readings intact once the colour and size cues are gone.
        else if (cls.contains('note') || cls.contains('alert')) out.push(`_${t}_`)
        else if (cls.contains('verdict-label')) out.push(`**${t}**`)
        else out.push(t)
        continue
      }
      if (tag === 'UL' || tag === 'OL') {
        const items = node.classList.contains('hbars')
          ? barLines(node)
          : [...node.children]
              .filter((li) => !skipped(li))
              // A standout ranking already carries a fully-qualified sentence
              // for exactly this purpose — metric, rank, denominator, cohort,
              // direction, year, ties and source, in one line built to be
              // quoted. Reassembling the same facts from the three fragments
              // the layout splits them into would be strictly worse, and is
              // what produced "1of 19 College, career or military ready ...".
              .map((li) => `- ${li.querySelector('[data-claim]')?.dataset.claim ?? text(li)}`)
              .filter((s) => s !== '- ')
              .join('\n')
        if (items) out.push(items)
        continue
      }
      if (tag === 'SUMMARY') {
        // A collapsed STAAR subject group carries a real heading inside its
        // summary (role="heading" aria-level="4"), matching the <h4> the first,
        // uncollapsed group gets. Honouring it keeps every subject at the same
        // depth in the export instead of demoting the collapsed ones to bold.
        const h = node.querySelector('[role="heading"]')
        if (h) {
          out.push(`${'#'.repeat(Math.min(6, Number(h.getAttribute('aria-level')) || 4))} ${text(h)}`)
          continue
        }
        // Otherwise the summary is a label plus a <small> gloss of what is
        // inside ("Browse all 50 schools" + "Name, type, rating, ..."), two
        // sibling elements that concatenate into one run-on without a dash.
        const t = [...node.children].length
          ? [...node.children].filter((c) => !skipped(c)).map((c) => text(c)).filter(Boolean).join(' — ')
          : text(node)
        if (t) out.push(`**${t}**`)
        continue
      }
      // Containers: section, div, details, dd wrappers and the like. Recurse
      // so their block children are emitted in their own right.
      walk(node)
    }
  }
  walk(root)
  return out
}

/* ------------------------------------------------------------ provenance -- */

const meta = (name) => document.querySelector(`meta[name="${name}"]`)?.content ?? null

/**
 * The header that goes above every export. Written as prose rather than a YAML
 * front-matter block because the consumer is a chat model reading it as text,
 * and prose is what it will actually honour when it writes.
 */
function provenance() {
  const title = text(document.querySelector('main h1')) || document.title
  const url = document.querySelector('link[rel=canonical]')?.href ?? location.href
  const snapshot = meta('txs:snapshot')
  // The kind ("District · Traditional") and the place line sit in the hero as
  // two small paragraphs. In an export they belong up here — what this is,
  // where it is and how big it is are the first things a model needs, and left
  // in the body they read as two orphaned fragments under the title.
  const what = [text(document.querySelector('main .eyebrow')), text(document.querySelector('main .place'))]
    .filter(Boolean)
    .join(' · ')
  return [
    `# ${title}`,
    ...(what ? ['', `_${what}_`] : []),
    '',
    '## Source and terms of use',
    '',
    [
      `- **Data source:** Texas Education Agency (TEA) accountability data${snapshot ? `, archived snapshot of ${snapshot}` : ''}.`,
      `- **Page:** ${url}`,
      '- **Publisher:** txschools.net — an independent, unofficial site. It is **not** operated by, endorsed by, or connected to the Texas Education Agency.',
      '- **Scope:** traditional public school districts and campuses.',
      // The page links its own machine-readable copies. Anyone loading this
      // export into a tool that can fetch is better served by those than by
      // re-parsing the tables below.
      ...(() => {
        const files = [...document.querySelectorAll('main a[href*="/data/entity/"]')].map((a) => a.href)
        return files.length ? [`- **Machine-readable copy of this data:** ${[...new Set(files)].join(' · ')}`] : []
      })(),
      '- **Comparisons:** figures labelled as an average of similar districts, a region, a county or the state are computed by txschools.net from TEA data. TEA does not publish them.',
    ].join('\n'),
    '',
    '_When writing from this data, attribute the underlying figures to the Texas Education Agency and any comparison or ranking to txschools.net. Do not describe txschools.net as an official or state source._',
  ].join('\n')
}

/** The whole page, as one Markdown document. */
export function pageMarkdown() {
  const main = document.querySelector('main')
  return main ? `${provenance()}\n\n${blocks(main).join('\n\n')}\n` : `${provenance()}\n`
}

/* -------------------------------------------------------------- the UI ---- */

const el = (tag, props = {}, kids = []) => {
  const n = document.createElement(tag)
  Object.assign(n, props)
  for (const k of [].concat(kids)) n.append(k)
  return n
}

const slug = () =>
  (location.pathname.replace(/\/$/, '').split('/').pop() || 'txschools').replace(/[^a-z0-9-]/gi, '') || 'txschools'

function openPanel(markdown) {
  const status = el('p', { className: 'md-status', role: 'status' })
  const box = el('textarea', { className: 'md-text', readOnly: true, value: markdown, spellcheck: false })

  const say = (m) => { status.textContent = m }

  const copy = el('button', { type: 'button', className: 'rk-btn md-copy', textContent: 'Copy to clipboard' })
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(markdown)
      say('Copied. Paste it into your AI tool.')
    } catch {
      // Permission denied, or a browser without the async clipboard. Select the
      // text so the reader's own copy shortcut finishes the job, rather than
      // reporting a failure they can do nothing about.
      box.focus()
      box.select()
      say('Select-all is done — press Ctrl/Cmd+C to copy.')
    }
  })

  const save = el('a', { className: 'rk-btn md-save', textContent: 'Download .md', download: `${slug()}.md` })
  save.href = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))

  const dialog = el('dialog', { className: 'md-dialog' }, [
    el('form', { method: 'dialog', className: 'md-dismiss' }, [
      el('button', { type: 'submit', className: 'md-close', textContent: '×', ariaLabel: 'Close' }),
    ]),
    el('h2', { textContent: 'This page as Markdown' }),
    el('p', {
      className: 'md-intro',
      textContent:
        'Every figure on this page, plus where it came from, in one block you can paste into an AI tool. The source note at the top travels with it.',
    }),
    el('div', { className: 'md-actions' }, [copy, save, status]),
    box,
  ])

  // Revoking on close keeps the blob from being held for the life of the page;
  // the download has already been handed to the browser by then.
  dialog.addEventListener('close', () => {
    URL.revokeObjectURL(save.href)
    dialog.remove()
  })

  document.body.append(dialog)
  dialog.showModal()
  copy.focus()
}

function mount() {
  const hero = document.querySelector('main .hero') ?? document.querySelector('main > section')
  if (!hero) return

  const button = el('button', {
    type: 'button',
    className: 'rk-btn md-open',
    textContent: 'Copy this page for AI',
  })
  // Built lazily: a district page's Markdown is ~8 KB of string work, and most
  // readers never open this.
  button.addEventListener('click', () => openPanel(pageMarkdown()))

  hero.append(
    el('div', { className: 'md-export' }, [
      button,
      el('span', { className: 'md-hint', textContent: 'Markdown, with the TEA source and snapshot date attached.' }),
    ])
  )
}

mount()
