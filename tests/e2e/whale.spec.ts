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
import { FOOTER_TRANSCRIPT } from '../fixtures/importTranscript';

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

const readState = () => page.evaluate(() => new Promise<string>((res) => {
  const r = indexedDB.open('hufstep');
  r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('appState'); g.onsuccess = () => { res(JSON.stringify(g.result ?? null)); r.result.close(); }; };
}));
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

// 제목 유무와 무관하게 과목 목록·영역별 합계를 대조해야 저장된다.
const FULL_TRANSCRIPT = DEMO_TRANSCRIPT;
const startHufstep = async () => {
  // 저장에 성공하면 성공 모달이 뜨고, 'HUFStep 시작하기'를 누르면 학사 현황으로 넘어간다
  const ok = page.getByRole('alertdialog', { name: '성공적으로 입력되었습니다.' });
  await expect(ok).toBeVisible();
  await expect(ok).toContainText('입력하신 정보를 바탕으로 제공되는');
  await expect(ok).toContainText('맞춤형 HUFStep 서비스를 이용해보세요!');
  await expect(page.locator('.wm-backdrop')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.5)');
  expect(await ok.locator('img').first().evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  await ok.getByRole('button', { name: 'HUFStep 시작하기' }).click();
  await expect(ok).toBeHidden();
};

test('첫 실행 → 개인정보 저장 → 동의 → 종정시 붙여넣기 저장(빠진 건 반려) → 학사 현황 (원문 미저장)', async () => {
  // Figma: 칩은 이중전공·부전공·전공심화 3개 (없음 없음), 이중전공이 처음 선택돼 있다. 첫 화면 로고는 메인 로고 이미지
  await expect(page.locator('.opt-chips label')).toHaveText(['이중전공', '부전공', '전공심화']);
  await expect(page.getByRole('radio', { name: '이중전공' })).toBeChecked();
  // 글꼴은 앱에 넣은 Pretendard 파일로 불러온다 (PC에 깔린 글꼴에 기대지 않는다)
  // 웨일이 body에 자체 기본 글꼴(Segoe UI 등)을 입히므로, 화면 전체(body·제목·입력칸)가 실제로 Pretendard인지 확인한다
  const fonts = await page.evaluate(async () => {
    await document.fonts.load('600 16px Pretendard');
    const ff = (q: string) => getComputedStyle(document.querySelector(q)!).fontFamily;
    return { loaded: [...document.fonts].some((f) => f.family.includes('Pretendard') && f.status === 'loaded'), body: ff('body'), h1: ff('h1'), input: ff('input') };
  });
  expect(fonts.loaded).toBe(true);
  for (const f of [fonts.body, fonts.h1, fonts.input]) expect(f.startsWith('Pretendard')).toBe(true);
  // 'HUFStep' 로고 글씨는 글꼴이 아니라 그림(SVG 마스크)이라 PC 글꼴과 상관없이 똑같다
  const wm = page.locator('h1 .wordmark');
  await expect(wm).toHaveAttribute('aria-label', 'HUFStep');
  await expect(wm).toHaveCSS('background-color', 'rgb(6, 43, 98)');
  const wmBox = (await wm.boundingBox())!;
  expect(Math.abs(wmBox.height - 28.8)).toBeLessThan(0.6);
  expect(Math.abs(wmBox.width / wmBox.height - 73.8 / 17.5)).toBeLessThan(0.02);
  expect(await wm.evaluate((el) => getComputedStyle(el).maskImage.includes('wordmark'))).toBe(true);
  const [c1, c2] = await page.locator('.opt-chips label').all();
  const b1 = (await c1.boundingBox())!, b2 = (await c2.boundingBox())!;
  expect(b1.width).toBeGreaterThan(85); // 한 줄을 셋이 나눠 채운다 (390px에서 약 100)
  expect(Math.round(b1.height)).toBe(50);
  expect(Math.round(b2.x - (b1.x + b1.width))).toBe(15);
  const [, , c3] = await page.locator('.opt-chips label').all();
  const b3 = (await c3.boundingBox())!, row = (await page.locator('.opt-chips').boundingBox())!;
  expect(Math.abs(b3.x + b3.width - (row.x + row.width))).toBeLessThan(1); // 오른쪽 끝까지 꽉 찬다 (사이드바가 넓어도 가운데로 모이지 않는다)
  expect(Math.abs(b1.x - row.x)).toBeLessThan(1);
  expect(await page.locator('img.logo-lg').evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  await page.getByLabel('이름 / 닉네임').fill('김웨이');
  await page.getByLabel(/^주전공/).selectOption({ label: '말레이·인도네시아어과' });
  await page.getByRole('radio', { name: '이중전공' }).check();
  await page.getByRole('combobox', { name: /^이중전공/ }).selectOption({ label: '경영학부 (서울캠퍼스)' });
  await page.getByLabel(/^학번/).selectOption('2024');
  await page.getByLabel(/^현재 학년/).selectOption('3');
  await page.getByRole('button', { name: '학사정보 저장' }).click();
  // 정보를 저장한 뒤부터 헤더 로고가 학년을 따른다 (3학년 = 머리에 전구)
  const headLogo = page.locator('.app-header img.logo');
  await expect(page.locator('.app-header .brand .wordmark')).toHaveCSS('background-color', 'rgb(255, 255, 255)'); // 헤더 로고 글씨는 흰색 17px 크기
  const hb = (await page.locator('.app-header .brand .wordmark').boundingBox())!;
  expect(Math.abs(hb.width - 73.8)).toBeLessThan(0.6);
  await expect(headLogo).toHaveAttribute('data-year', '3');
  expect(await headLogo.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);

  await expect(page.getByRole('heading', { name: /종정시 정보를 입력하고/ })).toBeVisible();
  expect(JSON.parse(await readState()).profile.name).toBe('김웨이');
  await page.getByRole('checkbox', { name: /동의해요/ }).check();
  await page.getByRole('button', { name: '동의하고 계속' }).click();

  const link = page.getByRole('link', { name: /종합정보시스템 바로가기/ });
  await expect(link).toHaveAttribute('href', 'https://wis.hufs.ac.kr/src08/jsp/index.jsp');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(link).toHaveAttribute('target', '_blank');

  // 종정시 입력 화면 위쪽 안내 사진, 종정시 바로가기 버튼 색(#7A899B)
  expect(await page.locator('img.records-banner').evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  await expect(link).toHaveCSS('background-color', 'rgb(122, 137, 155)');

  // ? 를 누르면 가이드 모달이 올라오고(뒤는 #000 50%), 닫기 버튼 또는 Esc로 닫힌다
  const guide = page.getByRole('dialog', { name: '종정시 정보 붙여넣기 가이드' });
  const help = page.getByRole('button', { name: '붙여넣기 도움말' });
  await help.click();
  await expect(guide).toBeVisible();
  await expect(page.locator('.sheet-layer.howto .sheet-backdrop')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.5)');
  await expect(guide).toContainText('Step 1.');
  await expect(guide).toContainText('빨간 박스 안의 영역을 끝까지 드래그하며, 그림 속 ①~②번의 내용들을 모두 선택해주세요.');
  await expect(guide).toContainText('선택한 모든 정보를 Ctrl + C로 복사해주세요.');
  await expect(guide).toContainText('복사한 정보를 Ctrl + V로 아래 상자에 붙여넣어주세요.');
  await expect(guide).toContainText('상자 하단의 글씨가 검정색으로 바뀌었다면, 모든 정보가 정상적으로 입력된 거예요.');
  await expect(guide).toContainText('빨간색 글씨가 뜬다면 누락된 정보가 있는 거예요. 저장 버튼 클릭 후 입력한 내용 삭제하고, 종정시에서 다시 정보를 복사해서 넣어주세요.');
  await expect(guide.locator('.gd-note')).toHaveCSS('color', 'rgb(136, 136, 136)');
  await expect(guide.locator('.gd-mk b')).toHaveText(['①', '②']);
  await expect(guide.locator('.gd-drag b')).toHaveText(['드래그', '드래그']);
  for (const img of await guide.locator('.gd-fig > img, .gd-crop img').all()) {
    expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0); // 사진 2장이 실제로 로드됨
  }
  await guide.getByRole('button', { name: '닫기' }).click();
  await expect(guide).toBeHidden();
  await help.click();
  await page.keyboard.press('Escape');
  await expect(guide).toBeHidden();

  const box = page.getByLabel('종정시 정보 붙여넣기');
  const save = page.getByRole('button', { name: '종정시 정보 저장' });
  await expect(page.getByRole('button', { name: /초기화/ })).toHaveCount(0); // 처음에는 저장 버튼 하나만
  // 아무것도 안 붙이면 반려 + 두 부분 모두 빨간색
  await expect(page.locator('.part.missing')).toHaveCount(0);
  await save.click();
  await expect(page.locator('.red-list')).toContainText('붙여넣은 내용이 없어요');
  await expect(page.locator('.part.missing')).toHaveText(['년도/학기별 취득성적', '이수구분별 취득학점 계']);
  // 필수 줄(이수구분별 취득학점 계)이 빠지면 빨간 글씨로 알리고 저장하지 않는다
  const noSummary = FULL_TRANSCRIPT.slice(0, FULL_TRANSCRIPT.indexOf('이수구분별 취득학점 계'));
  await box.fill(noSummary);
  await save.click();
  await expect(page.locator('.red-list')).toContainText('이수구분별 취득학점 계');
  await expect(page.locator('.part.missing')).toHaveText(['이수구분별 취득학점 계']); // 빠진 부분만 빨갛다
  expect(JSON.parse(await readState()).courses).toHaveLength(0);
  // 붙여넣은 내용이 규격에 안 맞으면 경고 모달이 뜬다 (뒤는 #000 50%). Esc로 닫으면 입력은 그대로 남는다
  const warn = page.getByRole('alertdialog');
  await expect(warn).toContainText("‘이수구분별 취득학점 계'");
  await expect(warn).toContainText('영역이 누락되었습니다.');
  await expect(warn).toContainText('현재 입력된 내용을 삭제하고');
  await expect(warn).toContainText('종정시 정보를 다시 불러오세요.');
  await expect(page.locator('.wm-backdrop')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.5)');
  await expect(warn.getByRole('button', { name: '입력된 내용 삭제' })).toHaveCSS('background-color', 'rgb(255, 17, 17)');
  expect(await warn.locator('img').evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect(warn).toBeHidden();
  await expect(box).toHaveValue(noSummary);
  // 제목만 없어도 정상 분석되며, 저장 전에는 DB를 바꾸지 않는다.
  await box.fill(FULL_TRANSCRIPT.replace('년도/학기별 취득성적\n', ''));
  await expect(page.locator('.part.found')).toHaveCount(2);
  await expect(page.locator('.red-list')).toHaveCount(0);
  expect(JSON.parse(await readState()).courses).toHaveLength(0);
  await box.fill('아무 글이나 붙여넣었어요');
  await save.click();
  await expect(warn).toContainText("‘년도/학기별 취득성적', ‘이수구분별 취득학점 계'");
  await expect(warn).toContainText('영역이 누락되었습니다.');
  await page.keyboard.press('Escape');
  await box.fill(noSummary);
  // '입력된 내용 삭제'를 누르면 붙여넣은 내용과 빨간 표시가 지워져 다시 붙여넣을 수 있다 (저장된 기록은 건드리지 않는다)
  await save.click();
  await warn.getByRole('button', { name: '입력된 내용 삭제' }).click();
  await expect(warn).toBeHidden();
  await expect(box).toHaveValue('');
  await expect(box).toBeFocused();
  await expect(page.locator('.part.missing')).toHaveCount(0);
  await expect(page.locator('.red-list')).toHaveCount(0);

  // 이상 없으면 저장하고 학사 현황으로 넘어간다
  await box.fill(FULL_TRANSCRIPT);
  await save.click();
  await startHufstep();
  await expect(page.getByRole('heading', { name: '내 학사현황' })).toBeVisible();
  const saved = await readState();
  expect(JSON.parse(saved).courses).toHaveLength(6);
  expect(saved).not.toContain('이수구분별 취득학점 계'); // 원문은 저장하지 않는다

  // 저장된 정보가 있어도 초기화 없이 다시 반영할 수 있고 과목 ID·학점은 중복되지 않는다.
  await tab('종정시 입력').click();
  await expect(page.getByLabel('종정시 정보 붙여넣기')).toBeEnabled();
  await expect(box).toHaveValue(FULL_TRANSCRIPT);
  await tab('시간표').click();
  await tab('종정시 입력').click();
  await expect(box).toHaveValue(FULL_TRANSCRIPT);
  await expect(page.getByRole('button', { name: '종정시 정보 저장' })).toBeEnabled();
  const ids = JSON.parse(await readState()).courses.map((c: { id: string }) => c.id);
  await box.fill(FULL_TRANSCRIPT);
  await expect(page.locator('.part.found')).toHaveCount(2);
  expect(JSON.parse(await readState()).courses.map((c: { id: string }) => c.id)).toEqual(ids);
  await save.click();
  await startHufstep();
  expect(JSON.parse(await readState()).courses.map((c: { id: string }) => c.id)).toEqual(ids);
  await tab('종정시 입력').click();
  const reset = page.getByRole('button', { name: '저장된 종정시 정보 초기화' });
  const rb = (await reset.boundingBox())!; // Figma: 100×60, 남색 테두리 흰 바탕
  expect(Math.round(rb.width)).toBe(100);
  await expect(reset).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.getByRole('button', { name: '초기화' })).toHaveCount(1); // '한 번 더' 같은 버튼은 없다
  await reset.click();
  await expect(page.getByLabel('종정시 정보 붙여넣기')).toBeEnabled();
  await expect(page.getByLabel('종정시 정보 붙여넣기')).toHaveValue('');
  await expect(page.getByText('한 번 더')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /초기화/ })).toHaveCount(0);
  expect(JSON.parse(await readState()).courses).toHaveLength(0);
  expect(JSON.parse(await readState()).snapshots).toHaveLength(0);
  await page.getByLabel('종정시 정보 붙여넣기').fill(FULL_TRANSCRIPT);
  await page.getByRole('button', { name: '종정시 정보 저장' }).click();
  await startHufstep(); // 삭제(초기화)하고 새로 넣어도 저장 성공 모달이 똑같이 뜬다
  await expect(page.getByRole('heading', { name: '내 학사현황' })).toBeVisible();
  expect(JSON.parse(await readState()).courses).toHaveLength(6);
});

test('하단 안내문과 영역별 취득학점 표를 웨일 확장앱에서도 분석·저장한다', async () => {
  await tab('종정시 입력').click();
  await expect.poll(async () => JSON.parse(await readState()).settings.lastView).toBe('records');
  const before = JSON.parse(await readState());
  await page.getByLabel('종정시 정보 붙여넣기').fill(FOOTER_TRANSCRIPT);
  await expect(page.locator('.part.found')).toHaveCount(2);
  await expect(page.locator('.red-list')).toHaveCount(0);
  expect(JSON.parse(await readState())).toEqual(before);
  await page.getByRole('button', { name: '종정시 정보 저장' }).click();
  await startHufstep();
  const after = JSON.parse(await readState());
  expect(after.courses.map((c: { id: string }) => c.id)).toEqual(before.courses.map((c: { id: string }) => c.id));
  expect(after.snapshots.at(-1).reportedTotalEarnedUnits).toBe(2000);
});

test('학사 현황: 남은 학점·영역별·필수과목·졸업시험이 저장한 데이터로 채워지고, 직접 체크로 맞출 수 있다', async () => {
  await tab('학사 현황').click();
  await expect(page.locator('.st-meta')).toContainText('24학번');
  // 계단 위 캐릭터: 현재 학년(3학년)의 캐릭터가 3층에 선다
  const stairChar = page.locator('.stairs .stair-char');
  await expect(stairChar).toHaveAttribute('data-year', '3');
  expect(await stairChar.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  expect(await page.locator('.stairs .stairs-bg').evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator('.remain-card .got')).toContainText('20');
  await expect(page.locator('.remain-card .got')).toContainText('/134');
  expect(await page.locator('.area-row').count()).toBeGreaterThan(0);
  await page.getByRole('button', { name: '03 졸업시험' }).click();

  // 추가 입력 카드는 없다 (필요한 질문은 '아니요/해당 없음'으로 가정해 계산한다)
  await expect(page.locator('section[aria-labelledby="questions-title"]')).toHaveCount(0);
  await expect(page.getByText('추가 입력 필요')).toHaveCount(0);

  // 필수과목 카드: 행을 누르면 필수과목 목록이 펼쳐진다
  const primary = page.locator('.sc').filter({ hasText: '주전공' }).first();
  const row = primary.getByRole('button', { name: /^\d+\/11과목/ });
  await expect(row).toBeVisible();
  await row.click();
  const item = primary.locator('.sc-item').filter({ hasText: '지역과지역학' });
  await expect(item).not.toContainText('이수 완료'); // 이수하지 않은 줄에는 아무 표시도 없다
  await expect(item.getByRole('button', { name: '지역과지역학 이수', exact: true })).toBeVisible();

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
  await expect(primary.locator('.sc-item').filter({ hasText: '지역과지역학' }).locator('.sc-done')).toContainText('이수 완료');

  // 졸업 시험 및 요건: 정해진 목록에서 학생이 초록 체크박스로 직접 체크한다.
  const exam = page.locator('#st-exams .sc').first();
  await exam.locator('.sc-row').click();
  const box = exam.locator('.cbx').first();
  // 체크박스는 글자 왼쪽에 있다
  expect((await box.boundingBox())!.x).toBeLessThan((await exam.locator('.sc-item .tx').first().boundingBox())!.x);
  const size = (await box.boundingBox())!;
  expect(size.width).toBeLessThanOrEqual(22); // 작은 네모 체크박스
  expect(Math.abs(size.width - size.height)).toBeLessThan(1);
  // 졸업시험·요건 제목은 20자까지만 보이고 뒤는 …로 줄인다
  const rowTitle = (await exam.locator('.sc-row span').first().innerText()).replace(/\s*외 \d+건$/, '');
  expect([...rowTitle].length).toBeLessThanOrEqual(21);
  // 펼친 목록의 항목 제목·기준·설명은 줄이지 않고 전부 보인다
  const itemText = await exam.locator('.sc-item .tx').first().innerText();
  expect(itemText).not.toMatch(/…|\.\.\./);
  expect(itemText.length).toBeGreaterThan(0);
  await expect(box).toHaveAttribute('aria-checked', 'false');
  await box.click();
  await expect(box).toHaveAttribute('aria-checked', 'true');
  await expect(box.locator('.ic-check')).toBeVisible();
  expect(JSON.parse(await readState()).certConfirmations.length).toBe(1);
  await box.click();
  await expect(box).toHaveAttribute('aria-checked', 'false');
  expect(JSON.parse(await readState()).certConfirmations.length).toBe(0);

  // 직접 고치기 (필수과목): 추가하면 전체 과목 수가 늘고, 이름을 고치고, 지우면 다시 줄어든다
  const total = Number((await primary.locator('.sc-row span').first().innerText()).match(/\/(\d+)과목/)![1]);
  await primary.getByRole('button', { name: '졸업 필수 과목 추가하기' }).click();
  const add = page.getByRole('dialog', { name: '졸업 필수 과목 추가' });
  await add.getByRole('button', { name: '해당 과목 추가하기' }).click();
  await expect(add.getByRole('alert')).toContainText('과목명'); // 비어 있으면 더하지 않는다
  await add.getByLabel('과목명').fill('직접 넣은 과목');
  await add.getByRole('button', { name: '해당 과목 추가하기' }).click();
  await expect(add).toBeHidden();
  await expect(primary.locator('.sc-item').filter({ hasText: '직접 넣은 과목' })).toBeVisible();
  await expect(primary.locator('.sc-row span').first()).toContainText(`/${total + 1}과목`);
  await primary.getByRole('button', { name: '이름 고치기' }).click();
  const nm = primary.getByLabel('직접 넣은 과목 이름');
  await nm.fill('고친 과목');
  await nm.press('Enter');
  await primary.getByRole('button', { name: '지우기' }).click();
  await primary.getByRole('button', { name: '고친 과목 삭제' }).click();
  await expect(primary.locator('.sc-item').filter({ hasText: '고친 과목' })).toHaveCount(0);
  await expect(primary.locator('.sc-row span').first()).toContainText(`/${total}과목`);
  // 이수 칸을 누르면 직접 이수로 표시되고 숫자에 반영된다 (다시 누르면 해제)
  await primary.getByRole('button', { name: '지우기' }).click(); // 지우기 모드 끄기
  const met0 = Number((await primary.locator('.sc-row span').first().innerText()).match(/^(\d+)\//)![1]);
  const off = primary.locator('button.sc-check').first();
  await off.click();
  await expect(primary.locator('.sc-row span').first()).toContainText(`${met0 + 1}/`);
  await primary.locator('button.sc-done').first().click();
  await expect(primary.locator('.sc-row span').first()).toContainText(`${met0}/`);

  // 기존 전공 카드 안에 시험 정보를 더한다
  await expect(page.getByRole('button', { name: '졸업 요건 추가하기' })).toHaveCount(0);
  const fresh = page.locator('#st-exams .sc').first();
  await fresh.locator('.sc-row').click();
  await fresh.getByRole('button', { name: '졸업 시험 추가하기' }).click();
  const exm = page.getByRole('dialog', { name: '졸업 시험 추가' });
  await exm.getByLabel('시험명').fill('FLEX');
  await exm.getByLabel('점수 요건').fill('600점 이상');
  await exm.getByRole('button', { name: '해당 시험 정보 추가하기' }).click();
  const addedExam = fresh.locator('.sc-item').filter({ hasText: 'FLEX' });
  await expect(addedExam).toContainText('FLEX');
  await expect(addedExam.locator('.sub')).toHaveText('600점 이상');
  await fresh.getByRole('button', { name: '이름 고치기' }).click();
  const examName = fresh.getByLabel('FLEX 이름');
  await examName.fill('이름을 고친 FLEX');
  await examName.press('Enter');
  await expect(examName).toHaveValue('이름을 고친 FLEX');
  await fresh.getByRole('button', { name: '지우기' }).click();
  await fresh.getByRole('checkbox', { name: '이름을 고친 FLEX 삭제' }).click();
  await expect(fresh.locator('.sc-item').filter({ hasText: '이름을 고친 FLEX' })).toHaveCount(0);
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

test('시간표: 끌기·클릭으로 수업 추가 → 시험 정보 → 확인 후 삭제', async () => {
  await tab('시간표').click();
  await expect(page.locator('.tt')).toHaveCount(1);
  await expect(page.locator('.tt-dayh').filter({ hasText: /^[월화수목금]$/ })).toHaveCount(5);
  await expect(page.locator('.tt-cell.hour')).toHaveText(['9', '10', '11', '12', '13', '14', '15', '16']); // Figma: 9~16시
  await expect(page.locator('.tt-blk')).toHaveCount(0);
  await expect(page.getByText('아래 표를 드래그하여 수업 시간표를 추가하고,')).toBeVisible();
  // 요일 칸은 모두 같은 폭 (390px 화면에서 63px)
  const dayW = await page.locator('.tt-dayh').evaluateAll((els) => els.slice(1).map((e) => e.getBoundingClientRect().width));
  expect(Math.max(...dayW) - Math.min(...dayW)).toBeLessThan(1);

  // 시트가 열렸다 닫히면 화면이 조금 내려가 있을 수 있어, 칸 위치는 매번 다시 잰다
  const at = async (day: number, hour: number) => {
    const box = (await page.locator('.tt-over').boundingBox())!;
    const col = (box.width - 30) / 5;
    return { x: box.x + 30 + col * (day + 0.5), y: box.y + 70 * (hour - 9 + 0.5) };
  };
  const drag = async (day: number, from: number, to: number) => {
    const a = await at(day, from), b = await at(day, to);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 });
    await page.mouse.up();
  };
  const ask = page.getByRole('alertdialog');
  const sheet = page.getByRole('dialog', { name: '수업 정보' });

  // 월 9→11시를 위에서 아래로 끌면 3칸이 잡히고, 손을 뗀 뒤 확인 창이 뜬다. '아니오'면 아무것도 남지 않는다
  await drag(0, 9, 11);
  await expect(page.locator('.tt-sel')).toHaveCount(1);
  expect(Math.round((await page.locator('.tt-sel').boundingBox())!.height)).toBe(210);
  await expect(ask).toContainText('선택하신 영역에');
  await expect(ask).toContainText('시간표를 추가하시겠습니까?');
  await expect(page.locator('.wm-backdrop')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.5)');
  await ask.getByRole('button', { name: '취소' }).click();
  await expect(ask).toBeHidden();
  await expect(page.locator('.tt-sel')).toHaveCount(0);

  // 다시 끌고 '시간표 추가' → 수업 정보 시트에 시간이 09:00 ~ 12:00 으로 들어와 있다
  await drag(0, 9, 11);
  await ask.getByRole('button', { name: '시간표 추가' }).click();
  await expect(sheet).toBeVisible();
  await expect(sheet.getByLabel('시작 시')).toHaveValue('09');
  await expect(sheet.getByLabel('종료 시')).toHaveValue('12');
  await sheet.getByRole('button', { name: '수업 시간표 추가' }).click(); // 과목명이 비어 있으면 저장되지 않는다
  await expect(sheet.getByRole('alert')).toContainText('과목명을 입력해 주세요');
  await sheet.getByLabel('과목명').fill('가상 수강 과목');
  await sheet.getByRole('button', { name: '수업 시간표 추가' }).click();
  await expect(sheet).toBeHidden();
  const blocks = page.locator('.tt-blk');
  await expect(blocks).toHaveCount(1);
  await expect(blocks.first()).toContainText('가상 수강 과목');
  expect(Math.round((await blocks.first().boundingBox())!.height)).toBe(210); // 9~12시 = 3칸 × 70px (Figma)
  await expect(page.getByText('수업 시간표를 추가/삭제하고')).toHaveCount(0); // 안내 문구는 수업이 생겨도 '추가하고,' 그대로

  // 이미 있는 수업 위로는 끌어도 겹치지 않는다 (월 16시에서 9시까지 끌어 올려도 12시에서 멈춘다)
  await drag(0, 16, 9);
  expect(Math.round((await page.locator('.tt-sel').boundingBox())!.height)).toBe(70 * 5);
  await ask.getByRole('button', { name: '취소' }).click();

  // 아래에서 위로: 수 15시 → 13시 (13:00 ~ 16:00)
  await drag(2, 15, 13);
  await ask.getByRole('button', { name: '시간표 추가' }).click();
  await expect(sheet.getByLabel('시작 시')).toHaveValue('13');
  await expect(sheet.getByLabel('종료 시')).toHaveValue('16');
  await sheet.getByLabel('과목명').fill('가상 수강 과목'); // 같은 이름이면 같은 과목에 시간이 더해진다
  await sheet.getByRole('button', { name: '수업 시간표 추가' }).click();
  await expect(blocks).toHaveCount(2);

  // 끌지 않고 칸 하나만 누른 뒤 시간을 입력해도 같다: 금 9시 칸 → 종료를 11시로 → 막대가 2칸으로 바뀐다
  const f = await at(4, 9);
  await page.mouse.click(f.x, f.y);
  await ask.getByRole('button', { name: '시간표 추가' }).click();
  await sheet.getByLabel('종료 시').fill('11');
  await expect.poll(async () => Math.round((await page.locator('.tt-sel').boundingBox())!.height)).toBe(140);
  await sheet.getByLabel('과목명').fill('가상 B');
  await sheet.getByRole('button', { name: '수업 시간표 추가' }).click();
  await expect(blocks).toHaveCount(3);

  // 시간표 과목은 학점 계산의 이번 학기 목록으로 이어진다. 학점 미입력 시 보충할 수 있다.
  expect(JSON.parse(await readState()).courses.find((c: { name: string }) => c.name === '가상 수강 과목').origin).toBe('timetable');
  await tab('학점 계산').click();
  await expect(page.locator('.term-row').filter({ hasText: '가상 수강 과목' })).toContainText('학점 입력');
  await expect(page.locator('.term-row').filter({ hasText: '가상 B' })).toBeVisible();
  await tab('시간표').click();

  // 시험 정보: '시험정보 추가' → 메모 + 중간고사·기말고사 (O / X / 대체과제, 처음 값은 O) → '시험 정보 추가' (처음), 다시 열면 '변경사항 저장하기'
  const mon = blocks.filter({ hasText: '가상 수강 과목' }).first();
  // '시험정보 추가'는 블록 가운데 (왼쪽 아래로 치우치지 않는다)
  const addBtn = (await mon.getByRole('button', { name: /시험 정보 추가/ }).boundingBox())!, monBox = (await mon.boundingBox())!;
  expect(Math.abs(addBtn.x + addBtn.width / 2 - (monBox.x + monBox.width / 2))).toBeLessThan(2);

  await mon.getByRole('button', { name: /시험 정보 추가/ }).click();
  const exam = page.getByRole('dialog', { name: '시험 정보' });
  await expect(exam.getByLabel('중간고사')).toHaveValue('exam');
  await expect(exam.getByLabel('기말고사')).toHaveValue('exam');
  await expect(exam.getByLabel('기말고사').locator('option')).toHaveText(['O', 'X', '대체과제']);
  await expect(exam.getByRole('button', { name: '메모 저장' })).toHaveCount(0); // 메모는 아래 버튼 하나로 함께 저장
  await exam.getByLabel('내 메모').fill(MEMO);
  await exam.getByLabel('기말고사').selectOption({ label: '대체과제' });
  await exam.getByRole('button', { name: '시험 정보 추가' }).click();
  await expect(exam).toBeHidden();
  await expect(mon).toContainText('중간고사O');
  await expect(mon).toContainText('기말 대체 과제'); // 낱말 단위로 적힌다 ('제'만 따로 떨어지지 않는다)
  await mon.click({ position: { x: 20, y: 20 } }); // 블록을 누르면 수정 시트 (삭제 확인이 뜨지 않는다)
  await expect(ask).toBeHidden();
  await expect(exam.getByRole('button', { name: '변경사항 저장하기' })).toBeVisible(); // 두 번째부터는 '변경사항 저장하기'
  await expect(exam.getByLabel('내 메모')).toHaveValue(MEMO);
  await expect(exam.getByLabel('기말고사')).toHaveValue('replacement');
  await exam.getByLabel('기말고사').selectOption({ label: 'X' });
  await exam.getByRole('button', { name: '변경사항 저장하기' }).click();
  await expect(mon).toContainText('기말고사X');
  await page.screenshot({ path: 'test-results/timetable-figma.png', fullPage: true, timeout: 15_000 }).catch(() => {});

  // Delete 키나 끌기로는 지워지지 않는다. 삭제는 블록 맨 아래 삭제 아이콘 하나뿐
  await mon.focus();
  await page.keyboard.press('Delete');
  await expect(ask).toBeHidden();
  await expect(blocks).toHaveCount(3);

  // 삭제: 아이콘을 눌러야만 확인 창이 뜬다. 취소하면 그대로, '시간표 삭제'를 눌러야 월 9~12시 전체가 사라진다
  await mon.getByRole('button', { name: /시간표 삭제$/ }).click();
  await expect(ask).toContainText('‘가상 수강 과목’');
  await expect(ask).toContainText('시간표를 삭제하시겠습니까?');
  await expect(ask).toContainText('해당 시간표에 입력한 모든 정보도 함께 사라집니다.');
  await expect(ask.getByRole('button', { name: '시간표 삭제' })).toHaveCSS('background-color', 'rgb(255, 17, 17)');
  expect(Math.round((await page.locator('.tt-sel').boundingBox())!.height)).toBe(210);
  await ask.getByRole('button', { name: '취소' }).click();
  await expect(blocks).toHaveCount(3);
  await mon.getByRole('button', { name: /시간표 삭제$/ }).click();
  await ask.getByRole('button', { name: '시간표 삭제' }).click();
  await expect(blocks).toHaveCount(2);
  await expect(page.locator('.tt-sel')).toHaveCount(0);
  // 같은 과목의 수요일 시간과 시험 정보·메모는 남는다
  await expect(blocks.filter({ hasText: '가상 수강 과목' })).toHaveCount(1);
  await expect(blocks.filter({ hasText: '가상 수강 과목' })).toContainText('중간고사O');
  // 시간표에서만 만든 과목의 마지막 시간을 지우면 과목째 정리된다 (금 9~11시 '가상 B')
  await blocks.filter({ hasText: '가상 B' }).getByRole('button', { name: /시간표 삭제$/ }).click();
  await ask.getByRole('button', { name: '시간표 삭제' }).click();
  await expect(blocks).toHaveCount(1);
  const st = JSON.parse(await readState());
  expect(st.courses.some((c: { name: string }) => c.name === '가상 B')).toBe(false);
  expect(st.courses.find((c: { name: string }) => c.name === '가상 수강 과목').creditUnits).toBe(0);
  expect(st.classTimes.length).toBe(1);

  // 한 칸(70px)짜리 수업: 이름·시험 정보·삭제 아이콘이 서로 겹치지 않는다 (글씨를 같은 비율로 줄였다)
  const one = await at(3, 13);
  await page.mouse.click(one.x, one.y);
  await ask.getByRole('button', { name: '시간표 추가' }).click();
  await sheet.getByLabel('과목명').fill('한 칸 수업 이름이 꽤 긴 과목');
  await sheet.getByRole('button', { name: '수업 시간표 추가' }).click();
  const small = blocks.filter({ hasText: '한 칸 수업' });
  expect(Math.round((await small.boundingBox())!.height)).toBe(70);
  await small.getByRole('button', { name: /시험 정보 추가/ }).click();
  await exam.getByLabel('중간고사').selectOption({ label: '대체과제' });
  await exam.getByLabel('기말고사').selectOption({ label: '대체과제' });
  await exam.getByRole('button', { name: '시험 정보 추가' }).click();
  await expect(exam).toBeHidden();
  await expect(small).toContainText('기말 대체 과제');
  const parts = await small.evaluate((el) => {
    const rect = (e: Element) => e.getBoundingClientRect();
    return ['.nm', '.ev:nth-child(1)', '.ev:nth-child(2)', '.tt-del'].map((q) => { const r = rect(el.querySelector(q)!); return [r.left, r.top, r.right, r.bottom]; });
  });
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
    const [a, b] = [parts[i], parts[j]];
    const overlap = a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
    expect(overlap, `한 칸 블록 안 ${i}번·${j}번 글씨가 겹침`).toBe(false);
  }
  const big = await blocks.filter({ hasText: '가상 수강 과목' }).locator('.ev').first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  const tiny = await small.locator('.ev').first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  expect(tiny).toBeLessThan(big); // 한 칸이면 글씨가 줄어든다
});

test('마이페이지: 인사·프로필 카드·학적 정보 표, 톱니바퀴로 수정', async () => {
  await tab('마이페이지').click();
  await expect(page.getByRole('heading', { name: /안녕하세요,\s*김웨이님/ })).toBeVisible();
  await expect(page.locator('.profile-card')).toContainText('김웨이');
  expect(await page.locator('.profile-card .avatar img').evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0); // 외대 로고
  await expect(page.locator('.profile-card')).toContainText('24학번');
  await expect(page.locator('.info-table')).toContainText('말레이·인도네시아어과');
  await expect(page.locator('.info-table')).toContainText('경영학부');
  await expect(page.locator('.info-table')).toContainText('신입학');
  await expect(page.getByText('정보 관리')).toHaveCount(0); // 보류 중인 항목은 만들지 않았다
  await expect(page.locator('.mp-foot')).toContainText('오류 신고 및 문의');
  await expect(page.getByRole('link', { name: 'hufswavoo123@gmail.com' })).toHaveAttribute('href', 'mailto:hufswavoo123@gmail.com');
  await page.getByRole('button', { name: '학적 정보 수정하기' }).click();
  const dlg = page.getByRole('dialog', { name: '내 정보 수정' });
  for (const gone of ['기타 설정', '알림', '동의 철회', '전체 초기화', '현재 학기']) await expect(dlg).not.toContainText(gone);
  await dlg.getByLabel('이름 / 닉네임').fill('웨이');
  await dlg.getByRole('combobox', { name: '현재 학년', exact: true }).click();
  await dlg.getByRole('option', { name: '4학년', exact: true }).click();
  await dlg.getByRole('button', { name: '저장', exact: true }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByRole('heading', { name: /안녕하세요,\s*웨이님/ })).toBeVisible();
  expect(JSON.parse(await readState()).profile.name).toBe('웨이');
  // 학년을 바꾸면 헤더 로고도 같이 바뀐다 (4학년 = 학사모)
  await expect(page.locator('.app-header img.logo')).toHaveAttribute('data-year', '4');
  // 학사 현황 계단 캐릭터도 같이 바뀐다 (4학년 = 4층, 3층일 때보다 위·오른쪽)
  await tab('학사 현황').click();
  const stairChar4 = page.locator('.stairs .stair-char');
  await expect(stairChar4).toHaveAttribute('data-year', '4');
  expect(await stairChar4.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
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
    await page.locator('.tt-blk').first().click({ position: { x: 10, y: 10 } });
    const dlg = page.getByRole('dialog', { name: '시험 정보' });
    await expect(dlg.getByLabel('내 메모')).toBeVisible();
    const d = (await dlg.boundingBox())!;
    expect(d.x).toBeGreaterThanOrEqual(0);
    expect(d.x + d.width).toBeLessThanOrEqual(width + 0.5);
    expect(await dlg.locator('.sheet-body').evaluate((el) => el.scrollWidth - el.clientWidth), `${width}px 패널`).toBeLessThanOrEqual(0);
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    // 개인정보 입력 폼(마이페이지 수정 패널): 칩 3개가 모두 보이고 안 잘린다
    await tab('마이페이지').click();
    await page.getByRole('button', { name: '학적 정보 수정하기' }).click();
    const edit = page.getByRole('dialog', { name: '내 정보 수정' });
    const chips = edit.locator('.opt-chips label');
    await expect(chips).toHaveCount(3);
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
  await expect(page.locator('.tt-blk')).toHaveCount(2); // 가상 수강 과목(수 13~16시) + 한 칸 수업
  await page.locator('.tt-blk').filter({ hasText: '가상 수강 과목' }).click({ position: { x: 10, y: 10 } });
  await expect(page.getByRole('dialog', { name: '시험 정보' }).getByLabel('내 메모')).toHaveValue(MEMO);
  await page.keyboard.press('Escape');
});

test('가상 데이터 둘러보기(?demo): 실제 기록과 섞이지 않는다', async () => {
  // 화면에는 진입 버튼이 없다(Figma에 없음) → 주소 뒤 ?demo로 연다. 새로 열면 가상 데이터는 사라진다.
  const base = page.url().split('?')[0].split('#')[0];
  // 저장된 프로필이 없을 때만 열리므로 저장소를 비운다 (열려 있는 연결은 이 페이지를 떠날 때 닫히며 삭제가 끝난다)
  await page.evaluate(() => { indexedDB.deleteDatabase('hufstep'); });
  await page.goto(`${base}?demo`);
  await expect(page.getByRole('heading', { name: '내 학사현황' })).toBeVisible();
  await tab('시간표').click();
  await expect(page.locator('.tt-blk')).toHaveCount(7); // 가상 과목 5개, 그중 2개는 주 2회
  await page.goto(base);
  await expect(page.getByRole('button', { name: '학사정보 저장' })).toBeVisible();
  expect(await readState()).toBe('null'); // 가상 데이터는 저장되지 않는다
});

test('외부 네트워크 요청·콘솔 오류 없음', async () => {
  expect(external).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
