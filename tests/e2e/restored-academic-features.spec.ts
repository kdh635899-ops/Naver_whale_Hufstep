// 격리된 브라우저와 합성 자료로 직접 이수·시간표 예상 평점 연결을 검사한다.
import { expect, test, type Page } from '@playwright/test';
import { CONSENT_VERSION, emptyState, type AppState } from '../../src/domain/state';
import { course } from '../fixtures';
import type { Grade } from '../../src/domain/types';

test.use({ baseURL: 'http://127.0.0.1:4173', viewport: { width: 390, height: 820 } });

async function seed(page: Page, pastName = '합성 이전 성적', pastGrade: Grade = 'B0') {
  await page.clock.setFixedTime(new Date('2026-10-29T03:00:00Z'));
  const state = emptyState();
  state.profile = { schemaVersion: 1, homeCampus: 'seoul', cohortYear: 2024, entryType: 'freshman',
    primaryDepartmentId: 'seoul-malay-indonesian', programType: 'double', secondaryDepartmentId: 'seoul-business',
    currentYear: 3, currentTerm: { academicYear: 2026, semester: '2' },
    facts: { foreignLanguageSpecialAdmission: false, pureForeignAdmission: false } };
  state.courses = [course({ id: 'past', name: pastName, officialCode: pastName === '지역과지역학' ? 'B03131' : undefined,
    grade: pastGrade, term: { academicYear: 2025, semester: '1' } })];
  state.consent.academicData = { version: CONSENT_VERSION, at: '2026-10-29T03:00:00Z' };
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
  await expect(page.locator('.page-title')).toHaveText('내 학사현황');
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

const tab = (page: Page, name: string) => page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name });

test('필수과목 이수 → 과목 수 갱신 → 재접속 유지 → 취소, 실제 취득학점 보존', async ({ page }, testInfo) => {
  await seed(page);
  const earned = await page.locator('.remain-card .got').innerText();
  const primary = page.locator('#st-courses .sc').first();
  await primary.locator('.sc-row').click();
  const item = primary.locator('.sc-item').filter({ hasText: '지역과지역학' });
  const check = item.getByRole('button');
  await expect(primary.locator('.sc-row')).toHaveText('0/11과목');
  await check.click();
  await expect(check).toHaveAttribute('aria-pressed', 'true');
  await expect(check).toHaveText('이수 완료 · 직접 확인');
  await expect(primary.locator('.sc-row')).toHaveText('1/11과목');
  await expect(page.locator('.remain-card .got')).toHaveText(earned);
  expect((await readState(page)).courses).toHaveLength(1);
  await page.setViewportSize({ width: 320, height: 820 });
  await item.scrollIntoViewIfNeeded();
  const buttonBox = (await check.boundingBox())!;
  const textBox = (await item.locator('.tx').boundingBox())!;
  expect(textBox.x + textBox.width).toBeLessThanOrEqual(buttonBox.x);
  expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(320);
  await page.screenshot({ path: testInfo.outputPath('required-course-320.png') });
  await page.reload();
  await primary.locator('.sc-row').click();
  await expect(check).toHaveAttribute('aria-pressed', 'true');
  await check.click();
  await expect(check).toHaveAttribute('aria-pressed', 'false');
  await expect(primary.locator('.sc-row')).toHaveText('0/11과목');
  expect((await readState(page)).certConfirmations).toHaveLength(0);
});

async function addClass(page: Page, name: string, day: number, credits?: string) {
  // 격자의 첫 시간 행에서 해당 요일 칸 중앙을 누른다.
  await page.locator('.tt-grid .tt-cell:not(.hour)').nth(day).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '시간표 추가', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: '수업 정보', exact: true });
  await sheet.getByLabel('과목명').fill(name);
  if (credits) await sheet.getByLabel('학점 (선택)').fill(credits);
  await sheet.getByRole('button', { name: '수업 시간표 추가', exact: true }).click();
  await expect(sheet).toBeHidden();
}

test('필수과목 수강 중 표시·동일 색상·재접속·삭제, 이수 학점과 완료 수 보존', async ({ page }, testInfo) => {
  await seed(page);
  const earned = await page.locator('.remain-card .got').innerText();
  const progress = await page.getByRole('progressbar', { name: '전체 이수 진행률' }).getAttribute('aria-valuenow');
  await tab(page, '시간표').click();
  await addClass(page, '지역과지역학', 0, '3');
  await addClass(page, '지역과지역학', 2);
  await tab(page, '학사 현황').click();
  const primary = page.locator('#st-courses .sc').first();
  await primary.locator('.sc-row').click();
  const item = primary.locator('.sc-item').filter({ hasText: '지역과지역학' });
  await expect(item.locator('.sc-attending')).toHaveText('수강 중');
  const color = await primary.locator('.sc-top .todo').evaluate((el) => getComputedStyle(el).color);
  await expect(item.locator('.sc-attending')).toHaveCSS('color', color);
  await expect(primary.locator('.sc-row')).toHaveText('0/11과목');
  await expect(page.locator('.remain-card .got')).toHaveText(earned);
  await expect(page.getByRole('progressbar', { name: '전체 이수 진행률' })).toHaveAttribute('aria-valuenow', progress!);
  await page.setViewportSize({ width: 320, height: 820 });
  await item.scrollIntoViewIfNeeded();
  const textBox = (await item.locator('.tx').boundingBox())!;
  const statusBox = (await item.locator('.sc-course-status').boundingBox())!;
  expect(textBox.x + textBox.width).toBeLessThanOrEqual(statusBox.x);
  expect(statusBox.x + statusBox.width).toBeLessThanOrEqual(320);
  await page.screenshot({ path: testInfo.outputPath('in-progress-320.png') });
  await page.reload();
  await primary.locator('.sc-row').click();
  await expect(item.locator('.sc-attending')).toHaveText('수강 중');
  await tab(page, '시간표').click();
  await page.locator('.tt-del').first().click();
  await page.getByRole('alertdialog').getByRole('button', { name: '시간표 삭제', exact: true }).click();
  await tab(page, '학사 현황').click();
  await primary.locator('.sc-row').click();
  await expect(item.locator('.sc-attending')).toHaveText('수강 중');
  await tab(page, '시간표').click();
  await page.locator('.tt-del').first().click();
  await page.getByRole('alertdialog').getByRole('button', { name: '시간표 삭제', exact: true }).click();
  await tab(page, '학사 현황').click();
  await primary.locator('.sc-row').click();
  await expect(item.locator('.sc-attending')).toHaveCount(0);
  await expect(primary.locator('.sc-row')).toHaveText('0/11과목');
});

test('재수강 자동 제안·수정·저장, 기존 이수 완료와 취득학점 유지', async ({ page }, testInfo) => {
  await seed(page, '지역과지역학');
  const earned = await page.locator('.remain-card .got').innerText();
  await tab(page, '시간표').click();
  await page.locator('.tt-grid .tt-cell:not(.hour)').first().click();
  await page.getByRole('alertdialog').getByRole('button', { name: '시간표 추가', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: '수업 정보', exact: true });
  await sheet.getByLabel('과목명').fill('지역과지역학');
  await expect(sheet.getByText('졸업 필수 과목 · 지역과지역학')).toBeVisible();
  const retake = sheet.getByRole('checkbox', { name: '재수강 과목이에요' });
  await expect(retake).toBeChecked();
  await retake.uncheck();
  await expect(retake).not.toBeChecked();
  await retake.check();
  const previousSelect = sheet.getByRole('combobox', { name: '대체하는 이전 기록' });
  await expect(previousSelect).toHaveCSS('height', '34px');
  await previousSelect.click();
  await expect(sheet.getByRole('listbox', { name: '대체하는 이전 기록' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('retake-dropdown-open-390.png') });
  await previousSelect.press('Escape');
  await page.screenshot({ path: testInfo.outputPath('retake-sheet-390.png') });
  await sheet.getByRole('button', { name: '수업 시간표 추가', exact: true }).click();
  await expect(page.locator('.tt-retake')).toHaveText('재수강');
  await tab(page, '학사 현황').click();
  const primary = page.locator('#st-courses .sc').first();
  await primary.locator('.sc-row').click();
  const item = primary.locator('.sc-item').filter({ hasText: '지역과지역학' });
  await expect(item.locator('.sc-attending')).toHaveText('재수강 중');
  await expect(item.locator('.sc-done')).toHaveText('이수 완료');
  await expect(primary.locator('.sc-row')).toHaveText('1/11과목');
  await expect(page.locator('.remain-card .got')).toHaveText(earned);
  await page.reload();
  await primary.locator('.sc-row').click();
  await expect(item.locator('.sc-attending')).toHaveText('재수강 중');
  const saved = await readState(page);
  expect(saved.courses.find((c) => c.origin === 'timetable')?.isRetake).toBe(true);
  expect(saved.courses.find((c) => c.id === 'past')?.earnedInclusion).toBe('included');
  await tab(page, '학점 계산').click();
  await page.locator('.term-card.current .term-row').getByRole('button').click();
  const courseEditor = page.getByRole('dialog', { name: '과목 수정' });
  await expect(courseEditor.getByRole('checkbox', { name: '재수강 과목이에요' })).toBeChecked();
  await courseEditor.getByRole('spinbutton', { name: '학점', exact: true }).fill('3');
  await courseEditor.getByRole('button', { name: '저장', exact: true }).click();
  await expect(courseEditor).toBeHidden();
  expect((await readState(page)).courses.find((c) => c.origin === 'timetable')?.isRetake).toBe(true);
  const expectedGrade = page.getByRole('combobox', { name: '지역과지역학 예상 등급' });
  await expectedGrade.selectOption('A0');
  await expect(page.locator('.gpa-card.light .gpa-num')).toHaveText('3.00');
  await expect(page.locator('.gpa-card.dark .gpa-num')).toHaveText('4.00');
  await expectedGrade.selectOption('F');
  await expect(page.locator('.gpa-card.dark .gpa-num')).toHaveText('0.00');
  await tab(page, '학사 현황').click();
  await primary.locator('.sc-row').click();
  await expect(item.locator('.sc-done')).toHaveText('이수 완료');
  await expect(item.locator('.sc-attending')).toHaveText('재수강 중');
  await expect(page.locator('.remain-card .got')).toHaveText(earned);
  await tab(page, '학점 계산').click();
  await expectedGrade.selectOption('A0');
  await expect(page.locator('.gpa-card.dark .gpa-num')).toHaveText('4.00');
  await page.reload();
  await tab(page, '학점 계산').click();
  await expect(page.locator('.gpa-card.dark .gpa-num')).toHaveText('4.00');
  await tab(page, '시간표').click();
  await page.locator('.tt-blk').click();
  const edit = page.getByRole('dialog', { name: '시험 정보', exact: true });
  await edit.getByRole('checkbox', { name: '재수강 과목이에요' }).uncheck();
  await edit.getByRole('button', { name: '시험 정보 추가', exact: true }).click();
  await expect(page.locator('.tt-retake')).toHaveCount(0);
  await tab(page, '학점 계산').click();
  await expect(page.locator('.gpa-card.dark .gpa-num')).toHaveText('3.50');
});

test('F 과목 재수강 예상 성적을 선택해도 전공필수는 이수 완료로 바뀌지 않는다', async ({ page }, testInfo) => {
  await seed(page, '지역과지역학', 'F');
  const earned = await page.locator('.remain-card .got').innerText();
  const progress = await page.getByRole('progressbar', { name: '전체 이수 진행률' }).getAttribute('aria-valuenow');
  await tab(page, '시간표').click();
  await addClass(page, '지역과지역학', 0, '3');
  await tab(page, '학점 계산').click();
  await page.getByRole('combobox', { name: '지역과지역학 예상 등급' }).selectOption('A0');
  await expect(page.locator('.gpa-card.light .gpa-num')).toHaveText('0.00');
  await expect(page.locator('.gpa-card.dark .gpa-num')).toHaveText('4.00');
  await tab(page, '학사 현황').click();
  const primary = page.locator('#st-courses .sc').first();
  await primary.locator('.sc-row').click();
  const item = primary.locator('.sc-item').filter({ hasText: '지역과지역학' });
  await expect(item.locator('.sc-attending')).toHaveText('재수강 중');
  await expect(item.locator('.sc-done')).toHaveCount(0);
  await expect(primary.locator('.sc-row')).toHaveText('0/11과목');
  await expect(page.locator('.remain-card .got')).toHaveText(earned);
  await expect(page.getByRole('progressbar', { name: '전체 이수 진행률' })).toHaveAttribute('aria-valuenow', progress!);
  await page.setViewportSize({ width: 320, height: 820 });
  await item.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('failed-required-retake-320.png') });
  const saved = await readState(page);
  expect(saved.courses.find((c) => c.id === 'past')?.grade).toBe('F');
  expect(saved.courses.find((c) => c.origin === 'timetable')?.replacesCourseId).toBe('past');
});

test('이전 기록 없는 재수강은 계산을 보류하고 직접 연결하면 예상 계산한다', async ({ page }) => {
  await seed(page);
  await tab(page, '시간표').click();
  await page.locator('.tt-grid .tt-cell:not(.hour)').first().click();
  await page.getByRole('alertdialog').getByRole('button', { name: '시간표 추가', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: '수업 정보', exact: true });
  await sheet.getByLabel('과목명').fill('이름이 바뀐 과목');
  await sheet.getByLabel('학점 (선택)').fill('3');
  await sheet.getByRole('checkbox', { name: '재수강 과목이에요' }).check();
  await sheet.getByRole('button', { name: '수업 시간표 추가', exact: true }).click();
  await tab(page, '학점 계산').click();
  await page.getByRole('combobox', { name: '이름이 바뀐 과목 예상 등급' }).selectOption('A0');
  await expect(page.getByRole('alert')).toContainText('이전 기록');
  await expect(page.locator('.gpa-card.dark .gpa-num')).toHaveText('—');
  await page.locator('.term-card.current .name-btn').click();
  const editor = page.getByRole('dialog', { name: '과목 수정' });
  await editor.getByRole('combobox', { name: '대체하는 이전 기록' }).click();
  await editor.getByRole('option', { name: /합성 이전 성적/ }).click();
  await editor.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.locator('.gpa-card.dark .gpa-num')).toHaveText('4.00');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('시간표 등록 → 학점 계산 연결·예상 등급 변경·새로고침·삭제 반영', async ({ page }, testInfo) => {
  await seed(page);
  await tab(page, '시간표').click();
  await addClass(page, '합성 시간표 수업', 0, '3');
  await addClass(page, '합성 시간표 수업', 2); // 요일이 두 개여도 한 과목이다.
  await tab(page, '학점 계산').click();
  const rows = page.locator('.term-card.current .term-row');
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('(3학점)');
  await expect(page.locator('.term-card.current .term-foot')).toHaveText('총 3학점');
  const grade = rows.getByRole('combobox', { name: '합성 시간표 수업 예상 등급' });
  await grade.selectOption('A+');
  await expect(page.locator('.gpa-card.light .gpa-num')).toHaveText('3.00');
  await expect(page.locator('.gpa-card.dark .gpa-num')).toHaveText('3.75');
  await expect(page.locator('.term-card.current .term-head')).toContainText('4.50');
  await grade.selectOption('B0');
  await expect(page.locator('.gpa-card.dark .gpa-num')).toHaveText('3.00');
  await page.reload();
  await expect(grade).toHaveValue('B0');
  await expect(page.locator('.gpa-card.dark .gpa-num')).toHaveText('3.00');
  const state = await readState(page);
  const scheduled = state.courses.find((c) => c.name === '합성 시간표 수업')!;
  expect(scheduled.grade).toBeNull();
  expect(scheduled.status).toBe('inProgress');
  expect(scheduled.earnedInclusion).toBe('excluded');
  await page.screenshot({ path: testInfo.outputPath('calculator-390.png') });
  await tab(page, '시간표').click();
  for (let i = 0; i < 2; i++) {
    await page.locator('.tt-del').first().click();
    await page.getByRole('alertdialog').getByRole('button', { name: '시간표 삭제', exact: true }).click();
  }
  await tab(page, '학점 계산').click();
  await expect(rows).toHaveCount(0);
  await expect(page.locator('.gpa-card.dark .gpa-num')).toHaveText('—');
});

test('학점 없이 등록했던 시간표 과목도 학점을 보충해 예상 계산할 수 있다', async ({ page }) => {
  await seed(page);
  await tab(page, '시간표').click();
  await addClass(page, '합성 학점 미입력', 1);
  await tab(page, '학점 계산').click();
  const row = page.locator('.term-card.current .term-row');
  await expect(row).toContainText('학점 입력');
  await expect(row.getByRole('combobox')).toBeDisabled();
  await row.getByRole('button').click();
  const editor = page.getByRole('dialog', { name: '과목 수정' });
  await editor.getByRole('spinbutton', { name: '학점', exact: true }).fill('2');
  await editor.getByRole('button', { name: '저장', exact: true }).click();
  await expect(editor).toBeHidden();
  await row.getByRole('combobox').selectOption('A+');
  await expect(page.locator('.gpa-card.dark .gpa-num')).toHaveText('3.60');
  await expect(page.locator('.term-card.current .term-foot')).toHaveText('총 2학점');
});
