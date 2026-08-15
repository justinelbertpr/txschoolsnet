import { trajectoryChart, scoreBars, stackedShare, comparisonChart, esc } from './charts.js'

export const SITE_ORIGIN = 'https://txschools.net'

export const RACE_LABELS = [
  'African American', 'Hispanic', 'White', 'American Indian', 'Asian', 'Pacific Islander', 'Two or More Races',
]
export const EXPERIENCE_LABELS = [
  'Beginning', '1–5 years', '6–10 years', '11–20 years', '21–30 years', 'Over 30 years',
]

const n = (v, d = 0) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d }))
const pct = (v) => (v === null || v === undefined ? '—' : `${Number(v).toFixed(1)}%`)
const usd = (v) => (v === null || v === undefined ? '—' : `$${Number(v).toLocaleString('en-US')}`)
const ord = (i) => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = i % 100
  return i + (s[(v - 20) % 10] || s[v] || s[0])
}

/**
 * The plain-language answer, above everything else. A parent should not have to
 * read a chart to learn whether their district is improving.
 */
function summarize(e) {
  const bits = []
  const first = e.history.at(-1)
  const latest = e.history[0]

  if (latest?.score != null && first?.score != null) {
    const delta = latest.score - first.score
    const dir = delta > 0 ? 'up' : delta < 0 ? 'down' : 'unchanged'
    bits.push(
      delta === 0
        ? `${esc(e.name)} scores ${latest.score}, unchanged since ${esc(first.year)}.`
        : `${esc(e.name)} scores <strong>${latest.score}</strong>, ${dir} <strong>${Math.abs(delta)} points</strong> since ${esc(first.year)}.`
    )
  }
  if (latest?.score != null && e.stateAvg != null) {
    const d = latest.score - e.stateAvg
    bits.push(
      Math.abs(d) < 0.5
        ? `That is level with the state average of ${e.stateAvg.toFixed(1)}.`
        : `That is <strong>${Math.abs(d).toFixed(1)} points ${d > 0 ? 'above' : 'below'}</strong> the state average of ${e.stateAvg.toFixed(1)}.`
    )
  }
  if (e.rank && e.rankOf) {
    bits.push(`It ranks <strong>${ord(e.rank)} of ${n(e.rankOf)}</strong> Texas ${e.level === 'district' ? 'districts' : 'campuses'}.`)
  }
  if (e.regionRank && e.regionRankOf) {
    bits.push(`Within ${esc(e.regionName)}, ${ord(e.regionRank)} of ${n(e.regionRankOf)}.`)
  }
  return bits.join(' ')
}

const gradeChip = (g, score) =>
  `<span class="grade" data-grade="${esc(g ?? 'NR')}"><span class="grade-letter">${esc(g ?? 'NR')}</span>${
    score == null ? '' : `<span class="grade-score">${score}</span>`
  }</span>`

const stat = (label, value, note = '') =>
  `<div class="stat"><dt>${esc(label)}</dt><dd>${value}</dd>${note ? `<p class="stat-note">${esc(note)}</p>` : ''}</div>`

function legend(items) {
  return `<ul class="legend">${items
    .map((i) => `<li><span class="swatch swatch-${i.key}"></span>${esc(i.label)}</li>`)
    .join('')}</ul>`
}

export function renderEntityPage(e) {
  const latest = e.history[0]
  const kind = e.level === 'district' ? 'District' : 'Campus'
  const sector = e.isCharter ? 'Charter' : 'Traditional'
  const title = `${e.name} — ${kind === 'District' ? 'district' : 'school'} ratings, STAAR results and spending`

  const crumbs = [
    ['/', 'Texas schools'],
    [`/region/${e.regionId}`, e.regionName],
    [`/county/${e.countySlug}`, `${e.county} County`],
    e.level === 'campus' ? [`/district/${e.districtSlug}`, e.districtName] : null,
  ].filter(Boolean)

  // --- trajectory -----------------------------------------------------------
  const years = [...e.history].reverse().map((h) => h.year)
  const scores = [...e.history].reverse().map((h) => h.score)
  const stateLine = e.stateByYear ? years.map((y) => e.stateByYear[y] ?? null) : null

  const historyRows = e.history
    .map(
      (h) =>
        `<tr><th scope="row">${esc(h.year)}</th><td>${gradeChip(h.rating, null)}</td><td class="num">${h.score ?? '—'}</td></tr>`
    )
    .join('')

  // --- domains --------------------------------------------------------------
  const domainSection = e.domains?.length
    ? `<section id="domains">
  <h2>Where the score comes from</h2>
  <p class="lede">Texas builds the overall rating from three domains. ${
    e.notRated
      ? 'TEA did not issue a rating for this campus, so no letter grades are shown — only the underlying scores it published.'
      : 'A school takes the better of its two School Progress measures.'
  }</p>
  ${scoreBars(e.domains.map((d) => ({ label: d.label, score: d.score, grade: e.notRated ? null : d.grade })))}
  <table class="data">
    <caption class="sr-only">Domain scores</caption>
    <thead><tr><th>Domain</th><th class="num">Score</th><th>Grade</th><th class="num">To next grade</th></tr></thead>
    <tbody>${e.domains
      .map(
        (d) =>
          `<tr><th scope="row">${esc(d.label)}</th><td class="num">${d.score ?? '—'}</td><td>${
            e.notRated || !d.grade ? '<span class="na">Not rated</span>' : gradeChip(d.grade, null)
          }</td><td class="num">${d.toNextGrade == null ? '—' : `${d.toNextGrade} pts`}</td></tr>`
      )
      .join('')}</tbody>
  </table>
</section>`
    : ''

  // --- students -------------------------------------------------------------
  const race = e.raceShare?.map((v, i) => ({ label: RACE_LABELS[i], value: v })) ?? []
  const studentsSection = e.profile
    ? `<section id="students">
  <h2>Who this ${kind.toLowerCase()} serves</h2>
  <dl class="stats">
    ${stat('Students', n(e.profile.total))}
    ${stat('Economically disadvantaged', pct(e.profile.ecoDisPct))}
    ${stat('English learners', pct(e.profile.engLrnPct))}
    ${stat('Special education', pct(e.profile.specEdPct))}
    ${stat('Attendance', pct(e.profile.attendance))}
    ${stat('Chronically absent', pct(e.profile.absenteeism))}
  </dl>
  ${race.length ? `<h3>Student demographics</h3>${stackedShare(race)}${legend(race.filter((r) => r.value > 0).map((r, i) => ({ key: i % 7, label: `${r.label} ${r.value}%` })))}` : ''}
</section>`
    : ''

  // --- teachers -------------------------------------------------------------
  const exp = e.staffYears?.map((v, i) => ({ label: EXPERIENCE_LABELS[i], value: v })) ?? []
  const staffSection = e.profile?.avgSalary
    ? `<section id="teachers">
  <h2>Teachers</h2>
  <dl class="stats">
    ${stat('Average teacher salary', usd(e.profile.avgSalary))}
    ${stat('Teachers', n(e.profile.teachers, 0))}
    ${stat('Students per staff member', n(e.profile.stuPerStaff, 1))}
  </dl>
  ${exp.length ? `<h3>Teaching experience</h3>${stackedShare(exp)}${legend(exp.filter((x) => x.value > 0).map((x, i) => ({ key: i % 7, label: `${x.label} ${x.value}%` })))}` : ''}
</section>`
    : ''

  // --- money ----------------------------------------------------------------
  const financeSection = e.finance?.years?.length
    ? `<section id="spending">
  <h2>Spending per student</h2>
  <p class="lede">Compared against TEA's own peer group for this ${kind.toLowerCase()} and against the state. Peer groups control for size and student population, which is why they are the fairer comparison.</p>
  ${comparisonChart({
    years: e.finance.years,
    series: [
      { key: 'entity', values: e.finance.spendEntity },
      { key: 'peer', values: e.finance.spendPeer },
      { key: 'state', values: e.finance.spendState },
    ],
    fmt: (v) => `$${(v / 1000).toFixed(0)}k`,
  })}
  ${legend([
    { key: 'entity', label: e.name },
    { key: 'peer', label: 'Peer group' },
    { key: 'state', label: 'Texas average' },
  ])}
  ${
    e.finance.vsPeer != null
      ? `<p class="callout">${esc(e.name)} spends <strong>${usd(Math.abs(e.finance.vsPeer))} ${e.finance.vsPeer > 0 ? 'more' : 'less'}</strong> per student than its peer group.</p>`
      : '<p class="callout na">Peer-group spending was not reported for this entity in TEA\'s published file.</p>'
  }
</section>`
    : ''

  // --- campuses -------------------------------------------------------------
  const campusesSection = e.campuses?.length
    ? `<section id="campuses">
  <h2>${n(e.campuses.length)} schools in this district</h2>
  <table class="data sortable">
    <thead><tr><th>School</th><th>Type</th><th>Rating</th><th class="num">Score</th><th class="num">Students</th></tr></thead>
    <tbody>${e.campuses
      .map(
        (c) =>
          `<tr><th scope="row"><a href="/campus/${esc(c.slug)}">${esc(c.name)}</a></th><td>${esc(c.campusType ?? '—')}</td><td>${gradeChip(c.rating, null)}</td><td class="num">${c.score ?? '—'}</td><td class="num">${n(c.enrollment)}</td></tr>`
      )
      .join('')}</tbody>
  </table>
</section>`
    : ''

  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(
    `${e.name}: ${latest?.rating ?? 'unrated'} rating${latest?.score != null ? ` (${latest.score})` : ''} for ${latest?.year ?? ''}, ${e.history.length} years of history, domain scores, demographics and per-student spending compared with peer districts.`
  )}">
<link rel="canonical" href="${SITE_ORIGIN}/${e.level}/${esc(e.slug)}">
<link rel="stylesheet" href="/style.css">
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site">
  <a class="wordmark" href="/">txschools<span>.net</span></a>
  <p class="unofficial">Unofficial. Not affiliated with the Texas Education Agency. <a href="/about">What this is</a></p>
</header>

<nav aria-label="Breadcrumb"><ol class="crumbs">${crumbs
    .map((c) => `<li><a href="${esc(c[0])}">${esc(c[1])}</a></li>`)
    .join('')}<li aria-current="page">${esc(e.name)}</li></ol></nav>

<main id="main">
<section class="hero">
  <p class="eyebrow">${kind} · ${sector}${e.isAlt ? ' · Alternative Education Accountability' : ''}</p>
  <h1>${esc(e.name)}</h1>
  <p class="place">${esc(e.county)} County · ${esc(e.regionName)}${e.profile?.total ? ` · ${n(e.profile.total)} students` : ''}</p>

  <div class="verdict">
    ${gradeChip(latest?.rating, latest?.score)}
    <p class="summary">${summarize(e)}</p>
  </div>

  ${e.multYear > 0 ? `<p class="alert"><strong>${e.multYear} consecutive years</strong> rated unacceptable.${e.multYear >= 3 ? ' At three or more years, Texas law provides for state intervention.' : ''}</p>` : ''}
</section>

<section id="trajectory">
  <h2>Five years of ratings</h2>
  ${trajectoryChart({ years, scores, stateScores: stateLine })}
  ${stateLine ? legend([{ key: 'entity', label: e.name }, { key: 'state', label: 'Texas average' }]) : ''}
  <p class="note">2021-22 is shown under the refreshed methodology TEA adopted in 2023, so it is comparable with later years.${
    e.originalScore != null
      ? ` Under the original scoring this ${kind.toLowerCase()} scored <strong>${e.originalScore}</strong> that year${e.originalRating ? ` and was rated <strong>${esc(e.originalRating)}</strong>` : ''}.`
      : ''
  }</p>
  <table class="data">
    <caption class="sr-only">Rating history</caption>
    <thead><tr><th>Year</th><th>Rating</th><th class="num">Score</th></tr></thead>
    <tbody>${historyRows}</tbody>
  </table>
</section>

${domainSection}
${studentsSection}
${staffSection}
${financeSection}
${campusesSection}

<section id="source">
  <h2>Where this comes from</h2>
  <p>Every figure on this page comes from data the Texas Education Agency publishes at
     <a href="https://txschools.gov/?view=${e.level}&amp;id=${esc(e.id)}&amp;lng=en" rel="nofollow">txschools.gov</a>,
     fetched ${esc(e.snapshotDate)}. This site is not affiliated with TEA and is not an official source.
     <a href="/about">How this site works and what it adds</a>.</p>
  <p class="downloads">Download this ${kind.toLowerCase()}:
     <a href="/data/entity/${esc(e.id)}.json" download>JSON</a> ·
     <a href="/data/entity/${esc(e.id)}.csv" download>CSV</a> ·
     <a href="/download">the whole dataset</a></p>
</section>
</main>

<footer class="site">
  <p><strong>txschools.net</strong> is an independent, unofficial presentation of Texas school
     accountability data. It is not operated by, endorsed by, or connected to the Texas Education
     Agency. The official source is <a href="https://txschools.gov">txschools.gov</a>.</p>
</footer>
</body>
</html>
`
}
