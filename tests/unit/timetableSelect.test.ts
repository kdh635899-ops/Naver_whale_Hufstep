import { describe, expect, it } from 'vitest';
import { dragRange, hhmm, hmToMinutes, overlapsAny } from '../../src/domain/timetableSelect';

describe('시간표 칸 고르기', () => {
  it('hhmm: 분 → HH:mm', () => {
    expect(hhmm(9 * 60)).toBe('09:00');
    expect(hhmm(13 * 60 + 5)).toBe('13:05');
  });

  it('hmToMinutes: 시·분 글자 검사', () => {
    expect(hmToMinutes('09', '30')).toBe(570);
    expect(hmToMinutes('9', '0')).toBe(540);
    expect(hmToMinutes('24', '00')).toBeNull();
    expect(hmToMinutes('10', '60')).toBeNull();
    expect(hmToMinutes('', '00')).toBeNull();
    expect(hmToMinutes('ab', '00')).toBeNull();
  });

  it('overlapsAny: 같은 요일에서 겹칠 때만', () => {
    const times = [{ day: 0 as const, start: '09:00', end: '10:15' }];
    expect(overlapsAny(times, 0, 10 * 60, 11 * 60)).toBe(true); // 10:00~10:15 겹침
    expect(overlapsAny(times, 0, 10 * 60 + 15, 11 * 60)).toBe(false); // 맞닿기만 함
    expect(overlapsAny(times, 1, 9 * 60, 10 * 60)).toBe(false); // 다른 요일
    expect(overlapsAny(times, 0, 8 * 60, 9 * 60)).toBe(false);
  });

  it('dragRange: 위→아래, 아래→위, 한 칸', () => {
    const none = () => false;
    expect(dragRange(9, 11, none)).toEqual({ from: 9, to: 11 });
    expect(dragRange(11, 9, none)).toEqual({ from: 9, to: 11 });
    expect(dragRange(10, 10, none)).toEqual({ from: 10, to: 10 });
  });

  it('dragRange: 이미 있는 수업을 만나면 그 앞에서 멈춘다 (건너뛰지 않는다)', () => {
    const busy = (h: number) => h === 12;
    expect(dragRange(10, 15, busy)).toEqual({ from: 10, to: 11 });
    expect(dragRange(14, 9, busy)).toEqual({ from: 13, to: 14 });
    expect(dragRange(13, 13, busy)).toEqual({ from: 13, to: 13 });
  });
});
