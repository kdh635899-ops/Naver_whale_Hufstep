import 'fake-indexeddb/auto';
import { execFileSync } from 'node:child_process';
import type { ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { useStore } from '../../src/app/store';
import { catalog, departmentById, departmentFacts, departmentMetaById, departmentName } from '../../src/data';
import migrationIds from '../../src/data/requirement-id-migration.json';
import { computeGpa, effectiveCourses, earnedUnits } from '../../src/domain/gpa/gpa';
import { applyMerge, planMerge } from '../../src/domain/merge/mergeImport';
import { parseTranscript } from '../../src/domain/parser/parseTranscript';
import { briefAssessment, describeAssessment, assessmentRole, departmentAssessmentGuides, groupAssessments } from '../../src/domain/requirements/assessment';
import { ASKABLE_FIELDS, factsFor, isAskedOnScreen, roleContexts, UNASKED_FIELDS } from '../../src/domain/requirements/conditions';
import { buildOfficialReport, defaultAnswers, evaluateCourseRules, linkableLeaves, noteFrom, ruleTitle, type NodeProgress } from '../../src/domain/requirements/officialRules';
import { checklistCount, deleteChecklistItem, linkedChecklistIds, migrateChecklistIds, scopeStatusEdits } from '../../src/domain/requirements/statusEdits';
import { emptyEdits, emptyState, type AppState } from '../../src/domain/state';
import type { CourseExpr, StudentProfile } from '../../src/domain/types';
import { appStateSchema } from '../../src/domain/validation/schemas';
import { QuestionsCard } from '../../src/features/academic-status/OfficialSections';
import { ProfileForm } from '../../src/features/profile/ProfileForm';
import { StatusScreen } from '../../src/features/academic-status/StatusScreen';
import { loadState, migrate, saveState } from '../../src/storage/repository';
import { course, T26_2, TRANSCRIPT_FIXTURE } from '../fixtures';

vi.mock('../../src/app/store', () => ({ useStore: vi.fn() }));
const deptId = (name: string) => catalog.departments.find((d) => d.name === name)!.id;
const base: StudentProfile = { schemaVersion: 1, homeCampus: 'seoul', cohortYear: 2024, entryType: 'freshman',
  primaryDepartmentId: 'seoul-malay-indonesian', programType: 'double', secondaryDepartmentId: 'seoul-business', currentTerm: T26_2, facts: { foreignLanguageSpecialAdmission: false, pureForeignAdmission: false } };
const rep = (profile: StudentProfile) => buildOfficialReport({ profile, bundles: catalog.bundles, rules: catalog.officialRules,
  supportGaps: catalog.supportGaps, dept: departmentFacts, meta: departmentMetaById, today: '2026-10-30' });
const allLeaves = (n: CourseExpr): string[] => n.op === 'course' ? [n.id] : n.items.flatMap(allLeaves);
function render(s: AppState, Component: ComponentType = StatusScreen) {
  const report = rep(s.profile!);
  vi.mocked(useStore).mockReturnValue({ state: s, report, resolved: report.resolved, now: new Date('2026-10-30T00:00:00Z'),
    save: vi.fn(), today: '2026-10-30' } as unknown as ReturnType<typeof useStore>);
  return renderToStaticMarkup(<Component />);
}

describe('R1: 필요한 학생 입력과 경계값', () => {
  const ld = { ...base, secondaryDepartmentId: deptId('Language & Diplomacy학부') };
  it.each([2016, 2017, 2022, 2023, 2026, 2027])('LD 선발 %i년: 지원 범위만 선택', (year) => {
    const p = { ...ld, facts: { dualSelectionYear: year, graduationTerm: '2025-2' } };
    const list = linkableLeaves(rep(p)).filter(({ leaf }) => leaf.id.includes('ld-'));
    expect(list).toHaveLength(year < 2017 || year > 2026 ? 0 : year <= 2022 ? 4 : 5);
  });
  it('LD 미입력은 질문으로 남고 시행 이전·이후 졸업학기를 구분', () => {
    expect(rep(ld).questions.map((q) => q.field)).toEqual(expect.arrayContaining(['dualSelectionYear', 'graduationTerm']));
    for (const term of [undefined, '2025-1', '2025-2', '2026-1']) {
      const p = { ...ld, facts: { dualSelectionYear: 2023, ...(term ? { graduationTerm: term } : {}) } };
      const selected = rep(p).courseRules.filter((e) => e.rule.departmentId === ld.secondaryDepartmentId);
      expect(selected.length > 0).toBe(term === '2025-2' || term === '2026-1');
    }
    const html = render({ ...emptyState(), profile: ld }, QuestionsCard);
    expect(html).toContain('미정'); expect(html).toContain('이중전공을 선택(배정)받은 연도');
    expect(html).toContain('졸업 예정 학기'); expect(html).not.toMatch(/unknown|null|아직 모름/);
  });
  it.each([2024, 2025, 2026, 2027])('언어인지 선발 %i년 목록', (year) => {
    const p = { ...base, homeCampus: 'global' as const, primaryDepartmentId: deptId('통계학과'), secondaryDepartmentId: deptId('언어인지과학과'), facts: { ...base.facts, dualSelectionYear: year } };
    const own = rep(p).courseRules.filter((e) => e.rule.departmentId === p.secondaryDepartmentId);
    expect(own.flatMap((e) => allLeaves(e.rule.courses!))).toHaveLength(year === 2024 ? 1 : year <= 2026 ? 3 : 0);
  });
  it.each(['freshman', 'transferGeneral', 'transferBachelor'] as const)('ELLT %s 학위과정 미입력·선택', (entryType) => {
    const p = { ...base, entryType, secondaryDepartmentId: deptId('ELLT학과') };
    expect(rep(p).questions.some((q) => q.field === 'degreeTrack')).toBe(true);
    expect(rep(p).courseRules.filter((e) => e.rule.departmentId === p.secondaryDepartmentId)).toHaveLength(0);
    for (const degreeTrack of ['BA', 'BLS']) {
      const selected = rep({ ...p, facts: { ...base.facts, degreeTrack } }).courseRules.filter((e) => e.rule.departmentId === p.secondaryDepartmentId);
      expect(selected.length).toBeGreaterThan(0);
      expect(selected.flatMap((e) => allLeaves(e.rule.courses!))).toHaveLength(degreeTrack === 'BA' ? 5 : 6);
      expect(selected.every((e) => e.facts.degreeTrack === degreeTrack)).toBe(true);
    }
  });
  it.each(['freshman', 'transferGeneral', 'transferBachelor'] as const)('%s LD·언어인지: 2019~2026학번의 선발연도·졸업학기 경계', (entryType) => {
    for (let cohortYear = 2019; cohortYear <= 2026; cohortYear++) {
      for (const dualSelectionYear of [2016, 2017, 2022, 2023, 2024, 2025, 2026, 2027]) {
        for (const graduationTerm of [undefined, '2025-1', '2025-2', '2026-2']) {
          const p = { ...ld, cohortYear, entryType, facts: { ...base.facts, dualSelectionYear, ...(graduationTerm ? { graduationTerm } : {}) } };
          const own = rep(p).courseRules.filter((e) => e.rule.departmentId === p.secondaryDepartmentId);
          const expected = !graduationTerm || graduationTerm === '2025-1' || dualSelectionYear < 2017 || dualSelectionYear > 2026 ? 0 : dualSelectionYear <= 2022 ? 4 : 5;
          expect(own.flatMap((e) => allLeaves(e.rule.courses!)), JSON.stringify([entryType, cohortYear, dualSelectionYear, graduationTerm])).toHaveLength(expected);
        }
        const p = { ...base, cohortYear, entryType, homeCampus: 'global' as const, primaryDepartmentId: deptId('통계학과'),
          secondaryDepartmentId: deptId('언어인지과학과'), facts: { ...base.facts, dualSelectionYear } };
        const own = rep(p).courseRules.filter((e) => e.rule.departmentId === p.secondaryDepartmentId);
        expect(own.flatMap((e) => allLeaves(e.rule.courses!))).toHaveLength(dualSelectionYear <= 2024 ? 1 : dualSelectionYear <= 2026 ? 3 : 0);
      }
    }
  });
});

describe('R2: 미입력과 해당 없음 구분', () => {
  it('단과대학 자료가 없는 경우에도 미입력을 해당 없음(null)으로 만들지 않음', () => {
    expect(defaultAnswers(base, catalog.officialRules, () => undefined)).not.toHaveProperty('studentCollegeAtEntry');
  });
  it.each(['transferGeneral', 'transferBachelor'] as const)('%s 학번에서 편입학기·학년을 만들지 않음', (entryType) => {
    const p = { ...base, entryType };
    const defaults = defaultAnswers(p, catalog.officialRules, departmentFacts);
    expect(defaults).not.toHaveProperty('entryTerm'); expect(defaults).not.toHaveProperty('transferEntryGrade');
    const facts = factsFor(p, roleContexts(p)[0], departmentFacts);
    expect(facts).not.toHaveProperty('entryYear'); expect(facts).not.toHaveProperty('transferAdmissionTerm');
    const actual = factsFor({ ...p, facts: { entryTerm: '2023-2', transferEntryGrade: 2 } }, roleContexts(p)[0], departmentFacts);
    expect(actual).toMatchObject({ entryYear: 2023, transferAdmissionTerm: '2023-2', transferEntryGrade: 2 });
  });
  it('이미 답한 학위과정도 같은 입력에서 수정 가능, 다른 학과에는 불필요한 질문 없음', () => {
    const p = { ...base, secondaryDepartmentId: deptId('ELLT학과'), facts: { degreeTrack: 'BA' } };
    expect(render({ ...emptyState(), profile: p }, QuestionsCard)).toContain('학위 과정');
    expect(render({ ...emptyState(), profile: base }, QuestionsCard)).not.toContain('학위 과정');
  });
});

describe('R3: ELLT 사전 승인과 직접 확인 분리', () => {
  it('동일 코드 대체 성적도 자동 인정 차단, 체크는 학생 수준이고 학점·평점 불변', () => {
    const p = { ...base, primaryDepartmentId: deptId('ELLT학과'), facts: { ...base.facts, degreeTrack: 'BA', approvedRequiredCourseWaiver: false } };
    const r = rep(p);
    const leaf = linkableLeaves(r).find(({ leaf }) => leaf.name === '고급영어문법(1)')!.leaf;
    const c = course({ officialCode: leaf.code!, name: '고급영어문법', grade: 'A0', term: { academicYear: 2026, semester: '1' } });
    const before = [earnedUnits([c]), computeGpa([c])];
    const result = (ids: string[]) => evaluateCourseRules(r, [c], null, { dept: departmentById, confirmedLeafIds: ids });
    const find = (ps: NodeProgress[]): NodeProgress | undefined => ps.find((x) => x.node.op === 'course' && x.node.id === leaf.id)
      ?? ps.flatMap((x) => x.children ?? []).map((x) => find([x])).find(Boolean);
    expect(find(result([]).map((x) => x.root))).toMatchObject({ level: 0, state: 'unmet' });
    expect(find(result([leaf.id]).map((x) => x.root))).toMatchObject({ level: 1, state: 'selfConfirmed' });
    expect([earnedUnits([c]), computeGpa([c])]).toEqual(before);
    expect(p.facts).not.toHaveProperty('approvedCourseReplacement');
  });
});

describe('R4: 요건 없음·입력 부족·자료 미확보 안내', () => {
  it('공식 없음은 유지하고 자료 부족은 문의 안내', () => {
    const none = { ...base, primaryDepartmentId: deptId('중국언어문화전공'), cohortYear: 2020 };
    expect(rep(none).coverage.find((r) => r.scope === 'primary' && r.category === 'requiredCourses')?.basis).toBe('none');
    expect(render({ ...emptyState(), profile: none })).toContain('요건 없음');
    const missing = { ...base, secondaryDepartmentId: deptId('경제학부') };
    const html = render({ ...emptyState(), profile: missing });
    expect(html).toContain('현재 자료만으로는 본인에게 적용되는 기준을 확인하기 어려워요.');
    expect(html).toContain('tel:'); expect(html).not.toMatch(/학교가 기준을 정하지|아직 모름|\[object Object\]/);
  });
});

describe('P1: 트리를 보존하는 개인 제외', () => {
  const leaf = (id: string): CourseExpr => ({ op: 'course', id, name: id, code: id, matching: 'code', creditUnits: 300 });
  const node = (op: 'OR' | 'AT_LEAST', count = 1): NodeProgress => ({ node: op === 'OR' ? { op, items: [leaf('a'), leaf('b')] }
    : { op, count, items: [leaf('a'), leaf('b')] }, level: 0, children: ['a', 'b'].map((id) => ({ node: leaf(id), level: 0 })) });
  it.each(['OR', 'AT_LEAST'] as const)('%s 후보 하나·전체 제외해도 의무량 유지', (op) => {
    expect(checklistCount(node(op), new Set(['a']))).toEqual([0, 1]);
    expect(checklistCount(node(op), new Set(['a', 'b']))).toEqual([0, 1]);
  });
  it('2과목 이상과 중첩 ALL 갈래도 제외로 자동 충족하지 않음', () => {
    const two = node('AT_LEAST', 2); two.children![0].level = 1;
    expect(checklistCount(two, new Set(['b']))).toEqual([1, 2]);
    const inner: NodeProgress = { node: { op: 'ALL', items: [leaf('a'), leaf('b')] }, level: 0,
      children: [{ node: leaf('a'), level: 1 }, { node: leaf('b'), level: 0 }] };
    const outer: NodeProgress = { node: { op: 'OR', items: [inner.node] }, level: 0, children: [inner] };
    expect(checklistCount(outer, new Set(['b']))).toEqual([0, 1]);
  });
  it('경영 9개 완료 + 택일 미완료 = 9/10, 전부 숨겨도 9/10', () => {
    const r = rep({ ...base, primaryDepartmentId: 'seoul-business', secondaryDepartmentId: 'seoul-malay-indonesian' });
    const group = r.courseRules.find((e) => e.rule.courses?.op === 'ALL' && e.rule.courses.items.some((n) => n.op === 'OR'))!;
    expect(group).toBeDefined();
    const expr = group.rule.courses!;
    const ids = expr.op === 'ALL' ? expr.items.filter((n) => n.op === 'course').flatMap(allLeaves) : [];
    const root = evaluateCourseRules({ ...r, courseRules: [group] }, [], null, { confirmedLeafIds: ids })[0].root;
    const choice = expr.op !== 'course' ? expr.items.find((n) => n.op === 'OR')! : expr;
    expect(checklistCount(root, new Set(allLeaves(choice).slice(0, 1)))).toEqual([9, 10]);
    expect(checklistCount(root, new Set(allLeaves(choice)))).toEqual([9, 10]);
  });
  it('개인 제외 후의 완료를 공식 면제·공식 전체 충족으로 바꾸지 않음', () => {
    const r = rep(base); const own = r.courseRules.filter((e) => e.rule.departmentId === base.primaryDepartmentId);
    const ids = own.flatMap((e) => allLeaves(e.rule.courses!));
    const s = scopeStatusEdits({ ...emptyState(), profile: base });
    s.statusEdits!.removed = [ids[0]];
    s.certConfirmations = ids.slice(1).map((requirementId) => ({ requirementId, confirmedAt: '2026-10-30' }));
    const html = render(s); expect(html).toContain('10/10과목'); expect(html).toContain('개인 기준 완료');
    expect(evaluateCourseRules({ ...r, courseRules: own }, [], null, { confirmedLeafIds: ids.slice(1) }).every((p) => p.root.level === 0)).toBe(true);
  });
});

describe('P2: 개인 편집 문맥·저장 호환', () => {
  function edited() {
    const s = scopeStatusEdits({ ...emptyState(), profile: base });
    s.statusEdits!.extraCourses.push({ id: 'xc-stable', card: 'primary', name: '직접 추가' });
    s.statusEdits!.renamed['official'] = '수정'; s.statusEdits!.removed.push('hidden');
    s.statusEdits!.boxes.push({ id: 'bx-stable', kind: 'primary' });
    s.certConfirmations.push({ requirementId: 'xc-stable', confirmedAt: '2026-10-30' });
    return s;
  }
  it.each([{ primaryDepartmentId: deptId('경제학부') }, { cohortYear: 2025 }, { entryType: 'transferGeneral' as const },
    { programType: 'minor' as const }, { secondaryDepartmentId: deptId('ELLT학과') }, { facts: { dualSelectionYear: 2023 } }])('조건 변경 %j 시 혼입 없음, 되돌리면 복원', (change) => {
    const s = edited(); const changed = scopeStatusEdits({ ...s, profile: { ...base, ...change } });
    expect(changed.statusEdits).toEqual(emptyEdits()); expect(changed.certConfirmations).toEqual([]);
    const back = scopeStatusEdits({ ...changed, profile: base });
    expect(back.statusEdits).toEqual(s.statusEdits); expect(back.certConfirmations).toEqual(s.certConfirmations);
  });
  it('기존 소속 미기록 자료는 삭제 없이 별도 보관, 현재 전공에 임의 적용 안 함', () => {
    const raw = edited(); delete raw.statusEditContext; delete raw.statusEditContexts;
    const migrated = scopeStatusEdits(migrate(raw));
    expect(migrated.statusEdits).toEqual(emptyEdits());
    expect(migrated.statusEditContexts!['legacy-unassigned'].edits).toEqual(raw.statusEdits);
    expect(migrated.statusEditContexts!['legacy-unassigned'].confirmations).toEqual(raw.certConfirmations);
    expect(appStateSchema.safeParse(migrated).success).toBe(true);
  });
  it('새로고침·합성 성적 재가져오기 후 설정·체크·성적 유지', async () => {
    const s = edited(); await saveState(s); const loaded = scopeStatusEdits((await loadState())!);
    expect(loaded.statusEdits).toEqual(s.statusEdits); expect(loaded.certConfirmations).toEqual(s.certConfirmations);
    const parsed = parseTranscript(TRANSCRIPT_FIXTURE);
    const decisions = { link: {}, conflictChoice: {}, removeMissing: false };
    const first = applyMerge(loaded, parsed, planMerge(loaded, parsed), decisions, new Date('2026-10-30'));
    const imported = scopeStatusEdits(applyMerge(first, parsed, planMerge(first, parsed), decisions, new Date('2026-10-30')));
    expect(imported.courses).toHaveLength(6);
    expect(imported.courses.map((c) => c.id)).toEqual(first.courses.map((c) => c.id));
    expect(imported.statusEdits).toEqual(s.statusEdits); expect(imported.certConfirmations).toEqual(s.certConfirmations);
    await saveState(imported); expect(await loadState()).toEqual(imported);
  });
});

describe('P3: 성적의 유효성·표시명과 매칭 분리', () => {
  it.each(['excluded', 'timetable', 'current', 'retaken'] as const)('%s 성적을 자동 완료로 쓰지 않음', (kind) => {
    const p = { ...base, primaryDepartmentId: deptId('경제학부') };
    const r = rep(p); const leaf = linkableLeaves(r)[0].leaf;
    const valid = course({ id: 'old', name: leaf.name, officialCode: leaf.code ?? undefined, grade: 'A0' });
    const invalid = { ...valid, ...(kind === 'excluded' ? { earnedInclusion: 'excluded' as const }
      : kind === 'timetable' ? { origin: 'timetable' as const } : kind === 'current' ? { status: 'inProgress' as const } : {}) };
    const courses = [invalid, ...(kind === 'retaken' ? [course({ replacesCourseId: 'old', grade: 'F' })] : [])];
    expect(evaluateCourseRules(r, courses, null).every((x) => x.root.level === 0)).toBe(true);
    expect(effectiveCourses(courses).filter((c) => c.id === 'old' && c.earnedInclusion === 'included').length).toBe(kind === 'retaken' ? 0 : Number(kind !== 'excluded'));
  });
  it('추가 과목의 이름 일치만으로 완료 안 됨, 이름 수정 후 ID·직접 체크 유지', () => {
    const s = scopeStatusEdits({ ...emptyState(), profile: base, courses: [course({ name: '경제학원론', grade: 'A0' })] });
    s.statusEdits!.extraCourses = [{ id: 'xc', card: 'primary', name: '경제학원론' }];
    const before = render(s); expect(before).toContain('0/12과목');
    s.certConfirmations = [{ requirementId: 'xc', confirmedAt: '2026-10-30' }];
    s.statusEdits!.extraCourses[0].name = '표시명 수정';
    expect(render(s)).toContain('1/12과목'); expect(s.statusEdits!.extraCourses[0].id).toBe('xc');
    expect(s.courses).toHaveLength(1);
  });
  it('명시적으로 연결한 실제 인정 성적만 사용하고 표시명 변경과 분리', () => {
    const valid = course({ id: 'good', name: '성적 원본 이름', grade: 'A0', requirementLinks: ['xc-linked'] });
    const excluded = { ...course({ grade: 'A0', requirementLinks: ['excluded'] }), earnedInclusion: 'excluded' as const };
    const current = course({ status: 'inProgress', requirementLinks: ['current'] });
    const timetable = course({ grade: 'A0', origin: 'timetable', requirementLinks: ['timetable'] });
    const old = course({ id: 'old', grade: 'A0', requirementLinks: ['retaken'] });
    expect([...linkedChecklistIds([valid, excluded, current, timetable, old, course({ replacesCourseId: 'old', grade: 'B0' })])]).toEqual(['xc-linked']);
    const s = scopeStatusEdits({ ...emptyState(), profile: base, courses: [valid] });
    // 새 문맥에 명시적으로 연결한 과목으로 설정한다.
    s.courses = [valid]; s.statusEdits!.extraCourses = [{ id: 'xc-linked', card: 'primary', name: '수정한 표시명' }];
    expect(render(s)).toContain('1/12과목'); expect(valid.name).toBe('성적 원본 이름');
  });
});

describe('P4: 삭제·복구·ID 안정성', () => {
  it.each(['course', 'exam'])('%s 직접 항목 삭제는 체크·연결도 정리, 실제 성적 보존', (kind) => {
    const s = scopeStatusEdits({ ...emptyState(), profile: base });
    s.statusEdits!.extraCourses = [{ id: 'x', card: 'primary', name: '추가' }];
    s.statusEdits!.extraExams = [{ id: 'x', card: 'primary', title: '추가', detail: '' }];
    s.certConfirmations = [{ requirementId: 'x', confirmedAt: '2026-10-30' }];
    s.courses = [course({ requirementLinks: ['x'], requiredClaim: 'studentMarked', grade: 'A0' })];
    const after = deleteChecklistItem(s, kind === 'course' ? s.statusEdits!.extraCourses[0].id : s.statusEdits!.extraExams[0].id, true);
    expect(after.statusEdits!.extraCourses).toEqual([]); expect(after.statusEdits!.extraExams).toEqual([]);
    expect(after.certConfirmations).toEqual([]); expect(after.courses[0].requirementLinks).toEqual([]);
    expect(after.courses[0].requiredClaim).toBe('none');
    expect(after.courses[0].grade).toBe('A0'); expect(after.courses).toHaveLength(1);
  });
  it('공식 항목 제외·복구는 원본과 체크 보존', () => {
    const s = { ...emptyState(), profile: base, certConfirmations: [{ requirementId: 'official', confirmedAt: '2026-10-30' }] };
    const hidden = deleteChecklistItem(s, 'official', false);
    expect(hidden.statusEdits!.removed).toContain('official'); expect(hidden.certConfirmations).toEqual(s.certConfirmations);
    const restored = deleteChecklistItem(hidden, 'official', false);
    expect(restored.statusEdits!.removed).toEqual([]); expect(restored.certConfirmations).toEqual(s.certConfirmations);
  });
  it('같은 내용의 순서 변경은 ID를 바꾸지 않고, 과목명이 다른 항목은 다른 ID', () => {
    const result = execFileSync(process.execPath, ['--input-type=module', '-e', `import {stableCourseId} from './scripts/requirement-ids.mjs';
      const make = xs => Object.fromEntries(xs.map(name => [name,stableCourseId('r','C',name,'/ALL/OR')]));
      console.log(JSON.stringify([make(['가','나']),make(['나','가'])]));`], { encoding: 'utf8' });
    const [first, reordered] = JSON.parse(result);
    expect(first).toEqual(reordered); expect(first['가']).not.toBe(first['나']);
    const current = new Set([...catalog.officialRules.flatMap((r) => r.courses ? allLeaves(r.courses) : []), ...catalog.bundles.flatMap((b) => b.requiredCourseGroups.map((g) => g.id))]);
    for (const id of Object.values(migrationIds)) expect(current.has(id), id).toBe(true);
    expect(current.size).toBe(Object.keys(migrationIds).length);
    const old = Object.keys(migrationIds)[0];
    expect(migrateChecklistIds({ edits: { ...emptyEdits(), removed: [old, 'unmapped'] }, confirmations: [], links: {} }).edits.removed)
      .toEqual([(migrationIds as Record<string, string>)[old], 'unmapped']);
  });
});

describe('졸업평가 조립과 표시', () => {
  it('전 학과 평가 요약은 원문을 보존하고 긴 조사 메모를 표시하지 않음', () => {
    for (const r of catalog.officialRules.filter((r) => ['departmentAssessment', 'commonLanguageCertification'].includes(r.category))) {
      const before = JSON.stringify(r.detail);
      const text = briefAssessment(r.detail);
      expect(JSON.stringify(r.detail), r.id).toBe(before);
      expect(text, r.id).not.toMatch(/numeric|OPIcOrderedLevel|\[object Object\]|\bgraduation\b|일률적 2년 지정 안 함|본 기준표만으로/);
    }
    const common = briefAssessment(catalog.officialRules.find((r) => r.id === 'common-language-seoul-general')!.detail);
    for (const criterion of ['621점 이상', '170점 이상', '710점 이상', '120점 이상', 'IM1등급 이상', '80시간 이상', '제출일에 유효한 성적 필요']) expect(common).toContain(criterion);
    const ellt = briefAssessment(catalog.officialRules.find((r) => r.id === 'dept-language-ellt-seoul-dual')!.detail);
    expect(ellt).toContain('FLEX'); expect(ellt).toContain('610점');
    expect(ellt).toContain('TOEIC'); expect(ellt).toContain('805점');
    expect(ellt).toContain('외국어(영어) 인증 제출');
    expect(ellt).toContain('기준 확인 필요');
    expect(briefAssessment({ type: 'languageTest', test: 'FLEX', minimumScore: 600, approvalBeforeCourseRequired: true, evidenceRequired: true }))
      .toMatch(/600점 이상.*수강 전 승인 필요.*증빙 필요/);
    expect(briefAssessment({ condition: { op: 'eq', field: 'entryType', value: 'transferGeneral' }, evidenceRequired: true }))
      .toMatch(/입학 유형: 일반편입.*증빙 필요/);
  });
  it('말레이 주전공·ELLT 이중 학교 공통 카드에 분류용 제목·데이터 나열을 노출하지 않음', () => {
    const profile = { ...base, secondaryDepartmentId: deptId('ELLT학과'), facts: { ...base.facts, degreeTrack: 'BA' } };
    const html = groupAssessments(rep(profile)).filter((g) => g.eval.rule.category === 'commonLanguageCertification')
      .map((g) => `${ruleTitle(g.eval.rule)} ${describeAssessment(g.eval.rule.detail)}`).join(' ');
    expect(html).toContain('영어 졸업인증');
    expect(html).toContain('다음 중 하나를 충족해 주세요');
    expect(html).toContain('FLEX 621점 이상');
    expect(html).not.toMatch(/서울 비영어|seoul 비영어|학교 외국어 인증 · 언어: 영어 · 하나 선택|numeric|OPIcOrderedLevel/);
  });
  it('학교 영어 인증은 시험별 점수·등급과 면제 조건을 읽을 수 있게 표시한다', () => {
    const rule = catalog.officialRules.find((r) => r.id === 'common-language-seoul-general')!;
    const text = describeAssessment(rule.detail);
    expect(text).not.toMatch(/numeric|OPIcOrderedLevel|submissionDate|generalTransfer|bachelorTransfer|>=|\[object Object\]/);
    for (const criterion of ['621점 이상', '170점 이상', '710점 이상', '120점 이상', 'IM1등급 이상', '80시간 이상']) expect(text).toContain(criterion);
    expect(text).toContain('일반편입 또는 학사편입');
    expect(text).toContain('제외 전공 구성: 이중전공 / 전공심화·부전공');
    expect(text.match(/일률적 2년 지정 안 함/g)).toHaveLength(1);
    expect(text).toContain('과정별 대상·수료 조건 추가 확인 필요');
    expect(text).toContain('외국어연수평가원(서울)');
  });
  it('전체 확보한 평가 데이터: 내부 type·객체 문자열 노출 없음, 수치·단위·논리 보존', () => {
    for (const r of catalog.officialRules.filter((r) => ['departmentAssessment', 'commonLanguageCertification'].includes(r.category))) {
      const text = describeAssessment(r.detail);
      expect(text, r.id).not.toMatch(/\[object Object\]|languageTest|departmentExam|departmentLanguageScore|courseCredits|\bunknown\b|\bnull\b/);
    }
    expect(describeAssessment({ op: 'ALL', items: [{ type: 'languageTest', test: 'TOEIC', minimumScore: 900 },
      { type: 'courseCredits', minimumCredits: 6 }, { type: 'courseCompletion', minimumHours: 80 }] }))
      .toMatch(/모두 필요.*TOEIC.*900.*점.*6.*학점.*80.*시간/);
    expect(describeAssessment({ type: 'unrecognizedType' })).toBe('확인 필요');
    expect(describeAssessment({ test: 'FLEX', threshold: { value: 300 }, operator: '>' })).toContain('> 300');
    const ai = catalog.officialRules.find((r) => r.id === 'last-ai-data-assessment')!;
    expect(describeAssessment(ai.detail)).toMatch(/캡스톤 논문 통과.*학회 논문 제1저자 제출.*교외 대회 수상/);
    expect(describeAssessment(ai.detail)).toContain('캡스톤 수강 필수: 필요');
  });
  it('EICC 기타언어 한 의무와 학과 영어 평가 유지, 중국어 보충 입력 없음', () => {
    const p = { ...base, primaryDepartmentId: deptId('영어통번역(EICC)학과') };
    const r = rep(p); const gs = groupAssessments(r);
    expect(gs.filter((g) => g.eval.rule.category === 'commonLanguageCertification')).toHaveLength(1);
    expect(gs.some((g) => g.eval.rule.id === 'scope-eicc-english-assessment')).toBe(true);
    expect(gs.some((g) => g.eval.rule.type === 'commonLanguageCertificationOption')).toBe(false);
    expect(r.questions.some((q) => q.field === 'certificationLanguage')).toBe(false);
  });
  it('폐지·행정·접수·면제 안내는 독립 의무로 체크하지 않음, 제출 의무는 유지', () => {
    for (const id of ['chinese-pdf-thesis-removed-seoul-f94625560c', 'chinese-pdf-thesis-removed-seoul-5f6617f421',
      'chinese-pdf-thesis-removed-seoul-70ffe9c6dd', 'dept-language-jp2-seoul-minor', 'dept-exam-econ-seoul-policy',
      'dept-exam-jit-global', 'dept-exam-gbt-global-administration']) {
      expect(assessmentRole(catalog.officialRules.find((r) => r.id === id)!), id).toBe('information');
    }
    expect(assessmentRole(catalog.officialRules.find((r) => r.id === 'dept-thesis-ee-global')!)).toBe('obligation');
  });
  it('영미 통합 기준은 과거 부분 기준 중복 제거', () => {
    const p = { ...base, primaryDepartmentId: deptId('영미문학·문화학과'), facts: { ...base.facts, graduationTerm: '2026-2' } };
    const groups = groupAssessments(rep(p)); const ids = groups.map((g) => g.eval.rule.id);
    expect(ids).toContain('dept-exam-elc-seoul');
    expect(ids).not.toContain('dept-exam-elc-toeic805-flex721'); expect(ids).not.toContain('dept-exam-elc-added-tests-2023-2');
    expect(describeAssessment(groups.find((g) => g.eval.rule.id === 'dept-exam-elc-seoul')!.eval.rule.detail)).toMatch(/610.*805.*94.*6.5/);
  });
  it('GBT 본 시험·프로젝트·전체 면제·접수 안내를 한 의무에 연결하고 제출·승인 유지', () => {
    const p = { ...base, homeCampus: 'global' as const, primaryDepartmentId: deptId('Global Business & Technology학부'),
      secondaryDepartmentId: deptId('통계학과'), facts: { ...base.facts, graduationTerm: '2026-2' } };
    const gs = groupAssessments(rep(p)).filter((g) => g.eval.rule.departmentId === p.primaryDepartmentId);
    expect(gs.map((g) => g.eval.rule.id)).toEqual(['dept-gbt-project-pass-or-exam-primary']);
    const g = gs[0];
    expect(g.alternatives.map((a) => a.rule.id)).toContain('stage2-gbt-exam-full-waiver');
    expect(g.information.map((a) => a.rule.id)).toContain('stage2-gbt-exam-policy');
    const waiver = describeAssessment(g.alternatives.find((a) => a.rule.id === 'stage2-gbt-exam-full-waiver')!.rule.detail);
    expect(waiver).toContain('신청서와 증빙 모두 필요: 필요'); expect(waiver).toContain('학과 승인 필요: 필요');
    expect(waiver).toContain('학교 공통 어학인증 자동 면제 안 됨: 필요');
  });
  it.each(['중국언어문화전공', '정치외교학과', '포르투갈어과'])('%s 승인 대체는 관련 의무의 선택지, 설명을 별도 의무로 만들지 않음', (name) => {
    const p = { ...base, primaryDepartmentId: deptId(name), facts: { ...base.facts, graduationTerm: '2026-2' } };
    const own = groupAssessments(rep(p)).filter((g) => g.eval.rule.departmentId === p.primaryDepartmentId);
    expect(own.length).toBeGreaterThan(0);
    expect(own.flatMap((g) => g.alternatives).length).toBeGreaterThan(0);
    expect(own.every((g) => assessmentRole(g.eval.rule) !== 'information')).toBe(true);
    const strings = own.flatMap((g) => g.alternatives.map((a) => describeAssessment(a.rule.detail)));
    expect(strings.join(' · ')).toMatch(/승인|학과|확인 필요/);
  });
});


describe('LD 학생 조건 입력 안내와 학과 문의 분리', () => {
  const section = (html: string) => {
    const start = html.indexOf('<section id="st-exams"');
    return html.slice(start, html.indexOf('</section>', start));
  };
  it.each(['primary', 'dual'] as const)('%s 졸업학기 미정이면 입력은 유지하고 긴 문의 안내는 숨긴다', (role) => {
    const profile = { ...base, primaryDepartmentId: role === 'primary' ? deptId('Language & Diplomacy학부') : 'seoul-business',
      secondaryDepartmentId: role === 'dual' ? deptId('Language & Diplomacy학부') : undefined,
      programType: role === 'dual' ? 'double' as const : 'intensive' as const,
      facts: { ...base.facts, dualSelectionYear: 2023 } };
    const html = render({ ...emptyState(), profile });
    const exams = section(html);
    expect(html).toContain('졸업 예정 학기');
    expect(exams).not.toContain('국립외교원 응시 경로는');
    expect(exams).not.toContain('02-2173-2114');
    expect(exams).not.toContain('현재 자료만으로는 본인에게 적용되는 기준을 확인하기 어려워요.');
  });
  it('시행 이전 기준은 확정하지 않고 학과 안내로 연결한다', () => {
    const profile = { ...base, primaryDepartmentId: deptId('Language & Diplomacy학부'), secondaryDepartmentId: undefined,
      programType: 'intensive' as const, facts: { ...base.facts, graduationTerm: '2025-1', dualSelectionYear: 2023 } };
    const html = section(render({ ...emptyState(), profile }));
    expect(html).not.toContain('2026년 1월 졸업부터');
    const guidance = departmentAssessmentGuides(profile, catalog.officialRules, departmentFacts).map((g) => g.text).join(' ');
    expect(guidance).toContain('2026년 1월 졸업부터');
    expect(guidance).toContain('적용 범위는 학과 안내 확인');
  });
});

describe('외국어 특기자 전형: 기본은 아니요, 해당 학생만 직접 켠다', () => {
  const german = { ...base, primaryDepartmentId: 'seoul-german', cohortYear: 2021 };
  const courses = (html: string) => {
    const start = html.indexOf('<section id="st-courses"');
    return html.slice(start, html.indexOf('</section>', start));
  };
  const HINT = '외국어 특기자 등 특별전형으로 입학했다면 전공 정보에서 바꿔 주세요';
  const germanEval = (p: StudentProfile) => rep(p).evals.find((e) => e.rule.id === 'core-german-primary-2019-2024');

  it('신입학·체크 안 함: 전필 목록을 기본값으로 판정하고 안내 한 줄을 보인다', () => {
    const profile: StudentProfile = { ...german, facts: {} };
    const e = germanEval(profile);
    expect(e?.cls).toBe('confirmed');
    expect(e?.fallbackFields).toContain('foreignLanguageSpecialAdmission');
    const leaves = rep(profile).courseRules.filter((x) => x.rule.id === 'core-german-primary-2019-2024')
      .flatMap((x) => allLeaves(x.rule.courses!));
    expect(leaves).toHaveLength(4);
    const html = courses(render({ ...emptyState(), profile }));
    expect(html).toContain('4과목');
    expect(html).not.toContain('추가 입력 필요');
    expect(html).toContain(HINT);
  });

  it('신입학·체크함: 일반 목록 대신 학과 확인 안내를 보이고 특기자 전용 규칙은 적용한다', () => {
    const profile: StudentProfile = { ...german, facts: { foreignLanguageSpecialAdmission: true } };
    expect(germanEval(profile)).toBeUndefined();
    const html = courses(render({ ...emptyState(), profile }));
    expect(html).toContain('특별전형 입학생 기준은 학과에 확인해 주세요');
    expect(html).not.toContain(HINT);
    // 특기자 전용 규칙은 해당 학과 학생에게 그대로 적용된다
    const russian = rep({ ...base, primaryDepartmentId: 'seoul-78afe4e5e6', cohortYear: 2021,
      facts: { foreignLanguageSpecialAdmission: true } });
    expect(russian.evals.map((x) => x.rule.id)).toContain('remaining-russian-special-course-replacement');
  });

  it('편입생: 체크박스를 보이지 않고 목록은 기본값 안내 없이 보인다', () => {
    const profile: StudentProfile = { ...german, entryType: 'transferGeneral', facts: {} };
    expect(germanEval(profile)?.fallbackFields).not.toContain('foreignLanguageSpecialAdmission');
    expect(courses(render({ ...emptyState(), profile }))).not.toContain(HINT);
    expect(render({ ...emptyState(), profile }, () => <ProfileForm onDone={() => {}} submitLabel="저장" />))
      .not.toContain('외국어 특기자 등 특별전형으로 입학했어요');
    expect(render({ ...emptyState(), profile: { ...german, facts: {} } }, () => <ProfileForm onDone={() => {}} submitLabel="저장" />))
      .toContain('외국어 특기자 등 특별전형으로 입학했어요');
  });
});

describe('03 졸업시험 요건 직접 수정', () => {
  // 학과 졸업시험 항목은 체크·이름 수정 전에는 목록에 없다. 요건만 고쳐도 남는지 보는 기준 항목.
  const examId = () => groupAssessments(rep(base)).find((g) => g.eval.rule.departmentId === base.primaryDepartmentId)!.eval.rule.id;

  it('기본 시험·직접 추가 시험의 요건을 저장하고 새로고침 후에도 유지한다', async () => {
    const s = scopeStatusEdits({ ...emptyState(), profile: base });
    s.statusEdits!.extraExams = [{ id: 'xe-stable', card: 'primary', title: '직접 추가 시험', detail: '600 이상' }];
    s.statusEdits!.redetailed![examId()] = '700 이상';
    expect(appStateSchema.safeParse(s).success).toBe(true);
    await saveState(s);
    const loaded = scopeStatusEdits((await loadState())!);
    expect(loaded.statusEdits!.redetailed![examId()]).toBe('700 이상');
    expect(loaded.statusEdits!.extraExams[0].detail).toBe('600 이상');
    // 직접 추가 항목을 지우면 고친 요건 키도 함께 정리한다
    const after = deleteChecklistItem({ ...loaded, statusEdits: { ...loaded.statusEdits!, redetailed: { 'xe-stable': '600 이상' } } }, 'xe-stable', true);
    expect(after.statusEdits!.redetailed).toEqual({});
  });

  it('redetailed가 없는 옛 저장 데이터도 그대로 읽는다', () => {
    const old = { ...emptyEdits(), renamed: { official: '수정' } };
    delete (old as { redetailed?: unknown }).redetailed;
    expect(appStateSchema.safeParse({ ...emptyState(), statusEdits: old }).success).toBe(true);
    const migrated = migrateChecklistIds({ edits: old, confirmations: [], links: {} });
    expect(migrated.edits.redetailed).toEqual({});
    expect(migrated.edits.renamed).toEqual({ official: '수정' });
  });

  it('이름을 고치지 않고 요건만 고쳐도 항목이 목록에 남는다', () => {
    const id = examId();
    const plain = render({ ...emptyState(), profile: base });
    const s = scopeStatusEdits({ ...emptyState(), profile: base });
    s.statusEdits!.redetailed![id] = '내가 고친 기준 700';
    const edited = render(s);
    const placeholders = (html: string) => html.split('졸업 시험 및 요건 안내').length - 1;
    // 안내만 있던 카드에 항목이 생겨 접힌 줄이 시험 제목으로 바뀐다
    expect(placeholders(edited)).toBe(placeholders(plain) - 1);
  });
});

describe("입력할 곳 없는 '추가 입력 필요' 문구 정리", () => {
  const courseSection = (html: string) => {
    const start = html.indexOf('<section id="st-courses"');
    return html.slice(start, html.indexOf('</section>', start));
  };

  it('화면에서 묻는 질문이 하나도 없으면 학과 확인 필요로 적는다', () => {
    // 전형 질문은 화면에서 묻지 않는다 (답이 없는 상태로 둔다)
    const r = rep({ ...base, facts: {} });
    const e = r.evals.find((x) => x.rule.id === 'core-malay-flex-primary')!;
    expect(e.cls).toBe('needsInput');
    expect(e.askFields.filter(isAskedOnScreen)).toHaveLength(0);
    const note = noteFrom(e, departmentName);
    expect(note.text).toContain('학과 확인 필요');
    expect(note.text).not.toContain('추가 입력 필요');
    expect(note.askable).toBe(false);
    // 면제·승인만 남은 줄은 기존 문구를 그대로 쓴다
    const waiver = r.evals.find((x) => x.rule.id === 'common-language-seoul-general')!;
    expect(noteFrom(waiver, departmentName).text).toContain('면제·승인 여부 확인 필요');
  });

  it('묻지 않는 필드는 질문 목록에도 없고 문구와 같은 목록을 쓴다', () => {
    const html = render({ ...emptyState(), profile: { ...base, facts: {} } }, QuestionsCard);
    for (const field of UNASKED_FIELDS) expect(html).not.toContain(ASKABLE_FIELDS[field].label);
    expect([...UNASKED_FIELDS].every((f) => !isAskedOnScreen(f))).toBe(true);
  });

  it("02 카드의 '확인 필요 · …' 문구는 제목 줄에 한 번만 나온다", () => {
    const profile: StudentProfile = { ...base, homeCampus: 'global', primaryDepartmentId: 'global-9e8d6a6731',
      programType: 'intensive', secondaryDepartmentId: undefined, cohortYear: 2021, facts: {} };
    const sec = courseSection(render({ ...emptyState(), profile }));
    expect(rep(profile).coverage.find((r) => r.scope === 'primary' && r.category === 'requiredCourses')!
      .notes.some((n) => n.kind === 'needsInput')).toBe(true);
    expect(sec.split('확인 필요 · ').length - 1).toBe(1);
  });
});
