import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { useStore } from '../../src/app/store';
import { catalog, departmentFacts, departmentMetaById } from '../../src/data';
import { emptyState } from '../../src/domain/state';
import { buildOfficialReport, evaluateCourseRules, linkableLeaves } from '../../src/domain/requirements/officialRules';
import type { StudentProfile } from '../../src/domain/types';
import { CoverageCard, CourseRulesBlock, RuleItemsCard } from '../../src/features/academic-status/OfficialSections';

vi.mock('../../src/app/store', () => ({ useStore: vi.fn() }));

// 실제 화면과 같은 판정기를 사용하고, 학생 입력은 가상 프로필로 고정한다.
function setup(departmentId: string, cohortYear: number, secondary: boolean | 'minor' = false, graduationTerm = '2026-2') {
  const profile: StudentProfile = {
    schemaVersion: 1, homeCampus: departmentId.startsWith('global-') ? 'global' : 'seoul',
    cohortYear, entryType: 'freshman', currentTerm: { academicYear: 2026, semester: '2' },
    primaryDepartmentId: secondary ? 'global-0a02a07bb4' : departmentId,
    programType: secondary === 'minor' ? 'minor' : secondary ? 'double' : 'single',
    ...(secondary && { secondaryDepartmentId: departmentId }),
    facts: { graduationTerm, foreignLanguageSpecialAdmission: false, pureForeignAdmission: false, approvedRequiredCourseWaiver: false },
  };
  const report = buildOfficialReport({ profile, bundles: catalog.bundles, rules: catalog.officialRules,
    supportGaps: catalog.supportGaps, dept: departmentFacts, meta: departmentMetaById });
  const state = { ...emptyState(), profile };
  vi.mocked(useStore).mockReturnValue({ state, report, now: new Date('2026-10-29T00:00:00Z'), save: vi.fn() } as unknown as ReturnType<typeof useStore>);
  const leaves = linkableLeaves(report).map(({ leaf }) => leaf);
  const html = renderToStaticMarkup(<CourseRulesBlock progress={evaluateCourseRules(report, [], null)} courses={[]} />);
  return { report, leaves, html };
}

describe('2026-10-29 학과 메일 답변 회귀 검사', () => {
  it('메일로 반영 완료된 verified 규칙에는 문의용 displayReason이 없다', () => {
    const applied = catalog.officialRules.filter((r) => r.status === 'verified' && r.sourceIds.some((s) => s.startsWith('src-mail-')));
    expect(applied.length).toBeGreaterThanOrEqual(30);
    for (const rule of applied) expect(rule.displayReason, rule.id).toBeUndefined();
    setup('seoul-malay-indonesian', 2021);
    expect(renderToStaticMarkup(<CoverageCard />)).not.toContain('지역과지역학');
  });
  it.each([[2021, false], [2022, true]] as const)('말레이 %i학번 지역과지역학 필수 여부 %s', (year, required) => {
    const { leaves, html } = setup('seoul-malay-indonesian', year);
    expect(leaves.some((l) => l.name === '지역과지역학')).toBe(required);
    expect(html.includes('지역과지역학')).toBe(required);
  });

  it.each(['global-7fd0922a1d', 'global-e6cc8bd564'])('GBT %s 2026-2 이후 졸업은 P05406 필수 아님', (id) => {
    const { leaves, html } = setup(id, 2025);
    expect(leaves.some((l) => l.code === 'P05406' || /졸업프로젝트/.test(l.name))).toBe(false);
    expect(html).not.toContain('졸업프로젝트');
  });

  it('GBT 과거 졸업 기간 원본 규칙은 별도로 남아 있다', () => {
    const { leaves } = setup('global-e6cc8bd564', 2025, false, '2026-1');
    expect(leaves.some((l) => l.code === 'P05406')).toBe(true);
  });

  it('통계 2025 이중전공은 통계학개론 필수 아님', () => {
    const { leaves, html } = setup('global-dd521d15b1', 2025, true);
    expect(leaves.some((l) => l.code === 'F10106' || l.name === '통계학개론')).toBe(false);
    expect(html).not.toContain('통계학개론');
  });

  it('정치외교 2024학번은 이전 세 과목 필수 아님', () => {
    const { leaves, html } = setup('seoul-bb41508551', 2024);
    expect(leaves.length).toBeGreaterThan(0);
    for (const name of ['정치학연구방법론', '고대정치사상', '국제정치이론']) {
      expect(leaves.some((l) => l.name === name), name).toBe(false);
      expect(html).not.toContain(name);
    }
  });

  it('페르시아 2025학번은 문법과읽기 A1·A2 필수 유지', () => {
    const { leaves, html } = setup('seoul-fbbf413afe', 2025);
    expect(leaves.map((l) => l.code)).toEqual(expect.arrayContaining(['B09101', 'B09102']));
    expect(html).toContain('페르시아어문법과읽기');
  });

  it('학과 평가 없음 명시는 통과 확인 체크박스를 요구하지 않는다', () => {
    const { report } = setup('global-dd521d15b1', 2025, 'minor');
    const id = 'dept-exam-stat-global-primary-unknown';
    expect(report.evals.find((e) => e.rule.id === id)).toMatchObject({ cls: 'confirmed', rule: { none: { categories: ['departmentAssessment'] } } });
    const html = renderToStaticMarkup(<RuleItemsCard />);
    expect(html).toContain('원문에 해당 요건이 없거나 적용 제외로 명시돼 있어요');
    expect(report.coverage.flatMap((r) => r.notes).some((n) => n.ruleIds.includes(id))).toBe(false);
  });

  it.each(['seoul-14e2c61205', 'global-14e2c61205'])('Q18 %s는 데이터의 홈페이지 안내를 화면에 표시한다', (id) => {
    const { report } = setup(id, 2025, true);
    const notes = report.coverage.flatMap((r) => r.notes).filter((n) => n.ruleIds.some((rid) => catalog.officialRules.find((r) => r.id === rid)?.displayReason?.inquiryId === 'Q18'));
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((n) => n.displayReason === '학과 안내(홈페이지·편람) 기준이에요')).toBe(true);
    expect(renderToStaticMarkup(<CoverageCard />)).toContain('학과 안내(홈페이지·편람) 기준이에요');
  });
});
