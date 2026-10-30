import { describe, expect, it } from 'vitest';
import { catalog, departmentFacts, departmentMetaById } from '../../src/data';
import { graduationGpa } from '../../src/domain/gpa/gpa';
import { applyMerge, planMerge } from '../../src/domain/merge/mergeImport';
import { parseTranscript } from '../../src/domain/parser/parseTranscript';
import { ASKABLE_FIELDS } from '../../src/domain/requirements/conditions';
import { buildOfficialReport, defaultAnswers, normalizeCourseName, ruleTitle } from '../../src/domain/requirements/officialRules';
import { emptyState, latestSnapshot } from '../../src/domain/state';
import { appStateSchema } from '../../src/domain/validation/schemas';
import { assessmentCriteria, describe as describeRule } from '../../src/features/academic-status/OfficialSections';
import type { StudentProfile } from '../../src/domain/types';
import { course } from '../fixtures';
import { buildDemoState, DEMO_TRANSCRIPT } from '../../src/data/demo';

// 실제 학생 대신 독립적으로 만든 가상 학적 조건을 사용한다.
const SYNTHETIC_PROFILE: StudentProfile = {
  ...buildDemoState(new Date('2026-10-01T00:00:00Z')).profile!,
  cohortYear: 2024, entryType: 'freshman', programType: 'single', secondaryDepartmentId: undefined,
  facts: { foreignLanguageSpecialAdmission: false, pureForeignAdmission: false },
};

const report = (profile: StudentProfile = SYNTHETIC_PROFILE) => buildOfficialReport({
  profile, bundles: catalog.bundles, rules: catalog.officialRules, supportGaps: catalog.supportGaps,
  dept: departmentFacts, meta: departmentMetaById,
});

describe('합성 성적표 반영과 평점 판정', () => {
  it('가상 과목과 인정학점을 보존하고 재반영해도 중복하지 않는다', () => {
    const parsed = parseTranscript(DEMO_TRANSCRIPT);
    expect(parsed.rows).toHaveLength(6);
    expect(parsed.completeness).toMatchObject({ courses: true, gpa: true });
    expect(parsed.rows.filter((r) => r.officialCode).every((r) => r.offeringDepartment === '가상학과')).toBe(true);
    expect(parsed.rows[0]).toMatchObject({ recordKind: 'recognizedCredit', creditUnits: 600 });
    const initial = { ...emptyState(), profile: SYNTHETIC_PROFILE };
    const state = applyMerge(initial, parsed, planMerge(initial, parsed), { link: {}, conflictChoice: {}, removeMissing: false }, new Date());
    expect(appStateSchema.safeParse(state).success).toBe(true);
    expect(state.courses.filter((c) => c.officialCode).every((c) => c.offeringDepartmentName === '가상학과')).toBe(true);
    expect(state.courses.map((c) => c.name)).toEqual(parsed.rows.map((r) => r.name));
    expect(graduationGpa(state.courses, latestSnapshot(state))).toMatchObject({ status: 'met', hundredths: 270, creditUnits: 1000 });
    const again = applyMerge(state, parsed, planMerge(state, parsed), { link: {}, conflictChoice: {}, removeMissing: false }, new Date());
    expect(again.courses).toHaveLength(6);
    expect(again.courses.map((c) => c.offeringDepartmentName)).toEqual(state.courses.map((c) => c.offeringDepartmentName));
  });

  it.each([
    ['초급마.인어(1) (Elementary Malay-Indonesian (1))', '초급마.인어1'],
    ['초급마.인어(2) (Elementary Malay-Indonesian (2))', '초급마.인어2'],
    ['교양인정학점(1) (Liberal Arts Credits (1) (transferred))', '교양인정학점1'],
    ['과목 (1)', '과목1'],
    ['과목(English)', '과목english'],
    ['과목 (한글)', '과목한글'],
    ['과목 (First) (Last (2))', '과목first'],
  ])('%s 정규화 → %s', (raw, expected) => expect(normalizeCourseName(raw)).toBe(expected));
});

describe('질문 기본값과 직접 답변 우선순위', () => {
  it('예외 질문 기본값과 가상 편입 사례의 입학 학기를 계산한다', () => {
    const defaults = defaultAnswers({ ...SYNTHETIC_PROFILE, entryType: 'transferBachelor' }, catalog.officialRules, departmentFacts);
    for (const field of ['teacherTraining', 'pureForeignAdmission', 'foreignAdmission', 'northKoreanAdmission',
      'japanOverseasKoreanAdmission', 'japaneseNationality', 'militaryCommissioned', 'approvedDisabilityCertificationWaiver']) {
      expect(ASKABLE_FIELDS[field].fallback).toBe(false);
      expect(defaults[field]).toBe(false);
    }
    expect(defaults).toMatchObject({ entryTerm: '2026-1', transferEntryGrade: 3 });
    expect(defaultAnswers({ ...SYNTHETIC_PROFILE, entryType: 'freshman' }, catalog.officialRules, departmentFacts))
      .toMatchObject({ entryTerm: '2024-1' });
    expect(defaultAnswers(SYNTHETIC_PROFILE, catalog.officialRules, () => ({ college: '선택지에 없는 대학' })).studentCollegeAtEntry).toBeNull();
  });

  it('사용한 기본값만 보여 주고 학생 답으로 바꾸면 새 규칙을 선택한다', () => {
    const rep = report({ ...SYNTHETIC_PROFILE, entryType: 'transferBachelor' });
    expect(rep.questions.find((q) => q.field === 'entryTerm')).toMatchObject({ optional: true, defaultValue: '2026-1' });
    expect(rep.questions.find((q) => q.field === 'transferEntryGrade')).toMatchObject({ optional: true, defaultValue: 3 });
    expect(rep.questions.some((q) => q.field === 'graduationTerm')).toBe(false);
    const changed = report({ ...SYNTHETIC_PROFILE, facts: { entryTerm: '2024-2', transferEntryGrade: 2, approvedRequiredCourseWaiver: true } });
    expect(changed.courseRules.map((e) => e.rule.id)).not.toContain('core-malay-primary-2022-2026');
    expect(changed.questions.some((q) => ['entryTerm', 'transferEntryGrade', 'approvedRequiredCourseWaiver'].includes(q.field))).toBe(false);
    expect(changed.evals.filter((e) => 'entryYear' in e.facts).every((e) => e.facts.entryYear === 2024)).toBe(true);
  });

  it('기본값이 없는 특별전형·졸업 예정 학기 질문은 필수 입력으로 남긴다', () => {
    const freshman = report({ ...SYNTHETIC_PROFILE, facts: {} });
    expect(freshman.questions.find((q) => q.field === 'foreignLanguageSpecialAdmission')?.optional).not.toBe(true);
    expect(freshman.questions.some((q) => q.field === 'foreignLanguageSpecialAdmission')).toBe(true);
    const chinese = report({ ...SYNTHETIC_PROFILE, primaryDepartmentId: 'seoul-5f6617f421' });
    expect(chinese.questions.find((q) => q.field === 'graduationTerm')?.optional).not.toBe(true);
    expect(chinese.questions.some((q) => q.field === 'graduationTerm')).toBe(true);
  });

  it('학과 기준이 있으면 학교 시험/논문 중복 항목과 전필 정책을 제외한다', () => {
    const rep = report({ ...SYNTHETIC_PROFILE, facts: { ...SYNTHETIC_PROFILE.facts, approvedRequiredCourseWaiver: false } });
    expect(rep.items.map((e) => e.rule.id)).toContain('core-malay-flex-primary');
    expect(rep.items.some((e) => e.rule.type === 'assessmentRequired' || e.rule.type === 'requiredCoursePolicy')).toBe(false);
    expect(ruleTitle(catalog.officialRules.find((r) => r.id === 'transfer-bachelor-recognition-seoul')!)).toMatch(/^학사편입/);
  });
});

describe('학과 기준 표시', () => {
  it('내부 필드명 대신 시험·논문 문구와 점수·과목을 표시한다', () => {
    expect(describeRule({ op: 'OR', items: [{ type: 'departmentExamPassed' }, { type: 'departmentThesisPassed' }] }))
      .toBe('학과 졸업시험 또는 졸업논문 통과');
    const malay = catalog.officialRules.find((r) => r.id === 'core-malay-flex-primary')!;
    expect(assessmentCriteria(malay.detail as Record<string, unknown>)).toContain('교내 FLEX 마인어 600점 이상');
    expect(assessmentCriteria({ subjects: ['해석학', '선형대수학'], minimumEachScore: { value: 40 }, minimumMeanScore: { value: 60 } }))
      .toBe('시험 과목: 해석학, 선형대수학 · 과목별 40점 이상 · 평균 60점 이상');
  });
});

describe('졸업 평점 자동 판정', () => {
  it('2.00 경계, F 포함, 성적 미입력 및 재수강 제외를 처리한다', () => {
    expect(graduationGpa([course({ grade: 'C0' })]).status).toBe('met');
    expect(graduationGpa([course({ grade: 'D+' })]).status).toBe('unmet');
    expect(graduationGpa([course({ grade: 'A0' }), course({ id: 'failed', grade: 'F' })]).hundredths).toBe(200);
    expect(graduationGpa([]).status).toBe('insufficient');
    expect(graduationGpa([course({ id: 'old', grade: 'F' }), course({ id: 'new', replacesCourseId: 'old', grade: 'B+' })]))
      .toMatchObject({ status: 'met', hundredths: 350 });
  });
});
