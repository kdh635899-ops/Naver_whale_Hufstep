// 중간/기말 Assessment → 날짜별 평가 이벤트(시험/제출/발표) 파생 (§8.2). 화면마다 따로 만들지 않고 여기서만 만든다.
import { sameTerm } from '../terms';
import type { Assessment, Course, EvaluationEvent, EventCompletion, EventKind, Term } from '../types';

export function deriveEvaluationEvents(
  assessments: Assessment[], courses: Course[], completions: EventCompletion[], activeTerm: Term,
): EvaluationEvent[] {
  // 기본 범위: 활성 학기의 '수강 중' 과목. 삭제·다른 학기 과목은 포함하지 않는다.
  const active = new Set(courses.filter((c) => c.status === 'inProgress' && sameTerm(c.term, activeTerm)).map((c) => c.id));
  const done = new Set(completions.map((c) => c.eventId));
  const out: EvaluationEvent[] = [];
  const push = (a: Assessment, kind: EventKind, date?: string, time?: string) => {
    if (!date) return; // 날짜 없는 일정은 날짜별 집계·알림에서 제외
    const id = `${a.id}:${kind}`;
    out.push({ id, courseId: a.courseId, assessmentId: a.id, phase: a.phase, kind, date, time: time || undefined, completed: done.has(id) });
  };
  for (const a of assessments) {
    if (!active.has(a.courseId)) continue;
    if (a.mode === 'exam') push(a, 'exam', a.examDate, a.examStartTime);
    else if (a.mode === 'replacement') {
      // 자료 제출과 실제 발표는 서로 다른 이벤트다
      push(a, 'submission', a.submissionDate, a.submissionTime);
      push(a, 'presentation', a.presentationDate, a.presentationTime);
    }
    // mode 'none' / null 은 이벤트가 없다
  }
  return out;
}

export interface EventCounts { exam: number; submission: number; presentation: number; total: number }

export function countEventsForDate(events: EvaluationEvent[], date: string, opts: { excludeCompleted?: boolean } = {}): EventCounts {
  const c: EventCounts = { exam: 0, submission: 0, presentation: 0, total: 0 };
  for (const e of events) {
    if (e.date !== date || (opts.excludeCompleted && e.completed)) continue;
    c[e.kind]++;
    c.total++;
  }
  return c;
}

/** 해당 날짜 이벤트를 시간순으로 (시간 미입력은 뒤로) */
export const eventsOn = (events: EvaluationEvent[], date: string) =>
  events.filter((e) => e.date === date).sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99'));

/** '시험 2개 · 제출 1개 · 발표 1개' (0개 항목은 생략) */
export function countText(c: EventCounts): string {
  return ([['exam', '시험'], ['submission', '제출'], ['presentation', '발표']] as const)
    .filter(([k]) => c[k] > 0)
    .map(([k, label]) => `${label} ${c[k]}개`)
    .join(' · ');
}

export const KIND_LABEL: Record<EventKind, string> = { exam: '시험', submission: '제출', presentation: '발표' };
export const PHASE_LABEL = { midterm: '중간', final: '기말' } as const;
