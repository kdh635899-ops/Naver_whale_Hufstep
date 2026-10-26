import { describe, expect, it } from 'vitest';
import { advancedTerm } from '../../src/domain/terms';
import type { Term } from '../../src/domain/types';

const t = (academicYear: number, semester: Term['semester']): Term => ({ academicYear, semester });

describe('현재 학기 자동 갱신 (달력 기준, 학교 사이트를 읽지 않는다)', () => {
  it('저장된 학기가 지났으면 오늘 날짜 기준 학기로 옮긴다', () => {
    expect(advancedTerm(t(2026, '1'), new Date(2026, 9, 27))).toEqual(t(2026, '2')); // 10월 → 2학기
    expect(advancedTerm(t(2026, '2'), new Date(2027, 2, 3))).toEqual(t(2027, '1')); // 다음 해 3월 → 1학기
    expect(advancedTerm(t(2024, '1'), new Date(2026, 9, 27))).toEqual(t(2026, '2')); // 오래 안 열었어도 한 번에
  });
  it('같은 학기이거나 방학이면 그대로 둔다 (겨울방학은 직전 2학기)', () => {
    expect(advancedTerm(t(2026, '2'), new Date(2026, 9, 27))).toBeNull();
    expect(advancedTerm(t(2026, '2'), new Date(2027, 0, 15))).toBeNull(); // 1월
    expect(advancedTerm(t(2026, '2'), new Date(2027, 1, 20))).toBeNull(); // 2월
  });
  it('앞서 있는 값(계절학기·미래 학기)은 되돌리지 않는다', () => {
    expect(advancedTerm(t(2026, 'summer'), new Date(2026, 6, 10))).toBeNull(); // 7월, 1학기 < 여름
    expect(advancedTerm(t(2027, '1'), new Date(2026, 9, 27))).toBeNull();
  });
});
