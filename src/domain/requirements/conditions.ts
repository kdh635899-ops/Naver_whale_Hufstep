// 공식 규칙의 적용 조건식 평가 (참 / 거짓 / 모름 3값 논리).
// 학생 정보가 없으면 false가 아니라 'unknown'으로 남기고, 무엇을 입력받아야 하는지 모은다.
// 규칙은 데이터(JSON)일 뿐이며 문자열 코드를 실행하지 않는다.
import type { StudentProfile } from '../types';

export type Scalar = string | number | boolean | null;
export type Cond =
  | { op: 'AND' | 'OR'; conditions: Cond[] }
  | { op: 'NOT'; condition: Cond }
  | { op: 'eq'; field: string; value: Scalar }
  | { op: 'in'; field: string; values: Scalar[] }
  | { op: 'range'; field: string; min: number | null; max: number | null }
  | { op: 'true' }
  | { op: 'false' }
  | { op: 'unknown'; reason?: string };

export type Tri = true | false | 'unknown';
/** 학생 조건 값. 키가 없으면 '모름', null이면 '해당 없음'(어떤 값과도 같지 않음) */
export type Facts = Record<string, Scalar>;

export interface CondResult {
  value: Tri;
  /** 값이 없어 '모름'이 된 필드 */
  missing: string[];
  /** 원문에서 확정되지 않은 조건 (입력으로 해결할 수 없음) */
  blockers: string[];
}

const T: CondResult = { value: true, missing: [], blockers: [] };
const F: CondResult = { value: false, missing: [], blockers: [] };
const merge = (rs: CondResult[]) => ({
  missing: [...new Set(rs.flatMap((r) => r.missing))],
  blockers: [...new Set(rs.flatMap((r) => r.blockers))],
});

export function evalCond(c: Cond, facts: Facts): CondResult {
  switch (c.op) {
    case 'true': return T;
    case 'false': return F;
    case 'unknown': return { value: 'unknown', missing: [], blockers: [c.reason ?? '원문에서 확정되지 않은 조건'] };
    case 'NOT': {
      const r = evalCond(c.condition, facts);
      return r.value === 'unknown' ? r : { ...r, value: !r.value };
    }
    case 'AND': case 'OR': {
      const rs = c.conditions.map((x) => evalCond(x, facts));
      const decisive = c.op === 'OR'; // AND는 거짓 하나, OR는 참 하나로 결정
      if (rs.some((r) => r.value === decisive)) return decisive ? T : F;
      const unknown = rs.filter((r) => r.value === 'unknown');
      return unknown.length ? { value: 'unknown', ...merge(unknown) } : decisive ? F : T;
    }
    default: {
      if (!(c.field in facts)) return { value: 'unknown', missing: [c.field], blockers: [] };
      const v = facts[c.field];
      if (c.op === 'eq') return v === c.value ? T : F;
      if (c.op === 'in') return c.values.includes(v) ? T : F;
      if (typeof v !== 'number') return F; // null(해당 없음)은 어떤 범위에도 들지 않는다
      return (c.min === null || v >= c.min) && (c.max === null || v <= c.max) ? T : F;
    }
  }
}

/** 규칙 조건에 쓰인 필드별 값 목록 (선택지 만들기용) */
export function condValues(c: Cond, field: string, out = new Set<Scalar>()): Set<Scalar> {
  if (c.op === 'AND' || c.op === 'OR') c.conditions.forEach((x) => condValues(x, field, out));
  else if (c.op === 'NOT') condValues(c.condition, field, out);
  else if (c.op === 'eq' && c.field === field) out.add(c.value);
  else if (c.op === 'in' && c.field === field) c.values.forEach((v) => out.add(v));
  return out;
}

// ---- 학생에게 물을 수 있는 추가 조건 ----

export type FieldKind = 'bool' | 'choice' | 'term' | 'year';
/** fallback: 학생이 답하지 않았을 때 판정에 쓰는 값. 결과 아래 접힌 기본값 수정란에서 바꿀 수 있다. */
export interface FieldSpec { label: string; kind: FieldKind; help?: string; fallback?: Scalar }

/** 별도 답변이 없으면 일반학생 기준으로 계산하는 전형만 명시한다. */
export const GENERAL_ADMISSION_DEFAULTS = { foreignAdmission: false, northKoreanAdmission: false, militaryCommissioned: false } as const;

/** 규칙이 요구할 때만 묻는 학생 입력. 여기 없는 필드는 앱이 아직 입력받지 못하는 조건이다. */
export const ASKABLE_FIELDS: Record<string, FieldSpec> = {
  graduationTerm: { label: '졸업 예정 학기', kind: 'term', help: '현재 학기를 졸업 학기로 가정하지 않아요. 예정이 바뀌면 다시 고쳐 주세요.' },
  entryTerm: { label: '입학(편입학) 학기', kind: 'term', help: '학교가 부여한 학번 연도와 다를 수 있어요.' },
  studentCollegeAtEntry: { label: '입학 당시 소속 단과대학', kind: 'choice', help: '현재 학과의 소속을 기본값으로 사용해요. 입학 당시와 다르면 수정해 주세요.' },
  teacherTraining: { label: '교직과정을 이수하나요?', kind: 'bool', fallback: false },
  pureForeignAdmission: { label: '순수외국인 전형으로 입학했나요?', kind: 'bool', fallback: false },
  foreignAdmission: { label: '외국인 전형으로 입학했나요?', kind: 'bool', fallback: false },
  foreignLanguageSpecialAdmission: { label: '외국어 특기자 등 특별전형으로 입학했나요?', kind: 'bool' },
  northKoreanAdmission: { label: '북한이탈주민 전형으로 입학했나요?', kind: 'bool', fallback: false },
  japanOverseasKoreanAdmission: { label: '재일동포 특별전형으로 입학했나요?', kind: 'bool', fallback: false },
  japaneseNationality: { label: '일본 국적인가요?', kind: 'bool', fallback: false },
  militaryCommissioned: { label: '군 위탁생인가요?', kind: 'bool', fallback: false },
  approvedRequiredCourseWaiver: { label: '학과에서 전공필수 면제를 승인받았나요?', kind: 'bool', help: '승인을 받은 경우에만 ‘예’를 골라 주세요.',
    fallback: false },
  approvedDisabilityCertificationWaiver: { label: '장애학생 졸업인증 면제를 승인받았나요?', kind: 'bool', fallback: false },
  primaryMajorIsEnglish: { label: '주전공이 영어 전공으로 분류되나요? (학교 외국어인증 기준)', kind: 'bool' },
  primaryMajorCollegeIsEnglishCollege: { label: '주전공이 영어대학 소속인가요?', kind: 'bool' },
  degreeTrack: { label: '학위 과정', kind: 'choice' },
  transferEntryGrade: { label: '편입 학년', kind: 'choice' },
  dualSelectionYear: { label: '이중전공을 선택(배정)받은 연도', kind: 'year' },
  majorSelectionTerm: { label: '전공을 선택(배정)받은 학기', kind: 'term' },
  originalCourseTakenYear: { label: '기존 과목을 수강한 연도', kind: 'year' },
  assessmentRegime: { label: '적용받는 졸업평가 체계', kind: 'choice' },
  certificationLanguage: { label: '졸업인증 언어', kind: 'choice' },
  changedMajor: { label: '전과한 적이 있나요?', kind: 'bool' },
  returnedOrReadmitted: { label: '재입학(또는 복학 후 학번이 바뀐) 학생인가요?', kind: 'bool' },
  departmentThesisPreviouslyPassed: { label: '학과 졸업논문을 이미 통과했나요?', kind: 'bool' },
  statisticsIntroCompleted: { label: '통계학개론을 이수했나요?', kind: 'bool' },
  statisticsPractice1Completed: { label: '통계 실습(1) 과목을 이수했나요?', kind: 'bool' },
  statisticsPractice2Completed: { label: '통계 실습(2) 과목을 이수했나요?', kind: 'bool' },
  statisticsPracticeCompletedBeforeIntroOffering: { label: '통계학개론 개설 전에 통계 실습 과목을 이수했나요?', kind: 'bool' },
};

/** 과목마다 값이 다른 조건: 학생에게 묻지 않고 과목 대조 때 그 과목의 수강 학기로 평가한다 */
export const PER_COURSE_FIELDS = new Set(['courseEnrollmentTerm']);

/** 다른 답에서 계산되는 필드 → 물어볼 원래 필드 */
const DERIVED_FROM: Record<string, string> = {
  graduationMonthIndex: 'graduationTerm', graduationMonth: 'graduationTerm',
  admissionTerm: 'entryTerm', transferAdmissionTerm: 'entryTerm', entrySemesterIndex: 'entryTerm', entryYear: 'entryTerm',
};
/** 조건에 쓰인 필드를 학생에게 물을 필드로 바꾼다. 물을 수 없으면 null. */
export const askableFieldFor = (field: string): string | null =>
  DERIVED_FROM[field] ?? (field in ASKABLE_FIELDS ? field : null);

const TERM_RE = /^(\d{4})-([12])$/;
export const isTermValue = (v: unknown): v is string => typeof v === 'string' && TERM_RE.test(v);

export type ProgramComposition = 'singleExempt' | 'dualMajor' | 'minor' | 'intensiveSingle' | 'intensiveWithMinor';
export const programComposition = (p: StudentProfile): ProgramComposition =>
  p.programType === 'single' ? 'singleExempt'
    : p.programType === 'double' ? 'dualMajor'
      : p.programType === 'minor' ? 'minor'
        : p.secondaryDepartmentId ? 'intensiveWithMinor' : 'intensiveSingle';

export type MajorRole = 'primary' | 'dual' | 'minor';
export interface RoleContext {
  scope: 'primary' | 'secondary';
  role: MajorRole;
  departmentId: string;
}
export function roleContexts(p: StudentProfile): RoleContext[] {
  const out: RoleContext[] = [{ scope: 'primary', role: 'primary', departmentId: p.primaryDepartmentId }];
  if (p.secondaryDepartmentId) {
    out.push({ scope: 'secondary', role: p.programType === 'double' ? 'dual' : 'minor', departmentId: p.secondaryDepartmentId });
  }
  return out;
}

export interface DepartmentFacts { campus?: string; name?: string; college?: string; equivalentIds?: string[] }

/**
 * 학생 조건 + 판정 중인 전공 문맥 → 조건식에 넣을 값.
 * 카탈로그에서 확정되는 값(학과 캠퍼스·이름)만 자동으로 채우고, 나머지는 학생 답(profile.facts)만 쓴다.
 * currentTerm을 졸업 학기로 복사하지 않는다.
 */
export function factsFor(p: StudentProfile, ctx: RoleContext, dept: (id: string) => DepartmentFacts | undefined): Facts {
  const f: Facts = {
    homeCampus: p.homeCampus,
    cohortYear: p.cohortYear,
    entryType: p.entryType,
    programComposition: programComposition(p),
    primaryDepartmentId: p.primaryDepartmentId,
    majorRole: ctx.role,
    departmentId: ctx.departmentId,
  };
  const own = dept(ctx.departmentId);
  if (own?.campus) f.departmentCampus = own.campus;
  const primaryName = dept(p.primaryDepartmentId)?.name;
  if (primaryName) f.primaryMajorName = primaryName;
  // 이중전공이 아니면 이중전공 소속 대학은 '해당 없음'
  if (p.programType !== 'double') f.dualMajorCollege = null;
  else if (p.secondaryDepartmentId && dept(p.secondaryDepartmentId)?.college) f.dualMajorCollege = dept(p.secondaryDepartmentId)!.college!;

  // 외국어 특기자 등 특별전형은 신입학 전형이라 편입생에게는 해당 없음(묻지 않음)
  if (p.entryType === 'transferGeneral' || p.entryType === 'transferBachelor') f.foreignLanguageSpecialAdmission = false;
  for (const [k, v] of Object.entries(p.facts ?? {})) if (k in ASKABLE_FIELDS && k !== 'entryTerm') f[k] = v;

  const grad = p.facts?.graduationTerm;
  if (isTermValue(grad)) {
    const [, y, s] = TERM_RE.exec(grad)!;
    // 학위수여: 1학기 졸업 = 같은 해 8월, 2학기 졸업 = 다음 해 2월
    const month = s === '1' ? Number(y) * 100 + 8 : (Number(y) + 1) * 100 + 2;
    f.graduationMonthIndex = month;
    f.graduationMonth = `${Math.floor(month / 100)}-${String(month % 100).padStart(2, '0')}`;
  }
  const entry = p.facts?.entryTerm;
  if (isTermValue(entry)) {
    const [, y, s] = TERM_RE.exec(entry)!;
    f.admissionTerm = entry;
    f.transferAdmissionTerm = p.entryType === 'freshman' ? null : entry;
    f.entrySemesterIndex = Number(y) * 10 + Number(s);
    f.entryYear = Number(y);
  } else if (p.entryType === 'freshman') {
    // 날짜를 가정하는 작업은 규칙 평가의 fallback에서 한다. 그래야 사용한 기본값을 화면에서 수정할 수 있다.
    f.transferAdmissionTerm = null;
  }
  return f;
}
