// 시간표와 졸업 필수 과목의 화면 표시 연결(Model). 이수 판정과 학점 계산에는 사용하지 않는다.
import { autoLinkTargets, linkableLeaves, normalizeCourseName, type OfficialReport } from './requirements/officialRules';
import { gradeCourses, type AppState } from './state';
import { compareTerms, sameTerm } from './terms';
import type { Course } from './types';
import { autoProjectedRetake, projectedRetakeCandidates } from './retake';

/** 학수번호가 있으면 코드로, 없으면 유일하게 일치하는 과목명으로만 연결한다. */
export function timetableTargets(report: OfficialReport | null, course: Pick<Course, 'name' | 'officialCode'>) {
  if (course.officialCode) return linkableLeaves(report).filter(({ leaf }) => leaf.code === course.officialCode);
  const targets = autoLinkTargets(report, course.name);
  return targets.length === 1 ? targets : [];
}

/** 현재 학기에 실제 시간 칸이 남아 있는 과목만 수강 중으로 표시한다. */
export function timetableRequirementStates(state: AppState, report: OfficialReport | null): Map<string, { isRetake: boolean }> {
  const result = new Map<string, { isRetake: boolean }>();
  if (!state.profile) return result;
  const placed = new Set(state.classTimes.map((t) => t.courseId));
  for (const c of state.courses) {
    if (!placed.has(c.id) || !sameTerm(c.term, state.profile.currentTerm)
      || (c.status !== 'planned' && c.status !== 'inProgress')) continue;
    const direct = timetableTargets(report, c);
    // 과목명이 바뀐 재수강은 학생이 연결한 이전 과목의 필수 요건에 수강 상태를 표시한다.
    const previous = c.isRetake || c.replacesCourseId
      ? projectedRetakeCandidates(state.courses, c).find((old) => old.id === c.replacesCourseId) ?? autoProjectedRetake(state.courses, c)
      : undefined;
    for (const { leaf } of direct.length ? direct : previous ? timetableTargets(report, previous) : []) {
      result.set(leaf.id, { isRetake: !!c.isRetake || !!c.replacesCourseId || !!result.get(leaf.id)?.isRetake });
    }
  }
  return result;
}

/** 이전 학기의 수강 기록은 안내에만 쓴다. 기존 학점이나 재수강 대체 관계는 수정하지 않는다. */
export function previousTimetableCourse(state: AppState, subject: Pick<Course, 'name' | 'officialCode'>): Course | undefined {
  if (!state.profile || !subject.name.trim()) return undefined;
  return gradeCourses(state.courses).filter((c) => c.recordKind === 'course'
    && (c.status === 'completed' || c.status === 'notEarned')
    && compareTerms(c.term, state.profile!.currentTerm) < 0
    && (subject.officialCode && c.officialCode ? subject.officialCode === c.officialCode
      : normalizeCourseName(c.name) === normalizeCourseName(subject.name)))
    .sort((a, b) => compareTerms(b.term, a.term))[0];
}
