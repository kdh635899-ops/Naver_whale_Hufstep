import { describe, expect, it } from 'vitest';
import { emptyState, gradeCourses } from '../../src/domain/state';
import { migrate } from '../../src/storage/repository';
import { course, PROFILE } from '../fixtures';

describe('시간표 과목은 학점 계산과 이어지지 않는다', () => {
  it('gradeCourses: 시간표에서 만든 과목은 빼고 나머지만 돌려준다', () => {
    const list = [course({ id: 'a' }), { ...course({ id: 'b' }), origin: 'timetable' as const }, { ...course({ id: 'c' }), origin: 'manual' as const }];
    expect(gradeCourses(list).map((c) => c.id)).toEqual(['a', 'c']);
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
