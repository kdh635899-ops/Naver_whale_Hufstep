// 졸업요건 규칙 선택·결합(§5.2)과 이수 현황 평가(§3.4). 학교 규칙은 JSON 데이터로만 들어온다.
import { effectiveCourses } from '../gpa/gpa';
import type {
  AcademicSnapshot, BundleScope, CertificationRequirement, CommonRequirement, Course, CourseEquivalence,
  CreditArea, RequiredCourseGroup, RequirementBundle, StudentProfile, Verification,
} from '../types';

export type ReqStatus = 'met' | 'unmet' | 'insufficient' | 'notApplicable';

export interface ResolvedRequirements {
  verification: Verification;
  bundleIds: string[];
  totalRequiredUnits: number | null;
  requiredUnitsByArea: Partial<Record<CreditArea, number>>;
  groups: { scope: BundleScope; group: RequiredCourseGroup }[];
  certifications: { scope: BundleScope; cert: CertificationRequirement }[];
  commonRequirements: CommonRequirement[];
  allowCourseReuseAcrossGroups: boolean;
  /** 서로 다른 규칙이 같은 값을 다르게 요구해 판단을 보류한 항목 */
  conflicts: string[];
  /** 전공 구성상 필요한데 제공되지 않은 규칙 범위 */
  missingScopes: BundleScope[];
  sourceIds: string[];
}

function applies(b: RequirementBundle, p: StudentProfile, today?: string): boolean {
  const a = b.applicability;
  if (a.homeCampus !== p.homeCampus) return false;
  if (p.cohortYear < a.cohortFrom || p.cohortYear > a.cohortTo) return false;
  if (!a.entryTypes.includes(p.entryType) || !a.programTypes.includes(p.programType)) return false;
  if (today && ((a.effectiveFrom && today < a.effectiveFrom) || (a.effectiveTo && today > a.effectiveTo))) return false;
  if (b.scope === 'primary') return a.primaryDepartmentIds.includes(p.primaryDepartmentId);
  if (b.scope === 'secondary') {
    return !!p.secondaryDepartmentId && !!a.secondaryDepartmentIds?.includes(p.secondaryDepartmentId)
      && (a.primaryDepartmentIds.length === 0 || a.primaryDepartmentIds.includes(p.primaryDepartmentId));
  }
  return a.primaryDepartmentIds.length === 0 || a.primaryDepartmentIds.includes(p.primaryDepartmentId);
}

/** 학생 조건에 정확히 맞는 묶음만 고른다. allowed: 실제 모드 ['verified'], 데모 모드 ['demo'] — 섞지 않는다. */
export const selectBundles = (profile: StudentProfile, bundles: RequirementBundle[], allowed: Verification[], today?: string) =>
  bundles.filter((b) => allowed.includes(b.status) && applies(b, profile, today));

/** 결합에 필요한 부분만 (조건식 규칙에서 만든 학점 조각도 같은 방식으로 결합한다) */
export type CombinablePart = Pick<RequirementBundle,
  'id' | 'status' | 'scope' | 'totalRequiredUnits' | 'requiredUnitsByArea' | 'requiredCourseGroups'
  | 'certifications' | 'commonRequirements' | 'allowCourseReuseAcrossGroups' | 'sourceIds'>;

/**
 * 학생 조건에 맞는 규칙 묶음을 고르고 의미별로 결합한다.
 * - 같은 값을 다르게 요구하면 덮어쓰지 않고 충돌로 남긴다. 주전공·이중전공 총학점을 더하지 않는다.
 * 맞는 규칙이 하나도 없으면 null (= 현재 조건의 졸업 기준 미제공).
 */
export function resolveRequirements(
  profile: StudentProfile, bundles: RequirementBundle[], allowed: Verification[], today?: string,
): ResolvedRequirements | null {
  return combineParts(profile, selectBundles(profile, bundles, allowed, today));
}

export function combineParts(profile: StudentProfile, matched: CombinablePart[]): ResolvedRequirements | null {
  if (!matched.length) return null;

  const conflicts: string[] = [];
  const totals = [...new Set(matched.map((b) => b.totalRequiredUnits).filter((v): v is number => v !== null))];
  if (totals.length > 1) conflicts.push('졸업 총학점');

  const byArea: Partial<Record<CreditArea, number>> = {};
  const areaValues = new Map<CreditArea, Set<number>>();
  for (const b of matched) {
    for (const [area, v] of Object.entries(b.requiredUnitsByArea) as [CreditArea, number][]) {
      if (!areaValues.has(area)) areaValues.set(area, new Set());
      areaValues.get(area)!.add(v);
    }
  }
  for (const [area, set] of areaValues) {
    if (set.size === 1) byArea[area] = [...set][0];
    else conflicts.push(`${area} 영역 학점`);
  }

  const scopes = new Set(matched.map((b) => b.scope));
  const missingScopes: BundleScope[] = [];
  if (!scopes.has('primary')) missingScopes.push('primary');
  if (profile.secondaryDepartmentId && !scopes.has('secondary')) missingScopes.push('secondary');

  return {
    verification: matched.every((b) => b.status === 'verified') ? 'verified' : matched[0].status,
    bundleIds: matched.map((b) => b.id),
    totalRequiredUnits: totals.length === 1 ? totals[0] : null,
    requiredUnitsByArea: byArea,
    groups: matched.flatMap((b) => b.requiredCourseGroups.map((group) => ({ scope: b.scope, group }))),
    certifications: matched.flatMap((b) => b.certifications.map((cert) => ({ scope: b.scope, cert }))),
    commonRequirements: matched.flatMap((b) => b.commonRequirements),
    // 규정에 명시된 경우에만 중복 사용 허용 — 하나라도 금지하면 금지
    allowCourseReuseAcrossGroups: matched.every((b) => b.allowCourseReuseAcrossGroups === true),
    conflicts,
    missingScopes,
    sourceIds: [...new Set(matched.flatMap((b) => b.sourceIds))],
  };
}

export interface AreaProgress { area: CreditArea; earned: number; required?: number; shortfall?: number; status: ReqStatus }
export interface GroupProgress {
  scope: BundleScope; group: RequiredCourseGroup; matchedCourseIds: string[]; matchedCount: number;
  matchedUnits: number; status: ReqStatus;
}
export interface Progress {
  hasRecords: boolean;
  /** 'courses' = 과목 목록 합, 'reportedTotals' = 종정시 하단 합계 기준 (과목 목록 불완전) */
  basis: 'courses' | 'reportedTotals' | 'none';
  total: { earned: number; required: number | null; remaining: number | null; status: ReqStatus };
  areas: AreaProgress[];
  groups: GroupProgress[];
  studentMarkedCourseIds: string[];
}

function expandCode(code: string, eq: CourseEquivalence[]): string[] {
  const out = new Set([code]);
  for (const e of eq) {
    if (e.fromCodes.includes(code)) e.toCodes.forEach((c) => out.add(c));
    if (e.direction === 'bidirectional' && e.toCodes.includes(code)) e.fromCodes.forEach((c) => out.add(c));
  }
  return [...out];
}

export function evaluateProgress(
  resolved: ResolvedRequirements | null,
  courses: Course[],
  snapshot: AcademicSnapshot | null,
  equivalences: CourseEquivalence[] = [],
): Progress {
  const earnedCourses = effectiveCourses(courses).filter((c) => c.earnedInclusion === 'included');
  const hasRecords = courses.length > 0 || !!snapshot;

  // 취득학점 집계 기준 결정 (§6.3): 과목 목록이 불완전하고 하단 합계가 온전하면 합계를 쓴다
  const useReported = !!snapshot && !snapshot.completeness.courses && snapshot.completeness.earnedTotals;
  const earnedByArea: Partial<Record<CreditArea, number>> = {};
  let totalEarned = 0;
  const add = (a: CreditArea, u: number) => { earnedByArea[a] = (earnedByArea[a] ?? 0) + u; totalEarned += u; };
  if (useReported) {
    for (const [a, u] of Object.entries(snapshot!.reportedEarnedByArea) as [CreditArea, number][]) {
      earnedByArea[a] = u;
    }
    totalEarned = snapshot!.reportedTotalEarnedUnits
      ?? Object.values(snapshot!.reportedEarnedByArea).reduce((s, u) => s + (u ?? 0), 0);
    // 합계 이후 학생이 직접 추가한 과목만 더한다 (합계에 이미 들어간 가져온 과목은 다시 더하지 않음)
    const inSnapshot = new Set(snapshot!.courseIds);
    for (const c of earnedCourses) if (c.origin !== 'paste' && !inSnapshot.has(c.id)) add(c.area, c.creditUnits);
  } else {
    for (const c of earnedCourses) add(c.area, c.creditUnits);
  }

  const required = resolved?.totalRequiredUnits ?? null;
  const total = {
    earned: totalEarned,
    required,
    remaining: required === null ? null : Math.max(0, required - totalEarned),
    status: (required === null ? 'notApplicable' : totalEarned >= required ? 'met' : 'unmet') as ReqStatus,
  };

  // 영역별: 총학점과 따로 판단. 다른 영역 초과분으로 부족분을 상쇄하지 않는다.
  const areaSet = new Set<CreditArea>([
    ...(Object.keys(resolved?.requiredUnitsByArea ?? {}) as CreditArea[]),
    ...(Object.keys(earnedByArea) as CreditArea[]).filter((a) => (earnedByArea[a] ?? 0) > 0),
  ]);
  const areas: AreaProgress[] = [...areaSet].map((area) => {
    const earned = earnedByArea[area] ?? 0;
    const req = resolved?.requiredUnitsByArea[area];
    if (req === undefined) return { area, earned, status: 'notApplicable' };
    return { area, earned, required: req, shortfall: Math.max(0, req - earned), status: earned >= req ? 'met' : 'unmet' };
  });

  // 필수과목: 공식 코드(+검증된 동일과목)로만 매칭. 이름 유사도로 확정하지 않는다.
  const reuse = resolved?.allowCourseReuseAcrossGroups ?? false;
  const used = new Set<string>();
  const groups: GroupProgress[] = (resolved?.groups ?? []).map(({ scope, group }) => {
    const acceptable = new Set(group.acceptableCourseCodes.flatMap((code) => expandCode(code, equivalences)));
    const candidates = earnedCourses.filter((c) => c.officialCode && acceptable.has(c.officialCode) && (reuse || !used.has(c.id)));
    const needCount = group.minCount ?? 1;
    const needUnits = group.minCreditUnits ?? 0;
    const picked: Course[] = [];
    let units = 0;
    for (const c of candidates) {
      if (picked.length >= needCount && units >= needUnits) break; // 대체 과목을 여러 개 들어도 요구량만 사용
      picked.push(c);
      units += c.creditUnits;
    }
    if (!reuse) picked.forEach((c) => used.add(c.id));
    const met = picked.length >= needCount && units >= needUnits;
    return {
      scope, group, matchedCourseIds: picked.map((c) => c.id), matchedCount: picked.length, matchedUnits: units,
      status: met ? 'met' : useReported || !hasRecords ? 'insufficient' : 'unmet',
    };
  });

  return {
    hasRecords,
    basis: !hasRecords ? 'none' : useReported ? 'reportedTotals' : 'courses',
    total,
    areas,
    groups,
    // 학생이 '필수'로 표시한 과목은 확인 표시일 뿐, 학점을 따로 만들지 않는다
    studentMarkedCourseIds: courses.filter((c) => c.requiredClaim === 'studentMarked').map((c) => c.id),
  };
}
