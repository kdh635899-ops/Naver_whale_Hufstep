// 명세서 §4·§5의 데이터 계약. UI와 무관한 공용 타입만 둔다.
import type { Cond } from './requirements/conditions';

export type CampusId = 'seoul' | 'global';
export type EntryType = 'freshman' | 'transferGeneral' | 'transferBachelor';
export type ProgramType = 'single' | 'double' | 'minor' | 'intensive';
export type CreditArea =
  | 'primary' | 'double' | 'second' | 'minor'
  | 'practicalLanguage' | 'liberalArts' | 'teaching'
  | 'freeChoice' | 'foundation' | 'unknown';
export type CourseStatus = 'planned' | 'inProgress' | 'completed' | 'notEarned';
export type LetterGrade = 'A+' | 'A0' | 'B+' | 'B0' | 'C+' | 'C0' | 'D+' | 'D0' | 'F' | 'P' | 'NP';
export type Grade = LetterGrade | null;
export type Verification = 'demo' | 'verified' | 'unverified' | 'conflict';
export type Inclusion = 'included' | 'excluded' | 'unresolved';

export interface Term {
  academicYear: number;
  semester: '1' | '2' | 'summer' | 'winter' | 'unknown';
}

export interface StudentProfile {
  schemaVersion: number;
  homeCampus: CampusId;
  cohortYear: number; // 2019..2026 (기준 연도만, 전체 학번 아님)
  entryType: EntryType;
  primaryDepartmentId: string;
  programType: ProgramType;
  /** double·minor는 필수, intensive는 부전공을 함께 할 때만 (전공심화+부전공) */
  secondaryDepartmentId?: string;
  currentYear?: 1 | 2 | 3 | 4;
  currentTerm: Term;
  /** 특정 규칙이 요구할 때만 받은 추가 조건 답 (졸업 예정 학기·특별전형 등). 키가 없으면 '모름' */
  facts?: Record<string, string | number | boolean | null>;
}

export interface Course {
  id: string; // 로컬의 안정적인 ID, 재입력에도 보존
  officialCode?: string;
  name: string;
  term: Term;
  creditUnits: number; // 학점 × 100 정수
  area: CreditArea;
  rawAreaLabel?: string;
  /** 성적표 '개설학과' 칸 원문. 코드 없는 전공필수를 과목명으로 대조할 때 학과가 같은지 보는 데 쓴다. */
  offeringDepartmentName?: string;
  recognizedDepartmentId?: string;
  origin: 'paste' | 'manual' | 'demo';
  recordKind: 'course' | 'recognizedCredit';
  status: CourseStatus;
  grade: Grade;
  gradingMode: 'graded' | 'passFail' | 'ungradedCredit' | 'unknown';
  gpaInclusion: Inclusion;
  earnedInclusion: Inclusion;
  requiredClaim: 'none' | 'studentMarked' | 'officialMatched';
  /** 학생이 직접 연결한 공식 필수과목 요건 ID (공식 매칭과 구분되는 학생 확인) */
  requirementLinks?: string[];
  replacesCourseId?: string;
  sourceSnapshotId?: string;
  sourceRowKey?: string;
  overriddenFields: string[];
  updatedAt: string;
}

export interface AcademicSnapshot {
  id: string;
  importedAt: string;
  source: 'studentPaste' | 'summaryInput';
  courseIds: string[];
  reportedEarnedByArea: Partial<Record<CreditArea, number>>; // units
  reportedTotalEarnedUnits?: number;
  /** 요약 입력 경로에서만: 표시 GPA(×100)와 GPA 대상 학점(units) */
  reportedGpa?: { hundredths: number; gpaUnits: number };
  completeness: { earnedTotals: boolean; courses: boolean; gpa: boolean };
  warnings: { code: string; rowKey?: string; message: string }[];
}

export type AssessmentMode = 'exam' | 'replacement' | 'none' | null;

export interface Assessment {
  id: string;
  courseId: string;
  phase: 'midterm' | 'final';
  mode: AssessmentMode;
  replacementType?: 'presentation' | 'report' | 'project' | 'other';
  examDate?: string; // YYYY-MM-DD 로컬 날짜
  examStartTime?: string; // HH:mm
  examEndTime?: string;
  submissionDate?: string;
  submissionTime?: string;
  presentationDate?: string;
  presentationTime?: string;
  notes: string; // 최대 300자
  origin: 'student';
  updatedAt: string;
}

/** 과목 하나의 주간 수업 시간 한 칸. 한 과목에 여러 개 가능. 성적 붙여넣기에는 없어서 학생이 직접 입력한다. */
export interface ClassTime {
  courseId: string;
  day: 0 | 1 | 2 | 3 | 4; // 0=월 … 4=금
  start: string; // HH:mm
  end: string;
}

/** 과목별 자유 메모. 시험 정보(Assessment.notes)와 따로 저장하며 알림을 만들지 않는다. */
export interface CourseMemo {
  courseId: string;
  text: string; // 최대 1000자
  updatedAt: string;
}

export type EventKind = 'exam' | 'submission' | 'presentation';

export interface EvaluationEvent {
  id: string; // assessmentId:kind
  courseId: string;
  assessmentId: string;
  phase: 'midterm' | 'final';
  kind: EventKind;
  date: string;
  time?: string;
  completed: boolean;
}

export interface EventCompletion {
  eventId: string;
  completedAt: string;
}

export interface ScenarioEntry {
  courseId: string;
  expectedGrade: Grade;
  replacesCourseId?: string;
}

export interface GradeScenario {
  id: string;
  term: Term;
  baselineSnapshotId: string;
  entries: ScenarioEntry[];
}

// ---- 공식 데이터 묶음 (§5) ----

export interface SourceRef {
  id: string;
  title: string;
  url?: string;
  campus?: CampusId;
  section?: string;
  cohorts?: string;
  checkedAt?: string;
  status: Verification;
}

/** 졸업시험·인증: 종류별로 구분되는 discriminated union */
export type CertificationRequirement =
  | {
      kind: 'departmentExam';
      id: string;
      title: string;
      passCriteria: string;
      /** 공식 공개 근거가 있는 항목만 채운다 */
      publicExamInfo?: { areas?: string[]; format?: string; level?: string };
      exemptions: string[];
      alternatives: string[];
      sourceIds: string[];
    }
  | {
      kind: 'externalCertificate';
      id: string;
      title: string;
      acceptedTests: { name: string; passCriteria: string }[];
      exemptions: string[];
      sourceIds: string[];
    }
  | {
      kind: 'other';
      id: string;
      title: string;
      description: string;
      sourceIds: string[];
    };

export interface CommonRequirement {
  id: string;
  title: string;
  description: string;
  checkMethod: 'studentConfirm' | 'informational';
  sourceIds: string[];
}

export interface RequiredCourseGroup {
  id: string;
  title: string;
  minCount?: number;
  minCreditUnits?: number;
  acceptableCourseCodes: string[];
  sourceIds: string[];
}

export type BundleScope = 'common' | 'program' | 'primary' | 'secondary';

export interface RequirementBundle {
  schemaVersion: number;
  id: string;
  dataVersion: string;
  status: Verification;
  /** 어떤 의미의 규칙인지 (학교 공통 / 전공 구성 / 주전공 / 두 번째 전공) */
  scope: BundleScope;
  applicability: {
    homeCampus: CampusId;
    cohortFrom: number;
    cohortTo: number;
    entryTypes: EntryType[];
    primaryDepartmentIds: string[]; // 빈 배열 = 학과 무관 (common/program 용)
    programTypes: ProgramType[];
    secondaryDepartmentIds?: string[];
    effectiveFrom?: string;
    effectiveTo?: string;
  };
  totalRequiredUnits: number | null;
  requiredUnitsByArea: Partial<Record<CreditArea, number>>;
  requiredCourseGroups: RequiredCourseGroup[];
  /** 한 과목을 여러 필수 묶음에 동시에 쓸 수 있는지 (규정에 명시된 경우만 true) */
  allowCourseReuseAcrossGroups?: boolean;
  certifications: CertificationRequirement[];
  commonRequirements: CommonRequirement[];
  sourceIds: string[];
}

export interface Department {
  id: string;
  name: string;
  campus: CampusId;
  aliases: string[];
  validFrom?: string;
  validTo?: string;
  status: Verification;
}

export interface AcademicCalendar {
  campus: CampusId;
  term: Term;
  midtermPeriod?: { from: string; to: string };
  finalPeriod?: { from: string; to: string };
  sourceIds: string[];
  status: Verification;
}

export interface GradingPolicy {
  id: string;
  gradeAliases: Record<string, LetterGrade>;
  maxCreditUnitsPerCourse: number;
  sourceIds: string[];
  status: Verification;
}

// ---- 조건식이 붙은 공식 규칙 (official-rules.json) ----

export interface CourseLeaf {
  op: 'course';
  id: string;
  code: string | null;
  name: string;
  creditUnits: number | null;
  /** code = 공식 코드·검증된 대체로만 매칭, studentConfirmation = 코드가 없어 학생이 직접 연결 */
  matching: 'code' | 'studentConfirmation';
  waiverRuleIds?: string[];
  identicalNames?: string[];
}
export type CourseExpr =
  | { op: 'ALL' | 'OR'; items: CourseExpr[] }
  | { op: 'AT_LEAST'; count: number; items: CourseExpr[] }
  | CourseLeaf;

export interface OfficialRule {
  id: string;
  /** compatible = requirement-bundles.json에 이미 변환됨, pending = 조건 평가 후 사용, unconfirmed = 조사 미확정 */
  state: 'compatible' | 'pending' | 'unconfirmed';
  status: Exclude<Verification, 'demo'>;
  departmentId: string | null;
  category: string;
  type: string;
  title?: string;
  condition: Cond | null;
  bundleIds?: string[];
  totalRequiredUnits: number | null;
  requiredUnitsByArea: Partial<Record<CreditArea, number>>;
  areaNotes?: { area: string; reason: string }[];
  courses?: CourseExpr;
  listCompleteness?: string;
  /** 원문에 '요건 없음/적용 제외'가 명시된 범주 */
  /** departmentMayImpose: 학교 기본값으로만 '없음'인 경우(학과가 별도 부과할 수 있어 학과 확인 안내) */
  none?: { categories: string[]; exceptCompositions?: string[]; departmentMayImpose?: true };
  /** 코드가 명시된 대체·택일 관계 (규칙 조건이 맞을 때만 사용) */
  substitutions?: { from: string[]; to: string[]; fromTerm?: string; names?: string[] }[];
  /** 화면 표시용 원문 요건 (원래 단위) */
  detail?: unknown;
  /** 그 학기 공지에만 해당하는 마감일·시험일 (다른 졸업 학기에 재사용하지 않음) */
  termSpecific?: { term: string; fields: Record<string, unknown> };
  reasons: string[];
  note?: string;
  sourceIds: string[];
}

export interface SupportGap {
  departmentId: string;
  category: string;
  entryTypes?: EntryType[];
  majorRoles?: string[];
  status: string;
  reason: string;
}

export interface DepartmentMeta {
  id: string;
  kind: string;
  status: string;
  college?: string;
  parentId?: string;
  formerNames?: string[];
  requirementsComplete: boolean;
  roleRestrictions: { roles: string[]; condition: string | null; cohortFrom: number | null; cohortTo: number | null; reason: string }[];
  reorganization: { relation: string; relatedId: string | null }[];
  /** 학과 사무실 공개 연락처(학과 홈페이지 표기). checkedAt은 수집일 */
  contact?: { phone: string | null; email: string | null; homepageUrl: string | null; graduationPageUrl: string | null; checkedAt: string; note?: string; schoolMain?: true };
}

export interface CourseEquivalence {
  id: string;
  fromCodes: string[];
  toCodes: string[];
  direction: 'oneWay' | 'bidirectional';
  conditions?: string;
  sourceIds: string[];
  status: Verification;
}
