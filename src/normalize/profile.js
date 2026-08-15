import { num, str } from './entities.js'

export function toProfile(records) {
  return records.map((r) => ({
    id: r.id,
    total: num(r.Total),
    ecoDisPct: num(r.Eco_Dis),
    specEdPct: num(r.Spec_Ed),
    engLrnPct: num(r.Eng_Lrn),
    attendance: num(r.Attendance),
    absenteeism: num(r.Absenteeism),
    avgSalary: num(r.Avg_Salary),
    schoolYear: str(r.School_Year),
  }))
}
