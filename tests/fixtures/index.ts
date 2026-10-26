// 테스트용 합성 자료만 둔다. 실제 학생 성적·수강 이력은 넣지 않는다.
import { deriveInclusion, defaultGradingMode } from '../../src/domain/grades';
import { emptyState, type AppState } from '../../src/domain/state';
import type { Course, RequirementBundle, StudentProfile, Term } from '../../src/domain/types';

export { DEMO_TRANSCRIPT as TRANSCRIPT_FIXTURE, demoAssessments, demoCurrentCourses } from '../../src/data/demo';

export const T21_1: Term = { academicYear: 2021, semester: '1' };
export const T26_2: Term = { academicYear: 2026, semester: '2' };

let seq = 0;
/** 합성 과목 한 건 */
export function course(over: Partial<Course> & { credits?: number } = {}): Course {
  const { credits = 3, ...rest } = over;
  const grade = over.grade ?? null;
  const base: Course = {
    id: `c${++seq}`, name: `가상과목${seq}`, term: T21_1, creditUnits: Math.round(credits * 100), area: 'primary',
    origin: 'manual', recordKind: 'course', status: 'completed', grade,
    gradingMode: defaultGradingMode(grade), gpaInclusion: 'unresolved', earnedInclusion: 'unresolved',
    requiredClaim: 'none', overriddenFields: [], updatedAt: '2026-01-01T00:00:00.000Z',
    ...rest,
  };
  return { ...base, ...deriveInclusion(base) };
}

/** 규칙 엔진 전용 가상 학과 (실제 학과 카탈로그와 무관) */
export const PROFILE: StudentProfile = {
  schemaVersion: 1, homeCampus: 'seoul', cohortYear: 2022, entryType: 'freshman',
  primaryDepartmentId: 'test-major-x', programType: 'double', secondaryDepartmentId: 'test-major-y', currentTerm: T26_2,
};

const applicability = {
  homeCampus: 'seoul' as const, cohortFrom: 2019, cohortTo: 2026,
  entryTypes: ['freshman' as const, 'transferGeneral' as const], primaryDepartmentIds: [] as string[], programTypes: ['double' as const, 'single' as const],
};

/** §11.2 가상 기준: 총 30, 주전공 8, 이중전공 6, 교양 8 */
export const TEST_BUNDLES: RequirementBundle[] = [
  {
    schemaVersion: 1, id: 't-common', dataVersion: 't', status: 'verified', scope: 'common', applicability,
    totalRequiredUnits: 3000, requiredUnitsByArea: { liberalArts: 800 }, requiredCourseGroups: [], certifications: [],
    commonRequirements: [], sourceIds: ['s1'],
  },
  {
    schemaVersion: 1, id: 't-primary', dataVersion: 't', status: 'verified', scope: 'primary',
    applicability: { ...applicability, primaryDepartmentIds: ['test-major-x'] },
    totalRequiredUnits: null, requiredUnitsByArea: { primary: 800 },
    requiredCourseGroups: [
      { id: 'g-a', title: '가상 필수 A', minCount: 1, acceptableCourseCodes: ['T90001'], sourceIds: ['s1'] },
      { id: 'g-alt', title: '가상 필수 택1', minCount: 1, acceptableCourseCodes: ['X1', 'X2'], sourceIds: ['s1'] },
      { id: 'g-alt2', title: '가상 필수 택1 (같은 후보)', minCount: 1, acceptableCourseCodes: ['X1', 'X2'], sourceIds: ['s1'] },
    ],
    certifications: [], commonRequirements: [], sourceIds: ['s1'],
  },
  {
    schemaVersion: 1, id: 't-secondary', dataVersion: 't', status: 'verified', scope: 'secondary',
    applicability: { ...applicability, secondaryDepartmentIds: ['test-major-y'] },
    totalRequiredUnits: null, requiredUnitsByArea: { double: 600 }, requiredCourseGroups: [], certifications: [],
    commonRequirements: [], sourceIds: ['s1'],
  },
];

export function stateWith(over: Partial<AppState> = {}): AppState {
  return { ...emptyState(), profile: PROFILE, ...over };
}
