import { describe, expect, it } from 'vitest';
import { classTimeText, layoutWeek } from '../../src/domain/timetable';
import type { ClassTime } from '../../src/domain/types';

const t = (courseId: string, day: ClassTime['day'], start: string, end: string): ClassTime => ({ courseId, day, start, end });

describe('시간표 배치', () => {
  it('수강 과목이 없어도 기본 9~18시의 빈 격자 범위를 유지한다', () => {
    expect(layoutWeek([])).toEqual({ blocks: [], fromHour: 9, toHour: 18 });
  });
  it('한 과목의 여러 수업 시간이 각각 배치되고, 기본 범위는 9~18시', () => {
    const { blocks, fromHour, toHour } = layoutWeek([t('a', 0, '09:00', '10:15'), t('a', 2, '09:00', '10:15')]);
    expect(blocks.map((b) => [b.day, b.lane, b.lanes])).toEqual([[0, 0, 1], [2, 0, 1]]);
    expect([fromHour, toHour]).toEqual([9, 18]);
  });
  it('겹치는 수업은 나란히, 안 겹치면 다시 한 칸', () => {
    const { blocks } = layoutWeek([t('a', 1, '09:00', '11:00'), t('b', 1, '10:00', '12:00'), t('c', 1, '11:00', '12:00'), t('d', 1, '13:00', '14:00')]);
    const by = Object.fromEntries(blocks.map((b) => [b.courseId, [b.lane, b.lanes]]));
    expect(by).toEqual({ a: [0, 2], b: [1, 2], c: [0, 2], d: [0, 1] });
  });
  it('이른·늦은 수업이 있으면 범위를 넓힌다', () => {
    const r = layoutWeek([t('a', 4, '08:00', '09:00'), t('b', 4, '18:30', '20:45')]);
    expect([r.fromHour, r.toHour]).toEqual([8, 21]);
  });
  it('표시 문구', () => {
    expect(classTimeText(t('a', 3, '13:00', '14:15'))).toBe('목 13:00~14:15');
  });
});
