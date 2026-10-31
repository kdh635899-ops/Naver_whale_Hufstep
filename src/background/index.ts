// MV3 서비스 워커 진입점. 리스너는 최상위에서 동기적으로 등록해야 워커가 깨어날 때 이벤트를 받는다.
// DOM API를 쓰지 않는다.
import { RECONCILE_ALARM } from '../domain/notifications/plan';
import { runtimeMessageSchema } from '../domain/validation/schemas';
import { extApi } from '../platform/browser';
import { clearAllScheduling, handleAlarm, openFromNotification, reconcile } from './reconcile';

const runtime = extApi('runtime')!;
const alarms = extApi('alarms'); // 알림 권한을 뺐기 때문에 없을 수 있다 (없으면 아무것도 예약하지 않는다)
const notifications = extApi('notifications');

runtime.onInstalled.addListener(() => void reconcile());
runtime.onStartup.addListener(() => void reconcile());

alarms?.onAlarm.addListener((alarm) => {
  void (alarm.name === RECONCILE_ALARM ? reconcile() : handleAlarm(alarm.name));
});

notifications?.onClicked.addListener((id) => void openFromNotification(id));

// 내부 메시지만 받는다: 같은 확장앱의 페이지에서 온, 허용된 종류의 메시지
runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== runtime.id) return false;
  const parsed = runtimeMessageSchema.safeParse(msg);
  if (!parsed.success) return false;
  const job = parsed.data.type === 'clearAll' ? clearAllScheduling() : reconcile();
  job.then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
  return true; // 비동기 응답
});
