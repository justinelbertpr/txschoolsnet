import { num, percentage, str } from './entities.js'

export function toProfile(records) {
  return records.map((r) => ({
    id: r.id,
    total: num(r.Total),
    ecoDisPct: percentage(r.Eco_Dis),
    specEdPct: percentage(r.Spec_Ed),
    engLrnPct: percentage(r.Eng_Lrn),
    attendance: percentage(r.Attendance),
    absenteeism: percentage(r.Absenteeism),
    avgSalary: num(r.Avg_Salary),
    schoolYear: str(r.School_Year),
  }))
}
