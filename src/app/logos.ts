// 로고 이미지: 첫 화면(스플래시·학사정보 입력)은 메인 로고, 그 뒤 헤더의 작은 로고는 현재 학년을 따른다.
import appLogo from '../assets/logo/app-logo.png';
import year1 from '../assets/logo/year-1.png';
import year2 from '../assets/logo/year-2.png';
import year3 from '../assets/logo/year-3.png';
import year4 from '../assets/logo/year-4.png';

export const APP_LOGO = appLogo;
/** 1학년 새싹 · 2학년 책 · 3학년 전구 · 4학년 학사모 */
export const YEAR_LOGO: Record<1 | 2 | 3 | 4, string> = { 1: year1, 2: year2, 3: year3, 4: year4 };

/** 학년을 아직 모르면(미입력) 메인 로고 */
export function logoForYear(year?: number): string {
  return year === 1 || year === 2 || year === 3 || year === 4 ? YEAR_LOGO[year] : APP_LOGO;
}
