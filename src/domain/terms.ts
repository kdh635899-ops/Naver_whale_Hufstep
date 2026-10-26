import type { Term } from './types';

const SEMESTER_ORDER: Record<Term['semester'], number> = { '1': 1, summer: 2, '2': 3, winter: 4, unknown: 5 };

export const termKey = (t: Term) => `${t.academicYear}-${t.semester}`;
export const sameTerm = (a: Term, b: Term) => a.academicYear === b.academicYear && a.semester === b.semester;
export const compareTerms = (a: Term, b: Term) =>
  a.academicYear - b.academicYear || SEMESTER_ORDER[a.semester] - SEMESTER_ORDER[b.semester];

export function termLabel(t: Term): string {
  const s = { '1': '1학기', '2': '2학기', summer: '여름 계절학기', winter: '겨울 계절학기', unknown: '학기 미상' }[t.semester];
  return `${t.academicYear}년 ${s}`;
}

/** 오늘 날짜로 '지금 학기'를 제안한다 (사용자가 마이페이지에서 바꿀 수 있는 기본값일 뿐). */
export function suggestTerm(today: Date): Term {
  const m = today.getMonth() + 1;
  const y = today.getFullYear();
  if (m <= 2) return { academicYear: y - 1, semester: '2' };
  return { academicYear: y, semester: m <= 8 ? '1' : '2' };
}

/** 로컬 날짜 키 YYYY-MM-DD. toISOString()은 UTC라 한국 새벽에 전날이 되므로 쓰지 않는다. */
export function dateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 'YYYY-MM-DD' + 'HH:mm' → 로컬 시각 Date */
export function localDateTime(date: string, time = '00:00'): Date {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Date(y, mo - 1, d, h, mi);
}

export function addDays(date: string, days: number): string {
  const d = localDateTime(date);
  d.setDate(d.getDate() + days);
  return dateKey(d);
}

export const isDateKey = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && dateKey(localDateTime(s)) === s;
export const isTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** 학점(소수 가능) ↔ 100배 정수 */
export const toUnits = (credits: number) => Math.round(credits * 100);
export const formatUnits = (units: number) => {
  const v = units / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, '');
};
