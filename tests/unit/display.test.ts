// 화면 표시 규칙 검사: 요건 기호 두 가지(○/✓) 통합, 전공필수 체크 하나로 합치기,
// 학교 확인이 필요한 줄의 접힌 문의처 분류, 학사현황의 출처 표시 제거.
// 화면 문구는 DOM 렌더러 없이 소스 문구로 고정한다 (이 저장소의 단위 테스트는 vitest + 순수 로직만 쓴다).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { catalog, departmentFacts, departmentMetaById, departmentName } from '../../src/data';
import {
  autoLinkTargets, buildOfficialReport, DISPLAY_REASON_LABEL, displayReasonFor, evaluateCourseRules,
  leafDisplay, normalizeCourseName, type LeafState, type NodeProgress, type OfficialReport,
} from '../../src/domain/requirements/officialRules';
import type { CourseExpr, OfficialRule, StudentProfile } from '../../src/domain/types';
import { course } from '../fixtures';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const OFFICIAL_SECTIONS = read('src/features/academic-status/OfficialSections.tsx');
const STATUS_SCREEN = read('src/features/academic-status/StatusScreen.tsx');
const COURSE_EDITOR = read('src/features/courses/CourseEditor.tsx');
const ASSESSMENTS = read('src/features/assessments/AssessmentsScreen.tsx');
/** 문의처 컴포넌트 본문만 (남겨 둔 Sources 컴포넌트와 섞이지 않게) */
const INQUIRY_CONTACT = OFFICIAL_SECTIONS.slice(
  OFFICIAL_SECTIONS.indexOf('export function InquiryContact'),
  OFFICIAL_SECTIONS.indexOf('const PASS_LABEL'),
);

const german: StudentProfile = {
  schemaVersion: 1, homeCampus: 'seoul', cohortYear: 2025, entryType: 'freshman',
  primaryDepartmentId: 'seoul-german', programType: 'single', currentTerm: { academicYear: 2026, semester: '2' },
};
const synth = (over: Partial<OfficialRule>): OfficialRule => ({
  id: 'syn', state: 'pending', status: 'verified', departmentId: 'seoul-german', category: 'requiredCourses', type: 'requiredCourses',
  condition: { op: 'eq', field: 'majorRole', value: 'primary' }, totalRequiredUnits: null, requiredUnitsByArea: {},
  reasons: [], sourceIds: ['src-demo'], ...over,
});
const leaf = (id: string, code: string | null, name = id) => ({
  op: 'course' as const, id, code, name, creditUnits: 300,
  matching: code ? 'code' as const : 'studentConfirmation' as const,
});
const report = (rules: OfficialRule[], p = german): OfficialReport => buildOfficialReport({
  profile: p, bundles: catalog.bundles, rules, supportGaps: catalog.supportGaps, dept: departmentFacts, meta: departmentMetaById,
});
const node = (level: 0 | 1 | 2, state?: LeafState, skipped?: boolean): NodeProgress =>
  ({ node: leaf('x', 'X1'), level, state, skipped });

describe('요건 한 줄의 기호는 ○ 미이수 · ✓ 이수 두 가지', () => {
  it('코드·대체·이름 일치·면제는 모두 ✓이고 "내가 체크"를 붙이지 않는다', () => {
    for (const state of ['met', 'substituted', 'nameMatched', 'waived'] as LeafState[]) {
      expect(leafDisplay(node(2, state))).toEqual({ mark: '✓', selfChecked: false });
    }
  });
  it('학생이 직접 연결·확인한 줄도 ✓이고, 그 줄에만 "내가 체크"가 붙는다', () => {
    for (const state of ['studentLinked', 'selfConfirmed'] as LeafState[]) {
      expect(leafDisplay(node(1, state))).toEqual({ mark: '✓', selfChecked: true });
    }
  });
  it('미이수와 택일에서 확인하지 않은 줄은 ○', () => {
    expect(leafDisplay(node(0, 'unmet'))).toEqual({ mark: '○', selfChecked: false });
    expect(leafDisplay(node(0, undefined, true))).toEqual({ mark: '○', selfChecked: false });
  });
  it('기호 세 가지(= 이름 일치)를 쓰지 않고 범례는 한 줄이다', () => {
    expect(OFFICIAL_SECTIONS).toContain('data-testid="course-legend">○ 미이수 · ✓ 이수<');
    expect(OFFICIAL_SECTIONS).not.toContain('= 이름 일치');
    expect(OFFICIAL_SECTIONS).not.toContain('코드·대체');
    expect(OFFICIAL_SECTIONS).toContain('· 내가 체크');
  });
  it('이름 일치도 학생에게는 "이수"로 적는다 (내부 상태값 nameMatched는 그대로 둔다)', () => {
    expect(OFFICIAL_SECTIONS).toContain("nameMatched: '이수'");
    const expr: CourseExpr = { op: 'ALL', items: [leaf('n', null, '코드없는과목')] };
    const p = evaluateCourseRules(report([synth({ courses: expr })]), [course({ name: '코드없는과목', grade: 'A0' })], null)[0];
    expect(p.root.children![0].state).toBe('nameMatched');
  });
});

describe('학생이 체크한 줄도 충족 수에 들어가고, 학점은 더하지 않는다', () => {
  const expr: CourseExpr = { op: 'ALL', items: [leaf('a', 'A1'), leaf('b', 'B1')] };
  it('성적표에 없는 과목을 체크하면 그 줄은 level>0이 되어 이수로 세어진다', () => {
    const rules = [synth({ courses: expr })];
    const taken = [course({ officialCode: 'A1', grade: 'A0' })];
    const before = evaluateCourseRules(report(rules), taken, null)[0];
    expect(before.root.children!.map((c) => c.level)).toEqual([2, 0]);
    const after = evaluateCourseRules(report(rules), taken, null, { confirmedLeafIds: ['b'] })[0];
    expect(after.root.children!.map((c) => c.level)).toEqual([2, 1]);
    // 두 줄 모두 화면에서는 ✓ (둘째 줄에만 '내가 체크')
    expect(after.root.children!.map((c) => leafDisplay(c).mark)).toEqual(['✓', '✓']);
    expect(after.root.children!.map((c) => leafDisplay(c).selfChecked)).toEqual([false, true]);
    expect(after.status).toBe('studentConfirmed');
  });
  it('체크한 요건에는 연결된 과목이 없어 학점이 생기지 않는다', () => {
    const p = evaluateCourseRules(report([synth({ courses: expr })]), [], null, { confirmedLeafIds: ['a', 'b'] })[0];
    expect(p.root.children!.every((c) => c.courseId === undefined)).toBe(true);
  });
  it('학사현황의 "내가 필수로 표시한 과목 N개" 줄은 없앴다', () => {
    expect(STATUS_SCREEN).not.toContain('내가 필수로 표시한 과목');
    expect(STATUS_SCREEN).not.toContain('studentMarkedCourseIds');
  });
  it('묶음 요건 줄도 ○/✓ 두 가지만 쓰고, 다시 누르면 체크가 풀린다', () => {
    expect(STATUS_SCREEN).toContain("{it.done ? '✓' : '○'}");
    expect(STATUS_SCREEN).not.toContain("'?' :");
    expect(STATUS_SCREEN).toContain('toggleConfirm(g.group.id)');
  });
});

describe('과목 수정: 전공필수 체크 하나로 합치기', () => {
  const expr: CourseExpr = { op: 'ALL', items: [leaf('a', 'A1', '독일어문법'), leaf('b', 'B1', '독일문학사')] };
  const rep = report([synth({ courses: expr })]);

  it('이름이 맞는 요건이 정확히 하나면 그 하나만 돌려준다 (자동 연결)', () => {
    expect(autoLinkTargets(rep, '독일어문법', departmentName).map((h) => h.leaf.id)).toEqual(['a']);
  });
  it('이름이 맞는 요건이 없으면 비어 있다 (연결하지 않고 학생 표시로만 남는다)', () => {
    expect(autoLinkTargets(rep, '전혀 다른 과목', departmentName)).toEqual([]);
    expect(autoLinkTargets(null, '독일어문법', departmentName)).toEqual([]);
    expect(autoLinkTargets(rep, '   ', departmentName)).toEqual([]);
  });
  it('같은 이름 요건이 여러 개면 모두 돌려준다 (학생이 고른다)', () => {
    const two = report([
      synth({ id: 'r1', courses: { op: 'ALL', items: [leaf('a', 'A1', '독일어문법')] } }),
      synth({ id: 'r2', courses: { op: 'ALL', items: [leaf('c', 'C1', '독일어문법')] } }),
    ]);
    expect(autoLinkTargets(two, '독일어문법', departmentName).map((h) => h.leaf.id)).toEqual(['a', 'c']);
  });
  it('대조 기준은 normalizeCourseName 하나뿐이다 (끝 영문명은 무시, "(1)"은 다른 과목)', () => {
    expect(autoLinkTargets(rep, '독일어문법 (German Grammar)', departmentName).map((h) => h.leaf.id)).toEqual(['a']);
    expect(autoLinkTargets(rep, '독일어문법(1)', departmentName)).toEqual([]);
  });
  it('동일과목명(identicalNames)으로도 찾는다', () => {
    const withAlias = report([synth({ courses: { op: 'ALL', items: [{ ...leaf('a', null, '확률과통계'), identicalNames: ['통계학개론'] }] } })]);
    expect(autoLinkTargets(withAlias, '통계학개론', departmentName).map((h) => h.leaf.id)).toEqual(['a']);
  });
  it('체크박스 하나만 보이고, 따로 있던 "직접 연결" 목록은 없앴다', () => {
    expect(COURSE_EDITOR).toContain('이 과목은 전공필수예요');
    expect(COURSE_EDITOR).not.toContain('전공필수로 표시');
    expect(COURSE_EDITOR).not.toContain('필수과목 요건에 직접 연결');
    expect(COURSE_EDITOR).toContain('요건에 연결했어요');
    expect(COURSE_EDITOR).toContain('연결할 요건이 없어요');
    // 공식 규칙으로 매칭된 과목은 지금처럼 안내만 한다
    expect(COURSE_EDITOR).toContain('공식 규칙으로 필수과목에 매칭된 과목이에요');
  });
});

describe('학교 확인이 필요한 요건: 접힌 한 줄 분류 + 문의처', () => {
  it('화면용 분류는 네 가지뿐이다', () => {
    expect(Object.values(DISPLAY_REASON_LABEL)).toEqual([
      '자료마다 달라서 필수로 계산했어요', '학과 내규가 있을 수 있어요',
      '합격 기준은 학과 확인 필요', '학번별 기준이 확실하지 않아요',
    ]);
  });
  it('규칙에 실려 온 분류를 먼저 쓰고, 없으면 이유 종류로 정한다', () => {
    const withReason = synth({ status: 'unverified', displayReason: { key: 'threshold', label: '합격 기준은 학과 확인 필요' } });
    expect(displayReasonFor('unconfirmed', withReason)).toBe('합격 기준은 학과 확인 필요');
    expect(displayReasonFor('unconfirmed')).toBe('학번별 기준이 확실하지 않아요');
    expect(displayReasonFor('conflict')).toBe('자료마다 달라서 필수로 계산했어요');
    expect(displayReasonFor('schoolDefault')).toBe('학과 내규가 있을 수 있어요');
    expect(displayReasonFor('schoolCommonOnly')).toBe('합격 기준은 학과 확인 필요');
  });
  it('추가 입력 필요는 성격이 달라 분류하지 않는다 (지금 방식 유지)', () => {
    expect(displayReasonFor('needsInput')).toBeUndefined();
    expect(OFFICIAL_SECTIONS).toContain("needsInput: '추가 입력 필요'");
  });
  it('미확정 규칙은 판정 범위 줄에 분류·제목·체크용 ID를 갖고 들어온다', () => {
    const r = report([synth({
      id: 'unconf-1', status: 'unverified', category: 'departmentAssessment', type: 'assessmentRequired',
      title: '졸업시험 또는 FLEX 독일어 650점', courses: undefined,
      displayReason: { key: 'cohort', label: '학번별 기준이 확실하지 않아요', inquiryId: 'Q40' },
      reasons: ['적용 학번을 원문에서 확정하지 못함'],
    })]);
    const row = r.coverage.find((c) => c.category === 'departmentAssessment')!;
    const note = row.notes.find((n) => n.ruleIds.includes('unconf-1'))!;
    expect(note.kind).toBe('unconfirmed');
    expect(note.id).toBe('unconf-1');
    expect(note.title).toBe('졸업시험 또는 FLEX 독일어 650점');
    expect(note.displayReason).toBe('학번별 기준이 확실하지 않아요');
    // 자료가 없는 것이므로 '미충족'으로 적지 않는다
    expect(row.determinable).toBe(false);
    expect(note.text).not.toContain('미충족');
  });
  it('펼친 쪽은 네 경우 모두 같은 첫 줄과 전화·메일만 보여 준다 (날짜·링크 없음)', () => {
    expect(OFFICIAL_SECTIONS).toContain('정확한 기준은 학과에 확인할 수 있어요');
    expect(OFFICIAL_SECTIONS).toContain('문의 전화');
    expect(OFFICIAL_SECTIONS).toContain('문의 메일');
    expect(OFFICIAL_SECTIONS).toContain('tel:');
    expect(OFFICIAL_SECTIONS).toContain('mailto:');
    expect(OFFICIAL_SECTIONS).toContain('(학교 대표)');
    // 확인일·졸업요건 페이지·학과 홈페이지 링크는 넣지 않는다
    expect(OFFICIAL_SECTIONS).not.toContain('졸업요건 페이지');
    expect(OFFICIAL_SECTIONS).not.toContain('학과에 확인하세요');
    expect(OFFICIAL_SECTIONS).not.toContain('graduationPageUrl');
    // 문의처 컴포넌트 안에서만 (남겨 둔 Sources 컴포넌트는 확인일을 계속 쓴다)
    expect(INQUIRY_CONTACT).not.toContain('checkedAt');
    expect(INQUIRY_CONTACT).not.toContain('homepageUrl');
  });
  it('부전공 적용 여부가 불명확하면 미이수가 아니라 "해당 없음"으로 둔다', () => {
    expect(OFFICIAL_SECTIONS).toContain("note.notApplicable || note.kind === 'schoolDefault'");
    expect(OFFICIAL_SECTIONS).toContain('해당 없음');
    expect(OFFICIAL_SECTIONS).toContain("if (r.basis === 'none') return '해당 없음'");
  });
  it('모든 줄에 학생이 직접 넘기는 버튼을 두고, 배지 8종 목록은 쓰지 않는다', () => {
    expect(OFFICIAL_SECTIONS).toContain("departmentAssessment: '통과했어요'");
    expect(OFFICIAL_SECTIONS).toContain("requiredCourses: '이수했어요'");
    expect(OFFICIAL_SECTIONS).toContain('aria-expanded={open}');
    expect(OFFICIAL_SECTIONS).not.toContain('r.notes.map((n) => NOTE_LABEL[n.kind])');
  });
  it('배포 데이터: 조사 미확정 규칙 55건 모두 네 가지 중 하나로 분류돼 전달됐다', () => {
    const unconfirmed = catalog.officialRules.filter((r) => r.state === 'unconfirmed');
    expect(unconfirmed).toHaveLength(55);
    expect(unconfirmed.filter((r) => r.displayReason)).toHaveLength(55);
    for (const r of unconfirmed) {
      expect(DISPLAY_REASON_LABEL[r.displayReason!.key]).toBe(r.displayReason!.label);
    }
  });
  it('문의처는 학과 사무실 공개 연락처만 쓰고, 없으면 학교 대표 번호를 쓴다', () => {
    const depts = new Set(catalog.officialRules.filter((r) => r.state === 'unconfirmed' && r.departmentId).map((r) => r.departmentId!));
    expect(depts.size).toBeGreaterThan(0);
    for (const id of depts) {
      const contact = departmentMetaById(id)?.contact;
      if (contact?.email) expect(contact.email).toMatch(/@/);
    }
    expect(OFFICIAL_SECTIONS).toContain('SCHOOL_MAIN_PHONE');
  });
});

describe('학사현황에서 출처 표시 제거', () => {
  it('두 화면에 <Sources> 호출이 하나도 없다', () => {
    expect(OFFICIAL_SECTIONS).not.toContain('<Sources');
    expect(STATUS_SCREEN).not.toContain('<Sources');
    expect(STATUS_SCREEN).not.toContain('이 화면의 기준 출처');
  });
  it('Sources 컴포넌트와 sourceIds 데이터는 남아 있다 (나중에 쓸 수 있게)', () => {
    expect(OFFICIAL_SECTIONS).toContain('export function Sources');
    expect(catalog.sources.length).toBeGreaterThan(0);
    expect(catalog.officialRules.every((r) => Array.isArray(r.sourceIds))).toBe(true);
  });
  it('마이페이지 등 다른 화면에 출처 목록을 새로 만들지 않았다', () => {
    expect(read('src/features/settings/MyPage.tsx')).not.toContain('Sources');
  });
});

describe('충돌은 엄격하게 계산하고 부전공 전필 제외는 유지한다', () => {
  it('실제 GBT·이란학과 충돌 과목을 버리지 않고 필수 식으로 전달한다', () => {
    const find = (id: string) => catalog.officialRules.find((r) => r.id === id)!;
    const gbt = find('global-xls-gbt-capstone-primary');
    expect(gbt.status).toBe('conflict');
    expect(gbt.courses).toMatchObject({ op: 'ALL', items: [{ code: 'P05406' }] });
    expect(find('stage2-gbt-capstone-required-conflict').courses).toMatchObject({ op: 'ALL', items: [{ name: '졸업프로젝트(캡스톤디자인)' }] });
    expect(find('remaining-iran-courses-2025').courses).toMatchObject({ op: 'ALL', items: [{ code: 'B09101' }, { code: 'B09102' }] });
    expect(find('ingenium-credits-freshman').requiredUnitsByArea.primary).toBe(11800);
    expect(find('biods-internal-credit-conflict').requiredUnitsByArea.double).toBe(5700);
  });
  it('필요학점 충돌은 큰 값을 적용하고, 원래 규칙 객체는 수정하지 않는다', () => {
    const verified = synth({ id: 'verified', totalRequiredUnits: 15000, requiredUnitsByArea: { primary: 4200 } });
    const conflict = synth({ id: 'conflict', status: 'conflict', state: 'unconfirmed', totalRequiredUnits: 14000, requiredUnitsByArea: { primary: 5700 } });
    const snapshot = JSON.stringify([verified, conflict]);
    const r = buildOfficialReport({ profile: german, bundles: [], rules: [verified, conflict], supportGaps: [], dept: departmentFacts, meta: departmentMetaById });
    expect(r.resolved).toMatchObject({ totalRequiredUnits: 15000, requiredUnitsByArea: { primary: 5700 }, conflicts: [] });
    expect(JSON.stringify([verified, conflict])).toBe(snapshot);
    expect(r.coverage.find((c) => c.category === 'requiredCourses')?.determinable).toBe(false);
  });
  it('중국어통번역학과 부전공의 충돌 전필은 해당 없음으로 남긴다', () => {
    const p: StudentProfile = { ...german, programType: 'minor', homeCampus: 'global', primaryDepartmentId: 'global-0a02a07bb4',
      secondaryDepartmentId: 'global-3b5bd778ef', facts: { foreignLanguageSpecialAdmission: false, approvedRequiredCourseWaiver: false } };
    const r = report(catalog.officialRules, p);
    const row = r.coverage.find((c) => c.category === 'requiredCourses' && c.scope === 'secondary')!;
    expect(row.basis).toBe('none');
    expect(row.notes.filter((n) => n.ruleIds.includes('remaining-chinese-global-minor-conflict')).every((n) => n.notApplicable)).toBe(true);
    expect(r.courseRules.map((e) => e.rule.id)).not.toContain('remaining-chinese-global-minor-conflict');
  });
});

describe('이미 끝난 작업은 그대로 남아 있다', () => {
  it('normalizeCourseName: 끝 영문명만 제거하고 "(1)"은 유지', () => {
    expect(normalizeCourseName('독일어문법 (German Grammar)')).toBe('독일어문법');
    expect(normalizeCourseName('독일어문법(1)')).toBe('독일어문법1');
  });
  it('과목 수정: 재수강 체크·대체 기록 선택·"추가 정보" 접기', () => {
    expect(COURSE_EDITOR).toContain('재수강 과목이에요');
    expect(COURSE_EDITOR).toContain('대체하는 이전 기록');
    expect(COURSE_EDITOR).toContain('<summary>추가 정보</summary>');
    expect(COURSE_EDITOR).toContain('공식 과목 코드 (선택)');
  });
  it('시간표: 요일 시간표·시간 미정·중간·기말·메모', () => {
    expect(ASSESSMENTS).toMatch(/월|화|수|목|금/);
    expect(ASSESSMENTS).toContain('시간 미정');
    expect(ASSESSMENTS).toMatch(/중간/);
    expect(ASSESSMENTS).toMatch(/기말/);
    expect(ASSESSMENTS).toMatch(/메모/);
  });
  it('학사현황: 기본값 접기·졸업시험/논문 표기·참고 규정 접기', () => {
    expect(OFFICIAL_SECTIONS).toContain('기본값으로 계산했어요 · 다르면 수정');
    expect(OFFICIAL_SECTIONS).toContain("departmentExamPassed: '학과 졸업시험 통과'");
    expect(OFFICIAL_SECTIONS).toContain("departmentThesisPassed: '학과 졸업논문 통과'");
    expect(OFFICIAL_SECTIONS).toContain("'참고 규정'");
  });
});
