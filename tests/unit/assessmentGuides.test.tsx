import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { useStore } from '../../src/app/store';
import { catalog, departmentFacts, departmentMetaById } from '../../src/data';
import { departmentAssessmentGuides } from '../../src/domain/requirements/assessment';
import { buildOfficialReport } from '../../src/domain/requirements/officialRules';
import { emptyEdits, emptyState } from '../../src/domain/state';
import type { StudentProfile } from '../../src/domain/types';
import { QuestionsCard } from '../../src/features/academic-status/OfficialSections';
import { StatusScreen } from '../../src/features/academic-status/StatusScreen';

vi.mock('../../src/app/store', () => ({ useStore: vi.fn() }));
const base: StudentProfile = { schemaVersion: 1, homeCampus: 'seoul', cohortYear: 2024, entryType: 'freshman',
  primaryDepartmentId: 'seoul-malay-indonesian', programType: 'double', secondaryDepartmentId: 'seoul-business',
  currentTerm: { academicYear: 2026, semester: '2' } };
const guides = (profile: StudentProfile) => departmentAssessmentGuides(profile, catalog.officialRules, departmentFacts);
function setup(profile = base) {
  const state = { ...emptyState(), profile };
  const report = buildOfficialReport({ profile, bundles: catalog.bundles, rules: catalog.officialRules,
    supportGaps: catalog.supportGaps, dept: departmentFacts, meta: departmentMetaById });
  vi.mocked(useStore).mockReturnValue({ state, report, resolved: report.resolved, now: new Date('2026-10-30'),
    save: vi.fn() } as unknown as ReturnType<typeof useStore>);
  return state;
}
const exams = (html: string) => html.slice(html.indexOf('<section id="st-exams"'), html.indexOf('</section>', html.indexOf('<section id="st-exams"')));

describe('학과 졸업평가는 안내, 사용자가 추가한 항목은 기존 체크리스트', () => {
  it.each(['freshman', 'transferGeneral', 'transferBachelor'] as const)('%s: 전형·면제 답 없이 말레이 주·이중 기준을 구분한다', (entryType) => {
    const primary = guides({ ...base, entryType }).filter((g) => g.scope === 'primary').map((g) => g.text).join(' ');
    const dual = guides({ ...base, entryType, primaryDepartmentId: 'seoul-business', secondaryDepartmentId: base.primaryDepartmentId })
      .filter((g) => g.scope === 'secondary').map((g) => g.text).join(' ');
    expect(primary).toContain('600점 이상'); expect(primary).toContain('500점 이상');
    expect(primary).toContain('9 이상'); expect(primary).toContain('졸업시험 재응시');
    expect(primary).toContain('최초 응시는 일반 점수');
    expect(dual).toContain('500점 이상'); expect(dual).toContain('450점 이상');
    expect(dual).not.toContain('600점 이상');
  });
  it('모든 학과·전공 구분에서 안내는 짧고 원본·학생 답은 바뀌지 않는다', () => {
    const original = JSON.stringify(catalog.officialRules);
    for (const d of catalog.departments) for (const role of ['primary', 'dual', 'minor']) {
      const profile: StudentProfile = { ...base, homeCampus: d.campus,
        primaryDepartmentId: role === 'primary' ? d.id : 'seoul-business',
        secondaryDepartmentId: role === 'primary' ? undefined : d.id, programType: role === 'dual' ? 'double' : 'minor' };
      const before = JSON.stringify(profile);
      for (const g of guides(profile).filter((g) => g.scope === (role === 'primary' ? 'primary' : 'secondary'))) {
        expect(g.text.length, `${d.id}/${role}/${g.id}`).toBeLessThan(450);
        expect(g.text).not.toMatch(/\[object Object\]|추가 입력 필요|적용 조건 확인 필요/);
        expect(g.scope).toBe(role === 'primary' ? 'primary' : 'secondary');
      }
      expect(JSON.stringify(profile)).toBe(before);
    }
    expect(JSON.stringify(catalog.officialRules)).toBe(original);
  });
  it('부전공에 주·이중 기준을 옮기지 않고 의무 없음과 자료 부족을 구분한다', () => {
    expect(guides({ ...base, programType: 'minor', primaryDepartmentId: 'seoul-business', secondaryDepartmentId: base.primaryDepartmentId })
      .filter((g) => g.scope === 'secondary')).toEqual([]);
    const french = catalog.departments.find((d) => d.name === '프랑스어학부')!;
    expect(guides({ ...base, programType: 'minor', secondaryDepartmentId: french.id }).map((g) => g.text).join(' ')).toContain('의무 없음');
  });
  it('전형·승인을 답했더라도 기본 기준 안내는 유지하고 시기별 기준은 표시한다', () => {
    expect(guides({ ...base, facts: { pureForeignAdmission: true, approvedRequiredCourseWaiver: true } })
      .find((g) => g.id === 'core-malay-flex-primary')?.text).toContain('600점 이상');
    const p = { ...base, primaryDepartmentId: catalog.departments.find((d) => d.name === '영어교육과')!.id };
    expect(guides(p).map((g) => g.text).join(' ')).toContain('졸업');
  });
  it('접힌 카드에서는 학과 안내를 숨기고 새로운 학과 체크 의무는 만들지 않는다', () => {
    setup();
    const html = exams(renderToStaticMarkup(<StatusScreen />));
    expect(html).not.toContain('sc-check-hint'); expect(html).not.toContain('600점 이상');
    expect(html).not.toContain('본인에게 해당하는 졸업 요건'); expect(html).not.toContain('학과 공식 안내');
    expect(html).not.toContain('졸업 요건 추가하기'); expect(html).toContain('졸업 시험 및 요건 안내');
    expect(html).not.toContain('추가 입력 필요'); expect(html).not.toContain('순수외국인');
    expect(html).not.toContain('확인 필요 · 말레이');
    expect(renderToStaticMarkup(<QuestionsCard />)).not.toContain('졸업평가 체계');
  });
  it('사용자 추가·이름 수정·체크·제외 기록을 지우지 않고 저장값은 그대로 둔다', () => {
    const state = setup({ ...base, facts: { foreignLanguageSpecialAdmission: false, pureForeignAdmission: false, approvedRequiredCourseWaiver: false } });
    state.statusEdits = { ...emptyEdits(), extraExams: [{ id: 'mine', card: 'primary', title: '직접 추가한 시험', detail: '합성 기준' }],
      renamed: { 'core-malay-flex-primary': '기존에 수정한 시험' }, removed: ['mine'] };
    state.certConfirmations = [{ requirementId: 'core-malay-flex-primary', confirmedAt: '' }, { requirementId: 'mine', confirmedAt: '' }];
    const before = JSON.stringify(state);
    const html = exams(renderToStaticMarkup(<StatusScreen />));
    expect(html).toContain('기존에 수정한 시험');
    expect(JSON.stringify(state)).toBe(before);
  });
});
