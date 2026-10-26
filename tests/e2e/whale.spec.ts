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

async function addCourse(name: string, credits = '3') {
  await page.getByRole('button', { name: '과목 추가', exact: true }).first().click();
  const dlg = page.getByRole('dialog', { name: '과목 추가' });
  await dlg.getByLabel(/^과목명/).fill(name);
  await dlg.getByRole('spinbutton', { name: /^학점/ }).fill(credits);
  await dlg.getByRole('button', { name: '저장', exact: true }).click();
  await expect(dlg).toBeHidden();
}

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

test('첫 실행 → 조건 입력 → 동의 → 붙여넣기 분석 → 확인하고 반영 (원문 미저장)', async () => {
  await page.getByLabel('이름 / 닉네임').fill('김웨이');
  await page.getByLabel(/^주전공/).selectOption({ label: '말레이·인도네시아어과' });
  await page.getByRole('radio', { name: '이중전공' }).check();
  await page.getByRole('combobox', { name: /^이중전공/ }).selectOption({ label: '경영학부 (서울캠퍼스)' });
  await page.getByLabel(/^학번/).selectOption('2024');
  await page.getByRole('button', { name: '학사정보 저장' }).click();

  await expect(page.getByRole('heading', { name: '종정시 입력' })).toBeVisible();
  await page.getByRole('checkbox', { name: /동의해요/ }).check();
  await page.getByRole('button', { name: '동의하고 계속' }).click();

  const link = page.getByRole('link', { name: /종정시 열기/ });
  await expect(link).toHaveAttribute('href', 'https://wis.hufs.ac.kr/src08/jsp/index.jsp');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(link).toHaveAttribute('target', '_blank');

  const box = page.getByLabel('종정시에서 복사한 성적 내용');
  await box.fill(DEMO_TRANSCRIPT);
  await page.getByRole('button', { name: '분석하기' }).click();
  const stats = page.locator('.result .stats');
  await expect(stats).toContainText('4개');
  await expect(stats).toContainText('2건');
  await expect(stats).toContainText('20학점');
  await expect(stats).toContainText('2.70');
  expect(JSON.parse(await readState()).courses).toHaveLength(0); // 확인 전에는 저장하지 않음

  await page.getByRole('button', { name: '확인하고 반영' }).click();
  await expect(page.getByRole('status')).toContainText('반영했어요');
  await expect(box).toHaveValue('');
  const saved = await readState();
  expect(JSON.parse(saved).courses).toHaveLength(6);
  expect(saved).not.toContain('이수구분별 취득학점 계');

  // 같은 자료를 다시 반영해도 과목 수가 늘지 않음
  await box.fill(DEMO_TRANSCRIPT);
  await page.getByRole('button', { name: '분석하기' }).click();
  await page.getByRole('button', { name: '확인하고 반영' }).click();
  await expect(page.getByRole('status')).toContainText('새 과목 0개');
  expect(JSON.parse(await readState()).courses).toHaveLength(6);
});

test('학사현황: 기본값으로 결과 표시 → 공식 학점·필수과목 반영 (졸업 충족은 확정하지 않음)', async () => {
  await tab('학사 현황').click();
  const coverage = page.locator('section[aria-labelledby="coverage-title"]');
  await expect(coverage).toContainText('졸업 충족 여부는 확정하지 않아요');
  // 기본값이 있는 질문은 답하지 않아도 필요학점을 계산한다.
  await expect(page.locator('.hero-num')).toContainText('20');
  await expect(page.locator('.hero-num')).toContainText('필요 134학점');
  const questions = page.locator('section[aria-labelledby="questions-title"]');
  // 특별전형·영어 전공 분류·인증 언어에는 기본값이 없으므로 필요한 질문에만 답한다.
  for (let i = 0; i < 5 && await questions.count(); i++) {
    const select = questions.locator('li select').first();
    const label = (await select.getAttribute('aria-label'))!;
    const options = await select.locator('option').allTextContents();
    await select.selectOption({ label: options.includes('아니요') ? '아니요' : '목록에 없음 / 해당 없음' });
    await expect(questions.getByLabel(label, { exact: true })).toHaveCount(0);
  }
  await expect(questions).toHaveCount(0);
  const defaults = page.getByTestId('default-answers');
  await expect(defaults).not.toHaveAttribute('open');
  expect(JSON.parse(await readState()).profile.facts?.graduationTerm).toBeUndefined();

  // 공식 코드·개설학과/이름으로 자동 대조한다 (학생은 과목명이 맞을 때만 체크 하나로 연결한다).
  const rule = page.locator('details').filter({ hasText: '2022~2026학번 주전공 필수 11과목' });
  await expect(rule).toContainText('지역과지역학 (B03131)');
  const addPast = async (name: string, code?: string) => {
    await page.getByRole('button', { name: '과목 추가·수정' }).click();
    const dlg = page.getByRole('dialog', { name: '과목 추가' });
    await dlg.getByLabel(/^과목명/).fill(name);
    await dlg.getByLabel('학년도').fill('2025');
    await dlg.getByLabel('학기').selectOption('1');
    await dlg.getByRole('spinbutton', { name: /^학점/ }).fill('3');
    await dlg.getByLabel('상태').selectOption({ label: '이수 완료' });
    await dlg.getByLabel('성적').first().selectOption('A0'); // '성적 방식'과 구분
    if (code) {
      await dlg.getByText('추가 정보', { exact: true }).click();
      await dlg.getByLabel(/공식 과목 코드/).fill(code);
    }
    await dlg.getByRole('button', { name: '저장', exact: true }).click();
    await expect(dlg).toBeHidden();
  };
  await addPast('지역과지역학', 'B03131');
  await expect(rule.locator('li.req').filter({ hasText: '지역과지역학 (B03131)' })).toContainText('이수');
  // 코드 없는 요건도 개설학과 정보가 없으면 주전공 이수구분과 이름으로 대조한다.
  await addPast('초급마.인어(1)');
  const elementary = rule.locator('li.req').filter({ has: page.locator('.name', { hasText: /^초급마\.인어\(1\)/ }) });
  // 이름으로 맞은 줄도 ✓ '이수'로만 적고, '내가 체크'는 붙이지 않는다
  await expect(elementary).toContainText('이수');
  await expect(elementary).not.toContainText('내가 체크');
  await expect(elementary.locator('span[aria-hidden="true"]').first()).toHaveText('✓');
  await expect(page.getByTestId('course-legend')).toHaveText('○ 미이수 · ✓ 이수');

  // 전공필수 체크는 하나로 합쳐졌다: 이름이 맞으면 자동 연결, 맞는 게 없으면 안내만
  await page.getByRole('button', { name: '과목 추가·수정' }).click();
  const merged = page.getByRole('dialog', { name: '과목 추가' });
  await expect(merged.getByLabel(/필수과목 요건에 직접 연결/)).toHaveCount(0);
  await merged.getByLabel(/^과목명/).fill('초급마.인어(1)');
  await merged.getByLabel('이 과목은 전공필수예요').check();
  await expect(merged).toContainText('요건에 연결했어요');
  await merged.getByLabel(/^과목명/).fill('목록에 없는 과목');
  await expect(merged).toContainText('연결할 요건이 없어요');
  await merged.getByRole('button', { name: '취소' }).click();
  await expect(merged).toBeHidden();

  await expect(rule.locator('summary').first()).toContainText('미충족');
  await expect(coverage).toContainText('졸업 충족 여부는 확정하지 않아요');
});

test('전공필수 체크 저장·이름 변경·해제와 직접 확인이 실제 요건 및 이수 수에 반영된다', async () => {
  test.setTimeout(45_000);
  const rule = page.locator('details').filter({ hasText: '2022~2026학번 주전공 필수 11과목' });
  const name = '인도네시아세계역사.문화:인도네시아,동티모르,필리핀';
  const row = rule.locator('li.req').filter({ has: page.locator('.name', { hasText: name }) });
  const leafId = 'core-malay-primary-2022-2026/r.0';
  const countBefore = (await rule.locator('summary').first().innerText()).match(/\d+ \/ 11/)![0];
  const before = JSON.parse(await readState());
  await page.getByRole('button', { name: '과목 추가·수정' }).click();
  let dlg = page.getByRole('dialog');
  await dlg.getByLabel(/^과목명/).fill(name);
  await dlg.getByLabel('학년도').fill('2025');
  await dlg.getByRole('spinbutton', { name: /^학점/ }).fill('3');
  await dlg.getByLabel('성적').first().selectOption('A0');
  await dlg.getByLabel('이 과목은 전공필수예요').check();
  await expect(dlg).toContainText(`${name} 요건에 연결했어요`);
  for (const width of [320, 390, 590]) {
    await page.setViewportSize({ width, height: 820 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(await dlg.locator('.sheet-body').evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
  }
  await page.setViewportSize({ width: 390, height: 820 });
  await dlg.getByRole('button', { name: '저장', exact: true }).click();
  await expect(dlg).toBeHidden();
  await expect(row).toContainText('내가 체크');
  await expect(row.locator('span[aria-hidden="true"]').first()).toHaveText('✓');
  await expect(row.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  const saved = JSON.parse(await readState()).courses.find((c: { name: string }) => c.name === name);
  expect(saved.requirementLinks).toEqual([leafId]);
  expect(saved.requiredClaim).toBe('studentMarked');
  await expect(rule.locator('summary').first()).toContainText(`${Number(countBefore.split(' ')[0]) + 1} / 11`);

  // 학사현황에서 다시 누르면 연결만 풀리고 성적·학점은 그대로 남는다.
  await row.getByRole('button').click();
  await expect(row.locator('span[aria-hidden="true"]').first()).toHaveText('○');
  await expect(row).not.toContainText('내가 체크');
  await expect(rule.locator('summary').first()).toContainText(countBefore);
  const earnedBefore = await page.locator('.hero-num').innerText();
  await row.getByRole('button').click();
  await expect(row).toContainText('내가 체크');
  expect(await page.locator('.hero-num').innerText()).toBe(earnedBefore);
  await row.getByRole('button').click();
  await expect(row.locator('span[aria-hidden="true"]').first()).toHaveText('○');

  // 다시 연결하고 저장한 뒤 이름을 바꾸면 옛 연결이 새 이름에 남지 않는다.
  const courseButton = page.getByRole('button').filter({ hasText: name }).filter({ has: page.locator('.name') });
  await page.locator('section[aria-labelledby="mine-title"] details').first().locator('summary').click();
  await courseButton.click();
  dlg = page.getByRole('dialog');
  await dlg.getByLabel('이 과목은 전공필수예요').check();
  await dlg.getByRole('button', { name: '저장', exact: true }).click();
  await expect(dlg).toBeHidden();
  await courseButton.click();
  dlg = page.getByRole('dialog');
  await expect(dlg.getByLabel('이 과목은 전공필수예요')).toBeChecked();
  await dlg.getByLabel(/^과목명/).fill('연결할 요건이 없는 테스트 과목');
  await expect(dlg).toContainText('연결할 요건이 없어요');
  await dlg.getByRole('button', { name: '저장', exact: true }).click();
  await expect(dlg).toBeHidden();
  const changed = JSON.parse(await readState()).courses.find((c: { id: string }) => c.id === saved.id);
  expect(changed.requirementLinks).toBeUndefined();
  expect(changed.requiredClaim).toBe('studentMarked');
  expect(changed.creditUnits).toBe(saved.creditUnits);
  expect(JSON.parse(await readState()).courses.length).toBe(before.courses.length + 1);

  // 기존 재수강 입력도 저장·재열기·해제가 유지된다.
  const renamed = page.locator('.course-row').filter({ hasText: changed.name });
  await renamed.click();
  dlg = page.getByRole('dialog');
  await dlg.getByLabel('재수강 과목이에요').check();
  const previous = dlg.getByLabel('대체하는 이전 기록');
  const previousId = (await previous.locator('option').nth(1).getAttribute('value'))!;
  await previous.selectOption(previousId);
  await dlg.getByRole('button', { name: '저장', exact: true }).click();
  await expect(dlg).toBeHidden();
  expect(JSON.parse(await readState()).courses.find((c: { id: string }) => c.id === saved.id).replacesCourseId).toBe(previousId);
  await renamed.click();
  dlg = page.getByRole('dialog');
  await expect(dlg.getByLabel('재수강 과목이에요')).toBeChecked();
  await expect(dlg.getByLabel('대체하는 이전 기록')).toHaveValue(previousId);
  await dlg.getByLabel('재수강 과목이에요').uncheck();
  await dlg.getByRole('button', { name: '저장', exact: true }).click();
  await expect(dlg).toBeHidden();
  expect(JSON.parse(await readState()).courses.find((c: { id: string }) => c.id === saved.id).replacesCourseId).toBeUndefined();
});

test('학교 문의는 접혀 있고, 펼치면 전화·메일만 보이며 출처는 표시하지 않는다', async () => {
  test.setTimeout(45_000);
  await page.getByRole('button', { name: '조건 수정', exact: true }).click();
  const profileDialog = page.getByRole('dialog', { name: '학생 조건 수정' });
  await profileDialog.getByLabel(/^주전공/).selectOption({ label: '몽골어과' });
  await profileDialog.getByRole('button', { name: '저장', exact: true }).click();
  await expect(profileDialog).toBeHidden();
  const inquiry = page.locator('.inquiry').filter({ has: page.locator('.inquiry-why') }).first();
  await expect(inquiry.locator('.inquiry-detail')).toHaveCount(0);
  await inquiry.locator('.inquiry-why').click();
  const contact = inquiry.locator('.inquiry-detail');
  await expect(contact).toContainText('정확한 기준은 학과에 확인할 수 있어요');
  await expect(contact.locator('a[href^="tel:"]')).toHaveCount(1);
  await expect(contact.locator('a[href^="mailto:"]')).toHaveCount(1);
  await expect(contact).not.toContainText(/2026-10|확인일|졸업요건 페이지/);
  await expect(contact.locator('a[href^="http"]')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('이 화면의 기준 출처');
  await expect(page.locator('main')).not.toContainText('출처:');
  for (const width of [320, 390, 590]) {
    await page.setViewportSize({ width, height: 820 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  const pass = inquiry.locator('.self-check');
  await pass.click();
  await expect(pass).toHaveAttribute('aria-pressed', 'true');
  await pass.click();
  await expect(pass).toHaveAttribute('aria-pressed', 'false');
  await inquiry.locator('.inquiry-why').click();
  await expect(contact).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 820 });
  await page.getByRole('button', { name: '조건 수정', exact: true }).click();
  await profileDialog.getByLabel(/^주전공/).selectOption('seoul-malay-indonesian');
  await profileDialog.getByRole('button', { name: '저장', exact: true }).click();
  await expect(profileDialog).toBeHidden();
});

const MEMO = '준비물: 사전\n2026-11-20 퀴즈 (메모 속 날짜는 알림이 아님)';
const TIME_HINT = '시간 미정 과목을 눌러 요일·시간을 넣어 주세요.';

// 빈 격자·미정 과목만 있는 격자·혼합 격자를 실제 화면에서 검사한다.
async function checkTimetableWidths(state: string) {
  for (const width of [320, 390, 590]) {
    await page.setViewportSize({ width, height: 820 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${state} ${width}px 문서`).toBeLessThanOrEqual(0);
    const timetable = page.locator('.timetable');
    const box = (await timetable.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(await timetable.evaluate((el) => el.scrollWidth - el.clientWidth), `${state} ${width}px 시간표 내부`).toBeLessThanOrEqual(0);
    for (const block of await timetable.locator('.tt-block').all()) {
      const b = (await block.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(box.x);
      expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width);
    }
    await page.screenshot({ path: `test-results/timetable-${state}-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 820 });
}

test('시간표: 수업 시간 입력 → 월~금 시간표, 자유 메모 저장과 시험 정보 수정 구분, 오늘 집계 갱신', async () => {
  await tab('시간표').click();
  await expect(page.getByText('오늘 등록된 평가가 없어요')).toBeVisible();
  await expect(page.locator('h1')).toHaveCSS('color', 'rgb(11, 42, 91)'); // 진한 네이비 제목
  // 수강 과목이 0개여도 월~금, 9~18시의 빈 격자는 항상 남는다.
  await expect(page.locator('.timetable')).toHaveCount(1);
  await expect(page.locator('.tt-col')).toHaveCount(5);
  await expect(page.locator('.tt-hours span')).toHaveText(['9', '10', '11', '12', '13', '14', '15', '16', '17']);
  await expect(page.locator('.tt-body')).toHaveCSS('height', '648px');
  await expect(page.locator('.tt-pending')).toHaveCount(0);
  await expect(page.getByText(TIME_HINT, { exact: true })).toHaveCount(0);
  await checkTimetableWidths('empty');
  await addCourse('가상 수강 과목: 아주 긴 이름을 가진 테스트용 과목명으로 줄바꿈 확인');
  await addCourse('가상 과목 B');
  // 시간 미정 과목도 하나의 시간표 안에서 같은 블록으로 접근한다.
  const pending = page.locator('.tt-pending .tt-block');
  await expect(pending).toHaveCount(2);
  await expect(page.locator('.timetable')).toHaveCount(1);
  await expect(page.locator('.unscheduled, .tiles, .tile')).toHaveCount(0);
  await expect(page.getByText(TIME_HINT, { exact: true })).toHaveCount(1);
  await expect(pending.nth(0)).toContainText('아주 긴 이름을 가진 테스트용 과목명으로 줄바꿈 확인');
  await expect(pending.nth(0)).toContainText('중간 —');
  await expect(pending.nth(0)).toContainText('기말 —');
  await checkTimetableWidths('pending');

  // 한 과목에 수업 시간 두 개
  const tint = await pending.nth(1).evaluate((el) => getComputedStyle(el).backgroundColor);
  await pending.nth(1).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toBeFocused();
  await dlg.getByRole('button', { name: '수업 시간 입력' }).click();
  await dlg.getByLabel('요일').nth(0).selectOption('0');
  await dlg.getByLabel('시작', { exact: true }).nth(0).fill('09:00');
  await dlg.getByLabel('종료', { exact: true }).nth(0).fill('10:15');
  await dlg.getByRole('button', { name: '+ 수업 시간 추가' }).click();
  await dlg.getByLabel('요일').nth(1).selectOption('2');
  await dlg.getByLabel('시작', { exact: true }).nth(1).fill('09:00');
  await dlg.getByLabel('종료', { exact: true }).nth(1).fill('10:15');
  await dlg.getByRole('button', { name: '저장', exact: true }).click();
  await expect(dlg).toContainText('월 09:00~10:15 · 수 09:00~10:15');

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

  const blocks = page.locator('.tt-col .tt-block');
  await expect(blocks).toHaveCount(2); // 월·수 두 칸
  await expect(pending).toHaveCount(1);
  await expect(blocks.first()).toBeFocused(); // 시간 미정 줄에서 요일 칸으로 옮겨진 과목 버튼으로 포커스 복귀
  await expect(blocks.first()).toHaveCSS('background-color', tint);
  await expect(blocks.first()).toContainText('가상 과목 B');
  await expect(blocks.first()).toContainText('중간 O');
  const [nameSize, evalSize] = await blocks.first().evaluate((el) => [
    parseFloat(getComputedStyle(el.querySelector('.tt-name')!).fontSize), parseFloat(getComputedStyle(el.querySelector('.tt-eval')!).fontSize)]);
  expect(nameSize).toBeGreaterThan(evalSize); // 과목명 크게, 중간·기말 작게
  const [mon, wed] = [await blocks.nth(0).boundingBox(), await blocks.nth(1).boundingBox()];
  expect(Math.abs(mon!.y - wed!.y)).toBeLessThan(2); // 같은 시간 줄
  expect(wed!.x).toBeGreaterThan(mon!.x + mon!.width); // 월 → 수 열
  await expect(page.locator('.today-line')).toContainText('오늘 시험 1개'); // 메모 속 날짜는 집계에 없음

  // 취소하면 저장 전 상태로
  await blocks.first().click();
  await dlg.getByRole('button', { name: '시험 정보 수정', exact: true }).click();
  await dlg.getByRole('radio', { name: 'X · 시험 없음' }).first().check();
  await dlg.getByRole('button', { name: '취소', exact: true }).click();
  await expect(dlg).toContainText('중간고사 · 시험 O');
  await page.locator('.sheet-backdrop').click({ position: { x: 10, y: 10 } }); // 배경 클릭으로 닫기
  await expect(dlg).toBeHidden();

  // 오늘 목록
  await page.locator('.today-line').click();
  const todayDlg = page.getByRole('dialog', { name: '오늘의 평가' });
  await expect(todayDlg).toContainText('가상 과목 B');
  await expect(todayDlg).toContainText('중간 · 시험 · 23:59');
  await page.keyboard.press('Escape');
});

test('시간표: 마지막 미정 과목 저장 → 미정 줄 숨김, 모든 시간 삭제 → 같은 블록으로 복귀', async () => {
  const pending = page.locator('.tt-pending .tt-block');
  const courseId = (await pending.first().getAttribute('data-course'))!;
  const before = JSON.parse(await readState());
  await pending.first().click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('button', { name: '수업 시간 입력' }).click();
  await dlg.getByLabel('요일').selectOption('4');
  await dlg.getByLabel('시작', { exact: true }).fill('08:30');
  await dlg.getByLabel('종료', { exact: true }).fill('20:45');
  await dlg.getByRole('button', { name: '저장', exact: true }).click();
  await expect(dlg).toContainText('금 08:30~20:45'); // 비동기 저장이 끝난 뒤 패널을 닫는다.
  await page.keyboard.press('Escape');
  await expect(page.locator('.tt-pending')).toHaveCount(0);
  await expect(page.getByText(TIME_HINT, { exact: true })).toHaveCount(0);
  await expect(page.locator('.tt-hours span').first()).toHaveText('8');
  await expect(page.locator('.tt-hours span').last()).toHaveText('20');
  await expect(page.locator('.tt-body')).toHaveCSS('height', '936px');
  const moved = page.locator(`.tt-col [data-course="${courseId}"]`);
  await expect(moved).toBeFocused();
  await expect(page.getByRole('list', { name: '금요일' }).locator('.tt-block')).toHaveCount(1);
  await checkTimetableWidths('scheduled');

  await moved.click();
  await dlg.getByRole('button', { name: '수업 시간 수정' }).click();
  await dlg.getByRole('button', { name: '이 시간 삭제' }).click();
  await expect(dlg).toContainText('저장하면 시간표의 ‘시간 미정’ 줄에 표시돼요.');
  await dlg.getByRole('button', { name: '저장', exact: true }).click();
  await expect(dlg.getByRole('button', { name: '수업 시간 입력' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(pending).toHaveCount(1);
  await expect(pending).toHaveAttribute('data-course', courseId);
  await expect(pending).toBeFocused();
  await expect(moved).toHaveCount(0);
  await expect(page.getByText(TIME_HINT, { exact: true })).toHaveCount(1);
  await expect(page.locator('.tt-body')).toHaveCSS('height', '648px');
  const after = JSON.parse(await readState());
  expect(after.classTimes).toEqual(before.classTimes);
  expect(after.courseMemos).toEqual(before.courseMemos);
  expect(after.assessments).toEqual(before.assessments);
});

test('알림: 동의·켜기 → 실제 whale.alarms 예약 → 알람 실행 시 whale.notifications 생성 → 끄면 정리', async () => {
  const minutes = await page.evaluate(() => new Date().getHours() * 60 + new Date().getMinutes());
  test.skip(minutes >= 23 * 60 + 50, '자정 직전에는 당일 알림 검사를 건너뜀');
  const t = await today();
  await tab('마이페이지').click();
  await page.getByRole('button', { name: '알림 받기에 동의하고 켜기' }).click();
  // 오늘 예약 시각(00:00)이 이미 지났고 남은 일정(23:59 시험)이 있으면 1분 뒤 한 번 알린다
  await page.getByLabel('알림 시각').fill('00:00');
  await expect.poll(async () => (await ourAlarms()).some((n) => n.startsWith(`hufstep:sameDay:${t}:`)), { timeout: 20_000 }).toBe(true);
  const id = `hufstep-n:sameDay:${t}`;
  await expect.poll(shownIds, { timeout: 150_000, intervals: [5000] }).toContain(id);

  // 끄면 예약·표시 중인 알림 정리
  const toggle = page.getByRole('checkbox', { name: '알림 켜기' });
  await toggle.click(); // 저장(IndexedDB)이 끝난 뒤 상태가 바뀐다
  await expect(toggle).not.toBeChecked();
  await expect.poll(ourAlarms, { timeout: 20_000 }).toEqual([]);
  await expect.poll(shownIds, { timeout: 20_000 }).not.toContain(id);
});

test('보안: 과목명에 넣은 HTML은 실행되지 않고 글자로 보인다', async () => {
  await tab('시간표').click();
  const evil = '<img src=x onerror="window.__xss=1">';
  await addCourse(evil);
  await expect(page.locator('.tt-pending .tt-block').filter({ hasText: evil })).toBeVisible();
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
    // 시간표와 상세 패널: 가로 넘침 없이 화면 안, 메모·시험 정보가 보임 (사람 확인용 스크린샷도 남김)
    await tab('시간표').click();
    const block = page.locator('.tt-col .tt-block').first();
    const box = (await page.locator('.timetable').boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(await page.locator('.tt-pending').evaluate((el) => el.scrollWidth - el.clientWidth), `${width}px 시간 미정 줄`).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `test-results/timetable-${width}.png`, fullPage: true, timeout: 15_000 }).catch(() => {}); // 사람 확인용 (실패해도 검사는 계속)
    await block.click();
    const dlg = page.getByRole('dialog');
    await expect(dlg.getByLabel('내 메모')).toBeVisible();
    await expect(dlg).toContainText('중간 · 기말 정보');
    const d = (await dlg.boundingBox())!;
    expect(d.x).toBeGreaterThanOrEqual(0);
    expect(d.x + d.width).toBeLessThanOrEqual(width + 0.5);
    expect(await dlg.locator('.sheet-body').evaluate((el) => el.scrollWidth - el.clientWidth), `${width}px 패널`).toBeLessThanOrEqual(0);
    await dlg.screenshot({ path: `test-results/detail-${width}.png`, timeout: 15_000 }).catch(() => {});
    // 요일·시간 편집 화면도 좁은 패널 안에 들어온다.
    await dlg.getByRole('button', { name: '수업 시간 수정' }).click();
    expect(await dlg.locator('.sheet-body').evaluate((el) => el.scrollWidth - el.clientWidth), `${width}px 시간 편집`).toBeLessThanOrEqual(0);
    await dlg.getByRole('button', { name: '취소', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
  }
  await page.setViewportSize({ width: 390, height: 820 });
});

test('다시 열어도 저장된 기록·메모·수업 시간이 복원된다', async () => {
  await page.reload();
  await expect(page.getByRole('navigation', { name: '주 메뉴' })).toBeVisible();
  await tab('시간표').click();
  await expect(page.locator('.tt-pending .tt-block')).toHaveCount(2); // 시간 미정 과목
  await expect(page.locator('.tt-col .tt-block')).toHaveCount(2);
  await page.locator('.tt-col .tt-block').first().click();
  await expect(page.getByRole('dialog').getByLabel('내 메모')).toHaveValue(MEMO);
  await page.keyboard.press('Escape');
});

test('전체 초기화: 기록·예약이 남지 않는다', async () => {
  await tab('마이페이지').click();
  await page.getByRole('button', { name: '전체 초기화' }).click();
  await page.getByRole('group', { name: '전체 초기화' }).getByRole('button', { name: '전체 초기화' }).click();
  await expect(page.getByRole('button', { name: '학사정보 저장' })).toBeVisible();
  expect(await readState()).toBe('null');
  await expect.poll(ourAlarms, { timeout: 20_000 }).toEqual([]);
});

test('가상 데이터 둘러보기: 실제 기록과 섞이지 않는다', async () => {
  // 화면에는 진입 버튼이 없다(Figma에 없음) → 주소 뒤 ?demo로 연다. 새로 열면 가상 데이터는 사라진다.
  const base = page.url().split('?')[0].split('#')[0];
  await page.goto(`${base}?demo`);
  await tab('시간표').click();
  await expect(page.locator('.today-line')).toContainText('오늘 시험 2개 · 제출 1개');
  await expect(page.locator('.tt-col .tt-block')).toHaveCount(7); // 가상 과목 5개, 그중 2개는 주 2회
  await expect(page.locator('.tt-pending .tt-block')).toHaveCount(1); // 수업 시간 없는 가상 과목
  await page.goto(base);
  await expect(page.getByRole('button', { name: '학사정보 저장' })).toBeVisible();
  expect(await readState()).toBe('null');
});

test('외부 네트워크 요청·콘솔 오류 없음', async () => {
  expect(external).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
