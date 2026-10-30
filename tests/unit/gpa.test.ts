import { describe, expect, it } from 'vitest';
import { calculateScenario, computeGpa, formatGpa, graduationGpa } from '../../src/domain/gpa/gpa';
import { parseTranscript } from '../../src/domain/parser/parseTranscript';
import { INCOMPLETE_TRANSCRIPTS } from '../fixtures/importTranscript';
import type { GradeScenario } from '../../src/domain/types';
import { course, T26_2 } from '../fixtures';

const scenario = (entries: GradeScenario['entries']): GradeScenario => ({ id: 's', term: T26_2, baselineSnapshotId: 'b', entries });

describe('평점 계산 (정수)', () => {
  it.each(Object.entries(INCOMPLETE_TRANSCRIPTS))('%s의 완전성을 계산기와 졸업평점에 함께 전달한다', (_name, text) => {
    const parsed = parseTranscript(text);
    const courses = [course({ grade: 'A0' })];
    const result = calculateScenario(courses, null, undefined, parsed.completeness);
    expect(result.completeness).toEqual(parsed.completeness);
    expect(result.baseline.gpa).toMatchObject({ complete: false, hundredths: null });
    expect(result.projected.gpa.hundredths).toBeNull();
    expect(graduationGpa(courses, { id: 'synthetic', importedAt: '', source: 'studentPaste', courseIds: [], reportedEarnedByArea: parsed.reportedEarnedByArea, warnings: parsed.warnings, completeness: parsed.completeness }).status).toBe('insufficient');
  });
  it('등급이 미상인 과목을 빼고 정상 평점으로 확정하지 않는다', () => {
    expect(computeGpa([course({ grade: 'A0' }), course()])).toMatchObject({ hundredths: null, complete: false });
  });
  it('27/10 = 2.70', () => {
    const g = computeGpa([course({ grade: 'A0' }), course({ grade: 'B+', credits: 2 }), course({ grade: 'C0' }), course({ grade: 'D0', credits: 2 })]);
    expect(formatGpa(g.hundredths)).toBe('2.70');
  });
  it('정확히 3.29는 3.28로 절사되지 않는다 (소수 학점 포함)', () => {
    const g = computeGpa([course({ grade: 'B+', credits: 2.9 }), course({ grade: 'B0', credits: 2.1 })]);
    expect(g.creditUnits).toBe(500);
    expect(g.hundredths).toBe(329);
    expect(formatGpa(g.hundredths)).toBe('3.29');
  });
  it('3.299는 3.29로 절사 (반올림하지 않음)', () => {
    const g = computeGpa([course({ grade: 'B+', credits: 2.99 }), course({ grade: 'B0', credits: 2.01 })]);
    expect(g.points / g.creditUnits).toBeCloseTo(329.9, 5);
    expect(formatGpa(g.hundredths)).toBe('3.29');
  });
  it('분모 0이면 0.00이 아니라 계산 대상 없음', () => {
    const g = computeGpa([course({ grade: 'P' }), course({ recordKind: 'recognizedCredit', gradingMode: 'ungradedCredit' })]);
    expect(g.hundredths).toBeNull();
    expect(formatGpa(g.hundredths)).toBe('—');
  });
  it('일반 F는 분모 포함, P/F 과목의 F는 분모 제외', () => {
    const regular = computeGpa([course({ grade: 'A0' }), course({ grade: 'F' })]);
    const pf = computeGpa([course({ grade: 'A0' }), course({ grade: 'F', gradingMode: 'passFail' })]);
    expect(regular.creditUnits).toBe(600);
    expect(pf.creditUnits).toBe(300);
  });
  it('인정학점은 GPA에서 빠진다', () => {
    const g = computeGpa([course({ grade: 'A0' }), course({ recordKind: 'recognizedCredit', gradingMode: 'ungradedCredit', credits: 6 })]);
    expect(g.creditUnits).toBe(300);
  });
  it('요약 평점 기반은 추정으로 표시', () => {
    const g = computeGpa([], { hundredths: 350, gpaUnits: 3000 });
    expect(g.estimated).toBe(true);
    expect(g.hundredths).toBe(350);
    expect(computeGpa([course({ grade: 'A0' })]).estimated).toBe(false);
  });
  it('과거 상세 성적이 없어도 요약 평점과 대상 학점으로 예상 누적 평점을 추정한다', () => {
    const now = course({ status: 'inProgress', term: T26_2 });
    const result = calculateScenario([now], scenario([{ courseId: now.id, expectedGrade: 'A+' }]),
      { hundredths: 300, gpaUnits: 3000 }, { earnedTotals: true, courses: false, gpa: false });
    expect(result.baseline.gpa).toMatchObject({ hundredths: 300, estimated: true });
    expect(result.projected.gpa).toMatchObject({ hundredths: 313, estimated: true });
    expect(result.termGpa.hundredths).toBe(450);
    expect(result.completeness.courses).toBe(false);
  });
  it('과거 평점을 모르면 누적 평점은 보류하되 이번 학기 예상 평점은 계산한다', () => {
    const now = course({ status: 'inProgress', term: T26_2 });
    const result = calculateScenario([now], scenario([{ courseId: now.id, expectedGrade: 'A0' }]),
      undefined, { earnedTotals: true, courses: false, gpa: false });
    expect(result.projected.gpa.hundredths).toBeNull();
    expect(result.termGpa.hundredths).toBe(400);
  });
});

describe('재수강·예상 시나리오', () => {
  it('C+ 3 → A0 3: 취득·분모 불변, Q +45000 (=4.5)', () => {
    const old = course({ grade: 'C+' });
    const now = course({ status: 'inProgress', term: T26_2 });
    const r = calculateScenario([old, now], scenario([{ courseId: now.id, expectedGrade: 'A0', replacesCourseId: old.id }]));
    expect(r.projected.gpa.creditUnits - r.baseline.gpa.creditUnits).toBe(0);
    expect(r.projected.earned - r.baseline.earned).toBe(0);
    expect(r.projected.gpa.points - r.baseline.gpa.points).toBe(45000);
  });
  it('F 3 → A0 3: 분모 불변, 취득 +3, Q +12', () => {
    const old = course({ grade: 'F' });
    const now = course({ status: 'inProgress', term: T26_2 });
    const r = calculateScenario([old, now], scenario([{ courseId: now.id, expectedGrade: 'A0', replacesCourseId: old.id }]));
    expect(r.projected.gpa.creditUnits - r.baseline.gpa.creditUnits).toBe(0);
    expect(r.projected.earned - r.baseline.earned).toBe(300);
    expect(r.projected.gpa.points - r.baseline.gpa.points).toBe(120000);
  });
  it('이미 baseline에서 제외된 이전 기록은 두 번 빼지 않는다', () => {
    const first = course({ grade: 'D0' });
    const second = course({ grade: 'C0', replacesCourseId: first.id }); // 실제 재수강으로 first는 이미 제외
    const now = course({ status: 'inProgress', term: T26_2 });
    const r = calculateScenario([first, second, now], scenario([{ courseId: now.id, expectedGrade: 'B0', replacesCourseId: first.id }]));
    expect(r.baseline.gpa.creditUnits).toBe(300);
    expect(r.projected.gpa.creditUnits).toBe(600); // second(유지) + now
  });
  it('같은 기존 과목을 두 행이 대체할 수 없다', () => {
    const old = course({ grade: 'C+' });
    const a = course({ status: 'inProgress', term: T26_2 });
    const b = course({ status: 'inProgress', term: T26_2 });
    const r = calculateScenario([old, a, b], scenario([
      { courseId: a.id, expectedGrade: 'A0', replacesCourseId: old.id },
      { courseId: b.id, expectedGrade: 'A0', replacesCourseId: old.id },
    ]));
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].courseId).toBe(b.id);
  });
  it('등급을 여러 번 바꿔도 baseline 기준으로 다시 계산하고, 삭제하면 원래대로', () => {
    const base = course({ grade: 'B0' });
    const now = course({ status: 'inProgress', term: T26_2 });
    const results = (['A+', 'C0', 'A+'] as const).map((g) => calculateScenario([base, now], scenario([{ courseId: now.id, expectedGrade: g }])));
    expect(results[0].projected.gpa).toEqual(results[2].projected.gpa);
    expect(calculateScenario([base, now], null).projected.gpa).toEqual(results[0].baseline.gpa);
  });
  it('예상 결과는 실제 과목 기록을 바꾸지 않는다', () => {
    const now = course({ status: 'inProgress', term: T26_2 });
    const courses = [now];
    calculateScenario(courses, scenario([{ courseId: now.id, expectedGrade: 'A+' }]));
    expect(courses[0].status).toBe('inProgress');
    expect(courses[0].grade).toBeNull();
  });
  it('이번 학기 예상 평점·취득 변화', () => {
    const past = course({ grade: 'B0' });
    const a = course({ status: 'inProgress', term: T26_2 });
    const b = course({ status: 'inProgress', term: T26_2, credits: 2 });
    const r = calculateScenario([past, a, b], scenario([{ courseId: a.id, expectedGrade: 'A+' }, { courseId: b.id, expectedGrade: 'B+' }]));
    expect(r.termGpa.hundredths).toBe(Math.floor((300 * 450 + 200 * 350) / 500));
    expect(r.projected.earned - r.baseline.earned).toBe(500);
  });
});
