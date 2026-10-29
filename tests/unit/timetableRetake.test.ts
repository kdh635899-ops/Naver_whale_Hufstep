import { describe, expect, it } from 'vitest';
import { calculateScenario } from '../../src/domain/gpa/gpa';
import { autoProjectedRetake, projectedRetakeCandidates } from '../../src/domain/retake';
import { course, T26_2 } from '../fixtures';
import type { Course, Grade, GradeScenario } from '../../src/domain/types';

const run = (courses: Course[], current: Course, grade: Grade = 'A0', replacesCourseId?: string) => {
  const scenario: GradeScenario = { id: 's', term: T26_2, baselineSnapshotId: 'none',
    entries: [{ courseId: current.id, expectedGrade: grade, replacesCourseId }] };
  return calculateScenario(courses.map((c) => c.id === current.id ? current : c), scenario);
};
const current = (over: Partial<Course> = {}) => course({ name: '전공 과목', term: T26_2, origin: 'timetable',
  status: 'inProgress', isRetake: true, area: 'unknown', ...over });

describe('시간표 재수강을 예상 평점에 반영', () => {
  it('B0 → A0: 이전 성적을 대체하고 취득학점·분모를 두 번 합산하지 않는다', () => {
    const old = course({ name: '전공 과목', grade: 'B0' });
    const now = current();
    const courses = [old, now];
    const before = JSON.stringify(courses);
    const result = run(courses, now);
    expect(result.errors).toEqual([]);
    expect(result.baseline.gpa.hundredths).toBe(300);
    expect(result.projected.gpa.hundredths).toBe(400);
    expect(result.projected.majorGpa.hundredths).toBe(400);
    expect(result.projected.gpa.creditUnits).toBe(300);
    expect(result.projected.earned).toBe(300);
    expect(result.baseline.earned).toBe(300);
    expect(JSON.stringify(courses)).toBe(before);
    expect(run(courses, now, null).projected.gpa.hundredths).toBe(300);
  });

  it('F → A0: F의 분모를 대체하고 예상 취득학점만 증가한다', () => {
    const old = course({ name: '전공 과목', grade: 'F', status: 'notEarned' });
    const now = current();
    const result = run([old, now], now);
    expect(result.errors).toEqual([]);
    expect(result.baseline.earned).toBe(0);
    expect(result.projected.earned).toBe(300);
    expect(result.projected.gpa.creditUnits).toBe(300);
    expect(result.projected.gpa.hundredths).toBe(400);
    expect(old.status).toBe('notEarned');
  });

  it('체크 해제 시 이전에 저장한 연결도 적용하지 않고 일반 수강으로 다시 계산한다', () => {
    const old = course({ name: '전공 과목', grade: 'B0' });
    const now = current({ isRetake: false, replacesCourseId: old.id });
    const result = run([old, now], now, 'A0', old.id);
    expect(result.projected.gpa.hundredths).toBe(350);
    expect(result.projected.earned).toBe(600);
  });

  it('이전 기록 누락·여러 후보 시 자동 대체하지 않고 연결 확인을 요청한다', () => {
    const now = current();
    const a = course({ name: now.name, grade: 'C0' });
    const b = course({ name: now.name, grade: 'B0' });
    for (const courses of [[now], [a, b, now]]) {
      const result = run(courses, now);
      expect(result.errors).toHaveLength(1);
      expect(result.projected.gpa.hundredths).toBeNull();
    }
    expect(run([a, b, now], { ...now, replacesCourseId: b.id }).projected.gpa.hundredths).toBe(300);
  });

  it('코드가 다른 동명 과목을 자동 연결하지 않고, 바뀐 이름은 직접 연결할 수 있다', () => {
    const old = course({ name: '전공 과목', grade: 'B0', officialCode: 'OLD' });
    const now = current({ officialCode: 'NEW' });
    expect(autoProjectedRetake([old], now)).toBeUndefined();
    expect(run([old, now], now).errors).toHaveLength(1);
    expect(run([old, now], { ...now, name: '변경된 과목', replacesCourseId: old.id }).projected.gpa.hundredths).toBe(400);
  });

  it('이미 대체된 과목·다른 시간표·현재 학기 기록은 후보에서 제외한다', () => {
    const old = course({ name: '전공 과목', grade: 'D0' });
    const replacement = course({ name: old.name, grade: 'C0', term: { academicYear: 2025, semester: '1' }, replacesCourseId: old.id });
    const now = current();
    const scheduled = current({ term: old.term });
    expect(projectedRetakeCandidates([old, replacement, scheduled, now], now).map((c) => c.id)).toEqual([replacement.id]);
    expect(autoProjectedRetake([old, replacement, now], now)?.id).toBe(replacement.id);
  });

  it('두 시간표 과목이 같은 이전 기록을 대체하면 예상 평점을 확정하지 않는다', () => {
    const old = course({ name: '전공 과목', grade: 'C0' });
    const a = current(), b = current();
    const result = calculateScenario([old, a, b], { id: 's', term: T26_2, baselineSnapshotId: 'none',
      entries: [a, b].map((c) => ({ courseId: c.id, expectedGrade: 'A0', replacesCourseId: old.id })) });
    expect(result.errors).toHaveLength(1);
    expect(result.projected.gpa.hundredths).toBeNull();
  });
});
