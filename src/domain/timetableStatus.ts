// 시간표와 졸업 필수 과목의 화면 표시 연결(Model). 이수 판정과 학점 계산에는 사용하지 않는다.
import { autoLinkTargets, linkableLeaves, normalizeCourseName, type OfficialReport } from './requirements/officialRules';
import { gradeCourses, type AppState } from './state';
import { compareTerms, sameTerm } from './terms';
import type { Course, CreditArea } from './types';
import { autoProjectedRetake, projectedRetakeCandidates } from './retake';
import { calculatorCourses } from './gpa/calculatorCourses';
import type { Progress } from './requirements/resolve';

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

/**
 * 이번 학기 이수 예정 학점: 시간표에 칸이 있는 이번 학기 시간표 과목의 학점. 실제 취득학점과 따로 더한다.
 * 한 과목이 여러 요일에 있어도 과목 하나로 세고, 같은 학기 성적 기록과 겹치는 과목은 빼는 calculatorCourses 기준을 쓴다.
 * 재수강은 이수하면 이전 기록의 취득학점이 빠지므로(gpa.effectiveCourses), 이전 기록이 취득학점에 들어가 있으면 그만큼 뺀다.
 */
export function plannedCredits(state: AppState): { total: number; byArea: Partial<Record<CreditArea, number>> } {
  const byArea: Partial<Record<CreditArea, number>> = {};
  let total = 0;
  for (const c of calculatorCourses(state)) {
    if (c.origin !== 'timetable' || c.creditUnits <= 0) continue;
    total += c.creditUnits;
    byArea[c.area] = (byArea[c.area] ?? 0) + c.creditUnits;
    const old = c.replacesCourseId ? state.courses.find((x) => x.id === c.replacesCourseId) : undefined;
    if (old?.status === 'completed' && old.earnedInclusion === 'included') {
      total -= old.creditUnits;
      byArea[old.area] = (byArea[old.area] ?? 0) - old.creditUnits;
    }
  }
  return { total, byArea };
}

/**
 * 학사현황 표시용 합계: 실제 취득학점(삭제·재수강 대체가 반영된 과목 목록 합)에 이번 학기 시간표 학점을 합친다.
 * 판정용 Progress는 그대로 두고 화면 숫자만 합친다.
 */
export function withPlanned(progress: Progress, planned: ReturnType<typeof plannedCredits>) {
  const earned = progress.total.earned + planned.total;
  const required = progress.total.required;
  return {
    earned,
    remaining: required === null ? null : Math.max(0, required - earned),
    areas: progress.areas.filter((a) => a.required !== undefined).map((a) => {
      const sum = Math.max(0, a.earned + (planned.byArea[a.area] ?? 0));
      return { area: a.area, earned: sum, required: a.required!, met: sum >= a.required! };
    }),
  };
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
