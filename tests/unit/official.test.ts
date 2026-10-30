// 실제 배포 공식 데이터(official-rules.json·requirement-bundles.json)와 조건식 규칙 엔진 검사.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { catalog, departmentById, departmentFacts, departmentMetaById, loadList, type Rejected } from '../../src/data';
import { buildDemoState } from '../../src/data/demo';
import { condValues, evalCond, factsFor, roleContexts, type Cond } from '../../src/domain/requirements/conditions';
import {
  buildOfficialReport, classifyRuleSupport, courseConfirmationIds, detailForGraduation, evaluateCourseRules, normalizeCourseName, ruleTitle, secondaryRestriction, type OfficialReport,
} from '../../src/domain/requirements/officialRules';
import { evaluateProgress, resolveRequirements } from '../../src/domain/requirements/resolve';
import { appStateSchema, bundleSchema, officialRuleSchema, profileSchema } from '../../src/domain/validation/schemas';
import type { CourseExpr, CourseLeaf, OfficialRule, StudentProfile } from '../../src/domain/types';
import { course } from '../fixtures';
import { correctTermScope, periodBound, type EffectivePeriod } from '../../scripts/term-scope.mjs';

const T26_2 = { academicYear: 2026, semester: '2' as const };
const base: StudentProfile = {
  schemaVersion: 1, homeCampus: 'seoul', cohortYear: 2025, entryType: 'freshman',
  primaryDepartmentId: 'seoul-japanese-language-culture', programType: 'double', secondaryDepartmentId: 'seoul-business', currentTerm: T26_2,
};
const report = (p: StudentProfile, rules = catalog.officialRules) => buildOfficialReport({
  profile: p, bundles: catalog.bundles, rules, supportGaps: catalog.supportGaps, dept: departmentFacts, meta: departmentMetaById,
});
const rule = (id: string) => catalog.officialRules.find((r) => r.id === id)!;
/** 서울 2025 이중전공 공통 학점 규칙이 요구하는 답 (사범대학·특별전형 아님) */
const ANSWERS = { teacherTraining: false, pureForeignAdmission: false, studentCollegeAtEntry: null } as const;

describe('공식 데이터 연결', () => {
  it('전달본 규칙 수: 호환 15 / 조건 처리 656 / 조사 미확정 25 (제외 243), 호환 묶음 23 (2026-10-29 메일 반영)', () => {
    const by = (s: string) => catalog.officialRules.filter((r) => r.state === s).length;
    expect([by('compatible'), by('pending'), by('unconfirmed')]).toEqual([15, 656, 25]);
    expect(catalog.bundles).toHaveLength(23);
    expect(catalog.rejected).toEqual([]);
    expect(new Set(catalog.officialRules.map((r) => r.id)).size).toBe(catalog.officialRules.length);
  });
  it('조건 처리·미확정 규칙의 출처·학과 참조가 모두 존재', () => {
    const sources = new Set(catalog.sources.map((s) => s.id));
    const depts = new Set(catalog.departments.map((d) => d.id));
    const condDepts = (c: Cond, out: string[] = []): string[] => {
      if (c.op === 'AND' || c.op === 'OR') c.conditions.forEach((x) => condDepts(x, out));
      else if (c.op === 'NOT') condDepts(c.condition, out);
      else if ((c.op === 'eq' || c.op === 'in') && (c.field === 'departmentId' || c.field === 'primaryDepartmentId')) out.push(...(c.op === 'eq' ? [c.value] : c.values) as string[]);
      return out;
    };
    for (const r of catalog.officialRules) {
      for (const s of r.sourceIds) expect(sources, `${r.id} → ${s}`).toContain(s);
      if (r.departmentId) expect(depts, r.id).toContain(r.departmentId);
      if (r.condition) for (const d of condDepts(r.condition)) expect(depts, `${r.id} 조건 → ${d}`).toContain(d);
      for (const b of r.bundleIds ?? []) expect(catalog.bundles.map((x) => x.id)).toContain(b);
    }
    for (const g of catalog.supportGaps) expect(depts).toContain(g.departmentId);
    expect(catalog.departmentMeta.map((m) => m.id).sort()).toEqual(catalog.departments.map((d) => d.id).sort());
  });
  it('기존 학생 정보가 참조하는 학과 ID 4개와 데모 출처를 유지', () => {
    const ids = catalog.departments.map((d) => d.id);
    for (const id of ['seoul-malay-indonesian', 'seoul-business', 'seoul-german', 'seoul-japanese-language-culture']) expect(ids).toContain(id);
    expect(catalog.sources.find((s) => s.id === 'src-demo')?.status).toBe('demo');
  });
  it('학점은 ×100 정수 한 번만: 공통 2025 이중전공 총 126학점 = 12600, 200학점 초과 값 없음', () => {
    const r = rule('credits-seoul-2025-None-61d88-dualMajor');
    expect(r.totalRequiredUnits).toBe(12600);
    expect(r.requiredUnitsByArea).toEqual({ primary: 4200, double: 4200, liberalArts: 3200, foundation: 600 });
    for (const x of catalog.officialRules) for (const v of [x.totalRequiredUnits, ...Object.values(x.requiredUnitsByArea)]) if (v != null) expect(v).toBeLessThanOrEqual(20000);
    // 원문의 대시(비해당)는 0이 아니라 이유와 함께 비워 둔다
    expect(r.requiredUnitsByArea.minor).toBeUndefined();
    expect(r.areaNotes?.map((n) => n.area)).toEqual(expect.arrayContaining(['minor', 'teaching']));
  });
  it('지원하지 않는 조건 필드는 조용히 지우지 않고 규칙을 거절한다', () => {
    const rejected: Rejected[] = [];
    const good = rule('credits-seoul-2025-None-61d88-dualMajor');
    const extraField = { ...good, id: 'x1', condition: { op: 'eq', field: 'homeCampus', value: 'seoul', note: '추가 키' } };
    const extraTop = { ...good, id: 'x2', specialAdmissionOnly: true };
    const b = catalog.bundles[0];
    const extraBundle = { ...b, id: 'x3', applicability: { ...b.applicability, graduationTerm: '2026-2' } };
    expect(loadList('r.json', [good, extraField, extraTop], officialRuleSchema, rejected)).toHaveLength(1);
    expect(loadList('b.json', [extraBundle], bundleSchema, rejected)).toHaveLength(0);
    expect(rejected).toHaveLength(3);
  });
});

describe('변환 중 조건·필수과목 구조 보존 (데이터 프로젝트 원본과 대조)', () => {
  const MANIFEST = 'C:/Users/USER/Documents/Codex/2026-10-13/files-pasted-by-the-user-c/outputs/app-import/integration-manifest.json';
  it.skipIf(!existsSync(MANIFEST))('모든 활성 규칙의 조건식이 원본 정규화 조건(졸업 학기 교정 후)과 같고, 과목 잎·택일 구조가 같다', () => {
    const m = JSON.parse(readFileSync(MANIFEST, 'utf8')) as {
      records: {
        ruleId: string; deliveryState: string; reasons: string[];
        originalRecord: { requirement?: { type?: string }; sourceRequirement?: { type?: string }; effectivePeriod?: EffectivePeriod };
        stagedProjection?: { applicabilityCondition: Cond; requiredCourseExpression: unknown };
      }[];
    };
    const shape = (e: unknown): string => {
      const o = e as { op?: string; type?: string; count?: number; items?: unknown[]; courseCode?: string; code?: string };
      if (o.type === 'course' || o.op === 'course') return `c:${o.courseCode ?? o.code ?? '-'}`;
      return `${o.op}${o.count ?? ''}(${(o.items ?? []).map(shape).join(',')})`;
    };
    let checked = 0;
    for (const rec of m.records) {
      if (!['conditionProcessingPending', 'researchUnconfirmed'].includes(rec.deliveryState)) continue;
      const r = rule(rec.ruleId);
      const o = rec.originalRecord;
      const fixed = correctTermScope(rec.ruleId, (o.requirement ?? o.sourceRequirement)?.type, rec.stagedProjection!.applicabilityCondition, null, rec.reasons, o.effectivePeriod);
      if (rec.ruleId === 'a42-dis-exam') {
        expect(JSON.stringify(r.condition)).not.toContain('적용 학번을 원문에서 확정하지 못함');
        expect(r.sourceIds).toContain('src-mail-dis-20261026');
      } else expect(r.condition, rec.ruleId).toEqual(fixed.condition);
      const src = rec.stagedProjection!.requiredCourseExpression as { items?: unknown[] } | null;
      if (src?.items?.length) expect(shape(r.courses), rec.ruleId).toBe(shape(src));
      checked++;
    }
    expect(checked).toBe(681);
  });
  it('EICC 2025 세 영역 택일을 6과목 전부 필수로 바꾸지 않았다', () => {
    const b = catalog.bundles.find((x) => x.id === 'eicc-required-2025:import-2')!;
    expect(b.requiredCourseGroups.map((g) => [g.minCount, g.acceptableCourseCodes.length])).toEqual([[1, 2], [1, 2], [1, 2]]);
    const atLeast = (e: CourseExpr | undefined): number => (!e || e.op === 'course' ? 0 : (e.op === 'AT_LEAST' ? 1 : 0) + e.items.reduce((s, x) => s + atLeast(x), 0));
    expect(catalog.officialRules.reduce((s, r) => s + atLeast(r.courses), 0)).toBeGreaterThan(0);
  });
});

describe('조건 처리 656건: 각 기록의 앱 처리 방식이 정해져 있다', () => {
  it('바로 사용 / 학생 입력 시 사용 / 미지원(구체 이유) 중 하나', () => {
    const pending = catalog.officialRules.filter((r) => r.state === 'pending').map((r) => ({ r, k: classifyRuleSupport(r) }));
    const count = (c: string) => pending.filter((x) => x.k.cls === c).length;
    expect(count('usable') + count('usableWithInput') + count('unsupported')).toBe(656);
    // 실제 시행일·조항별 시작일을 반영한 정적 분류. LD 시행 전 소급은 답변 후에도 학교 확인이 필요할 수 있다.
    expect([count('usable'), count('usableWithInput'), count('unsupported')]).toEqual([229, 425, 2]);
    for (const { r, k } of pending.filter((x) => x.k.cls === 'unsupported')) {
      expect(k.blockers.length + k.unsupportedFields.length, r.id).toBeGreaterThan(0);
    }
    for (const { k } of pending.filter((x) => x.k.cls === 'usableWithInput')) expect(k.inputFields.length).toBeGreaterThan(0);
  });
});

describe('조건식 3값 평가', () => {
  const c: Cond = { op: 'AND', conditions: [{ op: 'range', field: 'cohortYear', min: 2019, max: 2026 }, { op: 'eq', field: 'teacherTraining', value: false }] };
  it('미입력은 false가 아니라 unknown, NOT(unknown)도 unknown', () => {
    expect(evalCond(c, { cohortYear: 2025 })).toMatchObject({ value: 'unknown', missing: ['teacherTraining'] });
    expect(evalCond({ op: 'NOT', condition: { op: 'eq', field: 'x', value: 1 } }, {}).value).toBe('unknown');
    expect(evalCond({ op: 'unknown', reason: '원문 미확정' }, {})).toMatchObject({ value: 'unknown', blockers: ['원문 미확정'] });
  });
  it('AND는 거짓 하나로, OR는 참 하나로 결정 (모르는 값이 있어도)', () => {
    expect(evalCond(c, { cohortYear: 2018 }).value).toBe(false);
    expect(evalCond({ op: 'OR', conditions: [{ op: 'eq', field: 'a', value: 1 }, { op: 'eq', field: 'b', value: 1 }] }, { b: 1 }).value).toBe(true);
  });
  it('2019·2026 경계는 포함, 2018·2027은 범위 밖 (학생 조건 스키마도 거절)', () => {
    for (const y of [2019, 2026]) expect(evalCond(c, { cohortYear: y, teacherTraining: false }).value).toBe(true);
    for (const y of [2018, 2027]) {
      expect(evalCond(c, { cohortYear: y, teacherTraining: false }).value).toBe(false);
      expect(profileSchema.safeParse({ ...base, cohortYear: y }).success).toBe(false);
    }
    expect(resolveRequirements({ ...base, cohortYear: 2019 }, catalog.bundles, ['verified'])?.bundleIds).toContain('common-gpa-seoul:import-1');
  });
  it('졸업 학기를 현재 학기로 복사하지 않고, 답이 있을 때만 학위수여 월을 계산', () => {
    const ctx = roleContexts(base)[0];
    expect('graduationTerm' in factsFor(base, ctx, departmentFacts)).toBe(false);
    const f = factsFor({ ...base, facts: { graduationTerm: '2026-2' } }, ctx, departmentFacts);
    expect([f.graduationMonthIndex, f.graduationMonth]).toEqual([202702, '2027-02']);
    expect(factsFor({ ...base, facts: { graduationTerm: '2027-1' } }, ctx, departmentFacts).graduationMonthIndex).toBe(202708);
  });
  it('전공 구성: 전공심화 단독과 전공심화+부전공을 구분', () => {
    const solo = factsFor({ ...base, programType: 'intensive', secondaryDepartmentId: undefined }, roleContexts(base)[0], departmentFacts);
    const withMinor = { ...base, programType: 'intensive' as const };
    expect(solo.programComposition).toBe('intensiveSingle');
    expect(factsFor(withMinor, roleContexts(withMinor)[1], departmentFacts)).toMatchObject({ programComposition: 'intensiveWithMinor', majorRole: 'minor' });
    expect(profileSchema.safeParse(withMinor).success).toBe(true);
    expect(profileSchema.safeParse({ ...base, programType: 'single' }).success).toBe(false);
  });
});

describe('실제 규칙 선택 (캠퍼스·학번·역할·입학유형)', () => {
  it('추가 입력이 없어도 기본값으로 126학점을 계산하고 직접 답변이 우선한다', () => {
    const before = report(base);
    expect(before.resolved?.totalRequiredUnits).toBe(12600);
    const credits = before.coverage.find((r) => r.category === 'credits')!;
    expect(credits.determinable).toBe(true);
    expect(credits.notes.some((n) => n.kind === 'needsInput')).toBe(false);
    expect(before.questions.filter((q) => ['teacherTraining', 'pureForeignAdmission', 'studentCollegeAtEntry'].includes(q.field))
      .every((q) => q.optional)).toBe(true);
    expect(before.questions.map((q) => q.field)).toEqual(expect.arrayContaining(['teacherTraining', 'pureForeignAdmission', 'studentCollegeAtEntry']));
    const after = report({ ...base, facts: { ...ANSWERS } });
    expect(after.resolved?.totalRequiredUnits).toBe(12600);
    expect(after.coverage.find((r) => r.category === 'credits')!.determinable).toBe(true);
    // 사범대학 입학생이라고 답하면 이 비사범대 규칙은 적용되지 않는다
    expect(report({ ...base, facts: { ...ANSWERS, studentCollegeAtEntry: '사범대학' } }).evals.map((e) => e.rule.id)).not.toContain('credits-seoul-2025-None-61d88-dualMajor');
  });
  it('캠퍼스·학번이 다르면 같은 학과라도 다른 규칙 (서울 2025 규칙이 2024·글로벌에 적용되지 않음)', () => {
    const ids = (p: StudentProfile) => report(p).evals.map((e) => e.rule.id);
    expect(ids({ ...base, facts: { ...ANSWERS } })).toContain('credits-seoul-2025-None-61d88-dualMajor');
    expect(ids({ ...base, cohortYear: 2024, facts: { ...ANSWERS } })).not.toContain('credits-seoul-2025-None-61d88-dualMajor');
    expect(ids({ ...base, homeCampus: 'global', facts: { ...ANSWERS } })).not.toContain('credits-seoul-2025-None-61d88-dualMajor');
  });
  it('일본언어문화학부: 주전공·이중전공·부전공 졸업평가 규칙이 역할별로 분리', () => {
    const bundlesOf = (p: StudentProfile) => report(p).resolved?.bundleIds ?? [];
    const asPrimary = bundlesOf({ ...base, facts: { ...ANSWERS } });
    expect(asPrimary).toContain('japanese-assessment-primary:import-1');
    expect(asPrimary).not.toContain('japanese-assessment-dual:import-1');
    const other = { ...base, primaryDepartmentId: 'seoul-business', secondaryDepartmentId: 'seoul-japanese-language-culture' };
    expect(bundlesOf(other)).toContain('japanese-assessment-dual:import-1');
    const minor = bundlesOf({ ...other, programType: 'minor' });
    expect(minor).toContain('japanese-minor-no-assessment:import-1');
    expect(minor).not.toContain('japanese-assessment-dual:import-1');
    const row = report({ ...other, programType: 'minor' }).coverage.find((r) => r.category === 'departmentAssessment' && r.scope === 'secondary')!;
    expect(row.basis).toBe('none'); // 원문에 '부전공 평가 없음' 명시 → 빈 배열과 구분
  });
  it('학과 평가 기준이 없으면 학교 공통 기준(시험 또는 논문)을 알리고, 학과 공개 연락처를 제공 (2026-10-25)', () => {
    const row = report({ ...base, primaryDepartmentId: 'seoul-d3bb7a1b77', facts: { ...ANSWERS } }) // 베트남어과
      .coverage.find((r) => r.category === 'departmentAssessment' && r.scope === 'primary')!;
    expect(row.basis).toBe('missing');
    expect(row.notes.map((n) => n.kind)).toContain('schoolCommonOnly');
    expect(departmentMetaById('seoul-d3bb7a1b77')?.contact).toMatchObject({ phone: '02-2173-2300', checkedAt: '2026-10-25' });
    const india = report({ ...base, primaryDepartmentId: 'seoul-df70041afa', facts: { ...ANSWERS } }) // 인도어과: 학과 기준 확보
      .coverage.find((r) => r.category === 'departmentAssessment' && r.scope === 'primary')!;
    expect(india.notes.map((n) => n.kind)).not.toContain('schoolCommonOnly');    // 모집 중지·사이트 없는 학과는 학교 대표 연락처와 사유
    expect(departmentMetaById('global-63230b5542')?.contact).toMatchObject({ phone: '031-330-4114', schoolMain: true });
    expect(departmentMetaById('global-63230b5542')?.contact?.note).toContain('2023학년도부터 폐지');
    expect(departmentMetaById('seoul-bb41508551')?.contact?.phone).toBe('02-2173-2312'); // 학교 문의 대상 학과도 연락처 보유
  });
  it('부전공 졸업평가: 학교 기본값만 있으면 학과 확인 안내, 학과가 없음을 명시하면 확정 (2026-10-25)', () => {
    const minorRow = (dept: string) => report({ ...base, primaryDepartmentId: 'seoul-business', secondaryDepartmentId: dept, programType: 'minor', facts: { ...ANSWERS } })
      .coverage.find((r) => r.category === 'departmentAssessment' && r.scope === 'secondary')!;
    const viet = minorRow('seoul-d3bb7a1b77'); // 베트남어과: 학과 명시 없음 → 학교 기본값
    expect(viet.basis).toBe('none');
    expect(viet.determinable).toBe(false);
    expect(viet.notes.map((n) => n.kind)).toContain('schoolDefault');
    const french = minorRow('seoul-1bd24d6f87'); // 프랑스어학부: 부전공인증 폐지 명시
    expect(french.basis).toBe('none');
    expect(french.notes.map((n) => n.kind)).not.toContain('schoolDefault');
    expect(minorRow('seoul-japanese-language-culture').notes.map((n) => n.kind)).not.toContain('schoolDefault');
  });
  it('입학유형: EICC 2025 필수과목은 편입생에게도 적용 (2026-10-25 편입생 안내 졸업자격: 필수과목 이수)', () => {
    const p = { ...base, primaryDepartmentId: 'seoul-cfafcf03e2', secondaryDepartmentId: 'seoul-business' };
    expect(resolveRequirements(p, catalog.bundles, ['verified'])?.bundleIds).toContain('eicc-required-2025:import-2');
    expect(resolveRequirements({ ...p, entryType: 'transferGeneral' }, catalog.bundles, ['verified'])?.bundleIds ?? []).toContain('eicc-required-2025:import-2');
  });
  it('편입생: 학과 전필이 적용되고 편입 전필 공백 안내는 없으며, 신입 특별전형 질문은 하지 않는다 (2026-10-25)', () => {
    const p: StudentProfile = { ...base, primaryDepartmentId: 'seoul-japanese-language-culture', programType: 'single', secondaryDepartmentId: undefined, cohortYear: 2025,
      entryType: 'transferBachelor', facts: { teacherTraining: false, pureForeignAdmission: false, studentCollegeAtEntry: '일본학대학', approvedRequiredCourseWaiver: false } };
    const rows = report(p).coverage;
    const req = rows.find((r) => r.category === 'requiredCourses' && r.scope === 'primary')!;
    expect(req.notes.map((n) => n.kind)).not.toContain('gap');
    expect(req.notes.flatMap((n) => n.text)).not.toContain('외국어 특기자');
    expect(rows.find((r) => r.category === 'credits')!.determinable).toBe(true);
  });
  describe('전필 면제 승인: 답이 없으면 "아니요"로 판정 (2026-10-25)', () => {
    const p: StudentProfile = { ...base, primaryDepartmentId: 'seoul-japanese-language-culture', programType: 'single', secondaryDepartmentId: undefined, cohortYear: 2025,
      entryType: 'transferBachelor', facts: { teacherTraining: false, pureForeignAdmission: false, studentCollegeAtEntry: '일본학대학' } };
    const row = (r: OfficialReport, category: string) => r.coverage.find((x) => x.category === category && x.scope === 'primary')!;

    it('미입력: 필수과목·졸업평가 줄이 확인됨이 되고(줄 아래 안내 없음), 질문은 선택 항목으로만 남는다', () => {
      const r = report(p);
      for (const cat of ['requiredCourses', 'departmentAssessment']) {
        expect(row(r, cat).determinable, cat).toBe(true);
        expect(row(r, cat).notes.map((n) => n.text).join(' '), cat).not.toMatch(/core-|추가 입력 필요/);
      }
      const q = r.questions.find((x) => x.field === 'approvedRequiredCourseWaiver');
      expect(q?.optional).toBe(true);
      expect(r.questions.filter((x) => !x.optional).map((x) => x.field)).not.toContain('approvedRequiredCourseWaiver');
    });
    it('직접 "아니요": 같은 판정이고 선택 질문은 없다', () => {
      const r = report({ ...p, facts: { ...p.facts, approvedRequiredCourseWaiver: false } });
      for (const cat of ['requiredCourses', 'departmentAssessment']) {
        expect(row(r, cat).determinable, cat).toBe(true);
      }
      expect(r.evals.map((e) => e.rule.id).sort()).toEqual(report(p).evals.map((e) => e.rule.id).sort());
      expect(r.questions.map((x) => x.field)).not.toContain('approvedRequiredCourseWaiver');
    });
    it('"예"(면제 승인): 면제 조건이 걸린 규칙은 적용되지 않는 기존 동작 그대로', () => {
      const usesWaiver = report(p).evals.filter((e) => e.fallbackFields.includes('approvedRequiredCourseWaiver')).map((e) => e.rule.id);
      expect(usesWaiver.length).toBeGreaterThan(0);
      const waived = report({ ...p, facts: { ...p.facts, approvedRequiredCourseWaiver: true } });
      for (const id of usesWaiver) expect(waived.evals.map((e) => e.rule.id), id).not.toContain(id);
      expect(waived.questions.map((x) => x.field)).not.toContain('approvedRequiredCourseWaiver');
    });
  });
  it('원문 제목이 없는 규칙(17건)은 내부 ID 대신 학과명 + 요건 종류로 표시', () => {
    const untitled = catalog.officialRules.filter((r) => !r.title);
    expect(untitled.length).toBe(17);
    for (const r of untitled) {
      const t = ruleTitle(r, departmentFacts(r.departmentId!)?.name);
      expect(t, r.id).not.toContain(r.id);
      expect(t, r.id).not.toMatch(/졸업 관련 규정/); // 제목 없는 규칙의 category는 모두 이름이 있다
    }
    expect(ruleTitle({ ...rule('core-malay-flex-primary'), title: undefined }, '말레이·인도네시아어과')).toBe('말레이·인도네시아어과 졸업 인증 기준');
  });
  it('학과 확인 후 말레이 2021 지역과지역학은 필수과목과 문의 안내에서 제외', () => {
    const p: StudentProfile = { ...base, primaryDepartmentId: 'seoul-malay-indonesian', cohortYear: 2021, facts: { ...ANSWERS, foreignLanguageSpecialAdmission: false, approvedRequiredCourseWaiver: false, graduationTerm: '2026-2' } };
    const r = report(p);
    const removed = r.evals.find((e) => e.rule.id === 'core-malay-regional-2021-scope-conflict')!;
    expect(removed.cls).toBe('confirmed');
    expect(removed.rule.courses).toBeUndefined();
    expect(r.courseRules.map((e) => e.rule.id)).not.toContain(removed.rule.id);
    expect(r.coverage.flatMap((x) => x.notes).some((n) => n.ruleIds.includes(removed.rule.id))).toBe(false);
  });
  describe('졸업 학기: 공지 게시 학기와 그 학기 한정 조건을 구분', () => {
    const malay = { ...base, primaryDepartmentId: 'seoul-malay-indonesian', cohortYear: 2024 };
    const ask = { ...ANSWERS, foreignLanguageSpecialAdmission: false, approvedRequiredCourseWaiver: false };
    const terms = (id: string) => [...condValues(rule(id).condition!, 'graduationTerm')];
    const monthRanges = (c: Cond, out: [number | null, number | null][] = []) => {
      if (c.op === 'AND' || c.op === 'OR') c.conditions.forEach((x) => monthRanges(x, out));
      else if (c.op === 'range' && c.field === 'graduationMonthIndex') out.push([c.min, c.max]);
      return out;
    };

    it('상시 필수과목: 2026-2 공지에서 왔어도 학번·전공 조건으로 선택되고, 이후 졸업 예정자도 제외하지 않는다', () => {
      for (const graduationTerm of [undefined, '2026-2', '2027-2', '2028-1']) {
        const r = report({ ...malay, facts: { ...ask, ...(graduationTerm && { graduationTerm }) } });
        const e = r.evals.find((x) => x.rule.id === 'core-malay-primary-2022-2026')!;
        expect([e.cls, e.askFields], graduationTerm).toEqual(['confirmed', []]);
        expect(r.courseRules.map((x) => x.rule.id), graduationTerm).toContain('core-malay-primary-2022-2026');
      }
      // 학번 범위(2022~2026) 밖이면 여전히 적용되지 않는다
      expect(report({ ...malay, cohortYear: 2021, facts: { ...ask } }).evals.map((e) => e.rule.id)).not.toContain('core-malay-primary-2022-2026');
    });
    it('어학 기준: 여러 학기 졸업 공지 목록(2021-2~2026-2)으로 상한을 두지 않는다', () => {
      expect(terms('dept-exam-elc-toeic805-flex721')).toEqual([]);
      expect(classifyRuleSupport(rule('dept-exam-elc-toeic805-flex721')).inputFields).not.toContain('graduationTerm');
    });
    it('원문이 밝힌 시작 학기는 하한으로만 남긴다 (2023-2 이후 → 2024년 2월 이후 졸업, 상한 없음)', () => {
      expect(monthRanges(rule('dept-exam-elc-added-tests-2023-2').condition!)).toEqual([[202402, null]]);
      // 이란 프로젝트의 시작일을 시험·논문 전체에 적용하지 않는다.
      expect(monthRanges(rule('department-candidate-7ff9150fe820').condition!)).toEqual([[null, null]]);
    });
    describe('중국언어문화 계열 논문 폐지: "본 요건은 2025년 9월 1일부터 폐지한다" (졸업요건규정 2026.1.15 개정 제2조3호)', () => {
      const removals = [
        ['seoul-f94625560c', 'chinese-pdf-thesis-removed-seoul-f94625560c'], // 중국언어문화학부
        ['seoul-5f6617f421', 'chinese-pdf-thesis-removed-seoul-5f6617f421'], // 중국언어문화전공
        ['seoul-70ffe9c6dd', 'chinese-pdf-thesis-removed-seoul-70ffe9c6dd'], // 차이나데이터큐레이션전공
      ] as const;
      const student = (dept: string, graduationTerm?: string): StudentProfile => ({
        ...base, primaryDepartmentId: dept, cohortYear: 2022, programType: 'single', secondaryDepartmentId: undefined,
        facts: graduationTerm ? { graduationTerm } : {},
      });
      const evalOf = (dept: string, id: string, g?: string) => report(student(dept, g)).evals.find((e) => e.rule.id === id);

      it('시행일은 학위수여월 하한(2025년 9월 이후)으로 남고, 자동으로 붙은 2026-2 조건은 없다', () => {
        expect(periodBound('2025-09-01', 'from')).toBe(202509);
        for (const [, id] of removals) {
          expect(monthRanges(rule(id).condition!), id).toEqual([[202509, null]]);
          expect(terms(id), id).toEqual([]);
        }
      });
      it('시행 전: 2025-1 졸업(2025년 8월 수여)은 폐지 규칙을 적용하지 않는다', () => {
        for (const [dept, id] of removals) expect(evalOf(dept, id, '2025-1'), id).toBeUndefined();
      });
      it('시행 후: 2025-2(2026년 2월 수여)부터 이후 졸업까지 폐지 규칙을 적용한다', () => {
        for (const [dept, id] of removals) {
          for (const g of ['2025-2', '2026-2', '2028-1']) expect(evalOf(dept, id, g)?.cls, `${id} ${g}`).toBe('confirmed');
        }
      });
      it('졸업 예정 학기를 모르면 적용·제외하지 않고 그 답만 묻는다', () => {
        for (const [dept, id] of removals) expect([evalOf(dept, id)?.cls, evalOf(dept, id)?.askFields], id).toEqual(['needsInput', ['graduationTerm']]);
      });
      it('졸업월로 떨어지지 않는 날짜(월 중간 시작, 날짜 종료)는 추측하지 않고 멈춘다', () => {
        expect(() => periodBound('2025-09-15', 'from')).toThrow();
        expect(() => periodBound('2026-08-31', 'through')).toThrow();
        expect(() => periodBound('2025-13-01', 'from')).toThrow();
        expect(() => periodBound('2025-00', 'through')).toThrow();
        expect([periodBound('2025-08', 'from'), periodBound('2024-2', 'from'), periodBound(null, 'through')]).toEqual([202508, 202502, null]);
      });
    });
    it('원문에서 추가 확인한 시행일은 게시 학기와 구분하고 시행 전·후·미입력을 검사', () => {
      const starts = [
        ['remaining-chinese-education-2016', 202503],
        ['extended-french-global-assessment-2016', 202108],
        ['extended-french-global-minor-exemption', 202108],
        ['extended-media-brand-required-removed', 202702],
        ['boundary-spanish-core-abolished-2017-2019', 202508],
        ['boundary-politics-current-exam', 202608],
        ['dept-gbt-project-pass-or-exam-primary', 202702],
      ] as const;
      for (const [id, start] of starts) {
        expect(monthRanges(rule(id).condition!), id).toEqual([[start, null]]);
        const range: Cond = { op: 'range', field: 'graduationMonthIndex', min: start, max: null };
        expect(evalCond(range, { graduationMonthIndex: start - 1 }).value, id).toBe(false);
        expect(evalCond(range, { graduationMonthIndex: start }).value, id).toBe(true);
        expect(evalCond(range, { graduationMonthIndex: 202902 }).value, id).toBe(true);
        expect(evalCond(range, {}).value, id).toBe('unknown');
      }
    });
    const withMonth = (id: string, graduationTerm: string) => {
      const r = rule(id);
      const p: StudentProfile = { ...base, homeCampus: r.departmentId!.startsWith('global') ? 'global' : 'seoul',
        primaryDepartmentId: r.departmentId!, programType: 'single', secondaryDepartmentId: undefined,
        facts: { graduationTerm, pureForeignAdmission: false, foreignLanguageSpecialAdmission: false,
          approvedRequiredCourseWaiver: false, departmentThesisPreviouslyPassed: false } };
      return report(p, [r]);
    };
    const detail = (id: string, term: string) => withMonth(id, term).items[0]?.rule.detail as { expression: { items: Record<string, unknown>[] } };
    it('컴퓨터 논문은 발표 도입 이전에도 필요하며, 발표 조항만 2025-2부터 추가된다', () => {
      const id = 'computer-thesis-policy';
      expect(detail(id, '2025-1').expression.items.map((x) => x.type)).toEqual(['thesisPassed']);
      expect(detail(id, '2025-2').expression.items.map((x) => x.type)).toEqual(['thesisPassed', 'thesisPresentation']);
      expect(detail(id, '2028-1').expression.items).toHaveLength(2);
    });
    it('이란 시험·논문·프로젝트의 서로 다른 시행일을 각 경로에만 적용한다', () => {
      const id = 'department-candidate-7ff9150fe820';
      const types = (term: string) => detail(id, term).expression.items.map((x) => x.type);
      expect(types('2022-1')).toEqual(['languageExamSubstitution']);
      expect(types('2022-2')).toEqual(['graduationThesis', 'languageExamSubstitution']);
      expect(types('2023-1')).toEqual(['graduationExam', 'graduationThesis', 'languageExamSubstitution']);
      expect(types('2024-2')).toHaveLength(4);
    });
    it('중국어교육과 구 특별과정 대체는 2026년 2월까지만 표시하고 다른 대체 경로는 유지', () => {
      const id = 'remaining-chinese-education-2016';
      expect(withMonth(id, '2024-2').items).toHaveLength(0); // 2025년 2월은 개정 전
      expect(detail(id, '2025-2').expression.items.map((x) => x.name)).toContain('외국어연수평가원 방학 외국어 특별과정 수료증');
      expect(detail(id, '2026-1').expression.items.map((x) => x.name)).not.toContain('외국어연수평가원 방학 외국어 특별과정 수료증');
      expect(detail(id, '2026-1').expression.items.map((x) => x.name)).toContain('HSK');
    });
    it('정치외교 대체 경로의 추가 시점은 기존 고시 경로까지 제한하지 않는다', () => {
      const id = 'boundary-politics-current-approved-waiver';
      const items = (t: string) => detail(id, t).expression.items;
      expect(items('2024-2')).toHaveLength(1);
      expect(items('2024-2')[0].finalPassed).toEqual([]);
      expect(items('2025-1')).toHaveLength(2);
      expect(items('2025-2')).toHaveLength(5);
      expect(items('2026-1')).toHaveLength(6);
    });
    it('LD 2026-01-01 이전 소급은 자동 승인하지 않으며 시행 이후에는 정상 적용', () => {
      expect(classifyRuleSupport(rule('extended-ld-exam')).cls).toBe('usableWithInput');
      const before = withMonth('extended-ld-exam', '2025-1').evals[0];
      expect(before.cls).toBe('unsupported');
      expect(before.blockers.join()).toContain('소급 적용');
      expect(withMonth('extended-ld-exam', '2025-2').evals[0].cls).toBe('confirmed');
      expect(withMonth('extended-ld-exam', '2028-1').evals[0].cls).toBe('confirmed');
    });
    it('조항 필터는 원본을 바꾸지 않고, 학기가 없을 때 날짜가 있는 조항을 확정 표시하지 않는다', () => {
      const original = { op: 'AND', items: [{ type: 'thesisPassed' }, { type: 'thesisPresentation', graduationPeriod: { min: 202602, max: null } }] };
      const copy = structuredClone(original);
      expect(detailForGraduation(original, undefined)).toEqual({ op: 'AND', items: [{ type: 'thesisPassed' }] });
      expect(original).toEqual(copy);
    });
    it('OR·NOT 내부의 학기 조건은 의미를 바꾸며 삭제하지 않는다', () => {
      const leaf = { op: 'eq', field: 'graduationTerm', value: '2026-2' };
      for (const c of [{ op: 'NOT', condition: { op: 'AND', conditions: [leaf] } },
        { op: 'OR', conditions: [{ op: 'AND', conditions: [leaf] }, { op: 'true' }] }]) {
        expect(() => correctTermScope('synthetic', 'departmentAssessment', c, null, [])).toThrow();
      }
    });
    it('명시적 한시·전환 규정은 그대로 유지', () => {
      expect(monthRanges(rule('dept-gbt-capstone-required-before-2026-2').condition!)).toEqual([[202502, 202608]]);
      expect(monthRanges(rule('last-english-education-score-False').condition!)).toEqual([[null, 202708]]);
      expect([...condValues(rule('remaining-russian-pandemic-thesis-2020aug').condition!, 'graduationMonth')]).toEqual(['2020-08']);
    });
    it('시험 실시·접수·인증 기준일 공지는 그 학기 졸업에만 적용, 이후 학기에는 빠진 이유를 표시', () => {
      for (const id of ['extended-french-global-submission-2026-2', 'resume-romania-exam-administration', 'continued-dutch-current-application', 'app-japan-certification-reference-2026-2']) {
        expect(terms(id), id).toEqual(['2026-2']);
      }
      const japan = { ...base, primaryDepartmentId: 'seoul-japanese-language-culture', programType: 'single' as const, secondaryDepartmentId: undefined };
      const ids = (g: string) => report({ ...japan, facts: { ...ANSWERS, graduationTerm: g } }).evals.map((e) => e.rule.id);
      expect(ids('2026-2')).toContain('app-japan-certification-reference-2026-2');
      expect(ids('2027-2')).not.toContain('app-japan-certification-reference-2026-2');
    });
    it('상시 기준에 섞인 마감일·시험일은 그 학기 한정(termSpecific)으로 분리하고 기준값은 남긴다', () => {
      const math = rule('remaining-math-exam-4-subjects');
      expect(terms(math.id)).toEqual([]);
      expect(math.termSpecific).toEqual({ term: '2026-2', fields: { applicationDeadline: '2026-10-14', examDate: '2026-11-07' } });
      expect(math.detail).not.toHaveProperty('examDate');
      expect(math.detail).toMatchObject({ minimumMeanScore: { value: 60 }, minimumEachScore: { value: 40 } });
      // 2026-1 공지에서 온 환경학과 기준도 같은 방식
      expect(rule('remaining-environment-three-routes').termSpecific?.term).toBe('2026-1');
      // 교정 후 사유에 지운 조건 필드가 남지 않는다
      for (const r of catalog.officialRules) {
        if (!r.condition || condValues(r.condition, 'graduationTerm').size) continue;
        for (const why of r.reasons) expect(why, r.id).not.toMatch(/unsupportedApplicabilityFields:.*graduationTerm/);
      }
    });
  });
  it('여러 학생 조건 전체: 확정으로 쓰인 규칙은 모두 verified, 졸업 충족은 확정하지 않음 (학과 전체 조사 미완료)', () => {
    const depts = ['seoul-japanese-language-culture', 'seoul-malay-indonesian', 'seoul-german', 'seoul-business', 'seoul-cfafcf03e2', 'global-f522bbacea'];
    for (const primary of depts) for (const cohortYear of [2019, 2022, 2026]) for (const entryType of ['freshman', 'transferBachelor'] as const) {
      const p: StudentProfile = { ...base, primaryDepartmentId: primary, homeCampus: primary.startsWith('global') ? 'global' : 'seoul', cohortYear, entryType, programType: 'single', secondaryDepartmentId: undefined, facts: { ...ANSWERS } };
      const r = report(p);
      for (const e of r.evals.filter((x) => x.cls === 'confirmed')) expect(e.rule.status, e.rule.id).toBe('verified');
      for (const e of [...r.courseRules, ...r.items]) expect(e.rule.status).toBe('verified');
      expect(r.canDetermineGraduation).toBe(false);
    }
  });
  it('이중·부전공 선택 제한: 캠퍼스 간 제한 학과는 다른 캠퍼스 학생에게 막힌다', () => {
    const limited = catalog.departmentMeta.find((m) => m.roleRestrictions.some((x) => x.condition === 'crossCampus'))!;
    const d = catalog.departments.find((x) => x.id === limited.id)!;
    const other = d.campus === 'seoul' ? 'global' : 'seoul';
    expect(secondaryRestriction(limited, d.campus, 'dual', { homeCampus: other, cohortYear: 2022 })).toMatch(/캠퍼스/);
    expect(secondaryRestriction(limited, d.campus, 'dual', { homeCampus: d.campus, cohortYear: 2022 })).toBeNull();
  });
});

// ---- 필수과목 식: 합성 규칙으로 의미만 검사 (학교 규정 값 아님) ----
const synth = (over: Partial<OfficialRule>): OfficialRule => ({
  id: 'syn', state: 'pending', status: 'verified', departmentId: 'seoul-german', category: 'requiredCourses', type: 'requiredCourses',
  condition: { op: 'eq', field: 'majorRole', value: 'primary' }, totalRequiredUnits: null, requiredUnitsByArea: {},
  reasons: [], sourceIds: ['src-demo'], ...over,
});
const leaf = (id: string, code: string | null, name = id) => ({ op: 'course' as const, id, code, name, creditUnits: 300, matching: code ? 'code' as const : 'studentConfirmation' as const });
const german: StudentProfile = { ...base, primaryDepartmentId: 'seoul-german', programType: 'single', secondaryDepartmentId: undefined };

describe('데이터 보정과 기존 이수 기록 보존', () => {
  it('영미문학 FLEX 610과 경영 부전공 회신을 생성 데이터에 반영한다', () => {
    expect(JSON.stringify(rule('dept-exam-elc-seoul').detail)).toContain('610');
    expect(rule('dept-exam-elc-seoul').detail).toMatchObject({
      coversRuleIds: ['dept-exam-elc-toeic805-flex721', 'dept-exam-elc-added-tests-2023-2'],
    });
    expect(catalog.supportGaps.some((g) => g.departmentId === 'seoul-business'
      && g.category === 'departmentAssessment' && g.majorRoles?.includes('minor'))).toBe(false);
  });

  it('동일 학과의 다른 표기에 졸업시험만 연결하고 전필은 확대하지 않는다', () => {
    const department = catalog.departmentMeta.find((m) => m.reorganization.some((r) =>
      r.relatedId && ['sameUnitCatalogLabel', 'sameUnitAlternateLabel'].includes(r.relation)))!;
    const profile = { ...german, primaryDepartmentId: department.id };
    const related = departmentFacts(department.id)?.equivalentIds?.[0];
    expect(related).toBeTruthy();
    const condition = { op: 'eq' as const, field: 'departmentId', value: related! };
    const exam = synth({ id: 'alias-exam', departmentId: related!, category: 'departmentAssessment', condition });
    const courses = synth({ id: 'alias-courses', departmentId: related!, condition });
    expect(report(profile, [exam, courses]).evals.map((e) => e.rule.id)).toEqual(['alias-exam']);
  });

  it('전필 포함 목록을 정리해도 과거 체크와 과목 연결을 유지한다', () => {
    const old = leaf('old/a', null, '같은과목');
    const current = leaf('new/a', null, '같은과목');
    const r = report(german, [
      synth({ id: 'old', courses: { op: 'ALL', items: [old] } }),
      synth({ id: 'new', courses: { op: 'ALL', items: [current, leaf('new/b', 'B1')] } }),
    ]);
    expect(r.courseRules.map((e) => e.rule.id)).toEqual(['new']);
    expect(courseConfirmationIds(r, current.id)).toEqual([old.id, current.id]);
    expect(evaluateCourseRules(r, [], null, { confirmedLeafIds: [old.id] })[0].root.children![0].state).toBe('selfConfirmed');
    expect(evaluateCourseRules(r, [course({ grade: 'A0', requirementLinks: [old.id] })], null)[0].root.children![0].state).toBe('studentLinked');
  });

  it('졸업시험은 일반전형만 기본값으로 채우고 면제 승인은 질문으로 남긴다', () => {
    const exam = synth({ category: 'departmentAssessment', condition: { op: 'AND', conditions: [
      { op: 'eq', field: 'foreignAdmission', value: false },
      { op: 'eq', field: 'approvedRequiredCourseWaiver', value: false },
    ] } });
    const evaluated = report(german, [exam]).evals[0];
    expect(evaluated.fallbackFields).toContain('foreignAdmission');
    expect(evaluated.askFields).toContain('approvedRequiredCourseWaiver');
    expect(evaluated.cls).toBe('needsInput');
  });
});

describe('필수과목 식 평가', () => {
  const expr: CourseExpr = { op: 'ALL', items: [leaf('a', 'A1'), { op: 'AT_LEAST', count: 1, items: [leaf('b', 'B1'), leaf('c', 'C1')] }, leaf('n', null, '코드없는과목')] };
  const rep = (rules: OfficialRule[], p = german): OfficialReport => report(p, rules);
  const run = (rules: OfficialRule[], courses: ReturnType<typeof course>[], p = german) => evaluateCourseRules(rep(rules, p), courses, null)[0];

  it('택일은 하나만 쓰고(둘 다 들어도 하나), 나머지 필수는 따로 남는다', () => {
    const r = run([synth({ courses: expr })], [course({ officialCode: 'A1', grade: 'A0' }), course({ officialCode: 'B1', grade: 'B0' }), course({ officialCode: 'C1', grade: 'B0' })]);
    const choice = r.root.children![1];
    expect(choice.level).toBe(2);
    expect(choice.children!.filter((c) => c.courseId)).toHaveLength(1);
    expect(r.status).toBe('unmet'); // 코드 없는 과목이 남아 있음
  });
  it('코드 없는 요건: 개설학과 없는 성적은 이수구분이 같을 때만 이름으로 충족, 학생 연결은 학생 확인으로 구분', () => {
    const others = [course({ officialCode: 'A1', grade: 'A0' }), course({ officialCode: 'B1', grade: 'A0' })];
    // 개설학과 칸이 없던 예전 성적: 이수구분이 1전공이라 그 학과 과목으로 보고 이름 일치
    const legacy = course({ name: '코드없는과목', grade: 'A0' });
    const r0 = run([synth({ courses: expr })], [...others, legacy]);
    expect(r0.root.children![2].state).toBe('nameMatched');
    expect(r0.status).toBe('met');
    // 이수구분이 다르면(교양) 이름이 같아도 자동 충족하지 않는다
    const liberal = course({ name: '코드없는과목', grade: 'A0', area: 'liberalArts' });
    expect(run([synth({ courses: expr })], [...others, liberal]).status).toBe('unmet');
    const linked = course({ name: '아무 이름', grade: 'A0', requirementLinks: ['n'] });
    const r = run([synth({ courses: expr })], [course({ officialCode: 'A1', grade: 'A0' }), course({ officialCode: 'B1', grade: 'A0' }), linked]);
    expect(r.status).toBe('studentConfirmed');
    expect(r.root.children![2].state).toBe('studentLinked');
  });
  it('조건부 대체과목: 대체 규칙이 학생에게 적용되고 시행 학기 이후 수강일 때만 인정', () => {
    const req = synth({ courses: { op: 'ALL', items: [leaf('h', 'H01106')] } });
    const sub = (cond: Cond) => synth({ id: 'sub', category: 'courseSubstitution', type: 'approvedCourseReplacement', courses: undefined, condition: cond, substitutions: [{ from: ['H01106'], to: ['U72155'], fromTerm: '2025-1' }] });
    const taken = (y: number) => course({ officialCode: 'U72155', grade: 'A0', term: { academicYear: y, semester: '1' } });
    const primaryOnly: Cond = { op: 'eq', field: 'majorRole', value: 'primary' };
    expect(run([req, sub(primaryOnly)], [taken(2025)]).root.children![0].state).toBe('substituted');
    expect(run([req, sub(primaryOnly)], [taken(2024)]).status).toBe('unmet'); // 시행 전 수강
    expect(run([req, sub({ op: 'eq', field: 'cohortYear', value: 2019 })], [taken(2025)]).status).toBe('unmet'); // 학번 조건 불일치
    expect(run([req], [taken(2025)]).status).toBe('unmet'); // 대체 규칙 없이 코드만 다름
    // 수강 학기 조건이 붙은 대체: 그 과목을 들은 학기로 판정 (학생에게 묻지 않음)
    const perCourse: Cond = { op: 'AND', conditions: [primaryOnly, { op: 'in', field: 'courseEnrollmentTerm', values: ['2025-1', '2025-2'] }] };
    const r = rep([req, sub(perCourse)]);
    expect(r.questions.map((q) => q.field)).not.toContain('courseEnrollmentTerm');
    expect(evaluateCourseRules(r, [taken(2025)], null)[0].status).toBe('met');
    expect(evaluateCourseRules(r, [course({ officialCode: 'U72155', grade: 'A0', term: { academicYear: 2026, semester: '1' } })], null)[0].status).toBe('unmet');
  });
  it('미확정 대체는 쓰지 않고, 충돌한 필수 규칙은 조건에 맞으면 엄격하게 적용한다', () => {
    const req = synth({ courses: { op: 'ALL', items: [leaf('h', 'H01106')] } });
    const sub = synth({ id: 'sub', status: 'unverified', state: 'unconfirmed', courses: undefined, substitutions: [{ from: ['H01106'], to: ['U72155'] }] });
    expect(run([req, sub], [course({ officialCode: 'U72155', grade: 'A0' })]).status).toBe('unmet');
    expect(report(german, [synth({ status: 'conflict', state: 'unconfirmed', courses: expr })]).courseRules).toHaveLength(1);
  });
  it('면제 규칙이 적용되면 그 과목만 면제', () => {
    const req = synth({ courses: { op: 'ALL', items: [{ ...leaf('s', 'F10106'), waiverRuleIds: ['w'] }, leaf('t', 'T1')] } });
    const waiver = synth({ id: 'w', type: 'explicitRequiredCourseWaiver', courses: undefined });
    const r = run([req, waiver], [course({ officialCode: 'T1', grade: 'A0' })]);
    expect(r.root.children!.map((c) => c.state)).toEqual(['waived', 'met']);
  });
  it('이미 다른 필수 묶음에 쓴 과목은 다시 쓰지 않는다 (중복 인정 금지)', () => {
    const a1 = course({ officialCode: 'A1', grade: 'A0' });
    const r = evaluateCourseRules(rep([synth({ courses: { op: 'ALL', items: [leaf('a', 'A1')] } })]), [a1], null, { alreadyUsed: [a1.id] })[0];
    expect(r.status).toBe('unmet');
  });
  it('과목 기록이 없으면 미충족이 아니라 판단 자료 부족', () => {
    expect(run([synth({ courses: expr })], []).status).toBe('insufficient');
  });
});

describe('기존 학생 데이터와 데모', () => {
  it('추가 조건(facts)이 없는 기존 저장 상태가 그대로 읽힌다', () => {
    const old = { ...buildDemoState(new Date('2026-10-23T09:00:00')), profile: { ...base, programType: 'double' } };
    const parsed = appStateSchema.safeParse(old);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.profile?.facts).toBeUndefined();
  });
  it('데모는 데모 묶음만, 공식 묶음·규칙과 섞이지 않는다', () => {
    const demo = buildDemoState(new Date('2026-10-23T09:00:00'));
    const resolved = resolveRequirements(demo.profile!, catalog.demoBundles, ['demo'])!;
    expect(resolved.verification).toBe('demo');
    expect(resolved.sourceIds).toEqual(['src-demo']);
    expect(resolveRequirements(demo.profile!, catalog.demoBundles, ['verified'])).toBeNull();
    expect(catalog.bundles.every((b) => b.status !== 'demo')).toBe(true);
    expect(evaluateProgress(resolved, demo.courses, demo.snapshots.at(-1) ?? null).total.required).toBe(3000);
  });
});

describe('등록부 별칭으로 코드 없는 전공필수 대조', () => {
  const run = (departmentId: string, courses: ReturnType<typeof course>[], rules = catalog.officialRules) => {
    const p: StudentProfile = {
      ...base, homeCampus: departmentById(departmentId)!.campus, cohortYear: 2024, entryType: 'freshman',
      primaryDepartmentId: departmentId, programType: 'single', secondaryDepartmentId: undefined,
      facts: { foreignLanguageSpecialAdmission: false, pureForeignAdmission: false },
    };
    return evaluateCourseRules(report(p, rules), courses, null, { dept: departmentById });
  };
  const taken = (name: string, offeringDepartmentName: string, officialCode?: string) =>
    course({ name, offeringDepartmentName, officialCode, grade: 'A0' });

  it('서아프리카어전공 전필을 아프리카학부 개설 성적으로 이름 대조한다', () => {
    const progress = run('global-232e50994b', [
      taken('하우사문법(고급)', '아프리카학부'), taken('하우사언어실습(중급)', '아프리카학부'),
    ]).find((p) => p.eval.rule.id === 'dr105-africa-west-required-2019-2026')!;
    expect(progress.status).toBe('met');
    expect(progress.root.children!.map((c) => c.state)).toEqual(['nameMatched', 'nameMatched']);
    expect(progress.root.children!.every((c) => !!c.courseId)).toBe(true);
  });

  it.each([
    ['seoul-cc643ab94a', '태국어과'], ['seoul-8c71399e19', '태국학과'],
  ])('%s의 이름 대조는 개칭 전후 개설학과 %s를 인정한다', (departmentId, offeringDepartmentName) => {
    // 합성 요건으로 이름 대조만 검증한다. 실제 규칙의 학과·학번 적용범위를 승계시키지는 않는다.
    const req = synth({ departmentId, courses: { op: 'ALL', items: [leaf('thai', null, '태국어연습A1(1)')] } });
    const progress = run(departmentId, [taken('태국어연습A1(1)', offeringDepartmentName)], [req])[0];
    expect(progress.status).toBe('met');
    expect(progress.root.children![0].state).toBe('nameMatched');
  });

  it('태국어과의 실제 전필 규칙도 태국학과 개설 성적으로 대조한다', () => {
    const progress = run('seoul-8c71399e19', [taken('태국어연습A1(1)', '태국학과')])
      .find((p) => p.eval.rule.id === 'c99-thai-2021')!;
    expect(progress.root.children![0].state).toBe('nameMatched');
  });

  it.each([
    ['하우사문법(고급)', '베트남어과'], // 과목명이 같아도 관계가 없는 학과는 제외
    ['다른 과목', '아프리카학부'],     // 별칭 학과가 맞아도 과목명이 다르면 제외
  ])('학과와 과목명이 모두 맞아야 한다: %s / %s', (name, offeringDepartmentName) => {
    const progress = run('global-232e50994b', [taken(name, offeringDepartmentName)])
      .find((p) => p.eval.rule.id === 'dr105-africa-west-required-2019-2026')!;
    expect(progress.status).toBe('unmet');
    expect(progress.root.children!.map((c) => c.state)).toEqual(['unmet', 'unmet']);
  });

  it('동일 학과의 편람 표기는 양방향이며, 상위 학부는 하위 전공·다른 전공을 별칭으로 받지 않는다', () => {
    expect(departmentById('seoul-1ae01dc67c')!.aliases).toContain('페르시아어·이란학과');
    expect(departmentById('seoul-fbbf413afe')!.aliases).toContain('페르시아어·이란학과(구이란어과)');
    expect(departmentById('global-232e50994b')!.aliases).toEqual(['아프리카학부']);
    expect(departmentById('global-4e887fa213')!.aliases).not.toContain('서아프리카어전공');
    expect(departmentById('seoul-e2e6ddcb13')!.aliases).toEqual([]); // 일본어학전공은 상위 학부 관계 미기록
  });

  it('가상 수강 사례: 코드·이름 대조를 함께 사용해 전필 이수 여부를 판정', () => {
    const dept = '말레이·인도네시아어과';
    const grades = [
      taken('인도네시아세계역사.문화:인도네시아,동티모르,필리핀', dept, 'B03493'),
      taken('지역과지역학', dept, 'B03131'),
      ...['초급마.인어(1)', '초급마.인어(2)', '초급마.인어회화작문(1)', '초급마.인어회화작문(2)', '중급마.인어회화작문(1)']
        .map((name) => taken(name, dept)),
    ];
    const progress = run('seoul-malay-indonesian', grades).find((p) => p.eval.rule.id === 'core-malay-primary-2022-2026')!;
    const children = progress.root.children!;
    expect(children).toHaveLength(11);
    expect(children.filter((c) => c.state === 'met')).toHaveLength(2);
    expect(children.filter((c) => c.state === 'nameMatched')).toHaveLength(5);
    expect(children.filter((c) => c.state === 'unmet').map((c) => (c.node as CourseLeaf).name)).toEqual([
      '말레이세계역사와문화: 말레이시아,싱가포르,브루나이', '중급마.인어회화작문(2)', '영상마.인어(1)', '영상마.인어(2)',
    ]);
    expect(progress.status).toBe('unmet');
  });
});

// ---- 코드 없는 전공필수: 개설학과 + 과목명 대조 (실제 배포 규칙으로 시나리오 검사) ----
// 가상(합성) 학생 시나리오. 실제 학생의 수강 이력·등급을 쓰거나 참고해 재구성하지 않는다 (§11).
describe('코드 없는 전공필수 대조 (독일어과 2025 학사편입·단일전공)', () => {
  const GERMAN = '독일어과';
  const german: StudentProfile = {
    ...base, cohortYear: 2025, entryType: 'transferBachelor', primaryDepartmentId: 'seoul-german',
    programType: 'single', secondaryDepartmentId: undefined,
    facts: { foreignLanguageSpecialAdmission: false, pureForeignAdmission: false },
  };
  /** 성적 한 줄: 개설학과 + 코드 + 과목명 (코드 없는 요건에 맞물릴 번호는 가상 번호 T9xxxx) */
  const taken = (officialCode: string, name: string, dept = GERMAN) =>
    course({ officialCode, name, offeringDepartmentName: dept, grade: 'A0', area: 'primary' });
  const GRADES = [
    taken('A03209', '독일어말하기B2'),      // 규칙에 코드가 있는 요건 → 코드 일치
    taken('T90101', '독일문학기초세미나'),   // 이하 코드 없는 요건 → 이름 일치
    taken('T90102', '독일언어학기초세미나'),
    taken('T90103', '독일예술문화기초세미나'),
    taken('T90104', '독일지역사정(역사)'),
  ];
  const RULE_ID = 'core-german-primary-2025-2026';
  const run = (courses: ReturnType<typeof course>[], confirmedLeafIds: string[] = []) => {
    const rep = report(german);
    const p = evaluateCourseRules(rep, courses, null, { dept: departmentById, confirmedLeafIds })
      .find((x) => x.eval.rule.id === RULE_ID);
    expect(p, `${RULE_ID} 규칙이 확정 규칙에 없음`).toBeTruthy();
    return p!;
  };
  const leaves = (p: ReturnType<typeof run>) => p.root.children!;

  it('코드 일치 1 + 이름 일치 4 = 5과목 이수, 3과목 미이수', () => {
    const p = run(GRADES);
    const states = leaves(p).map((c) => c.state);
    expect(states.filter((x) => x === 'met')).toHaveLength(1); // A03209 (코드 일치)
    expect(states.filter((x) => x === 'nameMatched')).toHaveLength(4);
    expect(states.filter((x) => x === 'unmet')).toHaveLength(3);
    expect(leaves(p).filter((c) => c.state === 'unmet').map((c) => (c.node as { name: string }).name)).toEqual([
      '독일어읽기B2', '독일어발표와토론', '시사독일어2',
    ]);
    expect(p.status).toBe('unmet');
    // 자동 이수된 요건은 모두 성적표의 과목과 연결돼 있다 (학점 계산의 근거가 되는 과목)
    expect(leaves(p).filter((c) => c.level === 2).every((c) => !!c.courseId)).toBe(true);
  });

  it('로마숫자·전각 괄호가 달라도 같은 과목으로 본다', () => {
    const p = run([taken('T90104', '독일지역사정（역사）'), taken('T90105', '시사독일어Ⅱ')]);
    expect(leaves(p).filter((c) => c.state === 'nameMatched')).toHaveLength(2);
  });

  it('구분점 . ･ · ・ ㆍ 는 같은 글자로 본다 (성적표와 편람의 표기 차이)', () => {
    expect(normalizeCourseName('가상ㆍ과목Ⅰ')).toBe(normalizeCourseName('가상.과목(1)'));
    expect(normalizeCourseName('가상･과목Ⅰ')).toBe(normalizeCourseName('가상· 과목（1）'));
  });

  it('개설학과 칸이 없던 예전 성적도 이수구분(1전공)이 같으면 5과목 이수로 본다', () => {
    const legacy = GRADES.map((c) => ({ ...c, offeringDepartmentName: undefined }));
    const p = run(legacy);
    expect(leaves(p).filter((c) => c.state === 'met')).toHaveLength(1); // A03209 (코드 일치)
    expect(leaves(p).filter((c) => c.state === 'nameMatched')).toHaveLength(4);
    expect(leaves(p).filter((c) => c.state === 'unmet')).toHaveLength(3);
  });

  it('개설학과 칸이 없고 이수구분이 다른 예전 성적은 자동 이수하지 않는다', () => {
    const other = GRADES.map((c) => ({ ...c, offeringDepartmentName: undefined, area: 'liberalArts' as const }));
    expect(leaves(run(other)).some((c) => c.state === 'nameMatched')).toBe(false);
  });

  it('개설학과가 다르면 이름이 같아도 자동 이수하지 않는다', () => {
    const p = run([taken('T90101', '독일문학기초세미나', '베트남어과')]);
    expect(leaves(p).some((c) => c.state === 'nameMatched')).toBe(false);
  });

  it('미이수 요건은 학생이 직접 체크할 수 있고(△), 학점에 더하지 않고, 해제된다', () => {
    const unmetIds = leaves(run(GRADES)).filter((c) => c.state === 'unmet').map((c) => (c.node as { id: string }).id);
    expect(unmetIds).toHaveLength(3);
    const p = run(GRADES, unmetIds);
    const hit = leaves(p).filter((c) => unmetIds.includes((c.node as { id: string }).id));
    expect(hit.map((c) => c.state)).toEqual(['selfConfirmed', 'selfConfirmed', 'selfConfirmed']);
    expect(hit.map((c) => c.level)).toEqual([1, 1, 1]); // △ — 공식 충족(2)과 구분
    expect(hit.every((c) => c.courseId === undefined)).toBe(true); // 연결된 과목이 없어 학점에 더하지 않는다
    expect(p.status).toBe('studentConfirmed'); // 충족(met)으로 끝내지 않는다
    // 체크를 해제하면 다시 미이수
    expect(leaves(run(GRADES)).filter((c) => c.state === 'unmet')).toHaveLength(3);
  });
});
