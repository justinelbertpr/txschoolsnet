import { describe, it, expect } from 'vitest'
import { csvCell, datasetCsv, entityCsv, entityJson, entityRows, fileSize, renderDownloadPage, ENTITY_COLUMNS } from '../../src/render/downloads.js'
import { CCMR } from '../../src/render/labels.js'

/* A minimal RFC 4180 reader. The point of the escaping tests is that a real
   parser gets the original string back, so the test must not use the same
   escaping code it is checking. */
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ } else if (c === '"') quoted = false
      else field += c
      continue
    }
    if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' } else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' } else if (c !== '\r') field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}

/** Comment lines are provenance, not data. Strip them the way a reader would. */
const body = (csv) => csv.split('\n').filter((l) => !l.startsWith('#')).join('\n')
const readCsv = (csv) => {
  const [head, ...rest] = parseCsv(body(csv))
  return rest.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])))
}

/* A district whose name contains a comma. Real TEA names have none today, but
   CCMR criterion labels do ("...on SAT, ACT, TSIA"), and district names are TEA's
   to change. A format that only works on today's data is not a format. */
const vm = {
  id: '057905',
  level: 'district',
  name: 'Wells, Independent School District',
  slug: 'wells-independent-school-district-057905',
  county: 'Cherokee',
  countyId: '037',
  regionId: '07',
  regionName: 'Region 07: Kilgore',
  districtId: null,
  districtName: null,
  entityType: 'Independent',
  campusType: null,
  isCharter: false,
  isAlt: false,
  enrollment: 1204,
  snapshotDate: '15 August 2026',
  enrollmentSnapshotDate: '24 August 2026',
  enrollmentSourceUrl: 'https://rptsvr1.tea.texas.gov/adhocrpt/adspr.html',
  notRated: false,
  multYear: 0,

  history: [
    { year: '2025-26', rating: 'B', score: 84 },
    { year: '2024-25', rating: 'C', score: 79 },
  ],
  stateByYear: { '2025-26': 80.4, '2024-25': 78.2 },
  peerByYear: { '2025-26': 76.1, '2024-25': null },
  peerN: 294,
  rank: 214,
  rankOf: 1207,
  regionRank: 9,
  regionRankOf: 61,
  originalScore: null,
  originalRating: null,

  domains: [
    { domain: 'achievement', label: 'Student Achievement', score: 82, grade: 'B', toNextGrade: 8 },
    { domain: 'gaps', label: 'Closing the Gaps', score: null, grade: null, toNextGrade: null },
  ],

  profile: {
    total: 1204, schoolYear: '2025-26', ecoDisPct: 62.5, engLrnPct: null, specEdPct: 12.1,
    attendance: 94.2, absenteeism: null, avgSalary: 58231, teachers: 84.5, stuPerStaff: null,
  },
  raceShare: [12.4, 41.2, 0, null],
  staffYears: [8.1, 22.4],
  enrollmentReported: [
    { year: '2023-24', enrollment: 1_260 },
    { year: '2024-25', enrollment: null },
    { year: '2025-26', enrollment: 1_204 },
  ],

  /* The four cohorts buildCohorts really produces. The region and county ones are
     not decoration: the page's headline region rank and the comparison engine both
     describe the region, and a fixture without a region cohort cannot catch them
     colliding. */
  cohorts: [
    {
      key: 'peer', label: 'Similar student population', short: 'similar', n: 294,
      note: 'Within 10 points of this district’s economically disadvantaged share',
      metrics: { score: 76.1, 'domain:achievement': 74.2, 'ccmr:1': 41.3, ecoDis: 61.9, spend: 10980 },
    },
    {
      key: 'region', label: 'Region 07: Kilgore', short: 'region', n: 62,
      metrics: { score: 79.8, 'domain:achievement': 77.4 },
    },
    {
      key: 'county', label: 'Cherokee County', short: 'county', n: 7,
      metrics: { score: 80.1 },
    },
    {
      key: 'state', label: 'Texas average', short: 'state', n: 1207,
      metrics: { score: 80.4, 'domain:achievement': 79, ecoDis: 60.2 },
    },
  ],
  own: { score: 84, 'domain:achievement': 82, 'ccmr:1': 52.4, ecoDis: 62.5, specEd: 12.1, attendance: 94.2, avgSalary: 58231, spend: 11482 },
  ranks: [
    {
      metric: 'score', label: 'Overall score', fmt: 'points', cohort: 'peer',
      cohortLabel: 'Similar student population', cohortShort: 'similar',
      rank: 12, of: 294, pctile: 96, value: 84, tied: 3, lowerIsBetter: false,
    },
  ],

  staar: null,
  graduation: null,
  ccmr: [{ label: CCMR[1], value: 52.4, compare: 41.3 }],

  finance: {
    years: ['2022-23', '2023-24'],
    spendEntity: [11020, 11482],
    spendPeer: [null, 10980],
    spendState: [10800, 11010],
    vsPeer: 502,
    vsState: 472,
  },
  campuses: null,
}

/* ------------------------------------------------------------- csvCell ----- */

describe('csvCell', () => {
  it('leaves a plain value alone', () => {
    expect(csvCell('Cayuga ISD')).toBe('Cayuga ISD')
  })

  it('quotes a field containing a comma', () => {
    expect(csvCell('Wells, ISD')).toBe('"Wells, ISD"')
  })

  it('quotes and doubles an internal quote', () => {
    expect(csvCell('Say "hello"')).toBe('"Say ""hello"""')
  })

  it('quotes a field containing a newline', () => {
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
  })

  it('quotes edge whitespace a spreadsheet would eat', () => {
    expect(csvCell(' padded ')).toBe('" padded "')
  })

  it('writes null and undefined as empty, never 0', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })

  it('keeps a real zero', () => {
    expect(csvCell(0)).toBe('0')
  })

  it('never locale-formats a number', () => {
    expect(csvCell(1204)).toBe('1204')
    expect(csvCell(58231)).toBe('58231')
    expect(csvCell(62.5)).toBe('62.5')
  })

  it('empties NaN and Infinity rather than writing them into a data file', () => {
    expect(csvCell(NaN)).toBe('')
    expect(csvCell(Infinity)).toBe('')
  })
})

/* ----------------------------------------------------------- entityCsv ----- */

describe('entityCsv escaping', () => {
  const csv = entityCsv(vm)

  it('round-trips a district name containing a comma', () => {
    const rows = readCsv(csv)
    const name = rows.find((r) => r.section === 'identity' && r.metric === 'name')
    expect(name.value).toBe('Wells, Independent School District')
    expect(rows.every((r) => r.name === 'Wells, Independent School District')).toBe(true)
  })

  it('quotes that name in the raw text rather than splitting the row', () => {
    expect(csv).toContain('"Wells, Independent School District"')
    expect(csv).not.toContain(',Wells, Independent School District,')
  })

  it('keeps every row the same width as the header despite the commas', () => {
    const grid = parseCsv(body(csv)).filter((r) => r.length > 1)
    expect(new Set(grid.map((r) => r.length)).size).toBe(1)
    expect(grid[0]).toEqual(ENTITY_COLUMNS)
  })

  it('round-trips a label containing commas', () => {
    const label = readCsv(csv).find((r) => r.metric === 'ccmr:1')?.label
    expect(label).toBe(CCMR[1])
    expect(label).toContain('SAT, ACT, TSIA')
  })

  it('round-trips an embedded double quote', () => {
    const quoted = { ...vm, name: 'The "Big" ISD' }
    const rows = readCsv(entityCsv(quoted))
    expect(rows.find((r) => r.metric === 'name').value).toBe('The "Big" ISD')
  })
})

describe('entityCsv nulls', () => {
  const rows = readCsv(entityCsv(vm))

  it('leaves an unpublished identity field empty, not 0', () => {
    const districtId = rows.find((r) => r.metric === 'district_id')
    expect(districtId.value).toBe('')
  })

  it('leaves a missing cohort average empty, not 0', () => {
    // TEA published no peer-group spending for 2022-23.
    const r = rows.find((x) => x.metric === 'spend_per_student' && x.year === '2022-23' && x.cohort === 'tea_peer')
    expect(r.cohort_value).toBe('')
    expect(r.value).toBe('11020')
  })

  it('leaves a missing peer year empty, not 0', () => {
    const r = rows.find((x) => x.section === 'rating_history' && x.year === '2024-25' && x.cohort === 'peer')
    expect(r.cohort_value).toBe('')
  })

  it('leaves an absent rank empty rather than ranking the entity last', () => {
    const r = rows.find((x) => x.metric === 'domain:achievement' && x.cohort === 'state')
    expect(r.rank).toBe('')
    expect(r.rank_of).toBe('')
  })

  it('keeps a genuine zero share as 0', () => {
    expect(rows.find((r) => r.metric === 'race:2').value).toBe('0')
  })

  it('omits a share TEA did not publish rather than writing a zero row', () => {
    expect(rows.some((r) => r.metric === 'race:3')).toBe(false)
  })

  it('never emits a locale-formatted number', () => {
    const cells = rows.flatMap((r) => [r.value, r.cohort_value, r.cohort_n, r.rank_of])
    expect(cells.some((c) => /^\d{1,3}(,\d{3})+/.test(c ?? ''))).toBe(false)
    expect(cells.some((c) => (c ?? '').includes('$') || (c ?? '').includes('%'))).toBe(false)
    expect(rows.find((r) => r.metric === 'enrollment').value).toBe('1204')
    expect(rows.find((r) => r.metric === 'avgSalary').value).toBe('58231')
  })
})

describe('entityCsv provenance', () => {
  const csv = entityCsv(vm)
  const comments = csv.split('\n').filter((l) => l.startsWith('# '))

  it('opens with comment lines before any data', () => {
    expect(csv.startsWith('# ')).toBe(true)
    expect(comments.length).toBeGreaterThan(4)
    const firstData = csv.split('\n').findIndex((l) => !l.startsWith('#'))
    expect(csv.split('\n')[firstData]).toBe(ENTITY_COLUMNS.join(','))
  })

  it('records the snapshot date', () => {
    expect(comments.join('\n')).toContain('15 August 2026')
  })

  it('names txschools.gov as the source', () => {
    expect(comments.join('\n')).toContain('https://txschools.gov')
  })

  it('records the entity id', () => {
    expect(comments.join('\n')).toContain('057905')
  })

  it('says the site is unofficial and not affiliated with TEA', () => {
    const text = comments.join('\n')
    expect(text).toMatch(/unofficial/i)
    expect(text).toMatch(/not operated by, endorsed by, or affiliated with the Texas Education Agency/i)
  })

  it('warns that an empty cell is not a zero', () => {
    expect(comments.join('\n')).toMatch(/does not mean zero/i)
  })
})

const supplementalVm = {
  ...vm,
  transferContext: {
    netLabel: 'Transfers in minus transfers out (arithmetic context only; not a quality measure)',
    history: [
      {
        year: '2024-25', transfersIn: null, transfersOut: 20, net: null,
        coverage: {
          officialTotals: { in: 'masked', out: 'reported' },
          origins: { published: 3, reported: 2, masked: 1 },
          destinations: { published: 4, reported: 3, masked: 1 },
        },
      },
      {
        year: '2025-26', transfersIn: 10, transfersOut: 25, net: -15,
        coverage: {
          officialTotals: { in: 'reported', out: 'reported' },
          origins: { published: 2, reported: 2, masked: 0 },
          destinations: { published: 3, reported: 2, masked: 1 },
        },
      },
    ],
    current: {
      year: '2025-26', transfersIn: 10, transfersOut: 25, net: -15,
      coverage: {
        officialTotals: { in: 'reported', out: 'reported' },
        origins: { published: 2, reported: 2, masked: 0 },
        destinations: { published: 3, reported: 2, masked: 1 },
      },
      topOrigins: [{ id: '001902', name: 'Cayuga ISD', transfers: 7 }],
      topDestinations: [{ id: '101919', name: 'Spring ISD', transfers: 9 }],
    },
    changeSinceFirst: {
      fromYear: '2024-25', toYear: '2025-26',
      transfersInChange: null, transfersOutChange: 5, netChange: null,
    },
    caveats: { meaning: 'A transfer does not identify why a student attends elsewhere.' },
    scope: 'District only.',
  },
  teacherTurnover: {
    unit: 'percent',
    history: [
      { year: '2024-25', ratePct: 12.3 },
      { year: '2025-26', ratePct: null },
    ],
    latest: { year: '2025-26', ratePct: null },
  },
  discipline: {
    history: [
      {
        year: '2025-26',
        cumulativeEnrollment: { count: 1_200, status: 'reported', mask: null },
        students: { count: null, status: 'suppressed', mask: '<5', ratePct: null },
        actions: { count: 12, status: 'reported', mask: null, ratePer100: 1 },
      },
    ],
    current: {
      year: '2025-26',
      cumulativeEnrollment: { count: 1_200, status: 'reported', mask: null },
      categories: [
        {
          key: 'allDiscipline', label: 'All discipline',
          students: { count: null, status: 'suppressed', mask: '<5', ratePct: null },
          actions: { count: 12, status: 'reported', mask: null, ratePer100: 1 },
        },
        {
          key: 'expulsions', label: 'Expulsions',
          students: { count: null, status: 'not-reported', mask: null, ratePct: null },
          actions: { count: 0, status: 'reported', mask: null, ratePer100: 0 },
        },
      ],
    },
    caveats: { overlap: 'Do not add categories.', pandemic2020_21: 'Use cautiously.', source: 'Stable headings.' },
  },
  publicDataMeta: {
    transfers: { source: 'https://tea.example/transfers', fetchedAt: '24 August 2026' },
    educators: { source: 'https://tea.example/tapr', fetchedAt: '24 August 2026' },
    discipline: { source: 'https://tea.example/discipline', fetchedAt: '24 August 2026' },
  },
}

describe('supplemental per-entity downloads', () => {
  it('writes status and mask as real CSV columns and records each additional source', () => {
    const csv = entityCsv(supplementalVm)
    const rows = readCsv(csv)
    expect(ENTITY_COLUMNS.slice(8, 11)).toEqual(['unit', 'status', 'mask'])
    expect(rows.find((row) => row.metric === 'transfers_in' && row.year === '2024-25')).toMatchObject({
      value: '', status: 'masked', mask: '',
    })
    expect(rows.find((row) => row.metric === 'allDiscipline:students')).toMatchObject({
      value: '', status: 'suppressed', mask: '<5',
    })
    expect(csv).toContain('https://tea.example/transfers')
    expect(csv).toContain('https://tea.example/tapr')
    expect(csv).toContain('https://tea.example/discipline')
    expect(csv).toMatch(/arithmetic context, not quality measures/i)
    expect(csv).toMatch(/categories overlap/i)
  })

  it('keeps the typed source objects and source list in JSON', () => {
    const doc = JSON.parse(entityJson(supplementalVm))
    expect(doc.transfers.current.transfersOut).toBe(25)
    expect(doc.teacherTurnover.history[1].ratePct).toBe(null)
    expect(doc.classSize).toBe(null)
    expect(doc.discipline.current.categories[0].students).toEqual({
      count: null, status: 'suppressed', mask: '<5', ratePct: null,
    })
    expect(doc._meta.sources.map((source) => source.name)).toEqual(expect.arrayContaining([
      'TEA Student Transfer Reports',
      'TEA Texas Academic Performance Reports (TAPR)',
      'TEA Discipline Reports',
    ]))
    expect(doc._meta.sources).toHaveLength(5)
    expect(doc._meta.sources.at(-1)).toMatchObject({
      url: 'https://tea.example/discipline', fetched: '24 August 2026',
    })
  })
})

describe('entityRows', () => {
  it('exports each PEIMS enrollment year with suppression kept missing', () => {
    const rows = entityRows(vm).filter((row) => row.section === 'enrollment_history')
    expect(rows).toEqual([
      expect.objectContaining({ year: '2023-24', value: 1_260, unit: 'count' }),
      expect.objectContaining({ year: '2024-25', value: null, unit: 'count' }),
      expect.objectContaining({ year: '2025-26', value: 1_204, unit: 'count' }),
    ])
    expect(entityRows(vm).find((row) => row.metric === 'students_total').year).toBe('2025-26')
  })

  it('carries a denominator on every row that carries a rank', () => {
    const ranked = entityRows(vm).filter((r) => r.rank != null && r.rank !== '')
    expect(ranked.length).toBeGreaterThan(0)
    for (const r of ranked) {
      expect(r.rank_of).toBeGreaterThan(0)
      expect(r.cohort_label ?? r.cohort).toBeTruthy()
    }
  })

  it('records the statewide rank with its n', () => {
    // The engine's `state` cohort row is the one that carries it; the page's
    // headline rank is folded into that row rather than emitted beside it.
    const r = entityRows(vm).find((x) => x.section === 'rating' && x.metric === 'score' && x.cohort === 'state')
    expect(r.rank).toBe(214)
    expect(r.rank_of).toBe(1207)
  })

  it('records the region rank with its n', () => {
    const r = entityRows(vm).find((x) => x.section === 'rating' && x.metric === 'score' && x.cohort === 'region')
    expect(r.rank).toBe(9)
    expect(r.rank_of).toBe(61)
  })

  it('keeps a headline rank when the engine publishes no cohort for it', () => {
    // No cohorts at all: the fallback rows must still carry the ranks, or the
    // reconciliation would silently drop them.
    const bare = { ...vm, cohorts: [], ranks: [] }
    const rows = entityRows(bare)
    const texas = rows.find((r) => r.section === 'rating' && r.cohort === 'texas')
    const region = rows.find((r) => r.section === 'rating' && r.cohort === 'region')
    expect([texas.rank, texas.rank_of]).toEqual([214, 1207])
    expect([region.rank, region.rank_of]).toEqual([9, 61])
  })

  it('exports transfer totals, coverage, reported flows and arithmetic changes without converting masks to zero', () => {
    const rows = entityRows(supplementalVm)
    expect(rows.find((row) => row.metric === 'transfers_in' && row.year === '2024-25')).toMatchObject({
      value: null, unit: 'students', status: 'masked',
    })
    expect(rows.find((row) => row.metric === 'transfers_in_minus_out' && row.year === '2024-25')).toMatchObject({
      value: null, unit: 'students_net', status: 'not-calculable',
    })
    expect(rows.find((row) => row.metric === 'origin_rows_masked' && row.year === '2024-25')).toMatchObject({
      value: 1, unit: 'counterpart_rows', status: 'reported',
    })
    expect(rows.find((row) => row.metric === 'transfers_in_from:001902')).toMatchObject({
      value: 7, unit: 'students', status: 'reported',
    })
    expect(rows.find((row) => row.metric === 'transfers_out_change')).toMatchObject({
      value: 5, unit: 'students_change', status: 'derived',
    })
  })

  it('exports district turnover and every campus class-size category with explicit units and null status', () => {
    const turnover = entityRows(supplementalVm).filter((row) => row.section === 'teacher_turnover')
    expect(turnover).toEqual([
      expect.objectContaining({ year: '2024-25', value: 12.3, unit: 'percent', status: 'reported' }),
      expect.objectContaining({ year: '2025-26', value: null, unit: 'percent', status: 'not-reported' }),
    ])

    const campusVm = {
      ...vm,
      id: '057905001', level: 'campus',
      teacherTurnover: null,
      classSize: {
        year: '2025-26', reported: 1,
        categories: [
          { key: 'kindergarten', label: 'Kindergarten', studentsPerClass: 15 },
          { key: 'grade4', label: 'Grade 4', studentsPerClass: null },
        ],
      },
    }
    const classRows = entityRows(campusVm).filter((row) => row.section === 'class_size')
    expect(classRows).toEqual([
      expect.objectContaining({ metric: 'class_size:kindergarten', value: 15, unit: 'students_per_class', status: 'reported' }),
      expect.objectContaining({ metric: 'class_size:grade4', value: null, unit: 'students_per_class', status: 'not-reported' }),
    ])
    expect(JSON.parse(entityJson(campusVm)).classSize.categories).toHaveLength(2)
  })

  it('keeps discipline students, actions, status and masks separate, including a genuine zero', () => {
    const rows = entityRows(supplementalVm)
    expect(rows.find((row) => row.metric === 'allDiscipline:students')).toMatchObject({
      value: null, unit: 'students', status: 'suppressed', mask: '<5',
    })
    expect(rows.find((row) => row.metric === 'allDiscipline:students_rate')).toMatchObject({
      value: null, unit: 'percent_of_cumulative_enrollment', status: 'suppressed', mask: '<5',
    })
    expect(rows.find((row) => row.metric === 'allDiscipline:actions_rate')).toMatchObject({
      value: 1, unit: 'disciplinary_actions_per_100_cumulative_enrollment', status: 'derived',
    })
    expect(rows.find((row) => row.metric === 'expulsions:actions')).toMatchObject({
      value: 0, unit: 'disciplinary_actions', status: 'reported',
    })
    expect(rows.filter((row) => row.metric === 'allDiscipline:students' && row.year === '2025-26')).toHaveLength(1)
  })
})

/* ------------------------------------------------------- no duplicate keys -- */

// A journalist pivots these files on (section, metric, year, cohort). If that
// tuple repeats with different values, every pivot is wrong and the file is worse
// than no file at all.
describe('entityCsv key uniqueness', () => {
  const dupes = (rows, keyOf) => {
    const seen = new Map()
    const out = []
    for (const r of rows) {
      const k = keyOf(r)
      if (seen.has(k)) out.push({ key: k, first: seen.get(k), second: r })
      else seen.set(k, r)
    }
    return out
  }

  const csvRows = readCsv(entityCsv(vm))

  it('never repeats a (section, metric, year, cohort_label) tuple', () => {
    const found = dupes(csvRows, (r) => [r.section, r.metric, r.year, r.cohort_label].join(' '))
    expect(found.map((d) => d.key.replace(/ /g, ' | '))).toEqual([])
  })

  it('never repeats a (section, metric, year, cohort) tuple', () => {
    const found = dupes(csvRows, (r) => [r.section, r.metric, r.year, r.cohort].join(' '))
    expect(found.map((d) => d.key.replace(/ /g, ' | '))).toEqual([])
  })

  it('never repeats a key in the row objects either, not just after CSV escaping', () => {
    const found = dupes(entityRows(vm), (r) => [r.section, r.metric, r.year, r.cohort_label].join(' '))
    expect(found).toEqual([])
  })

  it('emits the overall score once per cohort, not once per source', () => {
    const scores = csvRows.filter((r) => r.section === 'rating' && r.metric === 'score')
    expect(scores.map((r) => r.cohort).sort()).toEqual(['county', 'peer', 'region', 'state'])
    // The surviving row is the comparison engine's: it carries the cohort average
    // the headline rank row never had.
    const region = scores.find((r) => r.cohort === 'region')
    expect(region.cohort_value).toBe('79.8')
    expect(region.cohort_n).toBe('62')
    expect(region.rank).toBe('9')
    expect(region.rank_of).toBe('61')
  })

  it('survives a duplicated STAAR subject without emitting the row twice', () => {
    // TEA has shipped a repeated subject before; a repeat must not become a
    // conflicting pair of rows.
    const twice = { ...vm, staar: { subjects: ['All Subjects', 'All Subjects'], levels: [[85], [52], [21]] } }
    const found = dupes(entityRows(twice), (r) => [r.section, r.metric, r.year, r.cohort_label].join(' '))
    expect(found).toEqual([])
  })

  it('says in the provenance header which source won', () => {
    const comments = entityCsv(vm).split('\n').filter((l) => l.startsWith('# ')).join('\n')
    expect(comments).toMatch(/at most once|appears once/i)
    expect(comments).toMatch(/comparison engine/i)
  })
})

/* ---------------------------------------------------------- entityJson ----- */

describe('entityJson', () => {
  const doc = JSON.parse(entityJson(vm))

  it('parses back to an object', () => {
    expect(typeof doc).toBe('object')
    expect(Array.isArray(doc)).toBe(false)
  })

  it('carries a _meta block with the snapshot, source and entity id', () => {
    expect(doc._meta).toBeTruthy()
    expect(doc._meta.snapshotDate).toBe('15 August 2026')
    expect(doc._meta.entityId).toBe('057905')
    expect(doc._meta.officialSource).toBe('https://txschools.gov')
    expect(doc._meta.sourceUrl).toContain('txschools.gov')
    expect(doc._meta.sources).toHaveLength(2)
    expect(doc._meta.sources[1]).toMatchObject({ fetched: '24 August 2026' })
  })

  it('exports enrollment history as numbers and nulls, not formatted prose', () => {
    expect(doc.enrollmentHistory).toEqual([
      { year: '2023-24', students: 1_260 },
      { year: '2024-25', students: null },
      { year: '2025-26', students: 1_204 },
    ])
  })

  it('exports dated notices, Census context and THECB outcomes without mixing them into ratings', () => {
    const enriched = {
      ...vm,
      actionNotices: [{
        id: '057905001', name: 'Wells High School',
        improvement: { kind: 'TSI', year: '2026', reason: 'Special Education' },
        peg: null,
      }],
      communityContext: {
        year: 2024, totalPopulation: 2_000, schoolAgePopulation: 300,
        schoolAgePoverty: 60, schoolAgePovertyRate: 20,
      },
      postsecondaryOutcome: {
        graduateYear: '2023-24', fallTerm: 'Fall 2024', graduates: 50,
        enrolledPublic: 20, rate: 40, notFound: 29, notTrackable: 1,
        destinations: [{ institution: 'Texas State University', students: 8 }],
      },
      publicDataMeta: {
        actionFlags: { sources: { landing: 'https://tea.example/notices' }, fetchedAt: '24 August 2026' },
        community: { landing: 'https://census.example/saipe', fetchedAt: '24 August 2026' },
        postsecondary: { landing: 'https://thecb.example/outcomes', fetchedAt: '24 August 2026' },
      },
    }
    const json = JSON.parse(entityJson(enriched))
    expect(json.officialNotices[0].improvement.kind).toBe('TSI')
    expect(json.community.schoolAgePovertyRate).toBe(20)
    expect(json.postsecondary.enrolledPublic).toBe(20)
    expect(json._meta.postsecondaryNote).toContain('non-standard identifier')
    expect(json._meta.sources).toHaveLength(5)

    const rows = entityRows(enriched)
    expect(rows.find((row) => row.metric === 'improvement:057905001')).toMatchObject({ value: 'TSI', unit: 'official_status' })
    expect(rows.find((row) => row.metric === 'resident_children_5_17_poverty_rate')).toMatchObject({ value: 20, unit: 'percent' })
    expect(rows.find((row) => row.metric === 'texas_public_enrolled_following_fall_rate')).toMatchObject({ value: 40, unit: 'percent' })
    expect(rows.find((row) => row.metric === 'destination:1')).toMatchObject({
      label: 'Named Texas public destination — Texas State University', value: 8, unit: 'students',
    })
    expect(rows.filter((row) => row.section === 'rating')).toEqual(entityRows(vm).filter((row) => row.section === 'rating'))

    const csv = entityCsv(enriched)
    expect(csv).toContain('https://tea.example/notices')
    expect(csv).toContain('https://census.example/saipe')
    expect(csv).toContain('https://thecb.example/outcomes')
    expect(csv).toContain('non-standard identifier')
  })

  it('states in the file that the site is unofficial', () => {
    expect(doc._meta.unofficial).toMatch(/not operated by, endorsed by, or affiliated/i)
  })

  it('round-trips a name containing a comma', () => {
    expect(doc.entity.name).toBe('Wells, Independent School District')
  })

  it('keeps an unpublished figure null, never 0', () => {
    expect(doc.students.englishLearnersPct).toBe(null)
    expect(doc.teachers.studentsPerStaff).toBe(null)
    expect(doc.spending.teaPeerGroup[0]).toBe(null)
    expect(doc.history[1].peerAverage).toBe(null)
    expect(doc.domains[1].score).toBe(null)
  })

  it('keeps numbers as numbers, never formatted strings', () => {
    expect(doc.entity.enrollment).toBe(1204)
    expect(doc.teachers.averageSalary).toBe(58231)
    expect(doc.students.economicallyDisadvantagedPct).toBe(62.5)
    expect(typeof doc.rating.score).toBe('number')
  })

  it('gives every rank its cohort and denominator', () => {
    expect(doc.ranks.length).toBeGreaterThan(0)
    for (const r of doc.ranks) {
      expect(r.of).toBeGreaterThan(0)
      expect(r.cohort).toBeTruthy()
      expect(r.cohortLabel).toBeTruthy()
    }
  })

  it('gives every cohort a stated n', () => {
    for (const c of doc.cohorts) expect(c.n).toBeGreaterThan(0)
  })

  it('exports positive signals as typed evidence rather than unsupported prose', () => {
    const withHighlight = JSON.parse(entityJson({
      ...vm,
      highlights: [{
        id: 'gain:score', kind: 'gain', metric: 'score', metrics: ['score'], label: 'Overall score',
        latestYear: '2025-26', previousYear: '2024-25',
        evidence: [{ kind: 'change', metric: 'score', fmt: 'points', fromValue: 65, toValue: 76, delta: 11 }],
      }],
    }))
    expect(withHighlight.highlights[0]).toMatchObject({ id: 'gain:score', kind: 'gain' })
    expect(withHighlight.highlights[0].evidence[0]).toEqual(
      expect.objectContaining({ fromValue: 65, toValue: 76, delta: 11 })
    )
    expect(typeof withHighlight.highlights[0].evidence[0].delta).toBe('number')
    expect(withHighlight._meta.highlightsNote).toMatch(/not a summary/i)
  })

  it('is deterministic — no wall-clock timestamp to churn the build', () => {
    expect(entityJson(vm)).toBe(entityJson(vm))
    expect(JSON.stringify(doc)).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:/)
  })
})

/* ---------------------------------------------------------- datasetCsv ----- */

describe('datasetCsv', () => {
  const rows = [
    { id: '057905', name: 'Wells, Independent School District', score: 84, rating: 'B' },
    { id: '001902', name: 'The "Big" ISD', score: null, rating: null },
  ]

  it('round-trips commas and quotes together', () => {
    const back = readCsv(datasetCsv(rows, { snapshotDate: '15 August 2026', dataset: 'entities' }))
    expect(back[0].name).toBe('Wells, Independent School District')
    expect(back[1].name).toBe('The "Big" ISD')
  })

  it('writes null as empty, never 0', () => {
    const back = readCsv(datasetCsv(rows))
    expect(back[1].score).toBe('')
    expect(back[1].rating).toBe('')
    expect(back[0].score).toBe('84')
  })

  it('carries a provenance header', () => {
    const csv = datasetCsv(rows, { snapshotDate: '15 August 2026', dataset: 'entities' })
    expect(csv.startsWith('# ')).toBe(true)
    expect(csv).toContain('15 August 2026')
    expect(csv).toContain('https://txschools.gov')
    expect(csv).toMatch(/unofficial/i)
    expect(csv).toContain('dataset: entities')
    expect(csv).toContain('rows: 2')
  })

  it('uses publisher-generic revision and missing-value language for non-TEA sources', () => {
    const csv = datasetCsv(rows, {
      snapshotDate: '24 August 2026',
      dataset: 'community',
      meta: { sourceName: 'U.S. Census Bureau', sourceUrl: 'https://census.example/saipe' },
    })
    expect(csv).toContain('source: U.S. Census Bureau')
    expect(csv).toContain('https://census.example/saipe')
    expect(csv).toMatch(/publisher may have revised/i)
    expect(csv).toMatch(/source did not publish/i)
    expect(csv).not.toMatch(/TEA may have revised|TEA did not publish/i)
    expect(csv).toMatch(/not operated by, endorsed by, or affiliated with the Texas Education Agency/i)
  })

  it('works with no options at all', () => {
    const csv = datasetCsv(rows)
    expect(csv).toMatch(/^# /)
    expect(readCsv(csv)).toHaveLength(2)
  })

  it('takes the column union in first-seen order for ragged rows', () => {
    const csv = datasetCsv([{ a: 1 }, { b: 2, a: 3 }])
    expect(body(csv).split('\n')[0]).toBe('a,b')
    const back = readCsv(csv)
    expect(back[0].b).toBe('')
    expect(back[1].b).toBe('2')
  })

  it('honours an explicit column list', () => {
    const csv = datasetCsv(rows, { columns: ['name', 'id'] })
    expect(body(csv).split('\n')[0]).toBe('name,id')
  })

  it('handles an empty table without producing a headerless file', () => {
    const csv = datasetCsv([], { columns: ['id', 'name'] })
    expect(body(csv).split('\n').filter(Boolean)).toEqual(['id,name'])
  })
})

/* ------------------------------------------------------------ file size ---- */

describe('fileSize', () => {
  it('returns null when no size was given, so the page can say so', () => {
    expect(fileSize(undefined)).toBe(null)
    expect(fileSize(null)).toBe(null)
  })

  it('reads bytes, KB and MB', () => {
    expect(fileSize(318)).toBe('318 bytes')
    expect(fileSize(8_120)).toBe('8.1 KB')
    expect(fileSize(812_000)).toBe('812 KB')
    expect(fileSize(1_240_000)).toBe('1.2 MB')
    expect(fileSize(42_000_000)).toBe('42 MB')
  })
})

/* -------------------------------------------------------- download page ---- */

describe('renderDownloadPage', () => {
  const html = renderDownloadPage({
    snapshotDate: '15 August 2026',
    enrollmentSnapshotDate: '24 August 2026',
    counts: { districts: 1207, campuses: 9029, ratingYears: 5 },
    files: [
      { href: '/data/entities.csv', label: 'Every district and campus', format: 'csv', bytes: 1_240_000, rows: 10236, description: 'One row per entity.' },
      { href: '/data/ratings.csv', label: 'Ratings by year', format: 'csv', rows: 44112 },
    ],
  })

  it('renders without JavaScript — the list is a real table', () => {
    expect(html).toContain('<table')
    expect(html).toContain('/data/entities.csv')
    expect(html).toContain('Ratings by year')
  })

  it('shows a real file size where one was given', () => {
    expect(html).toContain('1.2 MB')
  })

  it('says so plainly where a size was not measured', () => {
    expect(html).toContain('not measured')
  })

  it('formats counts for reading, since a page is not a data file', () => {
    expect(html).toContain('9,029')
    expect(html).toContain('Rating years')
  })

  it('links txschools.gov as the official source', () => {
    expect(html).toContain('https://txschools.gov')
    expect(html).toContain('PEIMS enrollment reports')
    expect(html).toContain('24 August 2026')
  })

  it('never implies affiliation with TEA', () => {
    expect(html).toMatch(/unofficial/i)
    expect(html).toMatch(/not operated by, endorsed by, or connected to TEA|not affiliated/i)
    expect(html).not.toMatch(/official (site|data portal) of the Texas Education Agency/i)
  })

  it('is honest about the licence rather than claiming rights it does not hold', () => {
    expect(html).toMatch(/claims no rights/i)
    expect(html).toMatch(/ask TEA/i)
  })

  it('attributes supplemental figures to their actual public publishers', () => {
    expect(html).toMatch(/U\.S\. Census Bureau/i)
    expect(html).toMatch(/Texas Higher Education Coordinating Board/i)
    expect(html).toMatch(/each file names its actual publisher/i)
    expect(html).toMatch(/other publisher named in the file/i)
  })

  it('explains that an empty cell is not a zero', () => {
    expect(html).toMatch(/not a zero/i)
  })

  it('states the snapshot date and offers a citation', () => {
    expect(html).toContain('15 August 2026')
    expect(html).toMatch(/citation|Citing/i)
  })

  it('does not claim campus pages link a per-entity file that is not built', () => {
    expect(html).not.toMatch(/every district and campus page links its own record/i)
    expect(html).toMatch(/district/i)
  })

  it('says the per-entity files are districts only, and why', () => {
    expect(html).toMatch(/per-entity files? (are|is) built for districts|districts only/i)
    expect(html).toMatch(/20,000|cap/i)
    expect(html).toMatch(/campus/i)
  })

  it('counts the file budget from the counts it was given, not from a stale number', () => {
    const page = renderDownloadPage({ counts: { districts: 1199, campuses: 9031 } })
    expect(page).toContain('10,230')
    expect(page).toContain('20,460')
    // and still reads as a sentence when no counts were passed
    expect(renderDownloadPage()).toMatch(/districts only/i)
  })

  it('survives being called with nothing to list', () => {
    const empty = renderDownloadPage()
    expect(empty).toContain('<h1>Download the data</h1>')
    expect(empty).toMatch(/No bulk files/i)
  })
})
