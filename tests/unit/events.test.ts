import { describe, expect, it } from 'vitest';
import { countEventsForDate, countText, deriveEvaluationEvents, eventsOn } from '../../src/domain/assessment-events/events';
import { decideDelivery, planNotifications, type NotificationSettings } from '../../src/domain/notifications/plan';
import { addDays, dateKey, suggestTerm } from '../../src/domain/terms';
import { demoAssessments, demoCurrentCourses, T26_2 } from '../fixtures';

const BASE = '2026-11-05'; // §11.3 가상 기준일 (테스트에서만 고정)
const courses = demoCurrentCourses(T26_2);
const events = () => deriveEvaluationEvents(demoAssessments(BASE), courses, [], T26_2);
const S: NotificationSettings = { enabled: true, dayBefore: true, sameDay: true, time: '09:00', version: 1 };
const at = (date: string, time: string) => new Date(`${date}T${time}:00`);

describe('§11.3 평가 이벤트', () => {
  it('기준일에 시험 2개 · 제출 1개', () => {
    const c = countEventsForDate(events(), BASE);
    expect(c).toEqual({ exam: 2, submission: 1, presentation: 0, total: 3 });
    expect(countText(c)).toBe('시험 2개 · 제출 1개');
  });
  it('제출일과 발표일이 다른 대체평가는 서로 다른 날의 다른 이벤트', () => {
    expect(countEventsForDate(events(), addDays(BASE, 2))).toMatchObject({ submission: 1, total: 1 });
    expect(countEventsForDate(events(), addDays(BASE, 4))).toMatchObject({ presentation: 1, total: 1 });
  });
  it('같은 날 제출+발표는 시험 2개가 아니라 제출 1·발표 1', () => {
    const a = [{ ...demoAssessments(BASE).find((x) => x.id === 'demo-a6m')!, submissionDate: BASE, presentationDate: BASE }];
    expect(countEventsForDate(deriveEvaluationEvents(a, courses, [], T26_2), BASE)).toEqual({ exam: 0, submission: 1, presentation: 1, total: 2 });
  });
  it('날짜 없는 시험·없음·미선택은 집계에 들어가지 않는다', () => {
    const all = events();
    expect(all.find((e) => e.assessmentId === 'demo-a4f')).toBeUndefined();
    expect(all.find((e) => e.courseId === 'demo-c5')).toBeUndefined();
    // a1m 제출·발표, a1f, a2m, a3f, a4m, a6m 제출·발표 = 8 (a4f 날짜 없음, a2f·a3m 없음, c5 미선택 제외)
    expect(all).toHaveLength(8);
  });
  it('다른 학기·수강 중이 아닌 과목의 일정은 오늘 집계에서 빠진다', () => {
    expect(deriveEvaluationEvents(demoAssessments(BASE), courses, [], { academicYear: 2027, semester: '1' })).toHaveLength(0);
    const done = courses.map((c) => ({ ...c, status: 'completed' as const }));
    expect(deriveEvaluationEvents(demoAssessments(BASE), done, [], T26_2)).toHaveLength(0);
  });
  it('없음으로 바꾸면 그날 건수가 줄어든다', () => {
    const changed = demoAssessments(BASE).map((a) => (a.id === 'demo-a2m' ? { ...a, mode: 'none' as const } : a));
    expect(countEventsForDate(deriveEvaluationEvents(changed, courses, [], T26_2), BASE).exam).toBe(1);
  });
  it('시간순 정렬, 시간 미입력은 뒤로', () => {
    const noTime = demoAssessments(BASE).map((a) => (a.id === 'demo-a2m' ? { ...a, examStartTime: undefined } : a));
    const list = eventsOn(deriveEvaluationEvents(noTime, courses, [], T26_2), BASE);
    expect(list.map((e) => e.time)).toEqual(['10:00', '23:59', undefined]);
  });
});

describe('실제 날짜 처리', () => {
  it('한국 자정 직후에도 UTC 전날로 바뀌지 않는다', () => {
    const justAfterMidnight = new Date('2026-11-04T15:30:00Z'); // 서울 11-05 00:30 (vitest TZ=Asia/Seoul)
    expect(dateKey(justAfterMidnight)).toBe('2026-11-05');
    expect(justAfterMidnight.toISOString().slice(0, 10)).toBe('2026-11-04');
  });
  it('학기 제안은 날짜에서 계산', () => {
    expect(suggestTerm(new Date(2026, 9, 23))).toEqual({ academicYear: 2026, semester: '2' });
    expect(suggestTerm(new Date(2027, 0, 10))).toEqual({ academicYear: 2026, semester: '2' });
    expect(suggestTerm(new Date(2027, 3, 1))).toEqual({ academicYear: 2027, semester: '1' });
  });
});

describe('알림 예약', () => {
  it('전날 09:00, 당일은 09:00과 첫 시험 30분 전(09:30) 중 빠른 시각', () => {
    const plan = planNotifications(events(), S, true, at('2026-11-01', '12:00'), '2026-2', new Set());
    const forBase = plan.filter((p) => p.date === BASE);
    expect(forBase.find((p) => p.kind === 'dayBefore')!.when).toBe(at('2026-11-04', '09:00').getTime());
    expect(forBase.find((p) => p.kind === 'sameDay')!.when).toBe(at(BASE, '09:00').getTime());
  });
  it('이른 시험이면 당일 알림을 시험 30분 전으로 당긴다', () => {
    const early = demoAssessments(BASE).map((a) => (a.id === 'demo-a1f' ? { ...a, examStartTime: '08:00' } : a));
    const plan = planNotifications(deriveEvaluationEvents(early, courses, [], T26_2), S, true, at('2026-11-01', '12:00'), '2026-2', new Set());
    expect(plan.find((p) => p.date === BASE && p.kind === 'sameDay')!.when).toBe(at(BASE, '07:30').getTime());
  });
  it('끄기·동의 없음이면 예약 없음', () => {
    expect(planNotifications(events(), { ...S, enabled: false }, true, at('2026-11-01', '12:00'), '2026-2', new Set())).toEqual([]);
    expect(planNotifications(events(), S, false, at('2026-11-01', '12:00'), '2026-2', new Set())).toEqual([]);
  });
  it('지난 일정은 예약하지 않는다 (무더기 발송 없음)', () => {
    expect(planNotifications(events(), S, true, at('2026-12-31', '12:00'), '2026-2', new Set())).toEqual([]);
  });
  it('당일 예약 시각이 지났어도 남은 일정이 있으면 한 번만 곧 알린다', () => {
    const now = at(BASE, '11:00');
    const same = planNotifications(events(), S, true, now, '2026-2', new Set()).find((p) => p.date === BASE && p.kind === 'sameDay')!;
    expect(same.when).toBe(now.getTime() + 60_000);
    const after = planNotifications(events(), S, true, now, '2026-2', new Set(['sameDay:2026-11-05:2026-2']));
    expect(after.find((p) => p.date === BASE && p.kind === 'sameDay')).toBeUndefined();
  });
  it('완료한 제출은 재알림하지 않는다', () => {
    const ev = deriveEvaluationEvents(demoAssessments(BASE), courses, [{ eventId: 'demo-a6m:submission', completedAt: '' }], T26_2);
    const plan = planNotifications(ev, S, true, at('2026-11-01', '12:00'), '2026-2', new Set());
    expect(plan.find((p) => p.date === addDays(BASE, 2))).toBeUndefined();
  });
});

describe('알림 발송 판단 (경쟁 상태·멱등)', () => {
  const name = 'hufstep:dayBefore:2026-11-05:2026-2:v1';
  const now = at('2026-11-04', '09:00');
  it('정상이면 건수만 담은 문구 (과목명 없음)', () => {
    const d = decideDelivery(name, now, events(), S, true, '2026-2', new Set());
    expect(d).toMatchObject({ deliver: true, message: '내일 시험 2개 · 제출 1개' });
    expect(JSON.stringify(d)).not.toContain('예시 과목');
  });
  it('설정 버전이 바뀐 뒤 실행된 이전 예약은 표시하지 않는다', () => {
    expect(decideDelivery(name, now, events(), { ...S, version: 2 }, true, '2026-2', new Set()).deliver).toBe(false);
  });
  it('동의 철회·이미 보냄·일정 삭제 후에는 표시하지 않는다', () => {
    expect(decideDelivery(name, now, events(), S, false, '2026-2', new Set()).deliver).toBe(false);
    expect(decideDelivery(name, now, events(), S, true, '2026-2', new Set(['dayBefore:2026-11-05:2026-2'])).deliver).toBe(false);
    expect(decideDelivery(name, now, [], S, true, '2026-2', new Set()).deliver).toBe(false);
  });
  it('절전 후 늦게 깨어나 시험 당일 이후 실행된 전날 알림은 보내지 않는다', () => {
    expect(decideDelivery(name, at(BASE, '10:00'), events(), S, true, '2026-2', new Set()).deliver).toBe(false);
  });
});
