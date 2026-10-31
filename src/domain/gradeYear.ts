// 학기를 '몇 학년'으로 묶는 순수 함수. 저장 데이터(학년도+학기)는 바꾸지 않고 화면에서만 학년으로 묶는다.
import type { StudentProfile, Term } from './types';

type YearBasis = Pick<StudentProfile, 'cohortYear' | 'currentYear' | 'currentTerm'> & Partial<Pick<StudentProfile, 'currentSemester' | 'semesterAnchor'>>;

const regularOrd = (t: Term) => t.academicYear * 2 + (t.semester === '2' ? 1 : 0);

/**
 * 학기를 직접 고른 학생: 고른 시점(semesterAnchor)부터 정규 학기를 하나씩 세어 학년·학기를 정한다.
 * 휴학해서 달력 학기와 다른 학생도 맞는다. 고르지 않았거나 고르기 전 학기, 계절학기는 null (기존 방식).
 */
function counted(term: Term, p: YearBasis): { year: number; semester: '1' | '2' } | null {
  if (!p.currentYear || !p.currentSemester || !p.semesterAnchor) return null;
  if ((term.semester !== '1' && term.semester !== '2') || regularOrd(term) < regularOrd(p.semesterAnchor)) return null;
  const n = Number(p.currentSemester) - 1 + regularOrd(term) - regularOrd(p.semesterAnchor);
  return { year: Math.min(4, p.currentYear + Math.floor(n / 2)), semester: n % 2 === 0 ? '1' : '2' };
}

/** 지금의 학년과(고른 경우) 학기 */
export const currentPosition = (p: YearBasis): { year?: number; semester?: '1' | '2' } =>
  counted(p.currentTerm, p) ?? { year: p.currentYear };

/**
 * 그 학기가 몇 학년이었는지 (1~4, 범위 밖은 끝으로 모은다).
 * 현재 학년이 입력돼 있으면 현재 학기에서 거꾸로 센다(편입생·휴학생도 맞는다).
 * 없으면 입학 연도 기준(신입학)으로 센다.
 */
export function gradeYearOf(term: Term, profile: YearBasis): number {
  const c = counted(term, profile);
  if (c) return c.year;
  const cur = (profile.currentSemester && profile.semesterAnchor ? profile.semesterAnchor : profile.currentTerm).academicYear;
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
  const s = counted(term, profile)?.semester ?? term.semester;
  return `${y}학년 ${s === '1' ? '1학기' : s === '2' ? '2학기' : s === 'summer' ? '여름학기' : s === 'winter' ? '겨울학기' : '학기 미상'}`;
}
