// 저장 데이터·공식 데이터 JSON·내부 메시지의 스키마 검사 (§9.2). 범위·enum·길이를 모두 검사한다.
import { z } from 'zod';
import { isDateKey } from '../terms';
import type {
  AcademicCalendar, AcademicSnapshot, Assessment, ClassTime, Course, CourseEquivalence, CourseMemo, CourseExpr, Department, DepartmentMeta,
  GradeScenario, GradingPolicy, OfficialRule, RequirementBundle, SourceRef, StudentProfile, SupportGap, Term,
} from '../types';
import type { AppState } from '../state';
import type { Cond } from '../requirements/conditions';

export const MAX_RECORD_UNITS = 15000; // 인정학점 묶음 1건 상한 150학점 (일반 과목 상한은 grading policy)

const campus = z.enum(['seoul', 'global']);
const entryType = z.enum(['freshman', 'transferGeneral', 'transferBachelor']);
const programType = z.enum(['single', 'double', 'minor', 'intensive']);
const verification = z.enum(['demo', 'verified', 'unverified', 'conflict']);
export const creditArea = z.enum([
  'primary', 'double', 'second', 'minor', 'practicalLanguage', 'liberalArts', 'teaching', 'freeChoice', 'foundation', 'unknown',
]);
const letter = z.enum(['A+', 'A0', 'B+', 'B0', 'C+', 'C0', 'D+', 'D0', 'F', 'P', 'NP']);
const grade = letter.nullable();
const inclusion = z.enum(['included', 'excluded', 'unresolved']);
const dateStr = z.string().refine(isDateKey, '날짜 형식이 올바르지 않아요 (YYYY-MM-DD)');
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, '시각 형식이 올바르지 않아요 (HH:mm)');
const isoStr = z.string().max(40);
const id = z.string().min(1).max(120);
const units = z.number().int().nonnegative().max(1_000_000);
const httpUrl = z.string().url().refine((u) => /^https?:\/\//.test(u), 'http/https 주소만 허용해요');
const areaUnits = z.record(creditArea, units) as unknown as z.ZodType<Partial<Record<z.infer<typeof creditArea>, number>>>;

export const termSchema: z.ZodType<Term> = z.object({
  academicYear: z.number().int().min(2000, '학년도를 확인해 주세요').max(2100),
  semester: z.enum(['1', '2', 'summer', 'winter', 'unknown']),
});

export const profileSchema: z.ZodType<StudentProfile> = z.object({
  schemaVersion: z.number().int(),
  homeCampus: campus,
  cohortYear: z.number().int().min(2019).max(2026),
  entryType,
  primaryDepartmentId: id,
  programType,
  secondaryDepartmentId: id.optional(),
  currentYear: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  currentTerm: termSchema,
  facts: z.record(z.string().max(60), z.union([z.string().max(60), z.number().int().min(0).max(999999), z.boolean(), z.null()]))
    .refine((f) => Object.keys(f).length <= 60, '추가 조건이 너무 많아요').optional(),
}).refine((p) => !p.secondaryDepartmentId || p.secondaryDepartmentId !== p.primaryDepartmentId, '주전공과 같은 전공은 두 번째 전공으로 고를 수 없어요')
  .refine((p) => (p.programType === 'double' || p.programType === 'minor' ? !!p.secondaryDepartmentId
    : p.programType === 'intensive' || !p.secondaryDepartmentId), '전공 구성에 맞게 두 번째 전공을 골라 주세요');

export const courseSchema: z.ZodType<Course> = z.object({
  id,
  officialCode: z.string().max(30).optional(),
  name: z.string().trim().min(1, '과목명을 입력해 주세요').max(120, '과목명은 120자까지예요'),
  term: termSchema,
  creditUnits: z.number().int().positive('학점은 0보다 커야 해요').max(MAX_RECORD_UNITS),
  area: creditArea,
  rawAreaLabel: z.string().max(30).optional(),
  offeringDepartmentName: z.string().max(60).optional(),
  recognizedDepartmentId: id.optional(),
  origin: z.enum(['paste', 'manual', 'demo']),
  recordKind: z.enum(['course', 'recognizedCredit']),
  status: z.enum(['planned', 'inProgress', 'completed', 'notEarned']),
  grade,
  gradingMode: z.enum(['graded', 'passFail', 'ungradedCredit', 'unknown']),
  gpaInclusion: inclusion,
  earnedInclusion: inclusion,
  requiredClaim: z.enum(['none', 'studentMarked', 'officialMatched']),
  requirementLinks: z.array(z.string().min(1).max(200)).max(20).optional(),
  replacesCourseId: id.optional(),
  sourceSnapshotId: id.optional(),
  sourceRowKey: z.string().max(400).optional(),
  overriddenFields: z.array(z.string().max(40)).max(20),
  updatedAt: isoStr,
});

const warning = z.object({ code: z.string().max(40), rowKey: z.string().max(400).optional(), message: z.string().max(400) });

export const snapshotSchema: z.ZodType<AcademicSnapshot> = z.object({
  id,
  importedAt: isoStr,
  source: z.enum(['studentPaste', 'summaryInput']),
  courseIds: z.array(id),
  reportedEarnedByArea: areaUnits,
  reportedTotalEarnedUnits: units.optional(),
  reportedGpa: z.object({ hundredths: z.number().int().min(0).max(450), gpaUnits: units.positive() }).optional(),
  completeness: z.object({ earnedTotals: z.boolean(), courses: z.boolean(), gpa: z.boolean() }),
  warnings: z.array(warning).max(3000),
});

export const assessmentSchema: z.ZodType<Assessment> = z.object({
  id,
  courseId: id,
  phase: z.enum(['midterm', 'final']),
  mode: z.enum(['exam', 'replacement', 'none']).nullable(),
  replacementType: z.enum(['presentation', 'report', 'project', 'other']).optional(),
  examDate: dateStr.optional(),
  examStartTime: timeStr.optional(),
  examEndTime: timeStr.optional(),
  submissionDate: dateStr.optional(),
  submissionTime: timeStr.optional(),
  presentationDate: dateStr.optional(),
  presentationTime: timeStr.optional(),
  notes: z.string().max(300, '메모는 300자까지예요'),
  origin: z.literal('student'),
  updatedAt: isoStr,
}).refine((a) => !a.examStartTime || !a.examEndTime || a.examStartTime <= a.examEndTime, '종료 시각이 시작보다 빨라요');

export const MEMO_MAX = 1000;
export const courseMemoSchema: z.ZodType<CourseMemo> = z.object({
  courseId: id,
  text: z.string().max(MEMO_MAX, `메모는 ${MEMO_MAX}자까지예요`),
  updatedAt: isoStr,
});

export const classTimeSchema: z.ZodType<ClassTime> = z.object({
  courseId: id,
  day: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  start: timeStr,
  end: timeStr,
}).refine((t) => t.start < t.end, '수업 종료 시각은 시작보다 늦어야 해요');

export const scenarioSchema: z.ZodType<GradeScenario> = z.object({
  id,
  term: termSchema,
  baselineSnapshotId: z.string().max(120),
  entries: z.array(z.object({ courseId: id, expectedGrade: grade, replacesCourseId: id.optional() })).max(200),
});

const notificationSettings = z.object({
  enabled: z.boolean(), dayBefore: z.boolean(), sameDay: z.boolean(), time: timeStr, version: z.number().int().positive(),
});
const consentRecord = z.object({ version: z.string().max(20), at: isoStr });

export const appStateSchema: z.ZodType<AppState> = z.object({
  schemaVersion: z.number().int(),
  profile: profileSchema.nullable(),
  courses: z.array(courseSchema).max(5000),
  snapshots: z.array(snapshotSchema).max(200),
  assessments: z.array(assessmentSchema).max(2000),
  completions: z.array(z.object({ eventId: z.string().max(200), completedAt: isoStr })).max(5000),
  courseMemos: z.array(courseMemoSchema).max(5000),
  classTimes: z.array(classTimeSchema).max(5000),
  scenarios: z.array(scenarioSchema).max(100),
  certConfirmations: z.array(z.object({ requirementId: id, confirmedAt: isoStr })).max(500),
  settings: z.object({
    notifications: notificationSettings,
    lastView: z.enum(['records', 'status', 'assessments', 'calculator', 'mypage']),
  }),
  consent: z.object({ academicData: consentRecord.optional(), notifications: consentRecord.optional() }),
});

// ---- 공식 데이터 묶음 ----

export const sourceSchema: z.ZodType<SourceRef> = z.object({
  id, title: z.string().min(1).max(200), url: httpUrl.optional(), campus: campus.optional(), section: z.string().max(100).optional(),
  cohorts: z.string().max(50).optional(), checkedAt: dateStr.optional(), status: verification,
});

export const departmentSchema: z.ZodType<Department> = z.object({
  id, name: z.string().min(1).max(60), campus, aliases: z.array(z.string().max(60)),
  validFrom: dateStr.optional(), validTo: dateStr.optional(), status: verification,
});

const sourceIds = z.array(id);
const certSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('departmentExam'), id, title: z.string().max(100), passCriteria: z.string().max(300),
    publicExamInfo: z.object({ areas: z.array(z.string().max(40)).optional(), format: z.string().max(100).optional(), level: z.string().max(100).optional() }).optional(),
    exemptions: z.array(z.string().max(200)), alternatives: z.array(z.string().max(200)), sourceIds,
  }),
  z.object({
    kind: z.literal('externalCertificate'), id, title: z.string().max(100),
    acceptedTests: z.array(z.object({ name: z.string().max(60), passCriteria: z.string().max(100) })),
    exemptions: z.array(z.string().max(200)), sourceIds,
  }),
  z.object({ kind: z.literal('other'), id, title: z.string().max(100), description: z.string().max(300), sourceIds }),
]);

// 묶음·조건 스키마는 strict: 지원하지 않는 조건 필드가 있으면 조용히 지우지 않고 그 묶음을 거절한다
// (조건이 지워지면 규칙이 더 넓게 적용되기 때문).
export const bundleSchema: z.ZodType<RequirementBundle> = z.object({
  schemaVersion: z.literal(1),
  id,
  dataVersion: z.string().max(40),
  status: verification,
  scope: z.enum(['common', 'program', 'primary', 'secondary']),
  applicability: z.object({
    homeCampus: campus,
    cohortFrom: z.number().int().min(2000).max(2100),
    cohortTo: z.number().int().min(2000).max(2100),
    entryTypes: z.array(entryType).min(1),
    primaryDepartmentIds: z.array(id),
    programTypes: z.array(programType).min(1),
    secondaryDepartmentIds: z.array(id).optional(),
    effectiveFrom: dateStr.optional(),
    effectiveTo: dateStr.optional(),
  }).strict().refine((a) => a.cohortFrom <= a.cohortTo, '학번 범위가 거꾸로예요'),
  totalRequiredUnits: units.nullable(),
  requiredUnitsByArea: areaUnits,
  requiredCourseGroups: z.array(z.object({
    id, title: z.string().max(100), minCount: z.number().int().positive().optional(), minCreditUnits: units.optional(),
    acceptableCourseCodes: z.array(z.string().max(30)).min(1), sourceIds,
  }).strict()),
  allowCourseReuseAcrossGroups: z.boolean().optional(),
  certifications: z.array(certSchema),
  commonRequirements: z.array(z.object({
    id, title: z.string().max(100), description: z.string().max(300), checkMethod: z.enum(['studentConfirm', 'informational']), sourceIds,
  })),
  sourceIds,
}).strict().refine((b) => b.status !== 'verified' || b.sourceIds.length > 0, 'verified 규칙에는 출처가 필요해요')
  .refine((b) => b.scope !== 'primary' || b.applicability.primaryDepartmentIds.length > 0, '주전공 규칙에는 학과 ID가 필요해요')
  .refine((b) => b.scope !== 'secondary' || (b.applicability.secondaryDepartmentIds?.length ?? 0) > 0, '두 번째 전공 규칙에는 학과 ID가 필요해요');

export const calendarSchema: z.ZodType<AcademicCalendar> = z.object({
  campus, term: termSchema,
  midtermPeriod: z.object({ from: dateStr, to: dateStr }).optional(),
  finalPeriod: z.object({ from: dateStr, to: dateStr }).optional(),
  sourceIds, status: verification,
});

export const gradingPolicySchema: z.ZodType<GradingPolicy> = z.object({
  id,
  gradeAliases: z.record(z.string().max(5), letter),
  maxCreditUnitsPerCourse: z.number().int().positive().max(MAX_RECORD_UNITS),
  sourceIds, status: verification,
});

export const equivalenceSchema: z.ZodType<CourseEquivalence> = z.object({
  id, fromCodes: z.array(z.string().max(30)).min(1), toCodes: z.array(z.string().max(30)).min(1),
  direction: z.enum(['oneWay', 'bidirectional']), conditions: z.string().max(300).optional(), sourceIds, status: verification,
});

// ---- 조건식이 붙은 공식 규칙 ----
const scalar = z.union([z.string().max(200), z.number(), z.boolean(), z.null()]);
const fieldName = z.string().min(1).max(60);
export const condSchema: z.ZodType<Cond> = z.lazy(() => z.union([
  z.object({ op: z.enum(['AND', 'OR']), conditions: z.array(condSchema).min(1) }).strict(),
  z.object({ op: z.literal('NOT'), condition: condSchema }).strict(),
  z.object({ op: z.literal('eq'), field: fieldName, value: scalar }).strict(),
  z.object({ op: z.literal('in'), field: fieldName, values: z.array(scalar).min(1) }).strict(),
  z.object({ op: z.literal('range'), field: fieldName, min: z.number().nullable(), max: z.number().nullable() }).strict(),
  z.object({ op: z.literal('true') }).strict(),
  z.object({ op: z.literal('false') }).strict(),
  z.object({ op: z.literal('unknown'), reason: z.string().max(400).optional() }).strict(),
]));

const courseExprSchema: z.ZodType<CourseExpr> = z.lazy(() => z.union([
  z.object({ op: z.enum(['ALL', 'OR']), items: z.array(courseExprSchema).min(1) }).strict(),
  z.object({ op: z.literal('AT_LEAST'), count: z.number().int().positive(), items: z.array(courseExprSchema).min(1) }).strict(),
  z.object({
    op: z.literal('course'), id: z.string().min(1).max(200), code: z.string().max(30).nullable(), name: z.string().min(1).max(120),
    creditUnits: units.nullable(), matching: z.enum(['code', 'studentConfirmation']),
    waiverRuleIds: z.array(id).optional(), identicalNames: z.array(z.string().max(120)).optional(),
  }).strict().refine((l) => l.matching === 'studentConfirmation' || !!l.code, '코드 매칭 과목에는 코드가 필요해요'),
]));

const ruleUnits = z.number().int().nonnegative().max(20000); // 200학점 초과 = 100배 중복 변환 의심
export const officialRuleSchema: z.ZodType<OfficialRule> = z.object({
  id,
  state: z.enum(['compatible', 'pending', 'unconfirmed']),
  status: z.enum(['verified', 'unverified', 'conflict']),
  departmentId: id.nullable(),
  category: z.string().min(1).max(60),
  type: z.string().min(1).max(80),
  title: z.string().max(300).optional(),
  condition: condSchema.nullable(),
  bundleIds: z.array(id).optional(),
  totalRequiredUnits: ruleUnits.nullable(),
  requiredUnitsByArea: z.record(creditArea, ruleUnits) as unknown as z.ZodType<Partial<Record<z.infer<typeof creditArea>, number>>>,
  areaNotes: z.array(z.object({ area: z.string().max(40), reason: z.string().max(300) }).strict()).optional(),
  courses: courseExprSchema.optional(),
  listCompleteness: z.string().max(60).optional(),
  none: z.object({ categories: z.array(z.string().max(60)).min(1), exceptCompositions: z.array(z.string().max(40)).optional(), departmentMayImpose: z.literal(true).optional() }).strict().optional(),
  substitutions: z.array(z.object({
    from: z.array(z.string().max(30)).min(1), to: z.array(z.string().max(30)).min(1),
    fromTerm: z.string().regex(/^\d{4}-[12]$/).optional(), names: z.array(z.string().max(120)).optional(),
  }).strict()).optional(),
  detail: z.unknown(),
  termSpecific: z.object({ term: z.string().regex(/^\d{4}-[12]$/), fields: z.record(z.unknown()) }).strict().optional(),
  reasons: z.array(z.string().max(400)),
  note: z.string().max(600).optional(),
  sourceIds,
}).strict()
  .refine((r) => r.state === 'compatible' ? !!r.bundleIds?.length : r.condition !== null, '조건 처리 규칙에는 조건식이, 호환 규칙에는 묶음 ID가 필요해요')
  .refine((r) => r.status !== 'verified' || r.sourceIds.length > 0, 'verified 규칙에는 출처가 필요해요');

export const supportGapSchema: z.ZodType<SupportGap> = z.object({
  departmentId: id, category: z.string().max(60), entryTypes: z.array(entryType).optional(), majorRoles: z.array(z.string().max(20)).optional(),
  status: z.string().max(30), reason: z.string().max(300),
}).strict();

export const departmentMetaSchema: z.ZodType<DepartmentMeta> = z.object({
  id, kind: z.string().max(60), status: z.string().max(60), college: z.string().max(60).optional(), parentId: id.optional(),
  formerNames: z.array(z.string().max(60)).optional(), requirementsComplete: z.boolean(),
  roleRestrictions: z.array(z.object({
    roles: z.array(z.string().max(20)), condition: z.string().max(40).nullable(), cohortFrom: z.number().int().nullable(),
    cohortTo: z.number().int().nullable(), reason: z.string().max(400),
  }).strict()),
  reorganization: z.array(z.object({ relation: z.string().max(40), relatedId: id.nullable() }).strict()),
  contact: z.object({
    phone: z.string().regex(/^0\d{1,2}-\d{3,4}-\d{4}$/).nullable(), email: z.string().email().max(80).nullable(),
    homepageUrl: z.string().url().max(300).nullable(), graduationPageUrl: z.string().url().max(300).nullable(), checkedAt: dateStr,
    note: z.string().max(120).optional(), schoolMain: z.literal(true).optional(),
  }).strict().optional(),
}).strict();

// ---- 사이드바 → 서비스 워커 내부 메시지 (필요한 종류만) ----
export const runtimeMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('reconcile') }),
  z.object({ type: z.literal('clearAll') }),
]);
export type RuntimeMessage = z.infer<typeof runtimeMessageSchema>;

/** zod 오류를 사용자에게 보여줄 첫 메시지로 */
export const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? '입력값을 확인해 주세요';
