// 학점 계산용 과목 선택(Model). 시간표 과목은 이번 학기 예상 계산에만 보탠다.
import { gradeCourses, type AppState } from '../state';
import { sameTerm } from '../terms';
import type { Course } from '../types';

export function calculatorCourses(state: AppState): Course[] {
  const records = gradeCourses(state.courses);
  const term = state.profile?.currentTerm;
  if (!term) return records;
  const scheduled = new Set(state.classTimes.map((t) => t.courseId));
  const nameKey = (name: string) => name.normalize('NFC').replace(/\s+/g, '').toLowerCase();
  const selected = [...records];
  for (const c of state.courses) {
    if (c.origin !== 'timetable' || !sameTerm(c.term, term) || !scheduled.has(c.id)
      || (c.status !== 'inProgress' && c.status !== 'planned')) continue;
    // 같은 학기에 이미 등록·가져온 수업은 한 번만 계산한다. 다른 학기의 재수강은 유지한다.
    const duplicate = selected.some((r) => sameTerm(r.term, c.term) && r.recordKind === 'course'
      && (r.officialCode && c.officialCode ? r.officialCode === c.officialCode : nameKey(r.name) === nameKey(c.name)));
    if (!duplicate) selected.push(c);
  }
  return selected;
}
