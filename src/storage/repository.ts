// 확장앱 origin의 IndexedDB 저장소 (§9.1). 사이드바와 서비스 워커가 같은 DB를 쓴다.
// - 'appState'  : 사이드바만 쓴다 (학생 조건·과목·평가·설정)
// - 'notifLog'  : 서비스 워커만 쓴다 (알림 발송 이력) → 서로 덮어쓰지 않게 키를 분리
// - 'pendingRoute': 알림 클릭 시 열 화면
import { SCHEMA_VERSION, type AppState } from '../domain/state';
import { appStateSchema, firstIssue } from '../domain/validation/schemas';

const DB_NAME = 'hufstep';
const STORE = 'kv';
export const KEYS = { state: 'appState', notifLog: 'notifLog', route: 'pendingRoute' } as const;

export interface NotifLog { sent: string[] }
export interface PendingRoute { view: 'today'; date: string }

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve((req ? req.result : undefined) as T);
      tx.onerror = () => reject(tx.error ?? new Error('저장소 작업 중 오류가 났어요'));
      tx.onabort = () => reject(tx.error ?? new Error('저장 트랜잭션이 취소됐어요'));
    });
  } finally {
    db.close();
  }
}

export const kvGet = <T>(key: string) => run<T | undefined>('readonly', (s) => s.get(key));
/** 여러 키를 하나의 트랜잭션으로: 중간에 실패하면 전부 반영되지 않는다 */
export const kvPut = (entries: Record<string, unknown>) =>
  run<void>('readwrite', (s) => { for (const [k, v] of Object.entries(entries)) s.put(v, k); });
export const kvDelete = (keys: string[]) => run<void>('readwrite', (s) => { keys.forEach((k) => s.delete(k)); });

export class StateLoadError extends Error {}

/** schemaVersion별 변환. 새 버전이 생기면 { 1: (v1) => v2 } 처럼 추가한다. 원본은 지우지 않는다. */
export const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {
  // v1 → v2: 과목별 자유 메모·수업 시간 칸을 빈 목록으로 추가 (기존 과목·성적·평가 값은 그대로)
  1: (raw) => ({ ...raw, courseMemos: [], classTimes: [] }),
};

/**
 * 카탈로그에서 ID가 바뀐 학과: 옛 ID → { 새 ID, 해당 학과의 실제 캠퍼스 }.
 * 일본언어문화학부는 서울캠퍼스 소속인데 글로벌로 잘못 등록돼 있었다 (https://hufsjp1.hufs.ac.kr/hufsjp/m01_s04.do).
 */
export const RENAMED_DEPARTMENTS: Record<string, { id: string; campus: 'seoul' | 'global' }> = {
  'global-japanese-language-culture': { id: 'seoul-japanese-language-culture', campus: 'seoul' },
};

/** 옛 학과 ID 연결만 새 ID로 옮긴다. 주전공이 그 학과일 때만 homeCampus를 학과 캠퍼스에 맞춘다. 원본은 바꾸지 않는다. */
function remapDepartments(cur: Record<string, unknown>): Record<string, unknown> {
  const fix = (id: unknown) => (typeof id === 'string' && RENAMED_DEPARTMENTS[id]?.id) || id;
  const out = { ...cur };
  const p = cur.profile as Record<string, unknown> | null | undefined;
  if (p && typeof p === 'object') {
    const moved = typeof p.primaryDepartmentId === 'string' ? RENAMED_DEPARTMENTS[p.primaryDepartmentId] : undefined;
    out.profile = {
      ...p,
      primaryDepartmentId: fix(p.primaryDepartmentId),
      ...('secondaryDepartmentId' in p && { secondaryDepartmentId: fix(p.secondaryDepartmentId) }),
      ...(moved && { homeCampus: moved.campus }),
    };
  }
  if (Array.isArray(cur.courses)) {
    out.courses = cur.courses.map((c) => (c && typeof c === 'object' && 'recognizedDepartmentId' in c
      ? { ...c, recognizedDepartmentId: fix((c as Record<string, unknown>).recognizedDepartmentId) } : c));
  }
  return out;
}

/** 예전에 시간표에서 만든 과목(직접 추가·학점 0·미분류·수업 시간 있음)을 시간표 과목으로 옮긴다. 학점 계산과 이어지지 않는다. */
function adoptTimetableCourses(cur: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(cur.courses) || !Array.isArray(cur.classTimes)) return cur;
  const timed = new Set(cur.classTimes.map((t) => (t as Record<string, unknown>)?.courseId));
  return {
    ...cur,
    courses: cur.courses.map((c) => {
      const o = c as Record<string, unknown>;
      return o && o.origin === 'manual' && o.creditUnits === 0 && o.area === 'unknown' && timed.has(o.id) ? { ...o, origin: 'timetable' } : c;
    }),
  };
}

export function migrate(raw: unknown, target = SCHEMA_VERSION): AppState {
  if (!raw || typeof raw !== 'object') throw new StateLoadError('저장된 데이터 형식을 알 수 없어요.');
  let cur = raw as Record<string, unknown>;
  let v = Number(cur.schemaVersion);
  if (!Number.isInteger(v) || v < 1) throw new StateLoadError('저장된 데이터 버전을 알 수 없어요.');
  if (v > target) throw new StateLoadError('더 새로운 버전의 앱에서 저장한 데이터예요. 앱을 업데이트해 주세요.');
  while (v < target) {
    const step = MIGRATIONS[v];
    if (!step) throw new StateLoadError(`데이터 버전 ${v}을(를) 변환할 수 없어요.`);
    cur = { ...step(cur), schemaVersion: v + 1 };
    v++;
  }
  const r = appStateSchema.safeParse(adoptTimetableCourses(remapDepartments(cur)));
  if (!r.success) throw new StateLoadError(`저장된 데이터 검사에 실패했어요: ${firstIssue(r.error)}`);
  return r.data;
}

/** 저장된 상태를 읽는다. 실패하면 예외 — 호출 측은 기존 데이터를 덮어쓰지 않아야 한다. */
export async function loadState(): Promise<AppState | null> {
  const raw = await kvGet<unknown>(KEYS.state);
  return raw === undefined ? null : migrate(raw);
}

/** 검사를 통과한 상태만 저장한다. 실패하면 예외를 던지고 기존 저장값은 그대로 남는다. */
export async function saveState(state: AppState): Promise<void> {
  const r = appStateSchema.safeParse(state);
  if (!r.success) throw new Error(`저장할 수 없어요: ${firstIssue(r.error)}`);
  await kvPut({ [KEYS.state]: r.data });
}

export const clearEverything = () => kvDelete([KEYS.state, KEYS.notifLog, KEYS.route]);
