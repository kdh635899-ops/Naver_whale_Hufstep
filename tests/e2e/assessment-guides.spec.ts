// 기존 UI로 안내 확인·직접 추가·체크·재접속을 검사한다. 실제 학생 저장소는 사용하지 않는다.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { scopeStatusEdits } from '../../src/domain/requirements/statusEdits';
import { emptyState, type AppState } from '../../src/domain/state';
import type { StudentProfile } from '../../src/domain/types';

test.use({ viewport: { width: 390, height: 820 } });
const base: StudentProfile = { schemaVersion: 1, homeCampus: 'seoul', cohortYear: 2024, entryType: 'freshman',
  primaryDepartmentId: 'seoul-malay-indonesian', secondaryDepartmentId: 'seoul-business', programType: 'double',
  currentYear: 3, currentTerm: { academicYear: 2026, semester: '2' } };
async function seed(page: Page, state: AppState) {
  await page.goto('http://127.0.0.1:4173/sidebar.html');
  await page.evaluate((value) => new Promise<void>((resolve, reject) => {
    const r = indexedDB.open('hufstep', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => {
      const tx = r.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(value, 'appState');
      tx.oncomplete = () => { r.result.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    };
  }), scopeStatusEdits(state));
  await page.reload();
  await expect(page.getByRole('heading', { name: '내 학사현황' })).toBeVisible();
}
const examCard = (page: Page, index: number) => page.locator('#st-exams .sc-list > .sc').nth(index);

for (const role of ['primary', 'dual'] as const) {
  test(`${role}: 기존 카드에서 안내를 보고 시험 직접 추가·체크·재접속`, async ({ page }, info) => {
    const profile = role === 'primary' ? base : { ...base, primaryDepartmentId: 'seoul-business', secondaryDepartmentId: base.primaryDepartmentId };
    await seed(page, { ...emptyState(), profile });
    const index = role === 'primary' ? 0 : 1;
    const card = examCard(page, index);
    const guidance = page.locator('#st-exams .sc-check-hint').filter({ hasText: 'FLEX 마인어' });
    await expect(guidance).toHaveCount(0);
    await card.locator('.sc-row').click();
    await expect(guidance).toContainText(role === 'primary' ? '600점 이상' : '500점 이상');
    await expect(guidance).not.toContainText('추가 입력 필요');
    await expect(card.getByRole('link', { name: '학과 공식 안내' })).toBeVisible();
    await card.locator('.sc-row').click();
    await expect(guidance).toHaveCount(0);
    await expect(card.getByRole('link', { name: '학과 공식 안내' })).toHaveCount(0);
    await card.locator('.sc-row').click();
    await expect(card.getByRole('checkbox')).toHaveCount(0);
    await card.getByRole('button', { name: '졸업 시험 추가하기', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '졸업 시험 추가' });
    await dialog.getByLabel('시험명', { exact: true }).fill('직접 관리할 FLEX');
    await dialog.getByLabel('점수 요건', { exact: true }).fill('합성 시험 기준');
    await dialog.getByRole('button', { name: '해당 시험 정보 추가하기' }).click();
    await expect(card.locator('.sc-state')).toHaveText('미이수');
    const check = card.getByRole('checkbox', { name: '직접 관리할 FLEX 응시·통과 체크' });
    await check.click(); await expect(check).toBeChecked();
    await expect(card).toContainText('이수 완료');
    await page.reload();
    await card.locator('.sc-row').click(); await expect(check).toBeChecked();
    await expect(card).toContainText('합성 시험 기준');
    await expect(guidance).toContainText('FLEX 마인어');
    await page.screenshot({ path: info.outputPath(`${role}-existing-ui.png`), fullPage: true });
  });
}

test('부전공 의무 없음은 안내로 표시하고 카드 안의 시험 추가만 제공한다', async ({ page }) => {
  const departments = JSON.parse(readFileSync('src/data/departments.json', 'utf8')) as { id: string; name: string }[];
  const french = departments.find((d) => d.name === '프랑스어학부')!;
  await seed(page, { ...emptyState(), profile: { ...base, programType: 'minor', secondaryDepartmentId: french.id } });
  await expect(examCard(page, 1).locator('.sc-check-hint')).toHaveCount(0);
  await examCard(page, 1).locator('.sc-row').click();
  await expect(examCard(page, 1).locator('.sc-check-hint')).toContainText('의무 없음');
  await expect(examCard(page, 1).getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '졸업 요건 추가하기', exact: true })).toHaveCount(0);
  await expect(examCard(page, 1).getByRole('button', { name: '졸업 시험 추가하기', exact: true })).toBeVisible();
});

test('기존 사용자 시험과 수정·체크한 학과 항목은 그대로 관리할 수 있다', async ({ page }) => {
  const state = scopeStatusEdits({ ...emptyState(), profile: { ...base,
    facts: { foreignLanguageSpecialAdmission: false, pureForeignAdmission: false, approvedRequiredCourseWaiver: false } } });
  state.statusEdits!.extraExams = [{ id: 'saved-exam', card: 'primary', title: '저장해 둔 시험', detail: '기존 점수' }];
  state.statusEdits!.renamed = { 'core-malay-flex-primary': '이름을 수정했던 시험' };
  state.statusEdits!.redetailed = { 'core-malay-flex-primary': '내가 고친 기준 700' };
  state.certConfirmations = [{ requirementId: 'saved-exam', confirmedAt: '' }, { requirementId: 'core-malay-flex-primary', confirmedAt: '' }];
  await seed(page, state);
  const card = examCard(page, 0);
  await card.locator('.sc-row').click();
  await expect(card.getByRole('checkbox', { name: '저장해 둔 시험 응시·통과 체크' })).toBeChecked();
  await expect(card.getByRole('checkbox', { name: '이름을 수정했던 시험 응시·통과 체크' })).toBeChecked();
  await expect(card).toContainText('기존 점수');
  // 학생이 고친 요건은 '내가 수정함'으로 구분하고, 원래 학교 기준도 회색 한 줄로 함께 둔다
  const edited = card.locator('.sc-item').filter({ hasText: '이름을 수정했던 시험' });
  await expect(edited).toContainText('내가 고친 기준 700');
  await expect(edited).toContainText('내가 수정함');
  await expect(edited).toContainText('원래 기준:');
  // 편집 모드에서 기본(학교 자료) 시험의 요건도 고칠 수 있다
  await card.getByRole('button', { name: '이름 고치기', exact: true }).click();
  const criteria = card.getByLabel(/이름을 수정했던 시험.*합격 기준/);
  await expect(criteria).toHaveValue('내가 고친 기준 700');
  await criteria.fill('다시 고친 기준 800');
  await criteria.press('Enter');
  await card.getByRole('button', { name: '이름 고치기', exact: true }).click();
  await expect(edited).toContainText('다시 고친 기준 800');
  await page.reload();
  await examCard(page, 0).locator('.sc-row').click();
  await expect(examCard(page, 0).locator('.sc-item').filter({ hasText: '이름을 수정했던 시험' })).toContainText('다시 고친 기준 800');
});
