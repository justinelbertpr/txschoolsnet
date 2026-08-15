export const BASE_URL = 'https://txschools.gov/data'

// minRows are floors ~5% below counts observed 2026-08-15. A partial TEA
// publication is the likeliest failure mode and looks like valid data.
export const SOURCES = [
  { name: 'districts', level: 'district', minRows: 1140 },
  { name: 'schools', level: 'campus', minRows: 8580 },
  { name: 'change_over_time', level: 'both', minRows: 9720 },
  { name: 'change_over_time_achievement', level: 'both', minRows: 10140 },
  { name: 'change_over_time_progress', level: 'both', minRows: 10140 },
  { name: 'change_over_time_gaps', level: 'both', minRows: 10140 },
  { name: 'overview', level: 'both', minRows: 9720 },
  { name: 'profile_tab', level: 'both', minRows: 9720 },
  { name: 'finance_district', level: 'district', minRows: 1135 },
  { name: 'finance_school', level: 'campus', minRows: 8280 },
  { name: 'ctg_districts', level: 'district', minRows: 1140 },
  { name: 'ctg_schools', level: 'campus', minRows: 8580 },
  { name: 'student_achievement_tab', level: 'both', minRows: 9410 },
  { name: 'school_progress_tab', level: 'both', minRows: 9720 },
]

export const sourceUrl = (name) => `${BASE_URL}/${name}.json`
