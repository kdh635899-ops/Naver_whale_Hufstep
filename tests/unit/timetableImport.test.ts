// 종정시 개인별시간표 붙여넣기: 합성 표로 해석·병합·범위 안내·중복 방지·예정 학점을 검사한다 (실제 수강 내역 없음).
import { describe, expect, it } from 'vitest';
import { evaluateProgress } from '../../src/domain/requirements/resolve';
import { emptyState, gradeCourses } from '../../src/domain/state';
import { applyTimetableImport, gridFromText, parseTimetableGrid, type ImportPick } from '../../src/domain/timetableImport';
import { plannedCredits, withPlanned } from '../../src/domain/timetableStatus';
import { course, PROFILE } from '../fixtures';

// 탭으로 나뉜 합성 표: 교시 | 월 | 화 | 수 | 목 | 금 (빈 칸 포함)
const TSV = [
  '교시\t월\t화\t수\t목\t금',
  '1교시\t가상 과목 A (본관 101)\t\t가상 과목 A (본관 101)\t\t',
  '2교시\t가상 과목 A (본관 101)\t\t\t\t가상 세미나 [사회관 2] 2학점',
  '3교시\t\t\t\t가상 과목 B\t',
  '메모\t\t알 수 없는 줄\t\t\t',
  '12교시\t\t\t\t\t가상 야간',
  '13교시\t\t\t\t\t가상 심야',
].join('\n');

describe('종정시 시간표 표 해석', () => {
  const r = parseTimetableGrid(gridFromText(TSV));
  const byName = Object.fromEntries(r.courses.map((c) => [c.name, c]));

  it('빈 칸을 지켜 요일이 밀리지 않고, 교시를 학교 시각으로 바꾼다', () => {
    expect(byName['가상 과목 B'].slots).toEqual([{ day: 3, start: 11 * 60, end: 11 * 60 + 50, room: '' }]);
    expect(byName['가상 세미나'].slots[0]).toMatchObject({ day: 4, start: 10 * 60, room: '사회관 2' });
  });

  it('같은 요일 연속 교시는 한 블록, 다른 요일은 같은 과목의 다른 칸', () => {
    expect(byName['가상 과목 A'].slots).toEqual([
      { day: 0, start: 9 * 60, end: 10 * 60 + 50, room: '본관 101' },
      { day: 2, start: 9 * 60, end: 9 * 60 + 50, room: '본관 101' },
    ]);
  });

  it('학점은 원본에 있을 때만 채우고 교시 수로 추정하지 않는다', () => {
    expect(byName['가상 세미나'].credit).toBe(2);
    expect(byName['가상 과목 A'].credit).toBeNull();
  });

  it('해석 못한 행과 21시 이후 수업을 알린다', () => {
    expect(r.unparsed).toHaveLength(1);
    expect(r.unparsed[0]).toContain('알 수 없는 줄');
    expect(byName['가상 야간'].slots[0]).toMatchObject({ start: 20 * 60, end: 20 * 60 + 50 });
    expect(byName['가상 심야']).toBeUndefined();
    expect(r.outOfRange).toEqual(['가상 심야 · 금 21:00~21:50']);
  });

  it('일반 텍스트 복사: 칸 안 줄바꿈(과목명 ↵ 강의실)을 행으로 오해하지 않는다', () => {
    // 종정시 일반 텍스트 복사 모양 (합성): 앞에 안내 줄, 칸 안 줄바꿈, 빈 칸, 토요일 칸, 빈 교시 행
    const text = [
      '2026년도 2학기 신청학점수: 9학점', '개인별시간표 조회',
      '\t월\t화\t수\t목\t금\t토',
      '1\t가상회화(2)', '(가상관101)\t\t가상지역학', '(가상관102)\t\t\t',
      '2\t가상회화(2)', '(가상관101)\t가상문법', '(가상관101)\t가상지역학', '(가상관102)\t\t\t',
      '3\t\t가상문법', '(가상관101)\t\t\t\t가상토요', '(가상관9)',
      '10\t\t\t\t\t\t',
    ].join('\n');
    for (const t of [text, text.replace(/\t/g, '    ')]) { // 탭이 공백 4칸으로 바뀐 경우도
      const p = parseTimetableGrid(gridFromText(t));
      expect(p.unparsed).toEqual([]);
      expect(p.courses.map((c) => [c.name, c.slots.map((s) => [s.day, s.start, s.end, s.room])])).toEqual([
        ['가상회화(2)', [[0, 540, 650, '가상관101']]],
        ['가상문법', [[1, 600, 710, '가상관101']]],
        ['가상지역학', [[2, 540, 650, '가상관102']]],
      ]);
      expect(p.outOfRange).toEqual(['가상토요 · 토 11:00~11:50']);
    }
  });

  it('행 머리의 시각이 있으면 교시보다 우선한다', () => {
    const t = parseTimetableGrid(gridFromText('\t시간\t월\t화\t수\n1\t09:00~10:15\t가상 C\t\t'));
    expect(t.courses[0].slots[0]).toMatchObject({ day: 0, start: 540, end: 615 });
  });
});

describe('확정 반영', () => {
  const base = () => ({ ...emptyState(), profile: PROFILE });
  const picks: ImportPick[] = [
    { name: '가상 과목 A', creditUnits: 300, area: 'primary', slots: [{ day: 0, start: 540, end: 650, room: '' }, { day: 2, start: 540, end: 590, room: '' }] },
    { name: '가상 세미나', creditUnits: 200, area: 'liberalArts', slots: [{ day: 4, start: 600, end: 650, room: '' }] },
  ];

  it('여러 요일 과목도 학점은 한 번, 같은 표를 다시 넣어도 중복되지 않는다', () => {
    const once = applyTimetableImport(base(), picks, '2026-11-15T00:00:00Z');
    if (once.error !== undefined) throw new Error(once.error);
    const twice = applyTimetableImport(once.state, picks, '2026-11-15T00:00:00Z');
    if (twice.error !== undefined) throw new Error(twice.error);
    expect(twice.state.courses).toHaveLength(2);
    expect(twice.state.classTimes).toHaveLength(3);
    expect(plannedCredits(twice.state)).toEqual({ total: 500, byArea: { primary: 300, liberalArts: 200 } });
  });

  it('기존 시간표 과목과 이름이 맞으면 ID를 유지해 메모·시험 정보가 남는다', () => {
    const old = course({ id: 'kept', name: '가상과목 A', origin: 'timetable', status: 'inProgress', term: PROFILE.currentTerm, grade: null, creditUnits: 0, area: 'unknown' });
    const s = { ...base(), courses: [old], classTimes: [{ courseId: 'kept', day: 1 as const, start: '13:00', end: '14:00' }],
      courseMemos: [{ courseId: 'kept', text: '합성 메모', updatedAt: '2026-11-01T00:00:00Z' }] };
    const r = applyTimetableImport(s, picks, '2026-11-15T00:00:00Z');
    if (r.error !== undefined) throw new Error(r.error);
    const kept = r.state.courses.find((c) => c.id === 'kept')!;
    expect(kept).toMatchObject({ creditUnits: 300, area: 'primary' });
    expect(r.state.classTimes.filter((t) => t.courseId === 'kept').map((t) => t.day)).toEqual([0, 2]);
    expect(r.state.courseMemos).toEqual(s.courseMemos);
  });

  it('재수강: 이전 기록에 자동 연결하고, 예정 학점은 이전 취득학점을 뺀 순증가분만 더한다', () => {
    const term = { academicYear: 2025, semester: '1' as const };
    const passed = course({ id: 'old-c', name: '가상 과목 A', grade: 'C0', area: 'primary', term }); // 3학점 취득
    const failed = course({ id: 'old-f', name: '가상 세미나', grade: 'F', status: 'notEarned', earnedInclusion: 'excluded', area: 'liberalArts', term });
    const r = applyTimetableImport({ ...base(), courses: [passed, failed] }, picks, '2026-11-15T00:00:00Z');
    if (r.error !== undefined) throw new Error(r.error);
    const imported = r.state.courses.filter((c) => c.origin === 'timetable');
    expect(imported.map((c) => [c.name, c.isRetake, c.replacesCourseId])).toEqual([['가상 과목 A', true, 'old-c'], ['가상 세미나', true, 'old-f']]);
    // A: 3학점 재수강이 이전 3학점을 대신 → 0, 세미나: F라 취득학점이 없었으므로 2학점 그대로
    expect(plannedCredits(r.state)).toEqual({ total: 200, byArea: { primary: 0, liberalArts: 200 } });
  });

  it('학사현황 합계: 삭제한 과목은 빠지고, 이번 학기 시간표 학점은 한 숫자로 합친다', () => {
    const resolved = { totalRequiredUnits: 13400, requiredUnitsByArea: { primary: 5400, liberalArts: 3200 }, groups: [], allowCourseReuseAcrossGroups: false } as never;
    const a = course({ id: 'a', grade: 'A0', area: 'primary' });
    const b = course({ id: 'b', grade: 'B0', area: 'liberalArts', credits: 2 });
    const r = applyTimetableImport({ ...base(), courses: [a, b] }, picks, '2026-11-15T00:00:00Z');
    if (r.error !== undefined) throw new Error(r.error);
    const shown = (courses: typeof r.state.courses) => {
      const s = { ...r.state, courses };
      return withPlanned(evaluateProgress(resolved, gradeCourses(s.courses), null), plannedCredits(s));
    };
    // 취득 3+2 + 이번 학기 3+2
    expect(shown(r.state.courses)).toMatchObject({ earned: 1000, remaining: 12400,
      areas: [{ area: 'primary', earned: 600, met: false }, { area: 'liberalArts', earned: 400 }] });
    // 기존 과목 'b'를 지우면 그 2학점이 합계·교양에서 빠진다
    expect(shown(r.state.courses.filter((c) => c.id !== 'b'))).toMatchObject({ earned: 800,
      areas: [{ area: 'primary', earned: 600 }, { area: 'liberalArts', earned: 200 }] });
  });

  it('예정 학점은 실제 취득학점(gradeCourses)과 섞이지 않는다', () => {
    const r = applyTimetableImport(base(), picks, '2026-11-15T00:00:00Z');
    if (r.error !== undefined) throw new Error(r.error);
    expect(r.state.courses.every((c) => c.origin === 'timetable' && c.earnedInclusion === 'excluded')).toBe(true);
  });
});
