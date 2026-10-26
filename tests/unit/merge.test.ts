import { describe, expect, it } from 'vitest';
import { applyMerge, planMerge, type MergeDecisions } from '../../src/domain/merge/mergeImport';
import { parseTranscript } from '../../src/domain/parser/parseTranscript';
import { evaluateProgress } from '../../src/domain/requirements/resolve';
import { latestSnapshot, type AppState } from '../../src/domain/state';
import { compareTerms } from '../../src/domain/terms';
import { course, stateWith, TRANSCRIPT_FIXTURE, T21_1 } from '../fixtures';

const NO: MergeDecisions = { link: {}, conflictChoice: {}, removeMissing: false };
const merge = (s: AppState, text: string, d: MergeDecisions = NO) => {
  const p = parseTranscript(text);
  return applyMerge(s, p, planMerge(s, p), d, new Date());
};

describe('재붙여넣기 병합', () => {
  it('같은 자료를 두 번 반영해도 과목 수·취득학점이 늘지 않고 Course ID가 유지된다', () => {
    const once = merge(stateWith(), TRANSCRIPT_FIXTURE);
    const twice = merge(once, TRANSCRIPT_FIXTURE);
    expect(twice.courses).toHaveLength(6);
    expect(twice.courses.map((c) => c.id).sort()).toEqual(once.courses.map((c) => c.id).sort());
    expect(evaluateProgress(null, twice.courses, latestSnapshot(twice)).total.earned).toBe(2000);
  });

  it('학생이 지정한 재수강 대체(replacesCourseId)는 재붙여넣기 뒤에도 남는다', () => {
    const once = merge(stateWith(), TRANSCRIPT_FIXTURE);
    const [older, newer] = [...once.courses].sort((a, b) => compareTerms(a.term, b.term));
    const marked = {
      ...once,
      courses: once.courses.map((c) => (c.id === newer.id ? { ...c, replacesCourseId: older.id } : c)),
    };
    const twice = merge(marked, TRANSCRIPT_FIXTURE);
    expect(twice.courses.find((c) => c.id === newer.id)!.replacesCourseId).toBe(older.id);
  });

  it('수동 수강 과목과 새 성적을 연결하면 한 번만 집계되고 평가 ID·메모가 유지된다', () => {
    const manual = course({ name: '예시과목(1) (Example Subject (1))', status: 'inProgress', term: T21_1, origin: 'manual' });
    const s = stateWith({
      courses: [manual],
      assessments: [{ id: 'as1', courseId: manual.id, phase: 'final', mode: 'exam', examDate: '2021-06-15', notes: '시험 메모', origin: 'student', updatedAt: '' }],
    });
    const p = parseTranscript(TRANSCRIPT_FIXTURE);
    const plan = planMerge(s, p);
    expect(plan.linkCandidates).toEqual([{ courseId: manual.id, rowKey: expect.stringContaining('T90001') }]);
    const next = applyMerge(s, p, plan, NO, new Date());
    expect(next.courses).toHaveLength(6);
    const linked = next.courses.find((c) => c.id === manual.id)!;
    expect(linked.status).toBe('completed');
    expect(linked.grade).toBe('A0');
    expect(next.assessments).toEqual(s.assessments); // 시험 날짜·메모는 덮어쓰지 않음
    expect(evaluateProgress(null, next.courses, latestSnapshot(next)).total.earned).toBe(2000);
  });

  it('성적을 다시 붙여넣어도 과목 ID에 붙은 자유 메모·수업 시간이 남고, 지운 과목 것만 정리된다', () => {
    const once = merge(stateWith(), TRANSCRIPT_FIXTURE);
    const gone = once.courses.find((c) => c.officialCode === 'T90004')!; // 이번 자료에서 뺄 과목
    const kept = once.courses.find((c) => c.officialCode === 'T90001')!;
    const s: AppState = {
      ...once,
      courseMemos: [kept, gone].map((c) => ({ courseId: c.id, text: `${c.name} 메모`, updatedAt: '' })),
      classTimes: [kept, gone].map((c) => ({ courseId: c.id, day: 1 as const, start: '09:00', end: '10:15' })),
    };
    expect(merge(s, TRANSCRIPT_FIXTURE)).toMatchObject({ courseMemos: s.courseMemos, classTimes: s.classTimes });
    // '완전한 최신 목록'으로 확인해 지울 때만 그 과목의 메모·시간도 지운다
    const without = TRANSCRIPT_FIXTURE.split('\n').filter((l) => !l.includes('T90004')).join('\n');
    const pruned = merge(s, without, { ...NO, removeMissing: true });
    expect(pruned.courses.some((c) => c.id === gone.id)).toBe(false);
    expect(pruned.courseMemos.map((m) => m.courseId)).toEqual([kept.id]);
    expect(pruned.classTimes.map((t) => t.courseId)).toEqual([kept.id]);
  });

  it('새 자료에 없는 과목을 자동 삭제하지 않고, 확인했을 때만 지운다', () => {
    const lines = TRANSCRIPT_FIXTURE.split('\n');
    const withExtra = [...lines.slice(0, 3), '2019 - 1', '가상학과 T80001 예전과목 교양 2 A0', ...lines.slice(3)].join('\n');
    const before = merge(stateWith(), withExtra);
    expect(before.courses).toHaveLength(7);
    const p = parseTranscript(TRANSCRIPT_FIXTURE);
    const plan = planMerge(before, p);
    expect(plan.missing).toHaveLength(1);
    expect(applyMerge(before, p, plan, NO, new Date()).courses).toHaveLength(7);
    expect(applyMerge(before, p, plan, { ...NO, removeMissing: true }, new Date()).courses).toHaveLength(6);
  });

  it('수동 과목은 새 자료에 없어도 삭제 후보가 아니다', () => {
    const manual = course({ name: '직접 추가한 과목', status: 'completed', grade: 'A0', origin: 'manual' });
    const plan = planMerge(stateWith({ courses: [manual] }), parseTranscript(TRANSCRIPT_FIXTURE));
    expect(plan.missing).toEqual([]);
  });

  it('학생이 직접 고친 필드는 충돌로 보여주고, 기본은 학생 값 유지', () => {
    const once = merge(stateWith(), TRANSCRIPT_FIXTURE);
    const target = once.courses.find((c) => c.officialCode === 'T90004')!;
    const edited = { ...once, courses: once.courses.map((c) => (c.id === target.id ? { ...c, area: 'freeChoice' as const, overriddenFields: ['area'] } : c)) };
    const p = parseTranscript(TRANSCRIPT_FIXTURE);
    const plan = planMerge(edited, p);
    const m = plan.matched.find((x) => x.courseId === target.id)!;
    expect(m.conflicts).toEqual([{ field: 'area', current: 'freeChoice', imported: 'liberalArts' }]);
    expect(applyMerge(edited, p, plan, NO, new Date()).courses.find((c) => c.id === target.id)!.area).toBe('freeChoice');
    const chosen = applyMerge(edited, p, plan, { ...NO, conflictChoice: { [`${target.id}:area`]: 'imported' } }, new Date());
    expect(chosen.courses.find((c) => c.id === target.id)!.area).toBe('liberalArts');
  });

  it('같은 코드·학기의 복수 기록은 하나로 합치지 않는다', () => {
    const dup = '2022 - 1\n가상학과 T1001 가 1전공 3 F\n가상학과 T1001 가 1전공 3 B0';
    const once = merge(stateWith(), dup);
    expect(once.courses).toHaveLength(2);
    expect(merge(once, dup).courses).toHaveLength(2);
  });

  it('원문 전체를 상태에 저장하지 않는다', () => {
    const s = merge(stateWith(), TRANSCRIPT_FIXTURE);
    expect(JSON.stringify(s)).not.toContain('이수구분별 취득학점 계');
    expect(JSON.stringify(s)).not.toContain('재수강누적');
  });
});
