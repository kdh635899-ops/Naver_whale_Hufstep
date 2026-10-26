import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { useStore } from '../../src/app/store';
import { catalog, departmentFacts, departmentMetaById } from '../../src/data';
import { emptyState } from '../../src/domain/state';
import { buildOfficialReport, evaluateCourseRules } from '../../src/domain/requirements/officialRules';
import type { OfficialRule, StudentProfile } from '../../src/domain/types';
import { CoverageCard, CourseRulesBlock, InquiryContact, RuleItemsCard } from '../../src/features/academic-status/OfficialSections';
import { CourseEditor } from '../../src/features/courses/CourseEditor';
import { course } from '../fixtures';

vi.mock('../../src/app/store', () => ({ useStore: vi.fn() }));

const profile: StudentProfile = {
  schemaVersion: 1, homeCampus: 'seoul', cohortYear: 2025, entryType: 'freshman',
  primaryDepartmentId: 'seoul-german', programType: 'single', currentTerm: { academicYear: 2026, semester: '2' },
};
const rule = (id: string, name = '독일어문법'): OfficialRule => ({
  id, state: 'pending', status: 'verified', departmentId: 'seoul-german', category: 'requiredCourses', type: 'requiredCourses',
  condition: { op: 'eq', field: 'majorRole', value: 'primary' }, totalRequiredUnits: null, requiredUnitsByArea: {}, reasons: [], sourceIds: ['src-demo'],
  courses: { op: 'course', id: `${id}/leaf`, code: 'A1', name, creditUnits: 300, matching: 'code' },
});

function setup(rules = [rule('one')]) {
  const state = emptyState();
  state.profile = profile;
  state.consent.academicData = { version: '2026-10-23', at: '2026-10-26T00:00:00Z' };
  const report = buildOfficialReport({ profile, bundles: [], rules, supportGaps: [], dept: departmentFacts, meta: departmentMetaById });
  const store = { state, report, now: new Date('2026-10-26T00:00:00Z'), save: vi.fn(), openEditor: vi.fn(),
    editor: { preset: { name: '독일어문법 (German Grammar)', requiredClaim: 'studentMarked' } },
  } as unknown as ReturnType<typeof useStore>;
  vi.mocked(useStore).mockReturnValue(store);
  return store;
}

describe('과목 편집기를 실제 React HTML로 렌더링', () => {
  it('일치 하나는 선택 목록 없이 자동 연결 안내를 보여 준다', () => {
    setup();
    const html = renderToStaticMarkup(<CourseEditor />);
    expect(html).toContain('독일어문법 요건에 연결했어요');
    expect(html).not.toContain('어느 요건인가요');
    expect(html).toContain('재수강 과목이에요');
    expect(html).toContain('<summary>추가 정보</summary>');
  });
  it('일치가 여럿일 때만 선택 목록을 보여 준다', () => {
    setup([rule('one'), rule('two')]);
    const html = renderToStaticMarkup(<CourseEditor />);
    expect(html).toContain('어느 요건인가요');
    expect(html).toContain('value="one/leaf"');
    expect(html).toContain('value="two/leaf"');
  });
  it('일치가 없으면 학생 표시만 남기고 연결 목록을 보여 주지 않는다', () => {
    setup([rule('other', '다른 과목')]);
    const html = renderToStaticMarkup(<CourseEditor />);
    expect(html).toContain('연결할 요건이 없어요');
    expect(html).not.toContain('어느 요건인가요');
  });
  it('공식 매칭 과목에는 학생용 체크 대신 기존 안내만 보여 준다', () => {
    const store = setup();
    store.state.courses = [course({ id: 'official', requiredClaim: 'officialMatched' })];
    store.editor = { courseId: 'official' };
    const html = renderToStaticMarkup(<CourseEditor />);
    expect(html).toContain('공식 규칙으로 필수과목에 매칭된 과목이에요');
    expect(html).not.toContain('이 과목은 전공필수예요');
  });
  it('학생 연결은 체크된 해제 버튼과 ✓를 함께 렌더링한다', () => {
    const store = setup();
    store.state.courses = [course({ grade: 'A0', requirementLinks: ['one/leaf'], requiredClaim: 'studentMarked' })];
    const progress = evaluateCourseRules(store.report!, store.state.courses, null);
    const html = renderToStaticMarkup(<CourseRulesBlock progress={progress} courses={store.state.courses} />);
    expect(html).toContain('✓');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('· 내가 체크');
  });
});

describe('문의 안내와 기존 접기 구조를 실제 React HTML로 렌더링', () => {
  it('학교 문의 줄은 기본적으로 접혀 있고 출처나 연락처를 노출하지 않는다', () => {
    setup([{ ...rule('unconfirmed'), status: 'unverified', courses: undefined }]);
    const html = renderToStaticMarkup(<CoverageCard />);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('학번별 기준이 확실하지 않아요');
    expect(html).not.toContain('tel:');
    expect(html).not.toContain('mailto:');
    expect(html).not.toContain('출처:');
    expect(html).not.toContain('미충족');
  });
  it('몽골어과는 사무실 전화·메일만, 연락처 누락 시에는 캠퍼스 대표 번호를 표시한다', () => {
    const store = setup();
    const id = catalog.departments.find((d) => d.name === '몽골어과')!.id;
    const html = renderToStaticMarkup(<InquiryContact departmentId={id} />);
    expect(html).toContain('tel:0221732415');
    expect(html).toContain('mailto:mgl@hufs.ac.kr');
    expect(html).toContain('정확한 기준은 학과에 확인할 수 있어요');
    expect(html).not.toMatch(/https?:|checkedAt|2026-10-25/);
    store.state.profile = { ...profile, homeCampus: 'global' };
    const fallback = renderToStaticMarkup(<InquiryContact />);
    expect(fallback).toContain('tel:0313304114');
    expect(fallback).toContain('(학교 대표)');
  });
  it('학과 졸업시험·논문 표기와 접힌 참고 규정을 유지한다', () => {
    const store = setup();
    const base = { ...rule('exam'), courses: undefined, category: 'departmentAssessment', type: 'assessmentRequired',
      detail: { expression: { op: 'AND', items: [{ type: 'departmentExamPassed' }, { type: 'departmentThesisPassed' }] } } };
    store.report = buildOfficialReport({ profile, bundles: [], rules: [base, { ...base, id: 'reference', category: 'coursePolicy' }],
      supportGaps: [], dept: departmentFacts, meta: departmentMetaById });
    const html = renderToStaticMarkup(<RuleItemsCard />);
    expect(html).toContain('학과 졸업시험 통과');
    expect(html).toContain('학과 졸업논문 통과');
    expect(html).toContain('<details class="req-block"><summary><b>참고 규정 1개');
    expect(html).not.toContain('출처:');
  });
});
