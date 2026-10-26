// 브라우저 확장 API 어댑터 (§10.2). whale.* 를 우선 쓰고, 없으면 Chrome 호환 chrome.* 를 쓴다.
// 확장앱이 아닌 환경(개발 서버·단위 테스트)에서는 null → 호출 측이 조용히 건너뛴다.
import type { RuntimeMessage } from '../domain/validation/schemas';

type Ext = typeof chrome;
const g = globalThis as unknown as { whale?: Partial<Ext> & { sidebarAction?: { show?: () => void } }; chrome?: Ext };

/** 특정 API 네임스페이스를 whale → chrome 순으로 찾는다 */
export function extApi<K extends keyof Ext>(name: K): Ext[K] | null {
  return (g.whale?.[name] as Ext[K] | undefined) ?? (g.chrome?.runtime?.id ? g.chrome[name] : null) ?? null;
}

/** 콜백형 API를 Promise로 (구버전 Chromium 기반 웨일에서도 동작하도록) */
export function call<T>(fn: unknown, thisArg: unknown, ...args: unknown[]): Promise<T> {
  return new Promise((resolve, reject) => {
    (fn as (...a: unknown[]) => unknown).call(thisArg, ...args, (result: T) => {
      const err = extApi('runtime')?.lastError;
      if (err) reject(new Error(err.message)); else resolve(result);
    });
  });
}

/** 사이드바 → 서비스 워커: 알림 예약을 최신 상태로 맞추라고 알린다 */
export async function notifyBackground(msg: RuntimeMessage): Promise<void> {
  const rt = extApi('runtime');
  if (!rt?.id) return;
  try { await call(rt.sendMessage, rt, msg); } catch { /* 워커가 아직 깨어나지 않음 — onStartup/주기 점검이 복구 */ }
}

export function showSidebar(): void {
  try { g.whale?.sidebarAction?.show?.(); } catch { /* 지원하지 않는 환경 */ }
}
