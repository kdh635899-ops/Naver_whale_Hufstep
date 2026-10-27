import { describe, expect, it } from 'vitest';
import { APP_LOGO, YEAR_LOGO, logoForYear } from '../../src/app/logos';

describe('학년별 헤더 로고', () => {
  it('1~4학년은 각자 다른 로고, 학년을 모르면 메인 로고', () => {
    expect(new Set([1, 2, 3, 4].map((y) => logoForYear(y))).size).toBe(4);
    expect(logoForYear(1)).toBe(YEAR_LOGO[1]);
    expect(logoForYear(4)).toBe(YEAR_LOGO[4]);
    expect(logoForYear(undefined)).toBe(APP_LOGO);
    expect(logoForYear(5)).toBe(APP_LOGO);
    expect(Object.values(YEAR_LOGO)).not.toContain(APP_LOGO);
  });
});
