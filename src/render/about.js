// The page that has to earn the rest of the site.
//
// Two jobs, in this order. First, say plainly that this is not the Texas
// Education Agency: the address resembles the official one closely enough that
// a reader could arrive here believing it is TEA's, and nothing else on the
// page matters if that misunderstanding survives. Second, carry the
// methodology — the judgement calls that turn TEA's files into the claims made
// elsewhere on this site — in language a parent can follow, including the
// places where the honest answer is less flattering than the simple one.
//
// Prose, not bullet fragments. A reader deciding whether to trust a number
// wants to see reasoning, and reasoning does not fit in fragments.

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
  <p class="eyebrow">About this site</p>
  <h1>An independent reading of data TEA publishes</h1>
  <p class="alert"><strong>txschools.net is not affiliated with, endorsed by, or operated by
  the Texas Education Agency.</strong> It is an unofficial presentation of data TEA publishes
  publicly. The official source — run by TEA, with TEA's own wording, its own corrections and
  its own authority — is <a href="https://txschools.gov">txschools.gov</a>. This address
  resembles that one closely enough that a reader could land here believing it is the state's
  site, which is why the point comes before anything else on the page. Where a figure here
  disagrees with the figure there, the official one is right and this one is wrong.</p>
  <p class="callout">Everything published here is either a number the Texas Education Agency
  released, or an average, difference or rank computed from those numbers and labelled as such.
  Nothing is modelled, estimated or filled in. What this site contributes is not new data but
  context: the comparisons, denominators and history that make a single letter grade mean
  something.</p>
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
    'What this adds to the official site',
    `<p class="callout">The official site answers one question well: what did this school or
  district score? It answers it one entity at a time, for the current year, against the state as
  a whole. Four things are missing from that picture, and this site exists to supply them.</p>

  <h3>A comparison that is not rigged by demographics</h3>
  <p class="callout">Every figure is set against a group of schools serving a similar share of
  economically disadvantaged students, alongside the statewide figure rather than instead of it.
  A school that beats the state average while serving almost no poor students has not
  demonstrated much; a school that matches its peers while serving many has. Both comparisons
  appear, and neither is presented as the whole answer.</p>

  <h3>Rankings that state what they are out of</h3>
  <p class="callout">Any rank published here carries the group it is drawn from and the number of
  entities in that group, because a rank without a denominator is a boast rather than a fact.
  Where several entities share a placement, the tie is shown.</p>

  <h3>Years of history, made comparable</h3>
  <p class="callout">A single year is a photograph. The direction a school is moving is usually
  the more useful thing, and it only becomes visible once the years are put on a footing where
  they can be compared — which, thanks to a mid-window rule change, takes some work. That work is
  described below.</p>

  <h3>The underlying data, downloadable</h3>
  <p class="callout">Every district and campus page offers its own figures as CSV and JSON, and
  the whole normalised dataset is available at once from <a href="/download">the download
  page</a>. Nothing here is meant to be taken on trust: the numbers should be checkable against
  TEA's originals, and disagreements should be resolvable.</p>

  ${tally.length ? statGrid(tally) : ''}`
  )
}

/* ---------------------------------------------------- methodology refresh -- */

const refresh = () =>
  section(
    'methodology-refresh',
    'The 2023 methodology refresh',
    `<p class="callout">In 2023 TEA changed how the A–F rating is calculated. The rules for
  turning student results into a score were rewritten — most visibly the college, career and
  military readiness targets — and the change applies to every year from 2022-23 onward. To let
  the older year be read against the newer ones, TEA re-scored 2021-22 under the new rules and
  published the result alongside the original, labelling it <strong>2021-22 What If</strong>.</p>
  <p class="callout">The gap between the two is not small, and it is not a correction. Cayuga ISD
  was rated <strong>A</strong> with a score of <strong>94</strong> for 2021-22 under the original
  rules, and <strong>B</strong> with <strong>87</strong> for the very same year under the
  refreshed ones. Nothing the district did changed. Only the arithmetic did.</p>
  <p class="callout">This site therefore uses the re-scored figure everywhere a year is compared
  with another year, so that a trend line measures schools rather than rule changes. The original
  score is not hidden: where an entity has one, its page shows what the old rules produced, and
  says which of the two it is charting. TEA publishes six year labels; there are five academic
  years, because 2021-22 and 2021-22 What If are the same twelve months scored twice.</p>`,
    'Why the same school year can appear with two different grades, and which one this site uses.'
  )

/* ------------------------------------------------------------ peer cohort -- */

const peers = () =>
  section(
    'peer-cohort',
    'How the peer group is chosen',
    `<p class="callout">A school's peer group here is the set of schools — districts compared with
  districts, campuses with campuses — whose share of economically disadvantaged students falls
  <strong>within 10 percentage points</strong> of its own. Every page states how many entities
  that group contains, because the size of the comparison is part of the claim.</p>
  <p class="callout">The reason for it came out of this project's own analysis rather than from a
  preference. Sorting the ${num(GRADIENT.campuses)} campuses with a comparable score in both
  ${GRADIENT.from} and ${GRADIENT.to} into ten equal groups by economically disadvantaged share,
  the tenth serving the most disadvantaged students gained
  <strong>${GRADIENT.poorestGain.toFixed(2)} points</strong> on average, while the tenth serving
  the fewest gained <strong>${GRADIENT.richestGain.toFixed(2)}</strong>. A gap of that size means
  a comparison against the state average is measuring the composition of a school's intake at
  least as much as anything the school did.</p>
  <p class="callout">That cuts both ways, which is the point. Judged against the state, a
  well-off school looks better than its work warrants and a high-poverty school looks worse. The
  peer band is not an excuse offered to schools serving poor students, nor a penalty applied to
  the rest — it is the comparison that has to hold before the statewide one means anything. Both
  are shown on every page, and the reader can switch which group each figure is measured
  against.</p>
  <p class="note">The band is a blunt instrument and is presented as one. It controls for a
  single characteristic. It does not control for mobility, language, disability, school size,
  or the many things TEA does not publish at this grain.</p>`,
    "Every comparison on this site is against schools serving a similar student population, and here is why that isn't a courtesy."
  )

/* --------------------------------------------------------- judgement calls -- */

const calls = () =>
  section(
    'judgement-calls',
    'Judgement calls, stated rather than buried',
    `<h3>Alternative Education Accountability campuses are flagged, not hidden</h3>
  <p class="callout">${AEA_DISTRICTS} districts and ${AEA_CAMPUSES} campuses are evaluated by TEA
  under Alternative Education Accountability, a separate standard for schools serving students at
  risk of dropping out. They are judged against a different bar, so reading their scores beside
  everyone else's without saying so would mislead in both directions. They appear in the data and
  are marked wherever they appear, rather than being quietly filtered out of the distributions
  they would otherwise shift.</p>

  <h3>"Not Rated" is a status, not a blank</h3>
  <p class="callout">When TEA declines to issue a rating — for a new campus, for one too small to
  report without identifying students, or for other reasons in its rules — the published value is
  <strong>Not Rated</strong>. That is a decision TEA made, not a number that went missing. It is
  excluded from averages rather than counted as zero, which would drag every average it touched
  downward and invent a failure that was never assessed. Where a page has no rating to show, it
  says the rating was not issued.</p>

  <h3>Ties are reported</h3>
  <p class="callout">When several entities share a score, they share a rank, and the pages here
  say how many. A shared ceiling is not a sole first place, and a ranking that silently breaks
  ties by alphabetical order or by identifier manufactures a distinction the data does not
  contain.</p>

  <h3>Averages are unweighted unless labelled otherwise</h3>
  <p class="callout">An average across districts treats every district equally; an average across
  students does not, and the two can point in opposite directions when large and small districts
  differ. Where that difference matters to a claim, both are given.</p>`
  )

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
  place with each release, so a copy of every fetch is archived under the date it was taken and
  kept, together with a <strong>sha256 checksum of each file's decompressed contents</strong>.
  Every figure published here can therefore be traced to the exact bytes the agency served on a
  given day, and a change between releases shows up as a changed checksum rather than as a
  silently different number.</p>
  <p class="callout">The site you are reading was built from the snapshot taken
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
  <p class="note">Row counts are what the build measured after normalising the published JSON;
  they count table rows, not distinct schools, since most files carry several years per entity.</p>
  <p class="downloads"><a href="/download">Download the dataset</a> and check any of this
  against TEA's own publication.</p>`,
    'Each fetch is archived and checksummed, so every published figure traces back to the bytes TEA served.'
  )
}

/* ----------------------------------------------------------- corrections -- */

const corrections = () =>
  section(
    'corrections',
    'Errors',
    `<p class="callout">This site is built and maintained independently, and mistakes in it are
  its own rather than the Texas Education Agency's. If a figure here looks wrong, the official
  publication at <a href="https://txschools.gov">txschools.gov</a> is the authority to check it
  against. The processing that produced every claim on this site is covered by tests that
  recompute those claims from the source data, so a future release from TEA that changes the
  picture fails the build rather than quietly ageing into being wrong.</p>`
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
      'It is an unofficial presentation of data TEA publishes at txschools.gov, with peer-group comparisons, ' +
      'ranked context and downloadable data. Methodology, caveats and provenance in full.',
    canonical: `${SITE_ORIGIN}/about`,
    crumbs: [{ href: '/', label: 'Texas schools', current: 'About' }],
    sections: [
      intro(),
      adds(counts),
      refresh(),
      peers(),
      calls(),
      provenance(snapshotDate, sources),
      corrections(),
    ],
  })
}
