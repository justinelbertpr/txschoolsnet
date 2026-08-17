// The page that has to earn the rest of the site.
//
// Two jobs, in this order. First, say plainly that this is not the Texas
// Education Agency: the address resembles the official one closely enough that
// a reader could arrive here believing it is TEA's, and nothing else on the
// page matters if that misunderstanding survives. Second, carry the
// methodology — the judgement calls that turn TEA's files into the claims made
// elsewhere on this site.
//
// Every factual commitment is stated ONCE. The page was 1,500 words and said
// several things three times in three wordings; a reader who has to wade to
// reach the caveats does not reach the caveats. Section order answers a
// reader's questions in the order they arrive: what is this, what does it add,
// where did the numbers come from, what should I distrust.

import { esc, num, section, shell, statGrid, table, SITE_ORIGIN } from './shell.js'

/** TEA's own classification counts, measured from the committed snapshot. */
const AEA_DISTRICTS = 30
const AEA_CAMPUSES = 416

/** The poverty-gradient finding that justifies the peer cohort. §8 of the design. */
const GRADIENT = {
  campuses: 8242,
  from: '2023-24',
  to: '2025-26',
  poorestGain: 4.34,
  richestGain: 0.75,
}

/* ------------------------------------------------------------------ intro -- */

const intro = () => `<section class="hero">
  <p class="eyebrow">Unofficial</p>
  <h1>About txschools.net</h1>
  <p class="alert"><strong>txschools.net is not affiliated with, endorsed by, or operated by
  the Texas Education Agency.</strong> It is an unofficial presentation of data TEA publishes.
  The official site is <a href="https://txschools.gov">txschools.gov</a>. Where a figure here
  disagrees with the figure there, the official one is right and this one is wrong.</p>
</section>`

/* ------------------------------------------------------------ what it adds -- */

const adds = (counts = {}) => {
  const tally = [
    counts.districts != null ? ['Districts', num(counts.districts)] : null,
    counts.campuses != null ? ['Campuses', num(counts.campuses)] : null,
    counts.years != null ? ['Academic years', num(counts.years)] : null,
    counts.metrics != null ? ['Metrics compared', num(counts.metrics)] : null,
  ].filter(Boolean)

  return section(
    'what-this-adds',
    'What this adds',
    `<h3>A comparison that demographics do not rig</h3>
  <p class="callout">Every figure is set against schools serving a similar share of economically
  disadvantaged students, alongside the statewide figure rather than instead of it. Beating the
  state average while serving almost no poor students demonstrates less than matching peers while
  serving many.</p>

  <h3>Ranks that state what they are out of</h3>
  <p class="callout">Every rank here carries the group it is drawn from and the number of entities
  in that group. Where several entities share a score they share a rank, and the page says how
  many.</p>

  <h3>Five years of history, made comparable</h3>
  <p class="callout">The direction a school is moving is usually more useful than one year of it.
  TEA rewrote the rules mid-window, so making the years comparable takes work.</p>

  <h3>The underlying data, downloadable</h3>
  <p class="callout">Every district and campus page offers its own figures as CSV and JSON, and the
  whole normalised dataset is at <a href="/download">the download page</a>. Nothing here is meant
  to be taken on trust.</p>

  ${tally.length ? statGrid(tally) : ''}`,
    'TEA publishes what a school scored. This site adds the context that makes the score mean something.'
  )
}

/* ------------------------------------------------------------- provenance -- */

const provenance = (snapshotDate, sources = []) => {
  const rows = sources.map(
    (s) => `<tr><th scope="row">${esc(s.name)}</th><td class="num">${num(s.rows)}</td></tr>`
  )

  return section(
    'provenance',
    'Where the numbers come from',
    `<p class="callout">The data is fetched from the files TEA serves publicly at
  <a href="https://txschools.gov" rel="nofollow">txschools.gov</a>. TEA overwrites those files in
  place with each release, so every fetch is kept under the date it was taken with a
  <strong>sha256 checksum of each file's decompressed contents</strong>: a change between releases
  shows up as a changed checksum rather than as a silently different number.</p>
  <p class="callout">This site was built from the snapshot taken
  <strong>${esc(snapshotDate ?? 'on the date shown on each page')}</strong>${
    sources.length ? `, comprising the ${num(sources.length)} files below.` : '.'
  }</p>
  ${
    rows.length
      ? table({
          caption: 'TEA source files in this snapshot, with row counts',
          head: ['TEA source file', { label: 'Rows', num: true }],
          rows,
        })
      : ''
  }
  <p class="note">Row counts are what the build measured after normalising the published JSON. They
  count table rows, not distinct schools, since most files carry several years per entity.</p>
  <p class="downloads"><a href="/download">Download the dataset</a> and check any of this against
  TEA's own publication.</p>`,
    'Each fetch is archived and checksummed, so every published figure traces back to the bytes TEA served.'
  )
}

/* ---------------------------------------------------- methodology refresh -- */

const refresh = () =>
  section(
    'methodology-refresh',
    'The 2023 methodology refresh',
    `<p class="callout">In 2023 TEA rewrote how the A–F score is calculated — most visibly the
  college, career and military readiness targets — for every year from 2022-23 onward. So the older
  year could be read beside the newer ones, TEA re-scored 2021-22 under the new rules and published
  the result alongside the original, labelled <strong>2021-22 What If</strong>.</p>
  <p class="callout">The gap is not small, and it is not a correction. Cayuga ISD was rated
  <strong>A</strong> with <strong>94</strong> for 2021-22 under the original rules, and
  <strong>B</strong> with <strong>87</strong> for the same year under the refreshed ones. Nothing
  the district did changed; only the arithmetic did.</p>
  <p class="callout">This site therefore uses the re-scored figure wherever one year is compared
  with another, so a trend measures schools rather than rule changes. The original is not hidden:
  where an entity has one, its page shows it and says which figure it is charting. TEA publishes
  six year labels; there are five academic years, because 2021-22 and 2021-22 What If are the same
  twelve months scored twice.</p>`,
    'Why the same school year can appear with two different grades, and which one this site uses.'
  )

/* ------------------------------------------------------------ peer cohort -- */

const peers = () =>
  section(
    'peer-cohort',
    'How the peer group is chosen',
    `<p class="callout">A peer group is the schools — districts with districts, campuses with
  campuses — whose share of economically disadvantaged students falls <strong>within 10 percentage
  points</strong> of the entity's own. Every page states how many entities that group contains.</p>
  <p class="callout">The band came out of this project's own analysis. Of the
  ${num(GRADIENT.campuses)} campuses with a comparable score in both ${GRADIENT.from} and
  ${GRADIENT.to}, sorted into ten equal groups by economically disadvantaged share, the poorest
  tenth gained <strong>${GRADIENT.poorestGain.toFixed(2)} points</strong> on average and the richest
  tenth gained <strong>${GRADIENT.richestGain.toFixed(2)}</strong>. A gap that size means a
  comparison against the state average measures the composition of a school's intake at least as
  much as anything the school did.</p>
  <p class="callout">That cuts both ways. Judged against the state, a well-off school looks better
  than its work warrants and a high-poverty school looks worse. The band is not an excuse for one or
  a penalty on the other. Both comparisons appear on every page, and the reader can switch which
  group each figure is measured against.</p>
  <p class="note">The band is blunt, and presented as one: it controls for a single characteristic.
  It does not control for mobility, language, disability, school size, or the many things TEA does
  not publish at this grain.</p>`
  )

/* --------------------------------------------------------- judgement calls -- */

const calls = () =>
  section(
    'judgement-calls',
    'Judgement calls',
    `<h3>Alternative Education Accountability campuses are flagged, not hidden</h3>
  <p class="callout">TEA evaluates ${AEA_DISTRICTS} districts and ${AEA_CAMPUSES} campuses under
  Alternative Education Accountability, a separate standard for schools serving students at risk of
  dropping out. They are held to a different bar, so they are marked wherever they appear rather
  than quietly filtered out of the distributions they would otherwise shift.</p>

  <h3>"Not Rated" is a status, not a blank</h3>
  <p class="callout">When TEA declines to issue a rating — for a new campus, for one too small to
  report without identifying students, or for other reasons in its rules — the published value is
  <strong>Not Rated</strong>. It is excluded from averages rather than counted as zero, which would
  invent a failure that was never assessed. Where a page has no rating to show, it says the rating
  was not issued.</p>

  <h3>Averages are unweighted unless labelled otherwise</h3>
  <p class="callout">An average across districts treats every district equally; an average across
  students does not, and the two can point in opposite directions when large and small districts
  differ. Where that difference matters to a claim, both are given.</p>`
  )

/* ----------------------------------------------------------- corrections -- */

const corrections = () =>
  section(
    'corrections',
    'Errors',
    `<p class="callout">This site is built and maintained independently, and mistakes in it are its
  own rather than the Texas Education Agency's. If a figure here looks wrong, check it against
  <a href="https://txschools.gov">txschools.gov</a>. Every claim published here is covered by tests
  that recompute it from the source data, so a future release from TEA that changes the picture
  fails the build rather than quietly ageing into being wrong.</p>
  <p>If it still looks wrong after checking against TEA's own figure, that is a bug in this site's
  normalisation, not a data question —
  <a href="https://github.com/justinelbertpr/txschoolsnet/issues">report it on GitHub</a>, with the
  page URL and the figure you expected.</p>`
  )

/* ------------------------------------------------------------------ page -- */

/**
 * @param {object}   opts
 * @param {string}   opts.snapshotDate  the date the archived TEA fetch was taken
 * @param {object}   opts.counts        { districts, campuses, years, metrics }
 * @param {Array}    opts.sources       [{ name, rows }] — the TEA files in the snapshot
 */
export function renderAboutPage({ snapshotDate, counts = {}, sources = [] } = {}) {
  return shell({
    title: 'About txschools.net — an unofficial view of Texas school ratings',
    description:
      'txschools.net is not affiliated with, endorsed by, or operated by the Texas Education Agency. ' +
      'It is an unofficial presentation of data TEA publishes at txschools.gov, adding peer-group ' +
      'comparisons, ranks with denominators and five years of history. Methodology and provenance in full.',
    canonical: `${SITE_ORIGIN}/about`,
    crumbs: [{ href: '/', label: 'Texas schools', current: 'About' }],
    sections: [
      intro(),
      adds(counts),
      provenance(snapshotDate, sources),
      refresh(),
      peers(),
      calls(),
      corrections(),
    ],
  })
}
