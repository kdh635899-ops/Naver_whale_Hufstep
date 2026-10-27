import { describe, expect, it } from 'vitest';
import { STAIR_CHARACTER, stairCharacter } from '../../src/app/stairs';
import { shortTitle } from '../../src/domain/requirements/displayTitle';

describe('학사 현황 계단 캐릭터', () => {
  it('학년마다 다른 캐릭터(1 새싹 · 2 책 · 3 전구 · 4 학사모), 학년을 모르면 없음', () => {
    expect(new Set([1, 2, 3, 4].map((y) => stairCharacter(y))).size).toBe(4);
    expect(stairCharacter(1)).toBe(STAIR_CHARACTER[1]);
    expect(stairCharacter(4)).toBe(STAIR_CHARACTER[4]);
    expect(stairCharacter(undefined)).toBeUndefined();
    expect(stairCharacter(5)).toBeUndefined();
  });
});

describe('졸업요건 제목', () => {
  it('접힌 줄용 short는 줄이고, 펼친 목록용 head는 줄이지 않는다', () => {
    const t = shortTitle('영미문학·문화학과 전공역할별 외국어인증 처리');
    expect(t.short.endsWith('…')).toBe(true);
    expect(t.head).toBe('영미문학·문화학과 전공역할별 외국어인증 처리');
    expect(t.head).not.toContain('…');
  });
});
