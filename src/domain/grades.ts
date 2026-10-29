import type { Course, Inclusion, LetterGrade } from './types';

/** 4.5 만점 평점 × 100 (정수 계산용) */
export const GRADE_HUNDREDTHS: Partial<Record<LetterGrade, number>> = {
  'A+': 450, A0: 400, 'B+': 350, B0: 300, 'C+': 250, C0: 200, 'D+': 150, D0: 100, F: 0,
};
export const LETTER_GRADES: LetterGrade[] = ['A+', 'A0', 'B+', 'B0', 'C+', 'C0', 'D+', 'D0', 'F', 'P', 'NP'];

/**
 * 원문 등급 기호 → 표준 등급. PASS는 P로 읽고, 그 밖의 별칭은 정책을 따른다. 모르는 기호는 보류한다.
 */
export function normalizeGrade(raw: string, aliases: Record<string, LetterGrade>): LetterGrade | undefined {
  const t = raw.trim();
  if ((LETTER_GRADES as string[]).includes(t)) return t as LetterGrade;
  if (t === 'PASS') return 'P';
  return Object.hasOwn(aliases, t) ? aliases[t] : undefined;
}

type InclusionInput = Pick<Course, 'status' | 'grade' | 'gradingMode' | 'recordKind'>;

/**
 * 과목 한 건의 GPA 포함 여부와 취득학점 포함 여부를 정한다 (§7.2).
 * - 일반 F: GPA 분모 포함, 취득학점 제외
 * - P/F 과목: GPA 제외, P만 취득
 * - 등급 없는 인정학점: 취득 포함, GPA 제외
 * - 등급 불명: 판단 보류 (F 아님)
 */
export function deriveInclusion(c: InclusionInput): { gpaInclusion: Inclusion; earnedInclusion: Inclusion } {
  if (c.status === 'planned' || c.status === 'inProgress') return { gpaInclusion: 'excluded', earnedInclusion: 'excluded' };
  if (c.recordKind === 'recognizedCredit' || c.gradingMode === 'ungradedCredit') {
    return { gpaInclusion: 'excluded', earnedInclusion: c.status === 'completed' ? 'included' : 'excluded' };
  }
  const g = c.grade;
  if (g === null) return { gpaInclusion: 'unresolved', earnedInclusion: c.status === 'notEarned' ? 'excluded' : 'unresolved' };
  if (c.gradingMode === 'passFail' || g === 'P' || g === 'NP') {
    return { gpaInclusion: 'excluded', earnedInclusion: g === 'P' && c.status === 'completed' ? 'included' : 'excluded' };
  }
  return {
    gpaInclusion: 'included',
    earnedInclusion: g === 'F' || c.status === 'notEarned' ? 'excluded' : 'included',
  };
}

/** 등급에 맞는 gradingMode 기본값 */
export const defaultGradingMode = (g: LetterGrade | null): Course['gradingMode'] =>
  g === 'P' || g === 'NP' ? 'passFail' : g ? 'graded' : 'unknown';
