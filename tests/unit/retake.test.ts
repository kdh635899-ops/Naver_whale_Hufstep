import { describe, expect, it } from 'vitest';
import { effectiveCourses, graduationGpa } from '../../src/domain/gpa/gpa';
import { hasRetakeWarning, initialReplacesCourseId, retakeCandidates } from '../../src/domain/retake';
import type { AcademicSnapshot, Term } from '../../src/domain/types';
import { course } from '../fixtures';

const T = (academicYear: number, semester: Term['semester'] = '1'): Term => ({ academicYear, semester });

const snapshot = (warnings: AcademicSnapshot['warnings']): AcademicSnapshot => ({
  id: 'snap1', importedAt: '2026-01-01T00:00:00.000Z', source: 'studentPaste', courseIds: [],
  reportedEarnedByArea: {}, completeness: { earnedTotals: true, courses: true, gpa: true }, warnings,
});

describe('재수강 대체 후보', () => {
  it('이전 학기 이수 완료 과목만, 같은 이름이 맨 위', () => {
    const other = course({ name: '다른과목', term: T(2024), grade: 'C0' });
    const same = course({ name: '가상ㆍ과목Ⅰ', term: T(2023), grade: 'F' });
    const later = course({ name: '가상.과목(1)', term: T(2026, '2'), grade: 'A0' }); // 이후 학기
    const inProgress = course({ name: '가상.과목(1)', term: T(2024), status: 'inProgress', grade: null });
    const me = course({ name: '가상.과목(1)', term: T(2026), status: 'inProgress', grade: null });

    const r = retakeCandidates([other, same, later, inProgress, me], { id: me.id, name: me.name, term: me.term });
    expect(r.map((c) => c.id)).toEqual([same.id, other.id]); // 같은 이름(정규화) 먼저
  });

  it('이미 다른 과목이 대체한 기록은 고를 수 없다', () => {
    const old = course({ name: '가상과목', term: T(2023), grade: 'F' });
    const taken = course({ name: '가상과목', term: T(2024), grade: 'B0', replacesCourseId: old.id });
    const me = course({ name: '가상과목', term: T(2026), status: 'inProgress', grade: null });
    const r = retakeCandidates([old, taken, me], { id: me.id, name: me.name, term: me.term });
    expect(r.map((c) => c.id)).toEqual([taken.id]);
  });

  it('자기 자신이 이미 고른 기록은 계속 보인다', () => {
    const old = course({ name: '가상과목', term: T(2023), grade: 'F' });
    const me = course({ name: '가상과목', term: T(2026), grade: 'B0', replacesCourseId: old.id });
    const r = retakeCandidates([old, me], { id: me.id, name: me.name, term: me.term });
    expect(r.map((c) => c.id)).toEqual([old.id]);
  });

  it('인정학점 기록은 대체 대상이 아니다', () => {
    const credit = course({ name: '인정학점', term: T(2023), recordKind: 'recognizedCredit', gradingMode: 'ungradedCredit', grade: null });
    const me = course({ name: '인정학점', term: T(2026), status: 'inProgress', grade: null });
    expect(retakeCandidates([credit, me], { id: me.id, name: me.name, term: me.term })).toEqual([]);
  });
});

describe('편집기를 열 때 미리 고르는 값', () => {
  it('이미 지정된 값이 있으면 그대로 쓴다', () => {
    const old = course({ name: '가상과목', term: T(2023), grade: 'F' });
    const me = course({ name: '가상과목', term: T(2026), grade: 'B0', replacesCourseId: old.id });
    expect(initialReplacesCourseId([old, me], [], me)).toBe(old.id);
  });

  it('retakeUnresolved 경고가 있으면 같은 이름의 이전 기록을 미리 고른다', () => {
    const old = course({ name: '가상과목', term: T(2023), grade: 'F' });
    const me = course({ name: '가상과목', term: T(2026), grade: 'B0', sourceRowKey: 'r1' });
    const snaps = [snapshot([{ code: 'retakeUnresolved', rowKey: 'r1', message: '' }])];
    expect(hasRetakeWarning(snaps, me)).toBe(true);
    expect(initialReplacesCourseId([old, me], snaps, me)).toBe(old.id);
  });

  it('경고가 없으면 아무것도 고르지 않는다', () => {
    const old = course({ name: '가상과목', term: T(2023), grade: 'F' });
    const me = course({ name: '가상과목', term: T(2026), grade: 'B0', sourceRowKey: 'r1' });
    expect(initialReplacesCourseId([old, me], [snapshot([])], me)).toBeUndefined();
  });

  it('경고가 있어도 이름이 같은 이전 기록이 없으면 비워 둔다', () => {
    const old = course({ name: '다른과목', term: T(2023), grade: 'F' });
    const me = course({ name: '가상과목', term: T(2026), grade: 'B0', sourceRowKey: 'r1' });
    const snaps = [snapshot([{ code: 'retakeUnresolved', rowKey: 'r1', message: '' }])];
    expect(initialReplacesCourseId([old, me], snaps, me)).toBeUndefined();
  });
});

describe('저장하면 기존 계산 로직이 그대로 반영한다', () => {
  it('replacesCourseId를 넣으면 이전 기록이 평점·취득학점에서 빠진다', () => {
    const old = course({ name: '가상과목', term: T(2023), grade: 'F' });
    const me = course({ name: '가상과목', term: T(2026), grade: 'B+', replacesCourseId: old.id });
    expect(effectiveCourses([old, me]).find((c) => c.id === old.id)!.earnedInclusion).toBe('excluded');
    expect(graduationGpa([old, me]).hundredths).toBe(350);
  });

  it('체크를 풀어 지우면 이전 기록이 다시 들어온다', () => {
    const old = course({ name: '가상과목', term: T(2023), grade: 'F' });
    const me = course({ name: '가상과목', term: T(2026), grade: 'B+', replacesCourseId: undefined });
    expect(graduationGpa([old, me]).hundredths).toBe(175);
  });
});
