// 시간표 칸 고르기(클릭·끌기) 계산. 화면과 무관한 순수 함수.
import { toMinutes } from './timetable';
import type { ClassTime } from './types';

/** 자정부터의 분 → 'HH:mm' */
export const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** 같은 요일에 [start, end)(분)와 겹치는 수업이 하나라도 있는가 */
export function overlapsAny(times: Pick<ClassTime, 'day' | 'start' | 'end'>[], day: number, start: number, end: number): boolean {
  return times.some((t) => t.day === day && toMinutes(t.start) < end && start < toMinutes(t.end));
}

/**
 * 끌기: 처음 누른 시(anchor)에서 지금 마우스가 있는 시(cursor)까지 칸을 늘린다.
 * 이미 수업이 있는 시(busy)를 만나면 그 앞에서 멈춘다. 위→아래, 아래→위 모두 같다. 반환은 양 끝 시를 포함한다.
 */
export function dragRange(anchor: number, cursor: number, busy: (hour: number) => boolean): { from: number; to: number } {
  const step = cursor >= anchor ? 1 : -1;
  let last = anchor;
  for (let h = anchor + step; step > 0 ? h <= cursor : h >= cursor; h += step) {
    if (busy(h)) break;
    last = h;
  }
  return { from: Math.min(anchor, last), to: Math.max(anchor, last) };
}

/** 시·분 두 칸 글자 → 분. 올바르지 않으면 null */
export function hmToMinutes(h: string, m: string): number | null {
  if (!/^\d{1,2}$/.test(h) || !/^\d{1,2}$/.test(m)) return null;
  const hh = Number(h), mm = Number(m);
  return hh > 23 || mm > 59 ? null : hh * 60 + mm;
}
