// Every section is (vm) => html | null. The shell composes whatever returns
// content, so a district with no finance data, or a campus TEA declined to rate,
// needs no special-case anywhere — the section simply returns null and vanishes.
//
// Order here IS the page order. Adding a section is one function plus one entry
// in SECTIONS at the bottom.

import { esc, grade, legend, num, ordinal, pct, section, signed, statGrid, table, usd } from './shell.js'
import { trajectoryChart, scoreBars, stackedShare, comparisonChart, groupedBars } from './charts.js'
import { RACE, EXPERIENCE, STAAR_LEVELS, GRADUATION, COMPLETION, CCMR } from './labels.js'

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
    sentences.push(`Ranks ${ordinal(vm.rank)} of ${num(vm.rankOf)} Texas ${vm.level === 'district' ? 'districts' : 'campuses'}, and ${ordinal(vm.regionRank)} of ${num(vm.regionRankOf)} in ${esc(vm.regionName)}.`)
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
  <p class="place">${esc(vm.county)} County &middot; ${esc(vm.regionName)}${vm.enrollment ? ` &middot; ${num(vm.enrollment)} students` : ''}</p>
  <div class="verdict">
    ${grade(latest?.rating, latest?.score, 'lg')}
    <p class="summary">${sentences.join(' ')}</p>
  </div>
  ${alert}
  ${vm.notRated ? '<p class="note">TEA did not issue an overall rating for this campus. Scores below are the figures TEA published; the letter grades are the state\'s where it issued them.</p>' : ''}
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

  const note = `2021-22 is shown under the refreshed methodology TEA adopted in 2023, so it is comparable with later years.${
    vm.originalScore != null
      ? ` Under the original scoring it was rated <strong>${esc(vm.originalRating ?? '')}</strong> with <strong>${vm.originalScore}</strong> that year.`
      : ''
  }`

  // Two comparisons are on by default so the page is complete without JavaScript.
  // The picker below is progressive enhancement: it swaps which cohorts are drawn.
  const defaults = ['peer', 'state']
  const picker = vm.comparisons?.length
    ? `<div class="picker" role="group" aria-label="Choose comparisons">
    <span class="picker-label">Compare against</span>
    ${vm.comparisons
      .map(
        (c) =>
          `<button type="button" class="chip" data-cmp="${esc(c.key)}" aria-pressed="${defaults.includes(c.key)}"${
            c.note ? ` title="${esc(c.note)}"` : ''
          }><span class="chip-dot chip-dot-${esc(c.key)}"></span>${esc(c.label)}<span class="chip-n">${num(c.n)}</span></button>`
      )
      .join('\n    ')}
  </div>`
    : ''

  const payload = vm.comparisons?.length
    ? `<script type="application/json" data-trajectory>${JSON.stringify({
        years,
        entity: { label: vm.name, values: mine },
        comparisons: vm.comparisons.map((c) => ({
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
    `${vm.history.length} years of ratings`,
    `${picker}
  ${trajectoryChart({ years, series: [
      { key: 'entity', values: mine, label: vm.name },
      peer ? { key: 'peer', values: peer, label: 'Districts like this one' } : null,
      state ? { key: 'state', values: state, label: 'Texas average' } : null,
    ].filter(Boolean) })}
  ${payload}
  <p class="note">${note}</p>
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
  const rows = vm.domains.map(
    (d) =>
      `<tr><th scope="row">${esc(d.label)}</th><td class="num">${d.score ?? '—'}</td><td>${
        d.grade ? grade(d.grade) : '<span class="na">Not rated</span>'
      }</td><td class="num">${d.toNextGrade == null ? '—' : `${d.toNextGrade}`}</td></tr>`
  )
  const closest = vm.domains.filter((d) => d.toNextGrade != null).sort((a, b) => a.toNextGrade - b.toNextGrade)[0]

  return section(
    'domains',
    'Where the score comes from',
    `${scoreBars(vm.domains.map((d) => ({ label: d.label, score: d.score, grade: d.grade })))}
  ${table({
      caption: 'Domain scores',
      head: ['Domain', { label: 'Score', num: true }, 'Grade', { label: 'Points to next grade', num: true }],
      rows,
    })}
  ${closest ? `<p class="callout">Closest to moving up: <strong>${esc(closest.label)}</strong>, ${closest.toNextGrade} ${closest.toNextGrade === 1 ? 'point' : 'points'} below ${esc(nextLetter(closest.grade))}.</p>` : ''}`,
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
        series: STAAR_LEVELS.map((label, i) => ({ key: `l${i}`, label, values: vm.staar.levels[i] })),
      })}
  ${legend(STAAR_LEVELS.map((label, i) => ({ key: `l${i}`, label })))}
  <p class="note">Percentage of tests at or above each level. Masters is a subset of Meets, which is a subset of Approaches.</p>`
    : ''

  const grad = vm.graduation?.length
    ? `<h3>${vm.isAlt ? 'Completion' : 'Graduation'}</h3>
  ${statGrid(vm.graduation.map((g) => [g.label.replace(/ (Graduation|Completion) Rate/, ''), pct(g.value)]))}`
    : ''

  const ccmr = vm.ccmr?.length
    ? `<h3>College, career and military readiness</h3>
  ${table({
        caption: 'CCMR criteria',
        head: ['Criterion', { label: 'This ' + (vm.level === 'district' ? 'district' : 'school'), num: true }, { label: vm.level === 'district' ? 'State' : 'District', num: true }],
        rows: vm.ccmr.map(
          (c) =>
            `<tr><th scope="row" class="wrap">${esc(c.label)}</th><td class="num">${c.value ?? '—'}</td><td class="num">${c.compare ?? '—'}</td></tr>`
        ),
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
      ['Economically disadvantaged', pct(vm.profile.ecoDisPct)],
      ['English learners', pct(vm.profile.engLrnPct)],
      ['Special education', pct(vm.profile.specEdPct)],
      ['Attendance', pct(vm.profile.attendance)],
      ['Chronically absent', pct(vm.profile.absenteeism)],
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
      ['Average salary', usd(vm.profile.avgSalary)],
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

/* ----------------------------------------------------------------- source -- */

export function source(vm) {
  return section(
    'source',
    'Where this comes from',
    `<p>Every figure on this page comes from data the Texas Education Agency publishes at
     <a href="https://txschools.gov/?view=${vm.level}&amp;id=${esc(vm.id)}&amp;lng=en" rel="nofollow">txschools.gov</a>,
     fetched ${esc(vm.snapshotDate)} and archived with a checksum so each number stays traceable to the bytes TEA served.</p>
  <p class="downloads"><a href="/data/entity/${esc(vm.id)}.csv" download>Download this ${vm.level} as CSV</a> &middot;
     <a href="/data/entity/${esc(vm.id)}.json" download>JSON</a> &middot;
     <a href="/download">the whole dataset</a></p>`
  )
}

/** Page order. */
export const SECTIONS = [verdict, trajectory, domains, outcomes, students, spending, teachers, campuses, source]
