import { describe, expect, it } from 'vitest';
import { currentPosition, gradeTermLabel, gradeYearOf, semesterOrder } from '../../src/domain/gradeYear';
import type { Term } from '../../src/domain/types';

const t = (academicYear: number, semester: Term['semester']): Term => ({ academicYear, semester });

describe('학기를 학년으로 묶기', () => {
  it('현재 학년이 있으면 현재 학기에서 거꾸로 센다 (3학년 2026-2)', () => {
    const p = { cohortYear: 2023, currentYear: 3 as const, currentTerm: t(2026, '2') };
    expect(gradeYearOf(t(2026, '1'), p)).toBe(3);
    expect(gradeYearOf(t(2025, '2'), p)).toBe(2);
    expect(gradeYearOf(t(2024, '1'), p)).toBe(1);
  });
  it('편입생은 입학 연도가 아니라 현재 학년으로 센다', () => {
    const p = { cohortYear: 2025, currentYear: 4 as const, currentTerm: t(2026, '1') };
    expect(gradeYearOf(t(2026, '1'), p)).toBe(4);
    expect(gradeYearOf(t(2025, '2'), p)).toBe(3);
  });
  it('현재 학년이 없으면 입학 연도 기준(신입학)', () => {
    const p = { cohortYear: 2024, currentTerm: t(2026, '2') };
    expect(gradeYearOf(t(2024, '1'), p)).toBe(1);
    expect(gradeYearOf(t(2026, '2'), p)).toBe(3);
  });
  it('범위 밖은 1~4로 모은다', () => {
    const p = { cohortYear: 2020, currentTerm: t(2026, '2') };
    expect(gradeYearOf(t(2026, '2'), p)).toBe(4);
    expect(gradeYearOf(t(2019, '1'), { ...p, currentYear: 2 as const })).toBe(1);
  });
  it('같은 학년 안 순서는 1학기, 여름, 2학기, 겨울', () => {
    const order = [t(2025, 'winter'), t(2025, '2'), t(2025, 'summer'), t(2025, '1')].sort((a, b) => semesterOrder(a) - semesterOrder(b));
    expect(order.map((x) => x.semester)).toEqual(['1', 'summer', '2', 'winter']);
  });
  it('라벨', () => {
    const p = { cohortYear: 2023, currentYear: 3 as const, currentTerm: t(2026, '2') };
    expect(gradeTermLabel(t(2026, '1'), p)).toBe('3학년 1학기');
    expect(gradeTermLabel(t(2025, 'summer'), p)).toBe('2학년 여름학기');
  });
});

describe('학기를 직접 고른 학생 (휴학해서 달력 학기와 다른 경우)', () => {
  // 2026년 가을(달력 2학기)에 복학했지만 실제로는 4학년 1학기
  const p = { cohortYear: 2021, currentYear: 4 as const, currentSemester: '1' as const, semesterAnchor: t(2026, '2'), currentTerm: t(2026, '2') };
  it('달력은 2학기여도 고른 학기(4학년 1학기)로 보인다', () => {
    expect(gradeTermLabel(t(2026, '2'), p)).toBe('4학년 1학기');
    expect(currentPosition(p)).toEqual({ year: 4, semester: '1' });
  });
  it('달력이 다음 학기로 넘어가면 같이 센다 (4학년 2학기 → 다음 해에도 4학년 안)', () => {
    const next = { ...p, currentTerm: t(2027, '1') };
    expect(gradeTermLabel(t(2027, '1'), next)).toBe('4학년 2학기');
    expect(gradeTermLabel(t(2026, '2'), next)).toBe('4학년 1학기');
  });
  it('고르기 전 학기와 계절학기는 기존 방식', () => {
    expect(gradeTermLabel(t(2025, '2'), p)).toBe('3학년 2학기');
    expect(gradeTermLabel(t(2026, 'summer'), p)).toBe('4학년 여름학기');
  });
  it('학기를 고르지 않으면 기존과 같다', () => {
    const q = { cohortYear: 2021, currentYear: 4 as const, currentTerm: t(2026, '2') };
    expect(gradeTermLabel(t(2026, '2'), q)).toBe('4학년 2학기');
    expect(currentPosition(q)).toEqual({ year: 4 });
  });
});
