// 재수강 대체 후보 고르기 (§3.5). 평점·취득학점 계산은 gpa.effectiveCourses가 그대로 맡고,
// 여기서는 "어떤 이전 기록을 고를 수 있는지"만 정한다.
import { normalizeCourseName } from './requirements/officialRules';
import { compareTerms } from './terms';
import type { AcademicSnapshot, Course, Term } from './types';

/** 재수강 과목(편집 중인 값일 수 있어서 Course 전체가 아니라 필요한 것만 받는다) */
export interface RetakeSubject { id?: string; name: string; term: Term; officialCode?: string }

/** 예상 계산용 후보. F·NP도 재수강 대상이며, 완료된 재수강이 이미 대체한 기록은 제외한다. */
export function projectedRetakeCandidates(courses: Course[], subject: RetakeSubject): Course[] {
  const replaced = new Set(courses.filter((c) => c.status === 'completed' && c.replacesCourseId).map((c) => c.replacesCourseId));
  const matches = (c: Course) => subject.officialCode && c.officialCode
    ? subject.officialCode === c.officialCode : normalizeCourseName(subject.name) === normalizeCourseName(c.name);
  return courses.filter((c) => c.id !== subject.id && c.origin !== 'timetable' && c.recordKind === 'course'
    && (c.status === 'completed' || c.status === 'notEarned') && compareTerms(c.term, subject.term) < 0 && !replaced.has(c.id))
    .sort((a, b) => Number(matches(b)) - Number(matches(a)) || compareTerms(b.term, a.term));
}

/** 정확히 일치하는 이전 기록이 하나일 때만 자동 연결한다. 후보가 여럿이면 학생이 선택한다. */
export function autoProjectedRetake(courses: Course[], subject: RetakeSubject): Course | undefined {
  const matches = projectedRetakeCandidates(courses, subject).filter((c) => subject.officialCode && c.officialCode
    ? subject.officialCode === c.officialCode : normalizeCourseName(subject.name) === normalizeCourseName(c.name));
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * 대체할 수 있는 이전 기록. 조건: 이 과목보다 이전 학기 + 이수 완료 + 인정학점이 아닌 실제 과목 +
 * 다른 과목이 이미 대체하지 않은 기록. 같은 이름(정규화 기준)을 맨 위로, 그다음 최근 학기 순.
 */
export function retakeCandidates(courses: Course[], subject: RetakeSubject): Course[] {
  const replacedByOthers = new Set(
    courses.filter((c) => c.id !== subject.id && c.replacesCourseId).map((c) => c.replacesCourseId!),
  );
  const key = normalizeCourseName(subject.name);
  const sameName = (c: Course) => key !== '' && normalizeCourseName(c.name) === key;
  return courses
    .filter((c) => c.id !== subject.id && c.status === 'completed' && c.recordKind === 'course'
      && compareTerms(c.term, subject.term) < 0 && !replacedByOthers.has(c.id))
    .sort((a, b) => Number(sameName(b)) - Number(sameName(a)) || compareTerms(b.term, a.term));
}

/** 성적표에 재수강 표시만 있고 대체된 기록을 못 찾은 과목인가 (parseTranscript의 retakeUnresolved 경고) */
export const hasRetakeWarning = (snapshots: AcademicSnapshot[], course: Pick<Course, 'sourceRowKey'>) =>
  !!course.sourceRowKey
  && snapshots.some((s) => s.warnings.some((w) => w.code === 'retakeUnresolved' && w.rowKey === course.sourceRowKey));

/** 편집기를 열 때 미리 골라 둘 이전 기록 (저장은 학생이 누를 때만 일어난다) */
export function initialReplacesCourseId(
  courses: Course[], snapshots: AcademicSnapshot[], subject: RetakeSubject & Pick<Course, 'sourceRowKey'> & { replacesCourseId?: string },
): string | undefined {
  if (subject.replacesCourseId) return subject.replacesCourseId;
  if (!hasRetakeWarning(snapshots, subject)) return undefined;
  const key = normalizeCourseName(subject.name);
  return retakeCandidates(courses, subject).find((c) => normalizeCourseName(c.name) === key)?.id;
}
