// 학기를 '몇 학년'으로 묶는 순수 함수. 저장 데이터(학년도+학기)는 바꾸지 않고 화면에서만 학년으로 묶는다.
import type { StudentProfile, Term } from './types';

type YearBasis = Pick<StudentProfile, 'cohortYear' | 'currentYear' | 'currentTerm'>;

/**
 * 그 학기가 몇 학년이었는지 (1~4, 범위 밖은 끝으로 모은다).
 * 현재 학년이 입력돼 있으면 현재 학기에서 거꾸로 센다(편입생·휴학생도 맞는다).
 * 없으면 입학 연도 기준(신입학)으로 센다.
 */
export function gradeYearOf(term: Term, profile: YearBasis): number {
  const cur = profile.currentTerm.academicYear;
  const nowYear = profile.currentYear ?? cur - profile.cohortYear + 1;
  const y = nowYear - (cur - term.academicYear);
  return Math.min(4, Math.max(1, y));
}

const SEMESTER_ORDER: Record<Term['semester'], number> = { '1': 0, summer: 1, '2': 2, winter: 3, unknown: 4 };

/** 같은 학년 안 순서: 1학기 → 여름 → 2학기 → 겨울 */
export const semesterOrder = (t: Term) => t.academicYear * 10 + SEMESTER_ORDER[t.semester];

/** '3학년 1학기', '2학년 여름학기' */
export function gradeTermLabel(term: Term, profile: YearBasis): string {
  const y = gradeYearOf(term, profile);
  const s = term.semester;
  return `${y}학년 ${s === '1' ? '1학기' : s === '2' ? '2학기' : s === 'summer' ? '여름학기' : s === 'winter' ? '겨울학기' : '학기 미상'}`;
}
