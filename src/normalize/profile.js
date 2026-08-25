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
    teachers: num(r.Full_Time_Teachers),
    stuPerStaff: num(r.Stu_Per_Staff),
    raceShare: Array.isArray(r.Enrollment) ? r.Enrollment.map(percentage) : null,
    staffYears: Array.isArray(r.Staff_Years) ? r.Staff_Years.map(percentage) : null,
    schoolYear: str(r.School_Year),
  }))
}
