// 조건식이 붙은 공식 규칙(official-rules.json)의 선택 → 학점 결합 → 필수과목 식 평가 → 핵심 항목별 판정 가능 범위.
// 원칙: 미확정 상태는 유지하며, 자료 충돌은 조건이 맞을 때 엄격한 쪽으로 계산한다.
import { effectiveCourses } from '../gpa/gpa';
import { compareTerms, termKey } from '../terms';
import type {
  AcademicSnapshot, Course, CourseExpr, CourseLeaf, CreditArea, Department, DepartmentMeta, OfficialRule, RequirementBundle, StudentProfile,
  SupportGap, Term,
} from '../types';
import {
  ASKABLE_FIELDS, askableFieldFor, condValues, evalCond, factsFor, PER_COURSE_FIELDS, programComposition, roleContexts,
  type DepartmentFacts, type Facts, type FieldSpec, type MajorRole, type Scalar, type Tri,
} from './conditions';
import { combineParts, selectBundles, type CombinablePart, type ResolvedRequirements } from './resolve';

export type RuleScope = 'common' | 'primary' | 'secondary';
/** confirmed = 앱에서 사용, needsInput = 학생 입력 후 사용, unsupported = 앱이 아직 판정 못 함, unconfirmed = 조사 미확정·충돌 */
export type RuleClass = 'confirmed' | 'needsInput' | 'unsupported' | 'unconfirmed';

export interface RuleEval {
  rule: OfficialRule;
  scope: RuleScope;
  role: MajorRole;
  applies: Tri;
  cls: RuleClass;
  /** 학생에게 물으면 판정할 수 있는 필드 */
  askFields: string[];
  /** 앱이 입력받지 못하는 조건 필드 */
  unaskableFields: string[];
  /** 원문에서 확정되지 않은 조건 */
  blockers: string[];
  /** 과목별 수강 학기로만 정해지는 규칙 (과목 대조 때 다시 평가) */
  perCourse: boolean;
  /** 평가에 쓴 학생 조건 값 */
  facts: Facts;
  /** 학생이 답하지 않아 정적·학생 정보 기반 기본값으로 판정한 필드 */
  fallbackFields: string[];
}

/** 저장하지 않는 계산용 기본값. 학생이 고른 답은 factsFor에서 항상 우선한다. */
export function defaultAnswers(profile: StudentProfile, rules: OfficialRule[], dept: (id: string) => DepartmentFacts | undefined): Facts {
  const defaults: Facts = Object.fromEntries(Object.entries(ASKABLE_FIELDS)
    .filter(([, spec]) => spec.fallback !== undefined).map(([field, spec]) => [field, spec.fallback!]));
  const transfer = profile.entryType !== 'freshman';
  defaults.entryTerm = `${profile.cohortYear + (transfer ? 2 : 0)}-1`;
  if (transfer) defaults.transferEntryGrade = 3;
  const colleges = new Set<Scalar>();
  for (const rule of rules) if (rule.condition) condValues(rule.condition, 'studentCollegeAtEntry', colleges);
  const college = dept(profile.primaryDepartmentId)?.college;
  defaults.studentCollegeAtEntry = college && colleges.has(college) ? college : null;
  return defaults;
}

interface UsedDefault { value: Scalar; ruleIds: string[] }

const rank = (t: Tri) => (t === true ? 2 : t === 'unknown' ? 1 : 0);

/** 한 규칙 안의 발표·대체 경로는 각 조항의 시행 기간으로 고른다. 원본 객체는 보존한다. */
export function detailForGraduation(value: unknown, month: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => detailForGraduation(v, month)).filter((v) => v !== null);
  if (value === null || typeof value !== 'object') return value;
  const node = value as Record<string, unknown>;
  const period = node.graduationPeriod as { min: number | null; max: number | null } | undefined;
  if (period && (typeof month !== 'number' || (period.min !== null && month < period.min)
    || (period.max !== null && month > period.max))) return null;
  return Object.fromEntries(Object.entries(node).filter(([k]) => k !== 'graduationPeriod')
    .map(([k, v]) => [k, detailForGraduation(v, month)]));
}

/** 학생의 주전공·두 번째 전공 문맥에서 각 규칙을 평가한다. 해당 없음(false)은 결과에서 뺀다. */
export function evaluateRules(
  profile: StudentProfile, rules: OfficialRule[], dept: (id: string) => DepartmentFacts | undefined,
  usedDefaults = new Map<string, UsedDefault>(),
): RuleEval[] {
  const defaults = defaultAnswers(profile, rules, dept);
  const ctxs = roleContexts(profile);
  const out: RuleEval[] = [];
  for (const rule of rules) {
    if (rule.state === 'compatible' || !rule.condition) continue; // 호환 규칙은 requirement-bundles.json으로 처리
    const candidates = rule.departmentId ? ctxs.filter((c) => c.departmentId === rule.departmentId) : ctxs;
    let best: { ctx: (typeof ctxs)[number]; r: ReturnType<typeof evalCond>; facts: Facts; fallbackFields: string[] } | null = null;
    for (const ctx of candidates) {
      let facts = factsFor(profile, ctx, dept);
      let r = evalCond(rule.condition, facts);
      // 답이 없어 '모름'이 된 필드 중 기본값이 있는 것은 그 값으로 다시 평가 (예: 전필 면제 승인 → 아니요)
      // 파생 필드(entryYear 등)도 원래 질문(entryTerm)의 기본값으로 다시 계산한다.
      const fields = r.value === 'unknown' ? [...new Set(r.missing.map(askableFieldFor)
        .filter((f): f is string => !!f && f in defaults && !(f in (profile.facts ?? {}))))] : [];
      const fill = fields.map((f) => [f, defaults[f]] as const);
      if (fill.length) {
        facts = factsFor({ ...profile, facts: { ...Object.fromEntries(fill), ...profile.facts } }, ctx, dept);
        r = evalCond(rule.condition, facts);
        // 제외된 규칙도 어떤 기본값으로 제외했는지 학생이 수정할 수 있어야 한다.
        for (const [field, value] of fill) {
          const previous = usedDefaults.get(field);
          usedDefaults.set(field, { value, ruleIds: [...new Set([...(previous?.ruleIds ?? []), rule.id])] });
        }
      }
      if (!best || rank(r.value) > rank(best.r.value)) best = { ctx, r, facts, fallbackFields: fill.map(([f]) => f) };
    }
    if (!best || best.r.value === false) continue;
    // 과목 수강 학기만 남은 규칙: 학생 단위로는 적용, 과목 대조 때 그 과목의 학기로 다시 평가
    const perCourse = best.r.value === 'unknown' && !best.r.blockers.length && best.r.missing.length > 0
      && best.r.missing.every((f) => PER_COURSE_FIELDS.has(f));
    const askFields = [...new Set(best.r.missing.map(askableFieldFor).filter((f): f is string => !!f))];
    const unaskableFields = best.r.missing.filter((f) => !askableFieldFor(f));
    const cls: RuleClass = rule.status !== 'verified' ? 'unconfirmed'
      : best.r.value === true || perCourse ? 'confirmed'
        : unaskableFields.length || best.r.blockers.length ? 'unsupported' : 'needsInput';
    out.push({
      rule, scope: rule.departmentId ? best.ctx.scope : 'common', role: best.ctx.role, applies: best.r.value, cls,
      askFields, unaskableFields: perCourse ? [] : unaskableFields, blockers: best.r.blockers, perCourse, facts: best.facts,
      fallbackFields: best.fallbackFields,
    });
  }
  return out;
}

// ---- 학생에게 물을 추가 조건 ----

/** optional = 답하지 않아도 기본값으로 판정되는 선택 질문 */
export interface Question { field: string; spec: FieldSpec; options: { value: Scalar; label: string }[]; ruleIds: string[]; optional?: boolean; defaultValue?: Scalar }

const OPTION_LABEL: Record<string, (v: Scalar) => string> = {
  transferEntryGrade: (v) => `${v}학년 편입`,
  assessmentRegime: (v) => (v === 'german2023Revision' ? '독일어과 2023 개정 평가 체계' : String(v)),
  certificationLanguage: (v) => (v === 'Chinese' ? '중국어' : String(v)),
};

/** 입력 필요(needsInput) 규칙이 실제로 요구하는 필드만 묻는다. 선택지는 규칙 조건에 쓰인 값 + '목록에 없음'. */
export function buildQuestions(evals: RuleEval[], allRules: OfficialRule[], usedDefaults = new Map<string, UsedDefault>()): Question[] {
  const byField = new Map<string, string[]>([...usedDefaults].map(([f, d]) => [f, d.ruleIds]));
  const optional = new Set<string>(usedDefaults.keys());
  for (const e of evals) {
    for (const f of e.fallbackFields) { optional.add(f); byField.set(f, [...(byField.get(f) ?? []), e.rule.id]); }
    if (e.cls !== 'needsInput') continue;
    for (const f of e.askFields) byField.set(f, [...(byField.get(f) ?? []), e.rule.id]);
  }
  // 필수 질문을 먼저, 기본값으로 판정되는 선택 질문은 뒤에
  return [...byField].sort(([a], [b]) => Number(optional.has(a)) - Number(optional.has(b))).map(([field, ruleIds]) => {
    const spec = ASKABLE_FIELDS[field];
    let options: Question['options'] = [];
    if (spec.kind === 'bool') options = [{ value: true, label: '예' }, { value: false, label: '아니요' }];
    if (spec.kind === 'choice') {
      const vals = new Set<Scalar>();
      for (const r of allRules) if (r.condition) condValues(r.condition, field, vals);
      options = [...vals].filter((v) => v !== null).map((v) => ({ value: v, label: (OPTION_LABEL[field] ?? String)(v) }));
      options.push({ value: null, label: '목록에 없음 / 해당 없음' });
    }
    return { field, spec, options, ruleIds: [...new Set(ruleIds)], ...(optional.has(field) && { optional: true,
      defaultValue: usedDefaults.get(field)?.value ?? spec.fallback ?? null }) };
  });
}

// ---- 핵심 항목별 판정 범위 ----

export type CoreCategory = 'credits' | 'requiredCourses' | 'departmentAssessment' | 'languageCertification';
const CORE_OF: Record<string, CoreCategory> = {
  credits: 'credits', majorCredits: 'credits', majorCreditDistribution: 'credits',
  requiredCourses: 'requiredCourses', departmentAssessment: 'departmentAssessment',
  commonLanguageCertification: 'languageCertification',
};
const coreOf = (r: OfficialRule): CoreCategory | undefined => {
  const c = CORE_OF[r.category];
  // 학과별 어학 요건은 그 전공의 졸업평가·인증 항목으로 본다
  return c === 'languageCertification' && r.departmentId ? 'departmentAssessment' : c;
};
const noneCore = (cat: string): CoreCategory | undefined => (cat === 'commonLanguageCertification' ? 'languageCertification' : CORE_OF[cat]);

export type NoteKind = 'needsInput' | 'unconfirmed' | 'unsupported' | 'gap' | 'partialList' | 'conflict' | 'schoolDefault' | 'schoolCommonOnly';

/** 학생에게 보여 줄 한 줄 분류. 규칙에 분류가 실려 오지 않으면 이유 종류로 정한다. */
export const DISPLAY_REASON_LABEL = {
  homepage: '학과 안내(홈페이지·편람) 기준이에요',
  conflict: '자료마다 달라서 필수로 계산했어요',
  minorScope: '학과 내규가 있을 수 있어요',
  threshold: '합격 기준은 학과 확인 필요',
  cohort: '학번별 기준이 확실하지 않아요',
} as const;
export type DisplayReasonKey = keyof typeof DISPLAY_REASON_LABEL;

const REASON_OF_KIND: Record<Exclude<NoteKind, 'needsInput'>, DisplayReasonKey> = {
  conflict: 'conflict', schoolDefault: 'minorScope', schoolCommonOnly: 'threshold',
  unconfirmed: 'cohort', unsupported: 'cohort', gap: 'cohort', partialList: 'cohort',
};

/** 규칙에 실려 온 분류를 먼저 쓰고, 없으면 이유 종류로 정한다. 추가 입력 필요는 성격이 달라 분류하지 않는다. */
export function displayReasonFor(kind: NoteKind, rule?: OfficialRule): string | undefined {
  if (kind === 'needsInput') return undefined;
  return rule?.displayReason?.label ?? DISPLAY_REASON_LABEL[REASON_OF_KIND[kind]];
}

export interface CoverageNote {
  notApplicable?: boolean;
  kind: NoteKind;
  /** 학생이 '통과했어요'로 넘긴 기록을 저장할 안정적인 ID */
  id: string;
  /** 요건 줄에 보여 줄 짧은 제목 (없으면 text를 쓴다) */
  title?: string;
  /** 학교 확인이 필요한 줄 아래 한 줄로 보여 줄 분류 (needsInput에는 없다) */
  displayReason?: string;
  text: string;
  ruleIds: string[];
  sourceIds: string[];
}
export interface CoverageRow {
  category: CoreCategory;
  scope: RuleScope;
  departmentId?: string;
  /** confirmed = 확인된 요건 있음, none = 원문에 요건 없음/적용 제외 명시, missing = 제공되는 자료 없음 */
  basis: 'confirmed' | 'none' | 'missing';
  notes: CoverageNote[];
  determinable: boolean;
}

export interface OfficialReport {
  evals: RuleEval[];
  questions: Question[];
  /** 호환 묶음 + 확정 학점 규칙을 결합한 결과 (기존 화면 계산에 그대로 사용) */
  resolved: ResolvedRequirements | null;
  courseRules: RuleEval[];
  items: RuleEval[];
  coverage: CoverageRow[];
  /** 주·두 번째 전공의 학과 단위 전체 조사가 끝났는지 */
  researchComplete: boolean;
  canDetermineGraduation: boolean;
}

const isCreditRule = (r: OfficialRule) => r.totalRequiredUnits !== null || Object.keys(r.requiredUnitsByArea).length > 0;

const CATEGORY_TITLE: Record<string, string> = {
  credits: '졸업 학점 기준', majorCredits: '전공 학점 기준', majorCreditDistribution: '전공 학점 배분 기준',
  basicCredits: '기초 학점 기준', basicCreditsPolicy: '기초 학점 규정', creditInterpretation: '학점 인정 해석',
  requiredCourses: '전공필수 과목 기준', liberalArtsRequired: '교양필수 과목 기준', courseSubstitution: '대체 과목 규정',
  courseRecognition: '과목 인정 규정', coursePolicy: '수강 규정', transferRecognition: '편입 학점 인정 규정',
  departmentAssessment: '졸업 인증 기준', commonLanguageCertification: '외국어 졸업인증 기준',
  examAdministration: '졸업시험 운영 규정', examDescription: '졸업시험 안내', departmentActivity: '학과 활동 요건',
  eligibility: '이수 자격 규정', majorEligibility: '전공 이수 자격 규정',
};
const ROLE_WORD: Record<string, string> = { primary: '주전공', dualMajor: '이중전공', dual: '이중전공', minor: '부전공' };
/** 원문 제목에 섞인 영어 역할명만 한글로 (ellt-dual-2018 같은 ID 꼴은 그대로 둔다) */
const koreanRoles = (t: string) => t.replace(/(^|[\s:,·])(primary|dualMajor|dual|minor)(?=[\s:,·]|$)/g, (_, pre, w) => pre + ROLE_WORD[w]);
/** 화면에 보일 규칙 이름. 원문 제목이 없으면 내부 ID 대신 '학과명 + 요건 종류'로 만든다. */
export const ruleTitle = (r: OfficialRule, departmentName?: string): string =>
  r.title ? koreanRoles(r.title).replace(/^20\d{2}\s+/, '')
    : [departmentName ?? (r.departmentId ? '' : '학교 공통'), CATEGORY_TITLE[r.category] ?? '졸업 관련 규정'].filter(Boolean).join(' ');

export function noteFrom(e: RuleEval, deptName: (id: string) => string | undefined): CoverageNote {
  const title = e.rule.type === 'conflictingLanguageCoursePolicy'
    ? '제2외국어 1~6단계 순차 이수 · 언어 변경 사전 승인'
    : ruleTitle(e.rule, e.rule.departmentId ? deptName(e.rule.departmentId) : undefined);
  const kind: NoteKind = e.cls === 'needsInput' ? 'needsInput' : e.cls === 'unsupported' ? 'unsupported' : 'unconfirmed';
  const why = kind === 'needsInput'
    ? `추가 입력 필요: ${e.askFields.map((f) => ASKABLE_FIELDS[f].label).join(', ')}`
    : kind === 'unsupported'
      ? [e.blockers.length ? `원문 미확정 조건: ${e.blockers.join(' / ')}` : '', e.unaskableFields.length ? `앱이 아직 입력받지 못하는 조건: ${e.unaskableFields.join(', ')}` : ''].filter(Boolean).join(' · ')
      : `${e.rule.status === 'conflict' ? '근거 충돌' : '조사 미확정'}: ${e.rule.reasons.join(' / ') || e.rule.note || '학교 확인 필요'}`;
  return {
    kind, id: e.rule.id, title, displayReason: displayReasonFor(kind, e.rule),
    text: `${title} — ${why}`, ruleIds: [e.rule.id], sourceIds: e.rule.sourceIds,
  };
}

export interface ReportInput {
  profile: StudentProfile;
  bundles: RequirementBundle[];
  rules: OfficialRule[];
  supportGaps: SupportGap[];
  dept: (id: string) => DepartmentFacts | undefined;
  meta: (id: string) => DepartmentMeta | undefined;
  today?: string;
}

export function buildOfficialReport({ profile, bundles, rules, supportGaps, dept, meta, today }: ReportInput): OfficialReport {
  const usedDefaults = new Map<string, UsedDefault>();
  const evals = evaluateRules(profile, rules, dept, usedDefaults);
  const deptName = (id: string) => dept(id)?.name;
  const titleOf = (r: OfficialRule) => ruleTitle(r, r.departmentId ? deptName(r.departmentId) : undefined);
  const confirmed = evals.filter((e) => e.cls === 'confirmed');
  // 학교 공통의 '부전공 전필 제외'를 우선하며, 조건을 모르는 충돌 규칙은 소급 적용하지 않는다.
  const conservative = evals.filter((e) => e.rule.status === 'conflict' && e.applies === true
    && !(e.role === 'minor' && e.rule.category === 'requiredCourses'));
  // 졸업 예정 학기 때문에 빠진 규칙을 찾기 위한 비교 평가 (그 답만 지운 상태)
  const grad = profile.facts?.graduationTerm;
  const withoutGrad = typeof grad === 'string'
    ? evaluateRules({ ...profile, facts: Object.fromEntries(Object.entries(profile.facts!).filter(([k]) => k !== 'graduationTerm')) }, rules, dept)
      .filter((e) => e.rule.status === 'verified' && e.askFields.includes('graduationTerm'))
    : [];
  const matchedBundles = selectBundles(profile, bundles, ['verified'], today);

  // 학점: 호환 묶음 + 확정된 학점 규칙을 같은 방식으로 결합 (다른 값이면 충돌로 남기고 비움)
  const creditParts: CombinablePart[] = [...confirmed, ...conservative].filter((e) => isCreditRule(e.rule)).map((e) => ({
    id: e.rule.id, status: 'verified', scope: e.scope, totalRequiredUnits: e.rule.totalRequiredUnits,
    requiredUnitsByArea: e.rule.requiredUnitsByArea, requiredCourseGroups: [], certifications: [], commonRequirements: [],
    sourceIds: e.rule.sourceIds,
  }));
  const parts = [...matchedBundles, ...creditParts].map((p) => ({ ...p, requiredUnitsByArea: { ...p.requiredUnitsByArea } }));
  for (const { rule } of conservative.filter((e) => isCreditRule(e.rule))) {
    if (rule.totalRequiredUnits !== null) {
      const maximum = Math.max(...parts.map((p) => p.totalRequiredUnits ?? 0));
      for (const p of parts) if (p.totalRequiredUnits !== null) p.totalRequiredUnits = maximum;
    }
    for (const [area, units] of Object.entries(rule.requiredUnitsByArea) as [CreditArea, number][]) {
      const maximum = Math.max(units, ...parts.map((p) => p.requiredUnitsByArea[area] ?? 0));
      for (const p of parts) if (p.requiredUnitsByArea[area] !== undefined) p.requiredUnitsByArea[area] = maximum;
    }
  }
  const resolved = combineParts(profile, parts);

  // 호환 묶음이 어떤 범주를 덮는지 (원래 규칙 기록으로 추적)
  const compatByBundle = new Map<string, OfficialRule>();
  for (const r of rules) if (r.state === 'compatible') for (const b of r.bundleIds ?? []) compatByBundle.set(b, r);
  const composition = programComposition(profile);
  const noneApplies = (r: OfficialRule, cat: CoreCategory) =>
    !!r.none?.categories.some((c) => noneCore(c) === cat) && !r.none.exceptCompositions?.includes(composition);

  const ctxs = roleContexts(profile);
  const rows: CoverageRow[] = [];
  const rowFor = (category: CoreCategory, scope: RuleScope, departmentId?: string) => {
    const ctx = ctxs.find((c) => c.scope === scope);
    const inRow = (e: RuleEval) => {
      if (scope === 'common') return coreOf(e.rule) === category && (category === 'credits' || e.scope === 'common');
      if (e.scope === scope) return coreOf(e.rule) === category || noneApplies(e.rule, category);
      // 학교 공통 규칙 중 이 역할에 '요건 없음'을 명시한 것 (예: 부전공 전공필수 기본 원칙)
      return e.scope === 'common' && e.role === ctx?.role && noneApplies(e.rule, category);
    };
    const rowEvals = evals.filter(inRow);
    const gradOnly = withoutGrad.filter((e) => inRow(e) && !evals.some((x) => x.rule.id === e.rule.id));
    const bundleRules = matchedBundles
      .filter((b) => (scope === 'common' ? b.scope === 'common' || b.scope === 'program' : b.scope === scope))
      .map((b) => compatByBundle.get(b.id)).filter((r): r is OfficialRule => !!r && coreOf(r) === category);
    const okRules = [...rowEvals.filter((e) => e.cls === 'confirmed').map((e) => e.rule), ...bundleRules];

    let basis: CoverageRow['basis'] = 'missing';
    if (category === 'credits') basis = resolved?.totalRequiredUnits != null ? 'confirmed' : 'missing';
    else if (okRules.some((r) => !noneApplies(r, category))) basis = 'confirmed';
    else if (okRules.some((r) => noneApplies(r, category))) basis = 'none';
    if (category === 'requiredCourses' && ctx?.role === 'minor'
      && !okRules.some((r) => r.departmentId && !noneApplies(r, category))) basis = 'none';

    const notes = rowEvals.filter((e) => e.cls !== 'confirmed').map((e) => noteFrom(e, deptName));
    if (basis === 'none') for (const note of notes) note.notApplicable = true;
    // 학과 기준이 없을 때 학교 공통 '졸업시험 또는 논문 통과 필요'를 학과 줄에도 알린다 (세부 기준은 학과 확인)
    if (category === 'departmentAssessment' && basis === 'missing' && departmentId) {
      const common = evals.filter((e) => e.scope === 'common' && e.role === ctx?.role && e.cls === 'confirmed' && e.rule.type === 'assessmentRequired');
      if (common.length) notes.push({ kind: 'schoolCommonOnly', id: `${category}:${scope}:schoolCommonOnly`,
        title: '학과 졸업시험 또는 졸업논문 통과', displayReason: displayReasonFor('schoolCommonOnly'),
        text: '학교 기준상 졸업시험 또는 졸업논문을 통과해야 해요. 학과별 시험 과목·점수·대체 경로는 아직 제공되지 않아 학과 공지를 확인하세요.',
        ruleIds: common.map((e) => e.rule.id), sourceIds: [...new Set(common.flatMap((e) => e.rule.sourceIds))] });
    }
    // 학교 기본값으로만 '없음'이면 확정으로 끝내지 않고 학과 확인 안내를 붙인다 (학과가 명시한 '없음'이 있으면 생략)
    if (basis === 'none') {
      const noneRules = okRules.filter((r) => noneApplies(r, category));
      if (noneRules.every((r) => r.none?.departmentMayImpose)) {
        notes.push({ kind: 'schoolDefault', id: `${category}:${scope}:schoolDefault`,
          title: '학과 졸업시험·논문 부과 여부', displayReason: displayReasonFor('schoolDefault', noneRules[0]),
          text: '학교 편람상 졸업시험·논문 의무는 1전공·이중전공에만 있어요. 학과가 부전공에도 부과할 수 있으니 학과 공지를 확인하세요.',
          ruleIds: noneRules.map((r) => r.id), sourceIds: [...new Set(noneRules.flatMap((r) => r.sourceIds))] });
      }
    }
    if (basis === 'missing') {
      for (const e of gradOnly) {
        const terms = [...condValues(e.rule.condition!, 'graduationTerm')].join(', ');
        notes.push({ kind: 'gap', id: e.rule.id, title: titleOf(e.rule), displayReason: displayReasonFor('gap', e.rule),
          text: `${titleOf(e.rule)} — 공개된 기준은 ${terms} 졸업에만 명시돼 있어, 입력한 졸업 예정 학기(${grad})에는 적용 근거가 아직 없어요`, ruleIds: [e.rule.id], sourceIds: e.rule.sourceIds });
      }
    }
    if (category === 'credits') {
      for (const c of resolved?.conflicts ?? []) notes.push({ kind: 'conflict', id: `${category}:${scope}:conflict:${c}`,
        title: c, displayReason: displayReasonFor('conflict'), text: `규정 값이 서로 달라 보류: ${c}`, ruleIds: [], sourceIds: [] });
    }
    if (category === 'requiredCourses') {
      for (const r of okRules) {
        if (r.courses && r.listCompleteness !== 'completeForStatedScope') {
          notes.push({ kind: 'partialList', id: `${r.id}:partialList`, title: titleOf(r), displayReason: displayReasonFor('partialList', r),
            text: `${titleOf(r)} — 원문 목록이 전체 목록인지 확인되지 않음 (${r.listCompleteness ?? '완전성 미표기'})`, ruleIds: [r.id], sourceIds: r.sourceIds });
        }
      }
    }
    if (departmentId) {
      for (const g of supportGaps) {
        if (g.departmentId !== departmentId || g.category !== category) continue;
        if (g.entryTypes && !g.entryTypes.includes(profile.entryType)) continue;
        if (g.majorRoles && !g.majorRoles.includes(ctx?.role ?? '')) continue;
        notes.push({ kind: 'gap', id: `gap:${departmentId}:${category}:${notes.length}`, title: g.reason,
          displayReason: displayReasonFor('gap'), text: g.reason, ruleIds: [], sourceIds: [] });
      }
    }
    rows.push({ category, scope, departmentId, basis, notes, determinable: basis !== 'missing' && notes.length === 0 });
  };

  rowFor('credits', 'common');
  rowFor('languageCertification', 'common');
  for (const ctx of ctxs) {
    rowFor('requiredCourses', ctx.scope, ctx.departmentId);
    rowFor('departmentAssessment', ctx.scope, ctx.departmentId);
  }

  const researchComplete = ctxs.every((c) => meta(c.departmentId)?.requirementsComplete === true);
  return {
    evals,
    questions: buildQuestions(evals, rules, usedDefaults),
    resolved,
    courseRules: [...confirmed, ...conservative].filter((e) => !!e.rule.courses),
    items: confirmed.filter((e) => !e.rule.courses && !isCreditRule(e.rule)
      && e.rule.type !== 'requiredCoursePolicy'
      && !(e.scope === 'common' && e.rule.type === 'assessmentRequired'
        && (confirmed.some((d) => d.rule.departmentId && d.role === e.role && coreOf(d.rule) === 'departmentAssessment')
          || matchedBundles.some((b) => b.scope === (e.role === 'primary' ? 'primary' : 'secondary') && b.certifications.length > 0)))).map((e) => ({
      ...e, rule: { ...e.rule, detail: detailForGraduation(e.rule.detail, e.facts.graduationMonthIndex) },
    })),
    coverage: rows,
    researchComplete,
    canDetermineGraduation: researchComplete && rows.every((r) => r.determinable),
  };
}

// ---- 필수과목 식 평가 ----

export type LeafState = 'met' | 'substituted' | 'nameMatched' | 'waived' | 'studentLinked' | 'selfConfirmed' | 'unmet';

const ROMAN: Record<string, string> = { 'Ⅰ': '1', 'Ⅱ': '2', 'Ⅲ': '3', 'Ⅳ': '4', 'Ⅴ': '5' };
/**
 * 과목명·학과명 대조용 정규화. 같은 과목이 성적표와 규정에서 다르게 적히는 것만 맞춘다.
 * 1) 끝에 붙은 영문 과목명 "(Example Subject)" 제거 2) 로마숫자 ⅠⅡ… → 1, 2
 * 3) NFKC로 전각 괄호·숫자를 반각으로 4) 구분점 . ･ · ・ ㆍ 통일 5) 괄호·공백 제거
 */
export const normalizeCourseName = (s: string) => s
  .normalize('NFC')
  // 공백 뒤의 마지막 괄호 묶음만 제거한다. 안쪽 괄호는 한 단계만 허용한다.
  .replace(/\s+\((?:[^()]|\([^()]*\))*\)\s*$/, (suffix) => /[A-Za-z]/.test(suffix) ? '' : suffix)
  .replace(/[Ⅰ-Ⅴ]/g, (m) => ROMAN[m])
  .normalize('NFKC')
  // NFKC가 ㆍ(U+318D)를 ᆞ(U+119E)로 바꾸므로 둘 다 넣는다
  .replace(/[.·・･ㆍᆞ‧]/g, '.')
  .replace(/[()\[\]]/g, '')
  .replace(/\s+/g, '')
  .toLowerCase();
export interface NodeProgress {
  node: CourseExpr;
  /** 2 = 공식 충족, 1 = 학생 연결 포함 충족, 0 = 미충족 */
  level: 0 | 1 | 2;
  /** 택일 묶음에서 이미 충족돼 확인하지 않은 항목 */
  skipped?: boolean;
  state?: LeafState;
  courseId?: string;
  children?: NodeProgress[];
}
export interface CourseRuleProgress {
  eval: RuleEval;
  root: NodeProgress;
  status: 'met' | 'studentConfirmed' | 'unmet' | 'insufficient';
}

/** 학생이 직접 연결·확인해서 충족된 상태 (내부 값은 그대로 두고 화면에서만 ✓로 합친다) */
const SELF_CHECKED: ReadonlySet<LeafState> = new Set<LeafState>(['studentLinked', 'selfConfirmed']);

/**
 * 요건 한 줄의 화면 표시. 기호는 두 가지만 쓴다.
 * - ○ 미이수 / ✓ 이수 (코드·대체·이름 일치·학생 확인을 모두 ✓로 합친다)
 * selfChecked = 학생이 직접 체크한 줄 (✓ 뒤에 '· 내가 체크'를 붙인다)
 */
export function leafDisplay(p: NodeProgress): { mark: '○' | '✓'; selfChecked: boolean } {
  if (p.level === 0) return { mark: '○', selfChecked: false };
  return { mark: '✓', selfChecked: !!p.state && SELF_CHECKED.has(p.state) };
}

const parseTerm = (s: string): Term => ({ academicYear: Number(s.slice(0, 4)), semester: s.slice(5) as Term['semester'] });

export interface CourseMatchContext {
  /** 기존 필수 묶음에서 이미 쓴 과목 (한 과목은 한 요건에만 쓴다) */
  alreadyUsed?: Iterable<string>;
  /** 학과 ID → 학과명·별칭. 코드 없는 요건을 '개설학과 + 과목명'으로 대조할 때 쓴다. */
  dept?: (id: string) => Pick<Department, 'name' | 'aliases'> | undefined;
  /** 학생이 '이수함(직접 확인)'만 체크한 요건(leaf) ID */
  confirmedLeafIds?: Iterable<string>;
}

/**
 * 확정된 필수과목 규칙을 이수 내역과 대조한다.
 * - 코드가 있는 요건: 공식 코드 또는 조건이 맞는 대체 관계로만 충족 (✓).
 * - 코드가 없는 요건(matching: studentConfirmation): 성적의 개설학과가 그 전필의 학과와 같고
 *   정규화한 과목명이 같으면 자동 이수 (이름 일치). 이름만 비슷한 과목은 쓰지 않는다.
 * - 그래도 미이수면 학생이 직접 연결(studentLinked)하거나 '이수함'만 체크(selfConfirmed)할 수 있다 (✓).
 */
export function evaluateCourseRules(
  report: OfficialReport, courses: Course[], snapshot: AcademicSnapshot | null, ctx: CourseMatchContext = {},
): CourseRuleProgress[] {
  const { alreadyUsed = [], dept, confirmedLeafIds = [] } = ctx;
  const selfConfirmed = new Set(confirmedLeafIds);
  const deptKey = (id: string) => {
    const d = dept?.(id);
    return new Set(d ? [d.name, ...d.aliases].map(normalizeCourseName) : []);
  };
  const earned = effectiveCourses(courses).filter((c) => c.earnedInclusion === 'included');
  const useReported = !!snapshot && !snapshot.completeness.courses && snapshot.completeness.earnedTotals;
  const hasRecords = courses.length > 0 || !!snapshot;
  const confirmedIds = new Set(report.evals.filter((e) => e.cls === 'confirmed').map((e) => e.rule.id));
  const subs = report.evals.filter((e) => e.cls === 'confirmed' && e.rule.substitutions)
    .flatMap((e) => e.rule.substitutions!.map((s) => ({ ...s, departmentId: e.rule.departmentId, eval: e })));
  // 수강 학기 조건이 붙은 대체 관계는 대체 과목을 실제로 들은 학기로 판정한다
  const subAppliesTo = (e: RuleEval, c: Course) =>
    !e.perCourse || evalCond(e.rule.condition!, { ...e.facts, courseEnrollmentTerm: termKey(c.term) }).value === true;
  let used = new Set(alreadyUsed);

  // 개설학과 칸이 없던 시절에 저장한 성적: 이수구분(1전공·이중전공·부전공)이 규칙의 역할과 같으면 그 학과 과목으로 본다
  const AREA_OF_ROLE: Record<MajorRole, CreditArea> = { primary: 'primary', dual: 'double', minor: 'minor' };
  const fromSameDepartment = (c: Course, departmentId: string, role: MajorRole) =>
    (c.offeringDepartmentName ? deptKey(departmentId).has(normalizeCourseName(c.offeringDepartmentName)) : c.area === AREA_OF_ROLE[role]);

  const matchLeaf = (leaf: CourseLeaf, departmentId: string | null, allowStudent: boolean, role: MajorRole): NodeProgress => {
    if (leaf.waiverRuleIds?.some((id) => confirmedIds.has(id))) return { node: leaf, level: 2, state: 'waived' };
    const take = (c: Course | undefined, state: LeafState, level: 1 | 2): NodeProgress | null =>
      c ? (used.add(c.id), { node: leaf, level, state, courseId: c.id }) : null;
    const free = earned.filter((c) => !used.has(c.id));
    if (leaf.code) {
      const direct = take(free.find((c) => c.officialCode === leaf.code), 'met', 2);
      if (direct) return direct;
      const rel = subs.filter((s) => (s.departmentId === null || s.departmentId === departmentId) && s.from.includes(leaf.code!));
      const viaSub = free.find((c) => c.officialCode && rel.some((s) => s.to.includes(c.officialCode!)
        && (!s.fromTerm || compareTerms(c.term, parseTerm(s.fromTerm)) >= 0) && subAppliesTo(s.eval, c)));
      const sub = take(viaSub, 'substituted', 2);
      if (sub) return sub;
    }
    // 코드가 없는 요건: 개설학과가 같고 정규화한 과목명이 같으면 자동 이수
    if (!leaf.code && departmentId) {
      const names = [leaf.name, ...(leaf.identicalNames ?? [])].map(normalizeCourseName);
      const byName = free.find((c) => fromSameDepartment(c, departmentId, role) && names.includes(normalizeCourseName(c.name)));
      const hit = take(byName, 'nameMatched', 2);
      if (hit) return hit;
    }
    if (allowStudent) {
      const linked = take(free.find((c) => c.requirementLinks?.includes(leaf.id)), 'studentLinked', 1);
      if (linked) return linked;
      // 성적표에 없는 과목: 학점은 더하지 않고 '이수함(직접 확인)'만 기록
      if (selfConfirmed.has(leaf.id)) return { node: leaf, level: 1, state: 'selfConfirmed' };
    }
    return { node: leaf, level: 0, state: 'unmet' };
  };

  const evalNode = (n: CourseExpr, departmentId: string | null, allowStudent: boolean, role: MajorRole): NodeProgress => {
    if (n.op === 'course') return matchLeaf(n, departmentId, allowStudent, role);
    if (n.op === 'ALL') {
      const children = n.items.map((c) => evalNode(c, departmentId, allowStudent, role));
      return { node: n, children, level: Math.min(...children.map((c) => c.level)) as 0 | 1 | 2 };
    }
    // 택일·n과목 이상: 요구량만큼만 과목을 쓴다. 공식 충족을 먼저 찾고, 모자랄 때만 학생 연결을 본다.
    const need = n.op === 'AT_LEAST' ? n.count : 1;
    const children: (NodeProgress | null)[] = n.items.map(() => null);
    for (const pass of allowStudent ? [false, true] : [false]) {
      for (let i = 0; i < n.items.length; i++) {
        if (children.filter((c) => c && c.level > 0).length >= need) break;
        if (children[i]?.level) continue;
        const before = new Set(used);
        const r = evalNode(n.items[i], departmentId, pass, role);
        if (r.level === 0) used = before; // 실패한 갈래가 과목을 점유하지 않게 되돌린다
        children[i] = r;
      }
    }
    const done = children.map((c, i) => c ?? { node: n.items[i], level: 0 as const, skipped: true });
    const official = done.filter((c) => c.level === 2).length;
    const any = done.filter((c) => c.level > 0).length;
    return { node: n, children: done, level: official >= need ? 2 : any >= need ? 1 : 0 };
  };

  return report.courseRules.map((e) => {
    const root = evalNode(e.rule.courses!, e.rule.departmentId, true, e.role);
    const status = root.level === 2 ? 'met' : root.level === 1 ? 'studentConfirmed' : useReported || !hasRecords ? 'insufficient' : 'unmet';
    return { eval: e, root, status };
  });
}

/** 과목 편집기에서 학생이 직접 연결할 수 있는 필수과목 요건 목록 */
export function linkableLeaves(report: OfficialReport | null, deptName?: (id: string) => string): { leaf: CourseLeaf; ruleTitle: string }[] {
  const out: { leaf: CourseLeaf; ruleTitle: string }[] = [];
  const walk = (n: CourseExpr, title: string) => {
    if (n.op === 'course') out.push({ leaf: n, ruleTitle: title });
    else n.items.forEach((c) => walk(c, title));
  };
  for (const e of report?.courseRules ?? []) walk(e.rule.courses!, ruleTitle(e.rule, e.rule.departmentId ? deptName?.(e.rule.departmentId) : undefined));
  return out;
}

/**
 * 과목명으로 연결할 수 있는 필수과목 요건을 찾는다 (과목 편집기의 '전공필수예요' 체크에 쓴다).
 * 대조 기준은 normalizeCourseName 하나뿐이다. 이름이 비슷한 과목은 찾지 않는다.
 * 정확히 하나면 자동 연결, 여럿이면 학생이 고르고, 없으면 연결하지 않는다.
 */
export function autoLinkTargets(
  report: OfficialReport | null, courseName: string, deptName?: (id: string) => string,
): { leaf: CourseLeaf; ruleTitle: string }[] {
  const key = normalizeCourseName(courseName.trim());
  if (!key) return [];
  const seen = new Set<string>();
  return linkableLeaves(report, deptName).filter(({ leaf }) => {
    if (seen.has(leaf.id)) return false;
    const names = [leaf.name, ...(leaf.identicalNames ?? [])].map(normalizeCourseName);
    if (!names.includes(key)) return false;
    seen.add(leaf.id);
    return true;
  });
}

// ---- 규칙별 앱 지원 분류 (학생과 무관한 정적 분류, 보고·검사용) ----

/** 학생 조건 선택(캠퍼스·학번·입학유형·전공 구성)과 카탈로그에서 바로 정해지는 조건 필드 */
const PROFILE_FIELDS = new Set([
  'homeCampus', 'cohortYear', 'entryType', 'programComposition', 'primaryDepartmentId', 'majorRole', 'departmentId',
  'departmentCampus', 'primaryMajorName', 'dualMajorCollege', ...PER_COURSE_FIELDS,
]);
export type SupportClass = 'usable' | 'usableWithInput' | 'unsupported';
export type UsageKind = 'credits' | 'courses' | 'none' | 'substitution' | 'item';

export function classifyRuleSupport(rule: OfficialRule): {
  cls: SupportClass; usage: UsageKind; inputFields: string[]; unsupportedFields: string[]; blockers: string[];
} {
  const fields = new Set<string>();
  const blockers: string[] = [];
  const walk = (c: NonNullable<OfficialRule['condition']>) => {
    if (c.op === 'AND' || c.op === 'OR') c.conditions.forEach(walk);
    else if (c.op === 'NOT') walk(c.condition);
    else if (c.op === 'unknown') blockers.push(c.reason ?? '원문 미확정 조건');
    else if ('field' in c) fields.add(c.field);
  };
  if (rule.condition) walk(rule.condition);
  const extra = [...fields].filter((f) => !PROFILE_FIELDS.has(f));
  const inputFields = [...new Set(extra.map(askableFieldFor).filter((f): f is string => !!f))];
  const unsupportedFields = extra.filter((f) => !askableFieldFor(f));
  // OR의 한 경로가 입력으로 판정 가능하면 전체 규칙을 미지원으로 분류하지 않는다.
  const supportedPath = (c: NonNullable<OfficialRule['condition']>): boolean => {
    if (c.op === 'unknown') return false;
    if (c.op === 'AND') return c.conditions.every(supportedPath);
    if (c.op === 'OR') return c.conditions.some(supportedPath);
    if (c.op === 'NOT') return supportedPath(c.condition);
    return !('field' in c) || PROFILE_FIELDS.has(c.field) || !!askableFieldFor(c.field);
  };
  const usage: UsageKind = isCreditRule(rule) ? 'credits' : rule.courses ? 'courses' : rule.none ? 'none'
    : rule.substitutions ? 'substitution' : 'item';
  const cls: SupportClass = rule.condition && !supportedPath(rule.condition) ? 'unsupported' : inputFields.length ? 'usableWithInput' : 'usable';
  return { cls, usage, inputFields, unsupportedFields, blockers };
}

/** 이중·부전공 선택 제한 (캠퍼스 간 제한, 부전공 불가 학과). 제한이 없으면 null. */
export function secondaryRestriction(
  meta: DepartmentMeta | undefined, departmentCampus: string | undefined, role: 'dual' | 'minor',
  p: Pick<StudentProfile, 'homeCampus' | 'cohortYear'>,
): string | null {
  for (const r of meta?.roleRestrictions ?? []) {
    if (!r.roles.includes(role)) continue;
    if ((r.cohortFrom !== null && p.cohortYear < r.cohortFrom) || (r.cohortTo !== null && p.cohortYear > r.cohortTo)) continue;
    if (r.condition === 'crossCampus') { if (departmentCampus !== p.homeCampus) return r.reason; continue; }
    if (r.condition === null) return r.reason;
  }
  return null;
}
