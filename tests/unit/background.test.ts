// 서비스 워커 예약·복구 로직을 가짜 alarms/notifications API로 검사한다 (실제 OS 알림 검증이 아님).
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllScheduling, handleAlarm, openFromNotification, reconcile } from '../../src/background/reconcile';
import { CONSENT_VERSION, type AppState } from '../../src/domain/state';
import { buildDemoState } from '../../src/data/demo';
import { clearEverything, KEYS, kvGet, saveState } from '../../src/storage/repository';

type Alarm = { name: string; scheduledTime: number; periodInMinutes?: number };
const alarms = new Map<string, Alarm>();
const shown = new Map<string, { message: string }>();

(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: { id: 'test-ext', lastError: undefined, getURL: (p: string) => `chrome-extension://test-ext/${p}` },
  alarms: {
    getAll: (cb: (a: Alarm[]) => void) => cb([...alarms.values()]),
    get: (n: string, cb: (a?: Alarm) => void) => cb(alarms.get(n)),
    clear: (n: string, cb: (ok: boolean) => void) => cb(alarms.delete(n)),
    create: (n: string, o: { when?: number; delayInMinutes?: number; periodInMinutes?: number }) =>
      alarms.set(n, { name: n, scheduledTime: o.when ?? Date.now() + (o.delayInMinutes ?? 0) * 60_000, periodInMinutes: o.periodInMinutes }),
  },
  notifications: {
    create: (id: string, o: { message: string }, cb: (id: string) => void) => { shown.set(id, o); cb(id); },
    getAll: (cb: (m: Record<string, boolean>) => void) => cb(Object.fromEntries([...shown.keys()].map((k) => [k, true]))),
    clear: (id: string, cb: (ok: boolean) => void) => cb(shown.delete(id)),
  },
};

const TODAY = new Date(2026, 10, 3, 12, 0); // 테스트용 가상 '지금' (기준일 11-05 이틀 전)
function state(over: Partial<AppState> = {}): AppState {
  const s = buildDemoState(new Date(2026, 10, 5));
  return {
    ...s,
    profile: { ...s.profile!, currentTerm: { academicYear: 2026, semester: '2' } },
    consent: { ...s.consent, notifications: { version: CONSENT_VERSION, at: '' } },
    settings: { ...s.settings, notifications: { enabled: true, dayBefore: true, sameDay: true, time: '09:00', version: 1 } },
    ...over,
  };
}
const withNotif = (s: AppState, n: Partial<AppState['settings']['notifications']>): AppState =>
  ({ ...s, settings: { ...s.settings, notifications: { ...s.settings.notifications, ...n } } });
const ours = () => [...alarms.keys()].filter((k) => k.startsWith('hufstep:')).sort();

beforeEach(async () => { alarms.clear(); shown.clear(); await clearEverything(); });

describe('예약 복구·정리', () => {
  it('저장된 일정으로 예약을 만들고, 워커 재시작(알람 소실) 후 같은 예약을 복구', async () => {
    await saveState(state());
    await reconcile(TODAY);
    const first = ours();
    expect(first).toContain('hufstep:dayBefore:2026-11-05:2026-2:v1');
    expect(first).toContain('hufstep:sameDay:2026-11-05:2026-2:v1');
    expect(alarms.has('hufstep-reconcile')).toBe(true);
    alarms.clear();
    await reconcile(TODAY);
    expect(ours()).toEqual(first);
  });
  it('알림 끄기·동의 철회·전체 삭제 시 예약이 사라진다', async () => {
    await saveState(state());
    await reconcile(TODAY);
    await saveState(withNotif(state(), { enabled: false, version: 2 }));
    await reconcile(TODAY);
    expect(ours()).toEqual([]);

    await saveState(state());
    await reconcile(TODAY);
    await saveState({ ...state(), consent: { academicData: state().consent.academicData } });
    await reconcile(TODAY);
    expect(ours()).toEqual([]);

    await saveState(state());
    await reconcile(TODAY);
    await clearEverything();
    await clearAllScheduling();
    expect(ours()).toEqual([]);
  });
  it('시험을 없음으로 바꾸면 그날 예약이 정리된다', async () => {
    await saveState(state());
    await reconcile(TODAY);
    const s = state();
    const changed = s.assessments.map((a) => (['demo-a1f', 'demo-a2m', 'demo-a3f'].includes(a.id) ? { ...a, mode: 'none' as const } : a));
    await saveState({ ...s, assessments: changed });
    await reconcile(TODAY);
    expect(ours().some((n) => n.includes('2026-11-05'))).toBe(false);
  });
  it('시험 날짜를 바꾸면 예약이 새 날짜로 옮겨지고, 메모·수업 시간은 그대로', async () => {
    const s = state({ assessments: state().assessments.filter((a) => a.id === 'demo-a1f') }); // 11-05 시험 하나만
    await saveState(s);
    await reconcile(TODAY);
    expect(ours().some((n) => n.includes('2026-11-05'))).toBe(true);
    const moved = { ...s, assessments: s.assessments.map((a) => ({ ...a, examDate: '2026-11-12' })) };
    await saveState(moved);
    await reconcile(TODAY);
    expect(ours().some((n) => n.includes('2026-11-05'))).toBe(false);
    expect(ours()).toContain('hufstep:sameDay:2026-11-12:2026-2:v1');
    const loaded = (await kvGet<AppState>(KEYS.state))!;
    expect(loaded.courseMemos).toEqual(s.courseMemos);
    expect(loaded.classTimes).toEqual(s.classTimes);
  });
  it('자유 메모에 날짜를 적어도 알림 예약이 생기지 않는다', async () => {
    await saveState(state({ assessments: [], courseMemos: [{ courseId: 'demo-c1', text: '2026-11-10 퀴즈, 11월 12일 과제 마감', updatedAt: '' }] }));
    await reconcile(TODAY);
    expect(ours()).toEqual([]);
  });
});

describe('알람 실행', () => {
  it('두 번 울려도 한 번만 발송하고, 과목명 없이 건수만 표시', async () => {
    await saveState(state());
    const name = 'hufstep:dayBefore:2026-11-05:2026-2:v1';
    await handleAlarm(name, new Date(2026, 10, 4, 9, 0));
    await handleAlarm(name, new Date(2026, 10, 4, 9, 1));
    expect([...shown.values()]).toEqual([expect.objectContaining({ message: '내일 시험 2개 · 제출 1개' })]);
    expect((await kvGet<{ sent: string[] }>(KEYS.notifLog))!.sent).toEqual(['dayBefore:2026-11-05:2026-2']);
  });
  it('설정 변경 직전 예약이 늦게 실행돼도 표시하지 않는다', async () => {
    await saveState(withNotif(state(), { time: '08:00', version: 2 }));
    await handleAlarm('hufstep:dayBefore:2026-11-05:2026-2:v1', new Date(2026, 10, 4, 9, 0));
    expect(shown.size).toBe(0);
  });
  it('일정 삭제 후 표시 중이던 알림도 정리', async () => {
    await saveState(state());
    await handleAlarm('hufstep:sameDay:2026-11-05:2026-2:v1', new Date(2026, 10, 5, 9, 0));
    expect(shown.size).toBe(1);
    await saveState({ ...state(), assessments: [] });
    await reconcile(new Date(2026, 10, 5, 9, 5));
    expect(shown.size).toBe(0);
  });
  it('알림 클릭 → 해당 날짜 목록으로 이동 정보 저장', async () => {
    shown.set('hufstep-n:sameDay:2026-11-05', { message: '' });
    await openFromNotification('hufstep-n:sameDay:2026-11-05');
    expect(await kvGet(KEYS.route)).toEqual({ view: 'today', date: '2026-11-05' });
    expect(shown.size).toBe(0);
  });
});
