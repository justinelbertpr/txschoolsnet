// Every section is (vm) => html | null. The shell composes whatever returns
// content, so a district with no finance data, or a campus TEA declined to rate,
// needs no special-case anywhere — the section simply returns null and vanishes.
//
// Order here IS the page order. Adding a section is one function plus one entry
// in SECTIONS at the bottom.

import { cmp, cohortSwitch, esc, grade, legend, num, ordinal, pct, section, signed, statGrid, table, usd } from './shell.js'
import { trajectoryChart, scoreBars, stackedShare, comparisonChart, groupedBars } from './charts.js'
import { RACE, EXPERIENCE, STAAR_LEVELS, GRADUATION, COMPLETION, CCMR } from './labels.js'

/* ------------------------------------------------------------------ words -- */

// Counts reach the page as prose, so the noun has to agree with the number. One
// year is a year, one student is a student. 179 pages read "1 years of ratings"
// and 61 read "1 students" before this existed.
const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`

// TEA's own noun for the two levels. Used wherever a sentence names the thing the
// page is about, so a district page never calls itself a campus.
const unit = (vm) => (vm.level === 'district' ? 'district' : 'campus')

/* ---------------------------------------------------------------- verdict -- */

export function verdict(vm) {
  const latest = vm.history[0]
  const first = vm.history.at(-1)
  const kind = vm.level === 'district' ? 'District' : 'Campus'
  const sentences = []

  if (latest?.score != null && first?.score != null) {
    const d = latest.score - first.score
    sentences.push(
      d === 0
        ? `Scores <strong>${latest.score}</strong>, unchanged since ${esc(first.year)}.`
        : `Scores <strong>${latest.score}</strong>, ${d > 0 ? 'up' : 'down'} <strong>${Math.abs(d)} points</strong> since ${esc(first.year)}.`
    )
  }

  // Both comparisons, deliberately. The state line is the number readers expect;
  // the peer line is the one that survives the poverty gradient.
  if (latest?.score != null && vm.stateAvg != null) {
    const d = latest.score - vm.stateAvg
    sentences.push(
      Math.abs(d) < 0.5
        ? `Level with the state average.`
        : `<strong>${signed(d)} points</strong> against the state average of ${vm.stateAvg.toFixed(1)}.`
    )
  }
  if (latest?.score != null && vm.peerAvg != null) {
    const d = latest.score - vm.peerAvg
    const firstPeer = vm.peerByYear?.[first?.year]
    const started = firstPeer != null && first?.score != null ? first.score - firstPeer : null
    let s = `<strong>${signed(d)} points</strong> against the ${num(vm.peerN)} ${vm.level === 'district' ? 'districts' : 'campuses'} serving a similar share of economically disadvantaged students.`
    if (started != null && Math.sign(started) !== Math.sign(d) && d > 0) {
      s += ` It started <strong>below</strong> that group.`
    }
    sentences.push(s)
  }
  if (vm.rank && vm.rankOf) {
    // A correct competition rank that does not disclose its ties still reads as a
    // sole placement. Say how many share it.
    const share = (n) => (n > 0 ? ` (shared with ${num(n)} other${n === 1 ? '' : 's'})` : '')
    const unit = vm.level === 'district' ? 'districts' : 'campuses'
    sentences.push(
      `Ranks ${ordinal(vm.rank)} of ${num(vm.rankOf)} Texas ${unit}${share(vm.rankTied)}, and ${ordinal(vm.regionRank)} of ${num(vm.regionRankOf)} in ${esc(vm.regionName)}${share(vm.regionRankTied)}.`
    )
  }

  const alert =
    vm.multYear > 0
      ? `<p class="alert"><strong>${vm.multYear} consecutive ${vm.multYear === 1 ? 'year' : 'years'}</strong> rated unacceptable.${
          vm.multYear >= 3 ? ' At three or more years, Texas law provides for state intervention.' : ''
        }</p>`
      : ''

  return `<section class="hero">
  <p class="eyebrow">${kind} &middot; ${vm.isCharter ? 'Charter' : 'Traditional'}${vm.isAlt ? ' &middot; Alternative Education Accountability' : ''}</p>
  <h1>${esc(vm.name)}</h1>
  <p class="place">${esc(vm.county)} County &middot; ${esc(vm.regionName)}${vm.enrollment ? ` &middot; ${plural(vm.enrollment, 'student')}` : ''}</p>
  <div class="verdict">
    ${grade(latest?.rating, latest?.score, 'lg')}
    <p class="summary">${sentences.join(' ')}</p>
  </div>
  ${alert}
  ${vm.notRated ? `<p class="note">TEA did not issue an overall rating for this ${unit(vm)}. Scores below are the figures TEA published; the letter grades are the state's where it issued them.</p>` : ''}
  ${cohortSwitch(vm)}
</section>`
}

/* ------------------------------------------------------------- trajectory -- */

export function trajectory(vm) {
  if (!vm.history?.length) return null
  const years = [...vm.history].reverse().map((h) => h.year)
  const mine = [...vm.history].reverse().map((h) => h.score)
  const peer = vm.peerByYear ? years.map((y) => vm.peerByYear[y] ?? null) : null
  const state = vm.stateByYear ? years.map((y) => vm.stateByYear[y] ?? null) : null

  const rows = vm.history.map((h) => {
    const p = vm.peerByYear?.[h.year]
    return `<tr><th scope="row">${esc(h.year)}</th><td>${grade(h.rating)}</td><td class="num">${h.score ?? '—'}</td><td class="num">${p == null ? '—' : p.toFixed(1)}</td><td class="num">${vm.stateByYear?.[h.year]?.toFixed(1) ?? '—'}</td></tr>`
  })

  // The rescoring footnote explains one row. Entities whose history starts after
  // 2021-22 have no such row, and 657 pages carried the explanation anyway —
  // annotating a year that is not on the page.
  const has2122 = vm.history.some((h) => h.year === '2021-22')
  const note = !has2122
    ? ''
    : `2021-22 is shown under the refreshed methodology TEA adopted in 2023, so it is comparable with later years.${
        vm.originalScore != null
          ? ` Under the original scoring it was rated <strong>${esc(vm.originalRating ?? '')}</strong> with <strong>${vm.originalScore}</strong> that year.`
          : ''
      }`

  // A chip whose series is empty invites the reader to switch to a cohort that
  // draws nothing. Offer only cohorts that have at least one value in the years
  // this page actually shows — and default only to those that survive.
  const comparisons = (vm.comparisons ?? []).filter((c) => years.some((y) => c.byYear?.[y] != null))

  // Two comparisons are on by default so the page is complete without JavaScript.
  // The picker below is progressive enhancement: it swaps which cohorts are drawn.
  const defaults = ['peer', 'state'].filter((k) => comparisons.some((c) => c.key === k))
  const picker = comparisons.length
    ? `<div class="picker" role="group" aria-label="Choose comparisons">
    <span class="picker-label">Compare against</span>
    ${comparisons
      .map(
        (c) =>
          `<button type="button" class="chip" data-cmp="${esc(c.key)}" aria-pressed="${defaults.includes(c.key)}"${
            c.note ? ` title="${esc(c.note)}"` : ''
          }><span class="chip-dot chip-dot-${esc(c.key)}"></span>${esc(c.label)}<span class="chip-n">${num(c.n)}</span></button>`
      )
      .join('\n    ')}
  </div>`
    : ''

  const payload = comparisons.length
    ? `<script type="application/json" data-trajectory>${JSON.stringify({
        years,
        entity: { label: vm.name, values: mine },
        comparisons: comparisons.map((c) => ({
          key: c.key,
          label: c.label,
          n: c.n,
          values: years.map((y) => c.byYear[y] ?? null),
        })),
        defaults,
      }).replace(/</g, '\\u003c')}</script>`
    : ''

  return section(
    'trajectory',
    `${plural(vm.history.length, 'year')} of ratings`,
    `${picker}
  ${trajectoryChart({ years, series: [
      { key: 'entity', values: mine, label: vm.name },
      // This is the line's accessible name. It was fixed at 'Districts like this
      // one' on 8,857 campus pages — the only string in the legend not switched
      // on the level of the page it appears on.
      peer ? { key: 'peer', values: peer, label: vm.level === 'district' ? 'Districts like this one' : 'Schools like this one' } : null,
      state ? { key: 'state', values: state, label: 'Texas average' } : null,
    ].filter(Boolean) })}
  ${payload}
  ${note ? `<p class="note">${note}</p>` : ''}
  ${table({
      caption: 'Rating history with comparisons',
      head: ['Year', 'Rating', { label: 'Score', num: true }, { label: 'Similar', num: true }, { label: 'State', num: true }],
      rows,
    })}`
  )
}

/* ---------------------------------------------------------------- domains -- */

export function domains(vm) {
  if (!vm.domains?.length) return null

  // src/normalize/domains.js derives the letter from the score using TEA's own
  // bands, and says in terms that a consumer holding entity metadata must not
  // publish that letter for a Not Rated entity: the state withheld it as an
  // administrative decision (mostly alternative-education campuses) that the
  // score alone cannot see. The score below is TEA's. The letter would be ours,
  // so it is not shown, and neither is anything that reads as one — "points to
  // next grade" has no referent without a current grade.
  const derivedGrades = !vm.notRated

  const rows = vm.domains.map(
    (d) =>
      `<tr><th scope="row">${esc(d.label)}</th><td class="num">${d.score ?? '—'}</td><td>${
        derivedGrades && d.grade ? grade(d.grade) : '<span class="na">Not rated</span>'
      }</td><td class="num">${!derivedGrades || d.toNextGrade == null ? '—' : `${d.toNextGrade}`}</td></tr>`
  )
  const closest = !derivedGrades
    ? null
    : vm.domains.filter((d) => d.toNextGrade != null).sort((a, b) => a.toNextGrade - b.toNextGrade)[0]

  return section(
    'domains',
    'Where the score comes from',
    `${scoreBars(
      vm.domains.map((d) => ({
        label: d.label,
        score: d.score,
        grade: derivedGrades ? d.grade : null,
        markers: (vm.cohorts ?? []).slice(0, 2).map((c, i) => ({
          key: i === 0 ? 'peer' : 'state',
          label: c.label,
          short: c.short,
          value: c.metrics[`domain:${d.domain}`] ?? null,
        })),
      }))
    )}
  ${vm.cohorts?.length ? legend([{ key: 'entity', label: vm.name }, ...vm.cohorts.slice(0, 2).map((c, i) => ({ key: i === 0 ? 'peer' : 'state', label: `${c.label} (${num(c.n)})` }))]) : ''}
  ${table({
      caption: 'Domain scores',
      head: ['Domain', { label: 'Score', num: true }, 'Grade', { label: 'Points to next grade', num: true }],
      rows,
    })}
  ${closest ? `<p class="callout">Closest to moving up: <strong>${esc(closest.label)}</strong>, ${closest.toNextGrade} ${closest.toNextGrade === 1 ? 'point' : 'points'} below ${esc(nextLetter(closest.grade))}.</p>` : ''}
  ${
    derivedGrades
      ? ''
      : `<p class="note">The scores above are the ones TEA published. TEA did not issue letter grades for
  this ${unit(vm)}, so none are shown: the A&ndash;F thresholds marked on the chart are the state's, but
  applying them here would produce a grade the state chose to withhold.</p>`
  }`,
    'Texas builds the overall rating from three domains, and a school takes the better of its two School Progress measures. The 60, 70, 80 and 90 rules mark the letter-grade thresholds.'
  )
}

const nextLetter = (g) => ({ F: 'D', D: 'C', C: 'B', B: 'A' }[g] ?? 'the next grade')

/* ------------------------------------------------------------- outcomes --- */

export function outcomes(vm) {
  if (!vm.staar?.subjects?.length && !vm.graduation?.length && !vm.ccmr?.length) return null

  const staar = vm.staar?.subjects?.length
    ? `<h3>STAAR performance</h3>
  ${groupedBars({
        groups: vm.staar.subjects,
        series: STAAR_LEVELS.map((label, i) => ({
          key: `l${i}`,
          label,
          values: vm.staar.levels[i],
          compare: vm.cohorts?.length
            ? vm.staar.subjects.map((subj) => vm.cohorts[0].metrics[`staar:${subj}:${i}`] ?? null)
            : null,
        })),
      })}
  ${legend([...STAAR_LEVELS.map((label, i) => ({ key: `l${i}`, label })), vm.cohorts?.length ? { key: 'peer', label: `Tick: ${vm.cohorts[0].label} (${num(vm.cohorts[0].n)})` } : null].filter(Boolean))}
  <p class="note">Percentage of tests at or above each level. Masters is a subset of Meets, which is a subset of Approaches. The tick on each bar marks the average for ${vm.level === 'district' ? 'districts' : 'schools'} serving a similar share of economically disadvantaged students — a comparison TEA does not publish.</p>`
    : ''

  const grad = vm.graduation?.length
    ? `<h3>${vm.isAlt ? 'Completion' : 'Graduation'}</h3>
  ${statGrid(vm.graduation.map((g, i) => [g.label.replace(/ (Graduation|Completion) Rate/, ''), pct(g.value) + cmp(vm, `grad:${i}`, { fmt: 'pct', invert: g.label === 'Dropout Rate' })]))}`
    : ''

  const ccmr = vm.ccmr?.length
    ? `<h3>College, career and military readiness</h3>
  ${table({
        caption: 'CCMR criteria',
        head: ['Criterion', { label: 'This ' + (vm.level === 'district' ? 'district' : 'school'), num: true }, { label: vm.cohorts?.[0]?.short ?? 'Cohort', num: true }, { label: 'Gap', num: true }],
        rows: vm.ccmr.map((c, i) => {
          const other = vm.cohorts?.[0]?.metrics[`ccmr:${i}`] ?? null
          const mine = vm.own?.[`ccmr:${i}`] ?? null
          const gap = mine != null && other != null ? mine - other : null
          return `<tr><th scope="row" class="wrap">${esc(c.label)}</th><td class="num">${c.value ?? '—'}</td><td class="num">${other == null ? '—' : other.toFixed(1) + '%'}</td><td class="num">${gap == null ? '—' : `<span class="${gap >= 0 ? 'cmp-up' : 'cmp-down'}">${gap >= 0 ? '+' : '−'}${Math.abs(gap).toFixed(1)}</span>`}</td></tr>`
        }),
      })}`
    : ''

  return section('outcomes', 'Student outcomes', `${staar}\n  ${grad}\n  ${ccmr}`)
}

/* ------------------------------------------------------------- who it serves */

export function students(vm) {
  if (!vm.profile) return null
  const race = (vm.raceShare ?? []).map((v, i) => ({ label: RACE[i], value: v })).filter((r) => r.value > 0)
  return section(
    'students',
    `Who this ${vm.level === 'district' ? 'district' : 'school'} serves`,
    `${statGrid([
      ['Students', num(vm.profile.total)],
      ['Economically disadvantaged', pct(vm.profile.ecoDisPct) + cmp(vm, 'ecoDis', { fmt: 'pct' })],
      ['English learners', pct(vm.profile.engLrnPct) + cmp(vm, 'engLrn', { fmt: 'pct' })],
      ['Special education', pct(vm.profile.specEdPct) + cmp(vm, 'specEd', { fmt: 'pct' })],
      ['Attendance', pct(vm.profile.attendance) + cmp(vm, 'attendance', { fmt: 'pct' })],
      ['Chronically absent', pct(vm.profile.absenteeism) + cmp(vm, 'absenteeism', { fmt: 'pct', invert: true })],
    ])}
  ${race.length ? `<h3>Student demographics</h3>${stackedShare(race)}${legend(race.map((r, i) => ({ key: String(i % 7), label: `${r.label} ${r.value}%` })))}` : ''}`,
    'Placed after the results deliberately: this is context for reading them, not an explanation of them.'
  )
}

/* ------------------------------------------------------------------ money -- */

export function spending(vm) {
  if (!vm.finance?.years?.length) return null
  const f = vm.finance
  const missing = ['spendPeer', 'spendState', 'spendEntity'].filter((k) => f[k].every((v) => v === null))
  return section(
    'spending',
    'Spending per student',
    `${comparisonChart({
      years: f.years,
      series: [
        { key: 'entity', values: f.spendEntity },
        { key: 'peer', values: f.spendPeer },
        { key: 'state', values: f.spendState },
      ].filter((s) => !s.values.every((v) => v === null)),
      fmt: (v) => `$${(v / 1000).toFixed(0)}k`,
    })}
  ${legend([
      { key: 'entity', label: vm.name },
      { key: 'peer', label: 'TEA peer group' },
      { key: 'state', label: 'Texas average' },
    ])}
  ${
    f.vsPeer != null
      ? `<p class="callout">Spends <strong>${usd(Math.abs(f.vsPeer))} ${f.vsPeer > 0 ? 'more' : 'less'}</strong> per student than its peer group, and <strong>${usd(Math.abs(f.vsState))} ${f.vsState > 0 ? 'more' : 'less'}</strong> than the state average.</p>`
      : `<p class="note na">TEA's published file does not include peer-group spending for this entity, so no comparison is shown.</p>`
  }
  ${missing.length ? `<p class="note na">Not reported by TEA for this entity: ${missing.map((m) => m.replace('spend', '').toLowerCase()).join(', ')}.</p>` : ''}`,
    "Compared against TEA's own peer group, which controls for size and student population, and against the state."
  )
}

/* --------------------------------------------------------------- teachers -- */

export function teachers(vm) {
  if (!vm.profile?.avgSalary) return null
  const exp = (vm.staffYears ?? []).map((v, i) => ({ label: EXPERIENCE[i], value: v })).filter((x) => x.value > 0)
  return section(
    'teachers',
    'Teachers',
    `${statGrid([
      ['Average salary', usd(vm.profile.avgSalary) + cmp(vm, 'avgSalary', { fmt: 'usd' })],
      vm.profile.teachers ? ['Teachers', num(vm.profile.teachers)] : null,
      vm.profile.stuPerStaff ? ['Students per staff member', num(vm.profile.stuPerStaff, 1)] : null,
    ])}
  ${exp.length ? `<h3>Teaching experience</h3>${stackedShare(exp)}${legend(exp.map((x, i) => ({ key: String(i % 7), label: `${x.label} ${x.value}%` })))}` : ''}`
  )
}

/* --------------------------------------------------------------- campuses -- */

export function campuses(vm) {
  if (!vm.campuses?.length) return null
  const rows = vm.campuses.map(
    (c) =>
      `<tr><th scope="row"><a href="/campus/${esc(c.slug)}">${esc(c.name)}</a></th><td>${esc(c.campusType ?? '—')}</td><td>${grade(c.rating)}</td><td class="num">${c.score ?? '—'}</td><td class="num">${num(c.enrollment)}</td></tr>`
  )
  return section(
    'campuses',
    `${num(vm.campuses.length)} schools in this district`,
    table({
      caption: 'Schools in this district',
      head: ['School', 'Type', 'Rating', { label: 'Score', num: true }, { label: 'Students', num: true }],
      rows,
      className: 'data scroll',
    })
  )
}

/* -------------------------------------------------------------- standouts -- */

const ordSuffix = (i) => { const s = ['th','st','nd','rd'], v = i % 100; return s[(v - 20) % 10] || s[v] || s[0] }

/** A sentence someone can paste into a newsletter and have it hold up. */
export const claimSentence = (vm, r) => {
  const unit = vm.level === 'district' ? 'districts' : 'schools'
  const scope =
    r.cohort === 'state' ? `Texas ${unit}`
    : r.cohort === 'peer' ? `${unit} serving a similar share of economically disadvantaged students`
    : `${unit} in ${r.cohortLabel}`
  const tie = r.tied > 0 ? `, tied with ${r.tied} other${r.tied === 1 ? '' : 's'}` : ''
  const reporting = ' that report this measure'
  const dir = r.lowerIsBetter ? 'lowest' : 'highest'
  return `${vm.name} ranks ${r.rank}${ordSuffix(r.rank)} of ${r.of} ${scope}${reporting} for ${r.label} (${dir}, 2025-26)${tie}. Source: txschools.net`
}

export function standouts(vm) {
  if (!vm.standouts?.length) return null

  const rows = vm.standouts
    .map((r) => {
      const claim = claimSentence(vm, r)
      return `<li class="standout">
      <div class="standout-rank"><span class="standout-n">${r.rank}</span><span class="standout-of">of ${num(r.of)}</span></div>
      <div class="standout-body">
        <p class="standout-metric">${esc(r.label)}${r.lowerIsBetter ? ' <span class="standout-dir">(lowest is best)</span>' : ''}</p>
        <p class="standout-scope">${esc(r.cohortLabel)} &middot; of the ${num(r.of)} that report this measure${r.tied > 0 ? ` &middot; tied with ${num(r.tied)}` : ''}</p>
      </div>
      <button type="button" class="copy" data-claim="${esc(claim)}" aria-label="Copy this statement">Copy</button>
    </li>`
    })
    .join('\n    ')

  return section(
    'standouts',
    'Where this ' + (vm.level === 'district' ? 'district' : 'school') + ' ranks best',
    `<ul class="standouts">
    ${rows}
  </ul>
  <p class="note"><strong>These are selected high placements, not a summary.</strong> Every figure above
  this section is the full picture, including where this ${vm.level} ranks poorly. Each statement below
  states its cohort and its denominator so it can be checked — a rank without an n is a boast, not a
  fact. Ties are shown because a shared ceiling is not a sole first place.</p>`,
    `Out of ${num(vm.ranks.length)} rankings computed across every published metric and every comparison group, these are the placements that stand out. Press Copy for a citable sentence.`
  )
}

/* ----------------------------------------------------------------- source -- */

export function source(vm) {
  return section(
    'source',
    'Where this comes from',
    `<p>Every figure on this page comes from data the Texas Education Agency publishes at
     <a href="https://txschools.gov/?view=${vm.level}&amp;id=${esc(vm.id)}&amp;lng=en" rel="nofollow">txschools.gov</a>,
     fetched ${esc(vm.snapshotDate)} and archived with a checksum so each number stays traceable to the bytes TEA served.</p>
  ${downloadLinks(vm)}`
  )
}

/**
 * Per-entity files are pre-generated for districts only. 10,230 entities in two
 * formats is 20,460 assets and a Workers version is capped at 20,000, so the
 * 9,031 campus files are never written (see the note at the top of
 * src/prerender.js). _redirects cannot rescue them either — a splat there is
 * followed whether or not an asset matches, which took out all 2,398 real
 * district files when it was tried. So the link has to be honest at the source:
 * a campus page links what exists rather than a file that 404s.
 */
const downloadLinks = (vm) =>
  vm.level === 'district'
    ? `<p class="downloads"><a href="/data/entity/${esc(vm.id)}.csv" download>Download this district as CSV</a> &middot;
     <a href="/data/entity/${esc(vm.id)}.json" download>JSON</a> &middot;
     <a href="/download">the whole dataset</a></p>`
    : `<p class="downloads"><a href="/download">Download the full dataset</a>${
        vm.districtSlug ? ` &middot; <a href="/district/${esc(vm.districtSlug)}#source">this campus's district</a>` : ''
      }</p>
  <p class="note">Single-file records are pre-built for districts only, so there is no per-campus CSV to
     link here &mdash; 10,230 entities in two formats would exceed the 20,000-asset limit this site is
     published under. This campus is a row in the bulk files on the download page, keyed by its TEA id
     <code>${esc(vm.id)}</code>.</p>`

/** Page order. */
export const SECTIONS = [verdict, trajectory, domains, outcomes, students, spending, teachers, standouts, campuses, source]
