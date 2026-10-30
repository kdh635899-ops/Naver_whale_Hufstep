// 평점·취득학점·예상 시나리오 계산 (§7). 모든 계산은 100배 정수로 한다.
import { deriveInclusion, defaultGradingMode, GRADE_HUNDREDTHS } from '../grades';
import { sameTerm } from '../terms';
import { autoProjectedRetake, projectedRetakeCandidates } from '../retake';
import type { AcademicSnapshot, Course, GradeScenario } from '../types';

export interface GpaResult {
  /** C: GPA 대상 학점 (units) */
  creditUnits: number;
  /** Q: Σ(creditUnits × gradeHundredths) */
  points: number;
  /** floor(Q/C) — 표시 평점 × 100. 대상이 없으면 null (0.00으로 확정하지 않음) */
  hundredths: number | null;
  /** 요약 평점에서 복원한 근사치가 섞였는지 */
  estimated: boolean;
  complete: boolean;
}

export const formatGpa = (h: number | null) => (h === null ? '—' : (h / 100).toFixed(2));

/** 재수강으로 대체된 이전 기록은 GPA·취득학점에서 뺀다 (이미 빠져 있으면 그대로). */
export function effectiveCourses(courses: Course[]): Course[] {
  const replaced = new Set(
    courses.filter((c) => c.replacesCourseId && c.status === 'completed').map((c) => c.replacesCourseId!),
  );
  return courses.map((c) => (replaced.has(c.id) ? { ...c, gpaInclusion: 'excluded', earnedInclusion: 'excluded' } : c));
}

export function computeGpa(courses: Course[], summary?: AcademicSnapshot['reportedGpa'], complete = true): GpaResult {
  complete = complete && !courses.some((c) => (c.status === 'completed' || c.status === 'notEarned') && c.gpaInclusion === 'unresolved');
  let C = 0;
  let Q = 0;
  for (const c of courses) {
    const g = c.grade ? GRADE_HUNDREDTHS[c.grade] : undefined;
    if (c.gpaInclusion !== 'included' || g === undefined) continue;
    C += c.creditUnits;
    Q += c.creditUnits * g;
  }
  if (summary) {
    // 요약 평점은 이미 절사된 값이므로 Q는 근사치다.
    C += summary.gpaUnits;
    Q += summary.gpaUnits * summary.hundredths;
  }
  return { creditUnits: C, points: Q, hundredths: C && complete ? Math.floor(Q / C) : null, estimated: !!summary, complete };
}

/** 졸업 평점 2.00 판정. F는 포함하고 인정학점·재수강으로 대체된 기록은 기존 계산 규칙대로 제외한다. */
export function graduationGpa(courses: Course[], snapshot?: AcademicSnapshot | null) {
  const effective = effectiveCourses(courses);
  const gpa = computeGpa(effective, snapshot?.source === 'summaryInput' ? snapshot.reportedGpa : undefined, snapshot?.completeness.gpa ?? true);
  const incomplete = effective.some((c) => c.status === 'completed' && c.gpaInclusion === 'unresolved')
    || (snapshot?.source === 'studentPaste' && !snapshot.completeness.gpa);
  const status = gpa.hundredths === null || incomplete ? 'insufficient' : gpa.hundredths >= 200 ? 'met' : 'unmet';
  return { ...gpa, status };
}

export const earnedUnits = (courses: Course[]) =>
  courses.reduce((s, c) => s + (c.earnedInclusion === 'included' ? c.creditUnits : 0), 0);

export interface ScenarioResult {
  completeness: AcademicSnapshot['completeness'];
  baseline: { gpa: GpaResult; majorGpa: GpaResult; earned: number };
  projected: { gpa: GpaResult; majorGpa: GpaResult; earned: number };
  termGpa: GpaResult;
  errors: { courseId: string; message: string }[];
}

/**
 * 예상 성적 시나리오. 매번 원본(baseline)에서 전체를 다시 계산한다 — 직전 결과에 변경분을 더하지 않는다.
 * 실제 과목 기록은 바꾸지 않고 복사본으로만 계산한다.
 */
export function calculateScenario(
  courses: Course[],
  scenario: GradeScenario | null,
  summary?: AcademicSnapshot['reportedGpa'],
  completeness: AcademicSnapshot['completeness'] = { earnedTotals: true, courses: true, gpa: true },
): ScenarioResult {
  const base = effectiveCourses(courses);
  const isMajor = (c: Course) => c.area === 'primary';
  const summarize = (list: Course[]) => ({
    // 요약 평점과 GPA 대상 학점이 있으면 상세 내역 없이도 누적 평점을 추정할 수 있다.
    gpa: computeGpa(list, summary, completeness.gpa || !!summary),
    majorGpa: computeGpa(list.filter(isMajor), undefined, completeness.gpa),
    earned: earnedUnits(list),
  });

  const working = new Map(base.map((c) => [c.id, c]));
  const errors: ScenarioResult['errors'] = [];
  const usedReplaced = new Set<string>();
  const scenarioIds = new Set<string>();

  for (const e of scenario?.entries ?? []) {
    const course = working.get(e.courseId);
    if (!course) { errors.push({ courseId: e.courseId, message: '삭제된 과목이에요.' }); continue; }
    if (!e.expectedGrade) continue;
    // 시간표에서 체크를 해제하면 저장돼 있던 예상 시나리오의 연결도 적용하지 않는다.
    const retakeOff = course.origin === 'timetable' && course.isRetake === false;
    const targetId = retakeOff ? undefined : course.replacesCourseId ?? e.replacesCourseId
      ?? (course.isRetake ? autoProjectedRetake(courses, course)?.id : undefined);
    if (course.isRetake && !targetId) {
      errors.push({ courseId: e.courseId, message: '재수강으로 대체할 이전 기록을 과목 정보에서 선택해 주세요.' }); continue;
    }
    let previous: Course | undefined;
    if (targetId) {
      const old = working.get(targetId);
      // 시간표 연결은 이전 학기 실제 성적이어야 한다. 기존 명시적 시나리오 연결 방식은 유지한다.
      if (!old || targetId === e.courseId || (course.isRetake && !projectedRetakeCandidates(courses, course).some((c) => c.id === targetId))) {
        errors.push({ courseId: e.courseId, message: '재수강 대상 기록을 찾을 수 없어요. 이전 기록을 다시 선택해 주세요.' }); continue;
      }
      if (usedReplaced.has(targetId)) { errors.push({ courseId: e.courseId, message: '같은 기존 과목을 두 번 대체할 수 없어요.' }); continue; }
      usedReplaced.add(targetId);
      previous = old;
      // 이미 baseline에서 제외된 기록이면 그대로 둔다 (두 번 빼지 않음)
      working.set(old.id, { ...old, gpaInclusion: 'excluded', earnedInclusion: 'excluded' });
    }
    const gradingMode = course.gradingMode === 'passFail' || e.expectedGrade === 'P' || e.expectedGrade === 'NP'
      ? 'passFail' : defaultGradingMode(e.expectedGrade);
    const projected = { ...course, area: course.area === 'unknown' && previous ? previous.area : course.area,
      status: 'completed' as const, grade: e.expectedGrade, gradingMode };
    working.set(course.id, { ...projected, ...deriveInclusion(projected) });
    scenarioIds.add(course.id);
  }

  const projectedList = [...working.values()];
  const termCourses = scenario
    ? projectedList.filter((c) => sameTerm(c.term, scenario.term) && (scenarioIds.has(c.id) || c.status === 'completed'))
    : [];
  const projected = summarize(projectedList);
  // 이번 학기 평점은 과거 성적 자료의 누락 여부와 관계없이 계산한다.
  const termGpa = computeGpa(termCourses);
  // 연결을 확인할 수 없는 재수강이 있으면 일부 과목만 계산한 값을 완성된 예상 평점으로 내보내지 않는다.
  if (errors.length) for (const gpa of [projected.gpa, projected.majorGpa, termGpa]) {
    gpa.hundredths = null; gpa.complete = false;
  }
  return { completeness, baseline: summarize(base), projected, termGpa, errors };
}
