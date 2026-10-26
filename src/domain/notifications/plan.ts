// 선택적 시스템 알림의 예약 계획·발송 판단 (§8.4). 순수 함수 — 실제 whale.alarms 호출은 background가 한다.
import { countEventsForDate, countText, type EventCounts } from '../assessment-events/events';
import { addDays, dateKey, localDateTime } from '../terms';
import type { EvaluationEvent } from '../types';

export interface NotificationSettings {
  enabled: boolean;
  dayBefore: boolean;
  sameDay: boolean;
  time: string; // HH:mm, 기본 09:00
  version: number; // 설정이 바뀔 때마다 +1 → 이전 예약 무효화
}

export type AlarmKind = 'dayBefore' | 'sameDay';
export interface PlannedAlarm { name: string; when: number; kind: AlarmKind; date: string }

export const ALARM_PREFIX = 'hufstep:';
export const RECONCILE_ALARM = 'hufstep-reconcile';

export const alarmName = (kind: AlarmKind, date: string, termKey: string, version: number) =>
  `${ALARM_PREFIX}${kind}:${date}:${termKey}:v${version}`;

export function parseAlarmName(name: string) {
  const m = /^hufstep:(dayBefore|sameDay):(\d{4}-\d{2}-\d{2}):([^:]+):v(\d+)$/.exec(name);
  return m ? { kind: m[1] as AlarmKind, date: m[2], termKey: m[3], version: Number(m[4]) } : null;
}

/** 발송 이력 키: 같은 날짜·종류·학기는 워커가 재시작돼도 한 번만 보낸다 */
export const sentKey = (kind: AlarmKind, date: string, termKey: string) => `${kind}:${date}:${termKey}`;

export function planNotifications(
  events: EvaluationEvent[], settings: NotificationSettings, consented: boolean, now: Date, termKey: string, sent: Set<string>,
): PlannedAlarm[] {
  if (!settings.enabled || !consented) return [];
  const pending = events.filter((e) => !e.completed); // 완료한 제출은 재알림하지 않는다
  const dates = [...new Set(pending.map((e) => e.date))];
  const nowMs = now.getTime();
  const out: PlannedAlarm[] = [];
  for (const date of dates) {
    if (settings.dayBefore && !sent.has(sentKey('dayBefore', date, termKey))) {
      const when = localDateTime(addDays(date, -1), settings.time).getTime();
      if (when > nowMs) out.push({ name: alarmName('dayBefore', date, termKey, settings.version), when, kind: 'dayBefore', date });
    }
    if (settings.sameDay && !sent.has(sentKey('sameDay', date, termKey))) {
      // 설정 시각과 '첫 시간 있는 이벤트 30분 전' 중 빠른 시각
      const times = pending.filter((e) => e.date === date && e.time).map((e) => localDateTime(date, e.time).getTime());
      const base = localDateTime(date, settings.time).getTime();
      let when = Math.min(base, times.length ? Math.min(...times) - 30 * 60_000 : Infinity);
      if (when <= nowMs && date === dateKey(now)) {
        // 오늘 예약 시각이 이미 지났다면, 아직 남은 이벤트가 있을 때만 곧바로 한 번 알린다
        const remaining = pending.some((e) => e.date === date && (!e.time || localDateTime(date, e.time).getTime() > nowMs));
        if (remaining) when = nowMs + 60_000;
      }
      if (when > nowMs) out.push({ name: alarmName('sameDay', date, termKey, settings.version), when, kind: 'sameDay', date });
    }
  }
  return out;
}

/**
 * 알람이 울렸을 때 실제로 보여줄지 최신 상태로 다시 판단한다.
 * (설정 변경 직전 예약, 동의 철회, 일정 삭제, 절전 복귀 후 지난 알림 등을 걸러낸다)
 */
export function decideDelivery(
  name: string, now: Date, events: EvaluationEvent[], settings: NotificationSettings, consented: boolean,
  termKey: string, sent: Set<string>,
): { deliver: false } | { deliver: true; counts: EventCounts; key: string; title: string; message: string; date: string } {
  const p = parseAlarmName(name);
  if (!p || !consented || !settings.enabled || p.version !== settings.version || p.termKey !== termKey) return { deliver: false };
  if ((p.kind === 'dayBefore' && !settings.dayBefore) || (p.kind === 'sameDay' && !settings.sameDay)) return { deliver: false };
  const key = sentKey(p.kind, p.date, p.termKey);
  if (sent.has(key)) return { deliver: false };
  const today = dateKey(now);
  // 늦게 깨어난 알람: 전날 알림은 시험 당일 이후 보내지 않고, 당일 알림은 그날이 지나면 보내지 않는다
  if (p.kind === 'dayBefore' ? today >= p.date : today !== p.date) return { deliver: false };
  const counts = countEventsForDate(events, p.date, { excludeCompleted: true });
  if (!counts.total) return { deliver: false };
  // 잠금화면 노출을 줄이기 위해 과목명·성적 없이 건수만
  return {
    deliver: true, counts, key, date: p.date,
    title: 'HUFStep 평가 알림',
    message: `${p.kind === 'dayBefore' ? '내일' : '오늘'} ${countText(counts)}`,
  };
}
