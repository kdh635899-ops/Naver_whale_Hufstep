// 학사 현황 상단 그림: 계단 위에 현재 학년의 캐릭터가 선다. 1학년 = 1층(새싹) · 2학년 = 2층(책) · 3학년 = 3층(전구) · 4학년 = 4층(학사모)
import stairs from '../assets/stairs/stairs.png';
import char1 from '../assets/stairs/char-1.png';
import char2 from '../assets/stairs/char-2.png';
import char3 from '../assets/stairs/char-3.png';
import char4 from '../assets/stairs/char-4.png';

export const STAIRS_IMG = stairs;
export const STAIR_CHARACTER: Record<1 | 2 | 3 | 4, string> = { 1: char1, 2: char2, 3: char3, 4: char4 };

/** 학년을 모르면(미입력) 캐릭터 없이 계단만 */
export function stairCharacter(year?: number): string | undefined {
  return year === 1 || year === 2 || year === 3 || year === 4 ? STAIR_CHARACTER[year] : undefined;
}
