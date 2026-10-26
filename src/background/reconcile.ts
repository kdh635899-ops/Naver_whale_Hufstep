// 서비스 워커의 알림 예약·복구·발송 (§8.4). 전역 변수에 상태를 두지 않고 매번 IndexedDB에서 다시 읽는다.
import { countEventsForDate, deriveEvaluationEvents } from '../domain/assessment-events/events';
import { ALARM_PREFIX, RECONCILE_ALARM, decideDelivery, parseAlarmName, planNotifications } from '../domain/notifications/plan';
import { termKey } from '../domain/terms';
import { call, extApi, showSidebar } from '../platform/browser';
import { KEYS, kvDelete, kvGet, kvPut, loadState, type NotifLog } from '../storage/repository';

const NOTIF_PREFIX = 'hufstep-n:';

async function readContext() {
  let state = null;
  try { state = await loadState(); } catch { /* 손상된 데이터면 알림을 보내지 않는다 */ }
  const log = (await kvGet<NotifLog>(KEYS.notifLog)) ?? { sent: [] };
  const profile = state?.profile;
  return {
    state,
    tk: profile ? termKey(profile.currentTerm) : '',
    events: state && profile ? deriveEvaluationEvents(state.assessments, state.courses, state.completions, profile.currentTerm) : [],
    settings: state?.settings.notifications ?? { enabled: false, dayBefore: false, sameDay: false, time: '09:00', version: 1 },
    consented: !!state?.consent.notifications && !!state?.consent.academicData,
    sent: new Set(log.sent),
  };
}

/** 저장된 일정 ↔ 실제 등록된 알람을 비교해 맞춘다. 설치·시작·주기 점검·사이드바 저장 때마다 호출. */
export async function reconcile(now = new Date()): Promise<void> {
  const alarms = extApi('alarms');
  const notifications = extApi('notifications');
  if (!alarms) return;
  const ctx = await readContext();
  if (!ctx.state) await kvDelete([KEYS.notifLog]); // 전체 초기화 후 발송 이력도 정리

  const desired = planNotifications(ctx.events, ctx.settings, ctx.consented, now, ctx.tk, ctx.sent);
  const wanted = new Map(desired.map((d) => [d.name, d]));
  const existing = (await call<chrome.alarms.Alarm[]>(alarms.getAll, alarms)).filter((a) => a.name.startsWith(ALARM_PREFIX));
  for (const a of existing) {
    const d = wanted.get(a.name);
    if (!d || Math.abs(a.scheduledTime - d.when) > 60_000) await call(alarms.clear, alarms, a.name);
    else wanted.delete(a.name);
  }
  for (const d of wanted.values()) alarms.create(d.name, { when: d.when });

  // 자정·절전 복귀 대비 주기 점검 (워커 재시작 후에도 예약 복구)
  const periodic = await call<chrome.alarms.Alarm | undefined>(alarms.get, alarms, RECONCILE_ALARM);
  if (!periodic) alarms.create(RECONCILE_ALARM, { delayInMinutes: 1, periodInMinutes: 60 });

  // 이미 표시 중인 알림 중 근거가 사라진 것(일정 삭제·없음 전환·알림 끄기·동의 철회) 정리
  if (notifications) {
    const shown = await call<Record<string, boolean>>(notifications.getAll, notifications);
    for (const id of Object.keys(shown ?? {})) {
      if (!id.startsWith(NOTIF_PREFIX)) continue;
      const date = id.split(':')[2];
      const stillValid = ctx.consented && ctx.settings.enabled && countEventsForDate(ctx.events, date, { excludeCompleted: true }).total > 0;
      if (!stillValid) await call(notifications.clear, notifications, id);
    }
  }
}

/** 알람 실행: 최신 설정·일정을 다시 읽고 판단한 뒤에만 표시 */
export async function handleAlarm(name: string, now = new Date()): Promise<void> {
  const notifications = extApi('notifications');
  const rt = extApi('runtime');
  const ctx = await readContext();
  const d = decideDelivery(name, now, ctx.events, ctx.settings, ctx.consented, ctx.tk, ctx.sent);
  if (d.deliver && notifications && rt) {
    const p = parseAlarmName(name)!;
    await call(notifications.create, notifications, `${NOTIF_PREFIX}${p.kind}:${d.date}`, {
      type: 'basic', iconUrl: rt.getURL('icons/icon128.png'), title: d.title, message: d.message, priority: 0,
    });
    const log = (await kvGet<NotifLog>(KEYS.notifLog)) ?? { sent: [] };
    await kvPut({ [KEYS.notifLog]: { sent: [...log.sent, d.key].slice(-500) } });
  }
  await reconcile(now);
}

/** 알림 클릭 → 해당 날짜의 평가 목록 */
export async function openFromNotification(id: string): Promise<void> {
  if (!id.startsWith(NOTIF_PREFIX)) return;
  await kvPut({ [KEYS.route]: { view: 'today', date: id.split(':')[2] } });
  showSidebar();
  const notifications = extApi('notifications');
  if (notifications) await call(notifications.clear, notifications, id);
}

/** 전체 초기화·동의 철회: 우리 알람·알림·발송 이력을 모두 지운다 */
export async function clearAllScheduling(): Promise<void> {
  const alarms = extApi('alarms');
  const notifications = extApi('notifications');
  if (alarms) {
    const all = await call<chrome.alarms.Alarm[]>(alarms.getAll, alarms);
    for (const a of all) if (a.name.startsWith(ALARM_PREFIX)) await call(alarms.clear, alarms, a.name);
  }
  if (notifications) {
    const shown = await call<Record<string, boolean>>(notifications.getAll, notifications);
    for (const id of Object.keys(shown ?? {})) if (id.startsWith(NOTIF_PREFIX)) await call(notifications.clear, notifications, id);
  }
  await kvDelete([KEYS.notifLog]);
}
