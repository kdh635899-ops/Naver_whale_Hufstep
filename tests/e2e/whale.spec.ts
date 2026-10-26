// 실제 네이버 웨일 + 빌드된 dist/ 확장앱으로 핵심 사용자 흐름을 검사한다.
// - 웨일은 임시 사용자 프로필로 띄운다 (평소 쓰는 웨일 프로필과 무관).
// - sidebar.html을 탭에서 390px로 연다. 실제 사이드바 패널 안의 표시·OS 알림 팝업은 사람이 따로 확인해야 한다.
// - 입력 데이터는 모두 합성 fixture.
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEMO_TRANSCRIPT } from '../../src/data/demo';

const WHALE = process.env.WHALE_PATH ?? 'C:/Program Files/Naver/Naver Whale/Application/whale.exe';
const PORT = 9334;
const EXT = path.resolve('dist');

let proc: ChildProcess;
let profileDir: string;
let ctx: BrowserContext;
let sw: Worker | undefined;
let extId: string;
let page: Page;
const external: string[] = [];
const consoleErrors: string[] = [];

const today = () => page.evaluate(() => {
  const d = new Date(); const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
});
const readState = () => page.evaluate(() => new Promise<string>((res) => {
  const r = indexedDB.open('hufstep');
  r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('appState'); g.onsuccess = () => { res(JSON.stringify(g.result ?? null)); r.result.close(); }; };
}));
const swCall = <T,>(fn: 'alarms' | 'notifications') => sw!.evaluate((f) => new Promise<unknown>((res) => {
  const api = (globalThis as unknown as { whale: typeof chrome }).whale;
  if (f === 'alarms') api.alarms.getAll(res); else api.notifications.getAll(res);
}), fn) as Promise<T>;
const ourAlarms = async () => (await swCall<chrome.alarms.Alarm[]>('alarms')).map((a) => a.name).filter((n) => n.startsWith('hufstep:'));
const shownIds = async () => Object.keys(await swCall<Record<string, boolean>>('notifications'));
const tab = (name: string) => page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name });

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  profileDir = mkdtempSync(path.join(tmpdir(), 'hufstep-e2e-'));
  proc = spawn(WHALE, [
    `--user-data-dir=${profileDir}`, `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check',
    `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, 'about:blank',
  ], { stdio: 'ignore', windowsHide: true });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch { /* 아직 시작 중 */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  ctx = browser.contexts()[0];
  for (let i = 0; i < 40 && !sw; i++) {
    for (const w of ctx.serviceWorkers()) {
      if (w.url().endsWith('/background.js') && await w.evaluate(() => chrome.runtime.getManifest().name).catch(() => '') === 'HUFStep') sw = w;
    }
    if (!sw) await new Promise((r) => setTimeout(r, 500));
  }
  expect(sw, 'HUFStep 서비스 워커가 웨일에 로드되어야 함').toBeTruthy();
  extId = new URL(sw!.url()).host;
  page = await ctx.newPage();
  await page.setViewportSize({ width: 390, height: 820 });
  page.on('request', (r) => { if (!/^(chrome-extension|data|blob):/.test(r.url())) external.push(r.url()); });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  await page.goto(`chrome-extension://${extId}/sidebar.html`);
});

test.afterAll(async () => {
  try {
    const browser = ctx?.browser();
    if (browser) await (await browser.newBrowserCDPSession()).send('Browser.close');
  } catch { /* 이미 종료 */ }
  proc?.kill();
  await new Promise((r) => setTimeout(r, 1500));
  try { rmSync(profileDir, { recursive: true, force: true }); } catch { /* 웨일이 파일을 잡고 있으면 남겨 둠 */ }
});

test('웨일 API: whale.alarms / notifications / sidebarAction 이 서비스 워커에 있다', async () => {
  const apis = await sw!.evaluate(() => {
    const w = (globalThis as unknown as { whale: Record<string, unknown> }).whale;
    return { alarms: typeof w.alarms, notifications: typeof w.notifications, sidebarAction: typeof w.sidebarAction };
  });
  expect(apis).toEqual({ alarms: 'object', notifications: 'object', sidebarAction: 'object' });
  const iconOk = await page.evaluate(async () => (await fetch('/icons/icon128.png')).ok);
  expect(iconOk).toBe(true); // 알림 아이콘 실제 파일
});

// Figma 화면 기준 흐름. 현재 학기는 앱이 정하는 값(오늘 날짜 기준)이라 학기 이름 대신 요소로 찾는다.
const MEMO = '준비물: 사전\n2026-11-20 퀴즈 (메모 속 날짜는 알림이 아님)';

/** 학점 계산 화면의 '강의 정보 추가하기'로 이번 학기 과목 하나를 추가한다 */
async function addCurrentCourse(name: string, credits = '3') {
  await tab('학점 계산').click();
  await page.getByRole('button', { name: '강의 정보 추가하기' }).click();
  const dlg = page.getByRole('dialog', { name: '과목 추가' });
  await dlg.getByLabel(/^과목명/).fill(name);
  await dlg.getByRole('spinbutton', { name: /^학점/ }).fill(credits);
  await dlg.getByRole('button', { name: '저장', exact: true }).click();
  await expect(dlg).toBeHidden();
}

test('첫 실행 → 개인정보 저장 → 동의 → 종정시 붙여넣기 저장(빠진 건 반려) → 학사 현황 (원문 미저장)', async () => {
  await page.getByLabel('이름 / 닉네임').fill('김웨이');
  await page.getByLabel(/^주전공/).selectOption({ label: '말레이·인도네시아어과' });
  await page.getByRole('radio', { name: '이중전공' }).check();
  await page.getByRole('combobox', { name: /^이중전공/ }).selectOption({ label: '경영학부 (서울캠퍼스)' });
  await page.getByLabel(/^학번/).selectOption('2024');
  await page.getByRole('button', { name: '학사정보 저장' }).click();

  await expect(page.getByRole('heading', { name: /종정시 정보를 입력하고/ })).toBeVisible();
  expect(JSON.parse(await readState()).profile.name).toBe('김웨이');
  await page.getByRole('checkbox', { name: /동의해요/ }).check();
  await page.getByRole('button', { name: '동의하고 계속' }).click();

  const link = page.getByRole('link', { name: /종합정보시스템 바로가기/ });
  await expect(link).toHaveAttribute('href', 'https://wis.hufs.ac.kr/src08/jsp/index.jsp');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(link).toHaveAttribute('target', '_blank');

  const box = page.getByLabel('종정시 정보 붙여넣기');
  const save = page.getByRole('button', { name: '종정시 정보 저장' });
  // 아무것도 안 붙이면 반려
  await save.click();
  await expect(page.locator('.red-list')).toContainText('붙여넣은 내용이 없어요');
  // 필수 줄(이수구분별 취득학점 계)이 빠지면 빨간 글씨로 알리고 저장하지 않는다
  const noSummary = DEMO_TRANSCRIPT.slice(0, DEMO_TRANSCRIPT.indexOf('이수구분별 취득학점 계'));
  await box.fill(noSummary);
  await save.click();
  await expect(page.locator('.red-list')).toContainText('이수구분별 취득학점 계');
  await expect(page.locator('.part.missing')).toHaveText('이수구분별 취득학점 계');
  expect(JSON.parse(await readState()).courses).toHaveLength(0);

  // 이상 없으면 저장하고 학사 현황으로 넘어간다
  await box.fill(DEMO_TRANSCRIPT);
  await save.click();
  await expect(page.getByRole('heading', { name: '내 학사현황' })).toBeVisible();
  const saved = await readState();
  expect(JSON.parse(saved).courses).toHaveLength(6);
  expect(saved).not.toContain('이수구분별 취득학점 계'); // 원문은 저장하지 않는다

  // 같은 자료를 다시 저장해도 과목 수가 늘지 않는다
  await tab('종정시 입력').click();
  await page.getByLabel('종정시 정보 붙여넣기').fill(DEMO_TRANSCRIPT);
  await page.getByRole('button', { name: '종정시 정보 저장' }).click();
  await expect(page.getByRole('heading', { name: '내 학사현황' })).toBeVisible();
  expect(JSON.parse(await readState()).courses).toHaveLength(6);
});

test('학사 현황: 남은 학점·영역별·필수과목·졸업시험이 저장한 데이터로 채워지고, 직접 체크로 맞출 수 있다', async () => {
  await tab('학사 현황').click();
  await expect(page.locator('.st-meta')).toContainText('24학번');
  await expect(page.locator('.remain-card .got')).toContainText('20');
  await expect(page.locator('.remain-card .got')).toContainText('/134');
  expect(await page.locator('.area-row').count()).toBeGreaterThan(0);
  await page.getByRole('button', { name: '03 졸업시험' }).click();

  // 규칙을 고르려면 답해야 하는 질문(특별전형·영어 전공 분류·인증 언어 등)은 필요할 때만 나타난다. 답하면 사라지고 규칙이 계산된다.
  const questions = page.locator('section[aria-labelledby="questions-title"]');
  for (let i = 0; i < 5 && await questions.count(); i++) {
    const select = questions.locator('li select').first();
    const label = (await select.getAttribute('aria-label'))!;
    const options = await select.locator('option').allTextContents();
    await select.selectOption({ label: options.includes('아니요') ? '아니요' : '목록에 없음 / 해당 없음' });
    await expect(questions.getByLabel(label, { exact: true })).toHaveCount(0);
  }
  await expect(questions).toHaveCount(0);

  // 필수과목 카드: 행을 누르면 필수과목 목록이 펼쳐진다
  const primary = page.locator('.sc').filter({ hasText: '주전공' }).first();
  const row = primary.getByRole('button', { name: /^\d+\/11과목/ });
  await expect(row).toBeVisible();
  await row.click();
  const item = primary.locator('.sc-item').filter({ hasText: '지역과지역학' });
  await expect(item).toContainText('미이수');

  // 과목을 추가하면(공식 코드로 대조) 이수로 바뀐다
  await tab('학점 계산').click();
  await page.getByRole('button', { name: '강의 정보 추가하기' }).click();
  const dlg = page.getByRole('dialog', { name: '과목 추가' });
  await dlg.getByLabel(/^과목명/).fill('지역과지역학');
  await dlg.getByLabel('학년도').fill('2025');
  await dlg.getByLabel('학기').selectOption('1');
  await dlg.getByRole('spinbutton', { name: /^학점/ }).fill('3');
  await dlg.getByLabel('상태').selectOption({ label: '이수 완료' });
  await dlg.getByLabel('성적').first().selectOption('A0');
  await dlg.getByText('추가 정보', { exact: true }).click();
  await dlg.getByLabel(/공식 과목 코드/).fill('B03131');
  await dlg.getByRole('button', { name: '저장', exact: true }).click();
  await expect(dlg).toBeHidden();
  await tab('학사 현황').click();
  await primary.getByRole('button', { name: /^\d+\/11과목/ }).click();
  await expect(primary.locator('.sc-item').filter({ hasText: '지역과지역학' })).toContainText('이수');

  // 직접 체크: 켜면 이수에 들어가고, 다시 누르면 풀린다
  const label = (await primary.locator('.sc-item:not(.met) .tg').first().getAttribute('aria-label'))!;
  const toggle = primary.getByRole('button', { name: label }); // 체크하면 줄이 이수로 바뀌므로 이름으로 고정한다
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(JSON.parse(await readState()).certConfirmations.length).toBe(1);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect(JSON.parse(await readState()).certConfirmations.length).toBe(0);
});

test('학점 계산: 평점 카드·학년 탭·이번 학기 카드에서 예상 등급을 넣으면 예상 누적 평점이 나온다', async () => {
  await tab('학점 계산').click();
  await expect(page.locator('.gpa-card.light')).toContainText('현재 누적 평점');
  await expect(page.locator('.gpa-card.dark .gpa-num')).toHaveText('—');
  await expect(page.locator('.pill-tabs button')).toHaveText(['1학년', '2학년', '3학년', '4학년']);
  await addCurrentCourse('가상 과목 B');
  const row = page.locator('.term-card.current .term-row').filter({ hasText: '가상 과목 B' });
  await row.getByRole('combobox').selectOption('A+');
  await expect(page.locator('.gpa-card.dark .gpa-num')).not.toHaveText('—');
  // 학년 탭을 바꾸면 이번 학기 카드는 사라진다 (지난 학년은 표만 순서대로)
  await page.locator('.pill-tabs button[aria-pressed="false"]').first().click();
  await expect(page.locator('.term-card.current')).toHaveCount(0);
  await page.locator('.pill-tabs button').nth(2).click(); // 3학년 = 현재 학년(2024학번 기준)
  await expect(page.locator('.term-card.current')).toHaveCount(1);
  // 예상 성적은 저장되지만 실제 이수 현황(과목 상태)은 바뀌지 않는다
  const state = JSON.parse(await readState());
  expect(state.scenarios.length).toBe(1);
  expect(state.courses.find((c: { name: string }) => c.name === '가상 과목 B').grade).toBeNull();
});

test('시간표: 과목 추가 → 수업 시간 입력 → 격자에 블록, 메모 저장과 시험 정보 수정 구분', async () => {
  await tab('시간표').click();
  await expect(page.locator('.tt')).toHaveCount(1);
  await expect(page.locator('.tt-dayh').filter({ hasText: /^[월화수목금]$/ })).toHaveCount(5);
  await expect(page.locator('.tt-cell.hour')).toHaveText(['9', '10', '11', '12', '13', '14', '15', '16']); // Figma: 9~16시
  await expect(page.locator('.tt-blk')).toHaveCount(0);

  // '수강 중' 과목은 이번 학기에 들어간다 (추가 → 시간 미정 칩으로 보임)
  await page.getByRole('button', { name: '+ 과목 추가' }).click();
  const add = page.getByRole('dialog', { name: '과목 추가' });
  await add.getByLabel(/^과목명/).fill('가상 수강 과목');
  await add.getByRole('spinbutton', { name: /^학점/ }).fill('3');
  await add.getByRole('button', { name: '저장', exact: true }).click();
  await expect(add).toBeHidden();
  const pill = page.locator('.tt-extra .pill').filter({ hasText: '가상 수강 과목' });
  await expect(pill).toBeVisible();

  await pill.click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toBeFocused();
  await dlg.getByRole('button', { name: '수업 시간 입력' }).click();
  await dlg.getByLabel('요일').nth(0).selectOption('0');
  await dlg.getByLabel('시작', { exact: true }).nth(0).fill('09:00');
  await dlg.getByLabel('종료', { exact: true }).nth(0).fill('12:00');
  await dlg.getByRole('button', { name: '+ 수업 시간 추가' }).click();
  await dlg.getByLabel('요일').nth(1).selectOption('2');
  await dlg.getByLabel('시작', { exact: true }).nth(1).fill('09:00');
  await dlg.getByLabel('종료', { exact: true }).nth(1).fill('12:00');
  await dlg.getByRole('button', { name: '저장', exact: true }).click();
  await expect(dlg).toContainText('월 09:00~12:00 · 수 09:00~12:00');

  // 자유 메모 저장 (시험 정보와 별도 버튼)
  await dlg.getByLabel('내 메모').fill(MEMO);
  await expect(dlg).toContainText('저장 전');
  await dlg.getByRole('button', { name: '메모 저장' }).click();
  await expect(dlg).toContainText('저장했어요');

  // 시험 정보 수정·저장 후에도 메모가 남는다
  await dlg.getByRole('button', { name: '시험 정보 수정', exact: true }).click();
  await dlg.getByRole('radio', { name: 'O · 시험 있음' }).first().check();
  await dlg.getByLabel('시험일').fill(await today());
  await dlg.getByLabel('시작 (선택)').fill('23:59');
  await dlg.getByRole('button', { name: '저장', exact: true }).click();
  await expect(dlg).toContainText('중간고사 · 시험 O');
  await expect(dlg.getByLabel('내 메모')).toHaveValue(MEMO);
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();

  const blocks = page.locator('.tt-blk');
  await expect(blocks).toHaveCount(2); // 월·수 두 칸
  await expect(pill).toHaveCount(0); // 시간이 생기면 '시간 미정' 칩에서 빠진다
  await expect(blocks.first()).toContainText('가상 수강 과목');
  await expect(blocks.first()).toContainText('중간 시험O');
  await expect(blocks.first()).toContainText('기말 —');
  const [mon, wed] = [await blocks.nth(0).boundingBox(), await blocks.nth(1).boundingBox()];
  expect(Math.abs(mon!.y - wed!.y)).toBeLessThan(2); // 같은 시간 줄
  expect(wed!.x).toBeGreaterThan(mon!.x + mon!.width - 1); // 월 → 수 열
  expect(Math.round(mon!.height)).toBe(210); // 9~12시 = 3칸 × 70px (Figma)
  await page.screenshot({ path: 'test-results/timetable-figma.png', fullPage: true, timeout: 15_000 }).catch(() => {});

  // 취소하면 저장 전 상태로
  await blocks.first().click();
  await dlg.getByRole('button', { name: '시험 정보 수정', exact: true }).click();
  await dlg.getByRole('radio', { name: 'X · 시험 없음' }).first().check();
  await dlg.getByRole('button', { name: '취소', exact: true }).click();
  await expect(dlg).toContainText('중간고사 · 시험 O');
  await page.locator('.sheet-backdrop').click({ position: { x: 10, y: 10 } });
  await expect(dlg).toBeHidden();
});

test('마이페이지: 인사·프로필 카드·학적 정보 표, 톱니바퀴로 수정', async () => {
  await tab('마이페이지').click();
  await expect(page.getByRole('heading', { name: /안녕하세요,\s*김웨이님/ })).toBeVisible();
  await expect(page.locator('.profile-card')).toContainText('김웨이');
  await expect(page.locator('.profile-card')).toContainText('24학번');
  await expect(page.locator('.info-table')).toContainText('말레이·인도네시아어과');
  await expect(page.locator('.info-table')).toContainText('경영학부');
  await expect(page.locator('.info-table')).toContainText('신입학');
  await expect(page.getByText('정보 관리')).toHaveCount(0); // 보류 중인 항목은 만들지 않았다
  await page.getByRole('button', { name: '학적 정보 수정하기' }).click();
  const dlg = page.getByRole('dialog', { name: '내 정보 수정' });
  await dlg.getByLabel('이름 / 닉네임').fill('웨이');
  await dlg.getByRole('button', { name: '저장', exact: true }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByRole('heading', { name: /안녕하세요,\s*웨이님/ })).toBeVisible();
  expect(JSON.parse(await readState()).profile.name).toBe('웨이');
});

test('알림: 동의·켜기 → 실제 whale.alarms 예약 → 알람 실행 시 whale.notifications 생성 → 끄면 정리', async () => {
  const minutes = await page.evaluate(() => new Date().getHours() * 60 + new Date().getMinutes());
  test.skip(minutes >= 23 * 60 + 50, '자정 직전에는 당일 알림 검사를 건너뜀');
  const t = await today();
  await tab('마이페이지').click();
  await page.getByRole('button', { name: '학적 정보 수정하기' }).click();
  const dlg = page.getByRole('dialog', { name: '내 정보 수정' });
  await dlg.getByText('기타 설정 (현재 학기 · 알림 · 데이터 관리)').click();
  await dlg.getByRole('button', { name: '알림 받기에 동의하고 켜기' }).click();
  // 오늘 예약 시각(00:00)이 이미 지났고 남은 일정(23:59 시험)이 있으면 1분 뒤 한 번 알린다
  await dlg.getByLabel('알림 시각').fill('00:00');
  await expect.poll(async () => (await ourAlarms()).some((n) => n.startsWith(`hufstep:sameDay:${t}:`)), { timeout: 20_000 }).toBe(true);
  const id = `hufstep-n:sameDay:${t}`;
  await expect.poll(shownIds, { timeout: 150_000, intervals: [5000] }).toContain(id);

  // 끄면 예약·표시 중인 알림 정리
  const toggle = dlg.getByRole('checkbox', { name: '알림 켜기' });
  await toggle.click(); // 저장(IndexedDB)이 끝난 뒤 상태가 바뀐다
  await expect(toggle).not.toBeChecked();
  await expect.poll(ourAlarms, { timeout: 20_000 }).toEqual([]);
  await expect.poll(shownIds, { timeout: 20_000 }).not.toContain(id);
  await page.keyboard.press('Escape');
});

test('보안: 과목명에 넣은 HTML은 실행되지 않고 글자로 보인다', async () => {
  const evil = '<img src=x onerror="window.__xss=1">';
  await addCurrentCourse(evil);
  await expect(page.locator('.term-card.current .term-row').filter({ hasText: evil })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
});

test('레이아웃: 320 / 390 / 590px 에서 가로 넘침 없음', async () => {
  for (const width of [320, 390, 590]) {
    await page.setViewportSize({ width, height: 820 });
    for (const t of ['종정시 입력', '학사 현황', '시간표', '학점 계산', '마이페이지']) {
      await tab(t).click();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${width}px ${t}`).toBeLessThanOrEqual(0);
    }
    // 시간표 격자와 상세 패널이 화면 안에 들어온다
    await tab('시간표').click();
    const box = (await page.locator('.tt').boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `test-results/timetable-${width}.png`, fullPage: true, timeout: 15_000 }).catch(() => {});
    await page.locator('.tt-blk').first().click();
    const dlg = page.getByRole('dialog');
    await expect(dlg.getByLabel('내 메모')).toBeVisible();
    const d = (await dlg.boundingBox())!;
    expect(d.x).toBeGreaterThanOrEqual(0);
    expect(d.x + d.width).toBeLessThanOrEqual(width + 0.5);
    expect(await dlg.locator('.sheet-body').evaluate((el) => el.scrollWidth - el.clientWidth), `${width}px 패널`).toBeLessThanOrEqual(0);
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    // 개인정보 입력 폼(마이페이지 수정 패널): 칩 4개가 모두 보이고 안 잘린다
    await tab('마이페이지').click();
    await page.getByRole('button', { name: '학적 정보 수정하기' }).click();
    const edit = page.getByRole('dialog', { name: '내 정보 수정' });
    const chips = edit.locator('.opt-chips label');
    await expect(chips).toHaveCount(4);
    for (const chip of await chips.all()) {
      const b = (await chip.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(width);
    }
    expect(await edit.locator('.sheet-body').evaluate((el) => el.scrollWidth - el.clientWidth), `${width}px 수정 패널`).toBeLessThanOrEqual(0);
    await page.keyboard.press('Escape');
    await expect(edit).toBeHidden();
  }
  await page.setViewportSize({ width: 390, height: 820 });
});

test('다시 열어도 저장된 기록·메모·수업 시간이 복원된다', async () => {
  await page.reload();
  await expect(page.getByRole('navigation', { name: '주 메뉴' })).toBeVisible();
  await tab('시간표').click();
  await expect(page.locator('.tt-blk')).toHaveCount(2);
  await page.locator('.tt-blk').first().click();
  await expect(page.getByRole('dialog').getByLabel('내 메모')).toHaveValue(MEMO);
  await page.keyboard.press('Escape');
});

test('전체 초기화: 기록·예약이 남지 않는다', async () => {
  await tab('마이페이지').click();
  await page.getByRole('button', { name: '학적 정보 수정하기' }).click();
  const dlg = page.getByRole('dialog', { name: '내 정보 수정' });
  await dlg.getByText('기타 설정 (현재 학기 · 알림 · 데이터 관리)').click();
  await dlg.getByRole('button', { name: '전체 초기화' }).click();
  await dlg.getByRole('group', { name: '전체 초기화' }).getByRole('button', { name: '전체 초기화' }).click();
  await expect(page.getByRole('button', { name: '학사정보 저장' })).toBeVisible();
  expect(await readState()).toBe('null');
  await expect.poll(ourAlarms, { timeout: 20_000 }).toEqual([]);
});

test('가상 데이터 둘러보기(?demo): 실제 기록과 섞이지 않는다', async () => {
  // 화면에는 진입 버튼이 없다(Figma에 없음) → 주소 뒤 ?demo로 연다. 새로 열면 가상 데이터는 사라진다.
  const base = page.url().split('?')[0].split('#')[0];
  await page.goto(`${base}?demo`);
  await expect(page.getByRole('heading', { name: '내 학사현황' })).toBeVisible();
  await tab('시간표').click();
  await expect(page.locator('.tt-blk')).toHaveCount(7); // 가상 과목 5개, 그중 2개는 주 2회
  await expect(page.locator('.tt-extra .pill').filter({ hasNotText: '+ 과목 추가' })).toHaveCount(1); // 수업 시간 없는 가상 과목
  await page.goto(base);
  await expect(page.getByRole('button', { name: '학사정보 저장' })).toBeVisible();
  expect(await readState()).toBe('null');
});

test('외부 네트워크 요청·콘솔 오류 없음', async () => {
  expect(external).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
