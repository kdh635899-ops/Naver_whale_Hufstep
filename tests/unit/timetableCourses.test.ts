import { describe, expect, it } from 'vitest';
import { emptyState, gradeCourses } from '../../src/domain/state';
import { calculatorCourses } from '../../src/domain/gpa/calculatorCourses';
import { calculateScenario } from '../../src/domain/gpa/gpa';
import { migrate } from '../../src/storage/repository';
import { course, PROFILE } from '../fixtures';

describe('시간표 과목은 예상 계산에 연결하고 실제 성적과는 구분한다', () => {
  it('gradeCourses: 시간표에서 만든 과목은 빼고 나머지만 돌려준다', () => {
    const list = [course({ id: 'a' }), { ...course({ id: 'b' }), origin: 'timetable' as const }, { ...course({ id: 'c' }), origin: 'manual' as const }];
    expect(gradeCourses(list).map((c) => c.id)).toEqual(['a', 'c']);
  });

  it('이번 학기에 시간이 등록된 수강 중 과목만 예상 계산에 보탠다', () => {
    const current = course({ id: 'current', origin: 'timetable', status: 'inProgress', term: PROFILE.currentTerm, grade: null });
    const past = course({ id: 'past', origin: 'timetable', status: 'inProgress' });
    const memoOnly = { ...current, id: 'memo-only' };
    const state = { ...emptyState(), profile: PROFILE, courses: [current, past, memoOnly],
      classTimes: [current, past].map((c) => ({ courseId: c.id, day: 0 as const, start: '09:00', end: '10:00' })) };
    expect(calculatorCourses(state).map((c) => c.id)).toEqual(['current']);
  });

  it('같은 학기 성적표·수동 과목과 중복하지 않고, 다른 학기 재수강은 유지한다', () => {
    const recorded = course({ id: 'recorded', name: '가상 과목', term: PROFILE.currentTerm, officialCode: 'T1' });
    const duplicate = course({ id: 'duplicate', name: '가상과목', term: PROFILE.currentTerm, origin: 'timetable', status: 'inProgress' });
    const differentCode = { ...duplicate, id: 'other-code', officialCode: 'T2' };
    const retake = { ...duplicate, id: 'retake', name: '이전 과목' };
    const old = course({ id: 'old', name: retake.name, grade: 'C0' });
    const state = { ...emptyState(), profile: PROFILE, courses: [recorded, duplicate, differentCode, retake, old],
      classTimes: [duplicate, differentCode, retake].map((c) => ({ courseId: c.id, day: 0 as const, start: '09:00', end: '10:00' })) };
    expect(calculatorCourses(state).map((c) => c.id)).toEqual(['recorded', 'old', 'other-code', 'retake']);
  });

  it('예상 등급을 바꾸면 평점이 바뀌고 실제 취득학점·과목 기록은 그대로다', () => {
    const past = course({ id: 'past', grade: 'B0' });
    const current = course({ id: 'current', origin: 'timetable', status: 'inProgress', term: PROFILE.currentTerm, gradingMode: 'graded' });
    const state = { ...emptyState(), profile: PROFILE, courses: [past, current],
      classTimes: [{ courseId: current.id, day: 0 as const, start: '09:00', end: '10:00' }] };
    const original = JSON.stringify(state);
    const courses = calculatorCourses(state);
    const scenario = { id: 'test', term: PROFILE.currentTerm, baselineSnapshotId: 'none', entries: [{ courseId: current.id, expectedGrade: 'A+' as const }] };
    const result = calculateScenario(courses, scenario);
    expect(result.baseline.gpa.hundredths).toBe(300);
    expect(result.projected.gpa.hundredths).toBe(375);
    expect(result.termGpa.hundredths).toBe(450);
    expect(result.baseline.earned).toBe(300);
    expect(result.projected.earned).toBe(600);
    expect(calculateScenario(courses, { ...scenario, entries: [{ courseId: current.id, expectedGrade: 'F' }] }).projected.earned).toBe(300);
    expect(JSON.stringify(state)).toBe(original);
  });

  it('예전에 시간표에서 만든 과목(직접 추가·학점 0·미분류·수업 시간 있음)은 시간표 과목으로 옮긴다', () => {
    const old = { ...course({ id: 'tt' }), origin: 'manual' as const, creditUnits: 0, area: 'unknown' as const };
    const kept = { ...course({ id: 'real' }), origin: 'manual' as const, creditUnits: 300, area: 'primary' as const };
    const s = { ...emptyState(), profile: PROFILE, courses: [old, kept], classTimes: [{ courseId: 'tt', day: 0 as const, start: '09:00', end: '10:00' }] };
    const m = migrate(JSON.parse(JSON.stringify(s)));
    expect(m.courses.find((c) => c.id === 'tt')?.origin).toBe('timetable');
    expect(m.courses.find((c) => c.id === 'real')?.origin).toBe('manual'); // 직접 추가한 진짜 과목은 그대로
  });
});
