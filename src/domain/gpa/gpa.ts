// 평점·취득학점·예상 시나리오 계산 (§7). 모든 계산은 100배 정수로 한다.
import { deriveInclusion, defaultGradingMode, GRADE_HUNDREDTHS } from '../grades';
import { sameTerm } from '../terms';
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
    gpa: computeGpa(list, summary, completeness.gpa),
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
    if (e.replacesCourseId) {
      const old = working.get(e.replacesCourseId);
      if (!old || e.replacesCourseId === e.courseId) { errors.push({ courseId: e.courseId, message: '재수강 대상 기록을 찾을 수 없어요.' }); continue; }
      if (usedReplaced.has(e.replacesCourseId)) { errors.push({ courseId: e.courseId, message: '같은 기존 과목을 두 번 대체할 수 없어요.' }); continue; }
      usedReplaced.add(e.replacesCourseId);
      // 이미 baseline에서 제외된 기록이면 그대로 둔다 (두 번 빼지 않음)
      working.set(old.id, { ...old, gpaInclusion: 'excluded', earnedInclusion: 'excluded' });
    }
    const gradingMode = course.gradingMode === 'passFail' || e.expectedGrade === 'P' || e.expectedGrade === 'NP'
      ? 'passFail' : defaultGradingMode(e.expectedGrade);
    const projected = { ...course, status: 'completed' as const, grade: e.expectedGrade, gradingMode };
    working.set(course.id, { ...projected, ...deriveInclusion(projected) });
    scenarioIds.add(course.id);
  }

  const projectedList = [...working.values()];
  const termCourses = scenario
    ? projectedList.filter((c) => sameTerm(c.term, scenario.term) && (scenarioIds.has(c.id) || c.status === 'completed'))
    : [];
  return { completeness, baseline: summarize(base), projected: summarize(projectedList), termGpa: computeGpa(termCourses, undefined, completeness.gpa), errors };
}
