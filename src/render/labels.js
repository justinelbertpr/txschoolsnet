// Labels for TEA's unlabeled parallel arrays, extracted verbatim from the
// txschools.gov application bundle rather than inferred. Guessing at these would
// mislabel published statistics — the graduation array in particular means
// something different for alternative-education campuses.

export const RACE = [
  'African American', 'Hispanic', 'White', 'American Indian',
  'Asian', 'Pacific Islander', 'Two or More Races',
]

export const EXPERIENCE = [
  'Beginning', '1 to 5 years', '6 to 10 years',
  '11 to 20 years', '21 to 30 years', 'Over 30 years',
]

export const STAAR_LEVELS = ['Approaches grade level', 'Meets grade level', 'Masters grade level']

/** AEA campuses report completion, not graduation. TEA swaps these labels itself. */
export const GRADUATION = ['Four-Year Graduation Rate', 'Five-Year Graduation Rate', 'Six-Year Graduation Rate', 'Dropout Rate']
export const COMPLETION = ['Four-Year Completion Rate', 'Five-Year Completion Rate', 'Six-Year Completion Rate', 'Dropout Rate']

export const CCMR = [
  'Total credit for CCMR criteria',
  'Scored at or above the college ready standard on SAT, ACT, TSIA, or earned credit for a college prep course',
  'Scored at or above the college ready standard on SAT, ACT, TSIA',
  'Met criterion score on AP/IB exam(s)',
  'Earned college credit for a dual credit course',
  'Earned an industry-based certification',
  'Earned a level I or level II certificate',
  'Earned an associate degree',
  'Completed an OnRamps course and qualified for college credit',
  'Graduated with completed individualized education program (IEP) and workforce readiness',
  'Graduated under an advanced diploma plan and identified as a current special education student',
  'Enlisted in the U.S. Armed Forces',
]

export const DOMAIN_ORDER = ['achievement', 'progress', 'gaps', 'progress_growth', 'progress_relative']
