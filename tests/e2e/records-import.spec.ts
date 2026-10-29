// 합성 자료와 격리된 브라우저 저장소로만 검사한다.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { emptyState, CONSENT_VERSION, type AppState } from '../../src/domain/state';
import { applyMerge, planMerge } from '../../src/domain/merge/mergeImport';
import { parseTranscript } from '../../src/domain/parser/parseTranscript';
import { course, TRANSCRIPT_FIXTURE } from '../fixtures';
import { CAPTIONED_TRANSCRIPT, CONTROLS_TRANSCRIPT, departmentTranscript, FOOTER_TRANSCRIPT, INCOMPLETE_TRANSCRIPTS, TITLELESS_TRANSCRIPT, WRAPPED_TRANSCRIPT } from '../fixtures/importTranscript';

test.use({ baseURL: 'http://127.0.0.1:4173', viewport: { width: 390, height: 820 } });

function initialState(saved = false): AppState {
  const state = emptyState();
  state.profile = {
    schemaVersion: 1, name: '합성테스트', homeCampus: 'seoul', cohortYear: 2024, entryType: 'freshman',
    primaryDepartmentId: 'seoul-malay-indonesian', programType: 'double', secondaryDepartmentId: 'seoul-business',
    currentYear: 3, currentTerm: { academicYear: 2026, semester: '2' },
  };
  state.consent.academicData = { version: CONSENT_VERSION, at: '2026-10-28T00:00:00.000Z' };
  state.settings.lastView = 'records';
  if (!saved) return state;
  const parsed = parseTranscript(TRANSCRIPT_FIXTURE);
  const merged = applyMerge(state, parsed, planMerge(state, parsed), { link: {}, conflictChoice: {}, removeMissing: false }, new Date());
  const target = merged.courses.find((c) => c.officialCode === 'T90001')!;
  merged.courseMemos = [{ courseId: target.id, text: '보존할 합성 메모', updatedAt: '' }];
  merged.classTimes = [{ courseId: target.id, day: 1, start: '09:00', end: '10:00' }];
  merged.assessments = [{ id: 'synthetic-exam', courseId: target.id, phase: 'final', mode: 'exam', examDate: '2026-12-01', notes: '보존할 평가', origin: 'student', updatedAt: '' }];
  merged.courses.push(course({ id: 'synthetic-manual', name: '수동 추가 합성과목', grade: 'B0' }));
  merged.courses.push(course({ id: 'synthetic-old', name: '이번 복사에 없는 기존 과목', officialCode: 'T80001', origin: 'paste', grade: 'A0' }));
  return merged;
}

async function seed(page: Page, state: AppState) {
  await page.goto('/sidebar.html');
  await page.evaluate((value) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('hufstep', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('kv');
    request.onsuccess = () => {
      const tx = request.result.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, 'appState');
      tx.oncomplete = () => { request.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), state);
  await page.reload();
  await expect(page.locator('#paste')).toBeVisible();
}

async function readState(page: Page): Promise<AppState> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('hufstep', 1);
    request.onsuccess = () => {
      const read = request.result.transaction('kv').objectStore('kv').get('appState');
      read.onsuccess = () => { request.result.close(); resolve(read.result); };
      read.onerror = () => reject(read.error);
    };
  }));
}

async function paste(page: Page, text: string) {
  await page.locator('#paste').evaluate((node: HTMLTextAreaElement, value) => {
    node.focus();
    node.setSelectionRange(0, node.value.length);
    const data = new DataTransfer();
    data.setData('text/plain', value);
    data.setData('text/html', '<script>throw new Error("HTML must not run")</script>');
    node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
  await expect(page.locator('#paste')).toHaveValue(text);
  await expect(page.locator('.cta-row > .cta')).toBeEnabled();
}

const success = (page: Page) => page.getByRole('alertdialog', { name: '성공적으로 입력되었습니다.' });
async function backToRecords(page: Page) {
  await success(page).getByRole('button', { name: 'HUFStep 시작하기' }).click();
  await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name: '종정시 입력' }).click();
  await expect(page.locator('#paste')).toBeVisible();
}

test('편입생 기존 UI에서 단일전공 선택 → 저장 → 남은 25학점 표시·재접속', async ({ page }) => {
  const state = initialState();
  state.profile = { ...state.profile!, cohortYear: 2023, entryType: 'transferBachelor',
    programType: 'intensive', secondaryDepartmentId: undefined, currentYear: 4 };
  // 사진의 취득 합계만 재현한 합성 자료. 개인 성적표는 사용하지 않는다.
  state.snapshots = [{ id: 'transfer-summary', importedAt: '', source: 'summaryInput', courseIds: [],
    reportedEarnedByArea: { primary: 3900, liberalArts: 3400, freeChoice: 3600 }, reportedTotalEarnedUnits: 10900,
    completeness: { earnedTotals: true, courses: false, gpa: false }, warnings: [] }];
  await seed(page, state);
  await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name: '학사 현황' }).click();
  await expect(page.locator('.remain-card .big')).toContainText('—');
  await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name: '마이페이지' }).click();
  await page.getByRole('button', { name: '학적 정보 수정하기' }).click();
  const form = page.getByRole('dialog', { name: '내 정보 수정' });
  await expect(form.locator('.field-legend')).toHaveText('이중전공 / 부전공 이수');
  await expect(form.getByRole('radio')).toHaveCount(4);
  await form.getByLabel('입학유형').selectOption('freshman');
  await expect(form.getByRole('radio')).toHaveCount(3);
  await form.getByLabel('입학유형').selectOption('transferGeneral');
  await expect(form.getByRole('radio', { name: '단일전공', exact: true })).toBeVisible();
  await form.getByLabel('입학유형').selectOption('transferBachelor');
  // 기존처럼 네 선택지를 한 줄에 두고, 입학유형은 학번·학년 뒤에 둔다.
  const chips = await form.locator('.opt-chips label').all();
  const rows = await Promise.all(chips.map(async (chip) => (await chip.boundingBox())!.y));
  expect(new Set(rows).size).toBe(1);
  expect((await form.getByLabel('입학유형').boundingBox())!.y)
    .toBeGreaterThan((await form.getByLabel('현재 학년').boundingBox())!.y);
  await form.getByRole('radio', { name: '단일전공', exact: true }).check();
  await expect(form.getByRole('combobox', { name: /^부전공/ })).toHaveCount(0);
  await form.screenshot({ path: 'test-results/transfer-profile-minimal.png' });
  await form.getByRole('button', { name: '저장', exact: true }).click();
  const saved = await readState(page);
  expect(saved.profile?.programType).toBe('single');
  expect(saved.profile?.secondaryDepartmentId).toBeUndefined();
  expect(saved.snapshots).toEqual(state.snapshots);
  await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name: '학사 현황' }).click();
  await expect(page.locator('.remain-card .big')).toContainText('25');
  await expect(page.locator('.remain-card .got')).toContainText('109/134');
  await page.reload();
  await expect(page.locator('.remain-card .big')).toContainText('25');
  // 저장된 단일전공 프로필도 신입학으로 바꾸면 편입생 전용 선택이 숨겨진다.
  await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name: '마이페이지' }).click();
  await page.getByRole('button', { name: '학적 정보 수정하기' }).click();
  await form.getByLabel('입학유형').selectOption('freshman');
  await expect(form.getByRole('radio', { name: '단일전공', exact: true })).toHaveCount(0);
  await expect(form.getByRole('radio', { name: '이중전공', exact: true })).toBeChecked();
});

for (const [id, name, campus, entryType, programType] of [
  ['seoul-business', '경영학부', 'seoul', 'freshman', 'single'],
  ['seoul-6afe7a8073', '영어교육과', 'seoul', 'freshman', 'minor'],
  ['global-c5a7095468', '컴퓨터공학부', 'global', 'transferGeneral', 'double'],
  ['global-673166b87b', '반도체전자공학부(반도체공학전공)', 'global', 'transferBachelor', 'intensive'],
] as const) {
  test(`다른 학과 입력: ${name} / ${entryType} / ${programType} 저장·재접속`, async ({ page }) => {
    const state = initialState();
    state.profile = {
      ...state.profile!, homeCampus: campus, primaryDepartmentId: id, entryType, programType,
      secondaryDepartmentId: programType === 'double' || programType === 'minor' ? 'seoul-malay-indonesian' : undefined,
    };
    await seed(page, state);
    await paste(page, departmentTranscript(name));
    await expect(page.locator('.part.found')).toHaveCount(2);
    await expect(page.locator('.red-list')).toHaveCount(0);
    await page.locator('.cta-row > .cta').click();
    await expect(success(page)).toBeVisible();
    const saved = await readState(page);
    expect(saved.profile).toEqual(state.profile);
    expect(saved.courses).toHaveLength(10);
    expect(saved.courses.filter((c) => c.officialCode).map((c) => c.offeringDepartmentName)).toEqual(Array(9).fill(name));
    expect(saved.snapshots.at(-1)?.reportedTotalEarnedUnits).toBe(1850);
    expect(saved.snapshots.at(-1)?.completeness).toEqual({ earnedTotals: true, courses: true, gpa: true });
    await page.reload();
    expect(await readState(page)).toEqual(saved);
  });
}

test('기존 입력 UI를 유지하고 메뉴 문구를 제외하며 오류 시 기존 안내만 표시한다', async ({ page }) => {
  const before = initialState(true);
  await seed(page, before);
  await paste(page, CONTROLS_TRANSCRIPT);
  await expect(page.locator('.red-list')).toHaveCount(0);
  await expect(page.locator('#import-diagnostic')).toHaveCount(0);
  await expect(page.locator('#transcript-audit')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /복사/ })).toHaveCount(0);
  await expect(page.getByText('성적 1:1 대조 자료', { exact: true })).toHaveCount(0);
  await page.locator('.cta-row > .cta').click();
  await expect(success(page)).toBeVisible();
  await backToRecords(page);
  const saved = await readState(page);

  await paste(page, `검색조건\n미상 합성 행\n${CONTROLS_TRANSCRIPT}`);
  await expect(page.locator('.red-list')).toContainText('미상 합성 행');
  await expect(page.locator('.import-diagnostic')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /복사/ })).toHaveCount(0);
  expect(await readState(page)).toEqual(saved);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await paste(page, CONTROLS_TRANSCRIPT);
  await expect(page.locator('.red-list')).toHaveCount(0);
});

test('과목 위 제목과 하단 중복 제목이 복사되어도 과목과 합계를 저장한다', async ({ page }) => {
  const before = initialState();
  await seed(page, before);
  await paste(page, CAPTIONED_TRANSCRIPT);
  await expect(page.locator('.part.found')).toHaveCount(2);
  await expect(page.locator('.red-list')).toHaveCount(0);
  expect(await readState(page)).toEqual(before);
  await page.locator('.cta-row > .cta').click();
  await expect(success(page)).toBeVisible();
  const saved = await readState(page);
  expect(saved.courses).toHaveLength(6);
  expect(saved.snapshots.at(-1)?.reportedTotalEarnedUnits).toBe(2000);
  expect(saved.snapshots.at(-1)?.completeness).toEqual({ earnedTotals: true, courses: true, gpa: true });
});

test('하단 안내문·영역별 취득학점 제목이 있어도 자동 분석하고 안전하게 병합한다', async ({ page }) => {
  const before = initialState(true);
  await seed(page, before);
  await paste(page, FOOTER_TRANSCRIPT);
  await expect(page.locator('.part.found')).toHaveCount(2);
  await expect(page.locator('.red-list')).toHaveCount(0);
  expect(await readState(page)).toEqual(before);
  await page.locator('.cta-row > .cta').click();
  await expect(success(page)).toBeVisible();
  const saved = await readState(page);
  expect(saved.courses.map((c) => c.id)).toEqual(before.courses.map((c) => c.id));
  expect(saved.snapshots.at(-1)?.reportedTotalEarnedUnits).toBe(2000);
  for (const key of ['courseMemos', 'classTimes', 'assessments'] as const) expect(saved[key]).toEqual(before[key]);
  await backToRecords(page);
  const afterNavigation = await readState(page);
  await paste(page, FOOTER_TRANSCRIPT.replace('취득학점\t5.0', '취득학점\t6.0'));
  await expect(page.locator('.red-list')).toBeVisible();
  await page.locator('.cta-row > .cta').click();
  await expect(success(page)).toBeHidden();
  expect(await readState(page)).toEqual(afterNavigation);
});

test('자동 분석은 미리보기만 갱신하고, 재반영·갱신은 ID와 연결 정보를 보존한다', async ({ page }) => {
  const before = initialState(true);
  await seed(page, before);
  await expect(page.locator('#paste')).toBeEnabled();
  await paste(page, WRAPPED_TRANSCRIPT);
  await expect(page.locator('.part.found')).toHaveCount(2);
  await expect(success(page)).toBeHidden();
  expect(await readState(page)).toEqual(before);
  await page.locator('.cta-row > .cta').click();
  await expect(success(page)).toBeVisible();
  const once = await readState(page);
  expect(once.courses.map((c) => c.id)).toEqual(before.courses.map((c) => c.id));
  for (const key of ['courseMemos', 'classTimes', 'assessments'] as const) expect(once[key]).toEqual(before[key]);
  await backToRecords(page);
  await paste(page, TITLELESS_TRANSCRIPT.replace('3 A0', '3 A+'));
  await page.locator('.cta-row > .cta').click();
  await expect(success(page)).toBeVisible();
  const updated = await readState(page);
  expect(updated.courses.map((c) => c.id)).toEqual(before.courses.map((c) => c.id));
  expect(updated.courses.find((c) => c.officialCode === 'T90001')?.grade).toBe('A+');
  for (const key of ['courseMemos', 'classTimes', 'assessments'] as const) expect(updated[key]).toEqual(before[key]);
  expect(updated.snapshots.at(-1)?.completeness).toEqual({ earnedTotals: true, courses: true, gpa: true });
  await page.reload();
  expect(await readState(page)).toEqual(updated);
});

test('과목 누락·미상 값·미해석 행·요약만 있는 자료는 경고하고 기존 DB를 유지한다', async ({ page }) => {
  const before = initialState(true);
  await seed(page, before);
  for (const text of Object.values(INCOMPLETE_TRANSCRIPTS)) {
    await paste(page, text);
    await expect(page.locator('.red-list')).toBeVisible();
    await page.locator('.cta-row > .cta').click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expect(success(page)).toBeHidden();
    expect(await readState(page)).toEqual(before);
    await page.keyboard.press('Escape');
  }
});

test('늦은 Worker 결과는 새 입력을 덮어쓰지 않으며 같은 내용의 재붙여넣기도 분석한다', async ({ page }) => {
  await seed(page, initialState(true));
  const before = await readState(page);
  await page.evaluate(() => {
    type FakeWorker = { onmessage?: (e: { data: unknown }) => void; onerror?: () => void; terminated?: boolean };
    const workers: FakeWorker[] = [];
    Object.assign(window, { testWorkers: workers });
    window.Worker = class {
      onmessage?: FakeWorker['onmessage'];
      onerror?: FakeWorker['onerror'];
      postMessage() { workers.push(this); }
      terminate() { Object.assign(this, { terminated: true }); }
    } as unknown as typeof Worker;
  });
  await page.locator('#paste').fill(TRANSCRIPT_FIXTURE);
  await expect.poll(() => page.evaluate(() => (window as unknown as { testWorkers: unknown[] }).testWorkers.length)).toBe(1);
  await page.locator('#paste').fill(INCOMPLETE_TRANSCRIPTS.unparsedLine);
  await expect.poll(() => page.evaluate(() => (window as unknown as { testWorkers: unknown[] }).testWorkers.length)).toBe(2);
  const good = parseTranscript(TRANSCRIPT_FIXTURE), bad = parseTranscript(INCOMPLETE_TRANSCRIPTS.unparsedLine);
  await page.evaluate(({ good, bad }) => {
    const workers = (window as unknown as { testWorkers: { onmessage: (e: unknown) => void; terminated: boolean }[] }).testWorkers;
    if (!workers[0].terminated) throw new Error('이전 Worker가 종료되지 않았습니다.');
    workers[1].onmessage({ data: { ok: true, result: bad } });
    workers[0].onmessage({ data: { ok: true, result: good } });
  }, { good, bad });
  await expect(page.locator('.red-list')).toContainText('해석하지 못한 줄');
  await page.locator('.cta-row > .cta').click();
  await expect(success(page)).toBeHidden();
  expect(await readState(page)).toEqual(before);
  await page.keyboard.press('Escape');
  await page.locator('#paste').evaluate((node: HTMLTextAreaElement) => {
    node.setSelectionRange(0, node.value.length);
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', node.value);
    node.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as { testWorkers: unknown[] }).testWorkers.length)).toBe(3);
});

test('Worker 시작 오류·시간 초과를 기존 오류 영역에 표시하고 저장하지 않는다', async ({ page }) => {
  await seed(page, initialState(true));
  const before = await readState(page);
  await page.evaluate(() => { window.Worker = class { constructor() { throw new Error('합성 Worker 오류'); } } as unknown as typeof Worker; });
  await paste(page, TRANSCRIPT_FIXTURE);
  await expect(page.locator('.red-list')).toContainText('Worker를 시작하지 못했어요');
  await page.locator('.cta-row > .cta').click();
  await expect(success(page)).toBeHidden();
  expect(await readState(page)).toEqual(before);
  await page.evaluate(() => {
    window.Worker = class { postMessage() {} terminate() {} } as unknown as typeof Worker;
  });
  await page.clock.install();
  await page.locator('#paste').fill(TITLELESS_TRANSCRIPT);
  await page.clock.runFor(15_300);
  await expect(page.locator('.red-list')).toContainText('너무 오래');
  await expect(success(page)).toBeHidden();
  expect(await readState(page)).toEqual(before);
});

test('IndexedDB 트랜잭션 실패 시 기존 성적과 연결 정보를 유지하고 성공 모달을 열지 않는다', async ({ page }) => {
  await seed(page, initialState(true));
  const before = await readState(page);
  await paste(page, TITLELESS_TRANSCRIPT);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      const request = put.apply(this, args);
      this.transaction.abort();
      return request;
    };
  });
  await page.locator('.cta-row > .cta').click();
  await expect(page.locator('.red-list')).toContainText('저장하지 못했어요');
  await expect(success(page)).toBeHidden();
  expect(await readState(page)).toEqual(before);
  await page.reload();
  expect(await readState(page)).toEqual(before);
});

test('기존 입력 화면과 모달 디자인을 유지한다', async ({ page }) => {
  await seed(page, initialState());
  await page.evaluate(() => document.fonts.ready);
  mkdirSync('docs/verification/records-design', { recursive: true });
  const after = await page.screenshot({ path: 'docs/verification/records-design/after-empty.png', fullPage: true });
  const baseline = 'docs/verification/records-design/before-empty.png';
  if (existsSync(baseline)) expect(after.equals(readFileSync(baseline)), '수정 전후 빈 입력 화면의 픽셀이 같아야 함').toBe(true);
  await page.getByRole('button', { name: '붙여넣기 도움말' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({ path: 'docs/verification/records-design/after-guide.png', fullPage: true });
  await page.keyboard.press('Escape');
  await paste(page, INCOMPLETE_TRANSCRIPTS.missingSummary);
  await page.locator('.cta-row > .cta').click();
  await page.screenshot({ path: 'docs/verification/records-design/after-warning.png', fullPage: true });
  await page.keyboard.press('Escape');
  await paste(page, WRAPPED_TRANSCRIPT);
  await page.locator('.cta-row > .cta').click();
  await expect(success(page)).toBeVisible();
  await page.screenshot({ path: 'docs/verification/records-design/after-success.png', fullPage: true });
});
