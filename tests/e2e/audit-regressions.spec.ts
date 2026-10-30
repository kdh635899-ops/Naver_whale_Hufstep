// Playwright의 새 context와 합성 상태만 사용한다. 평소 브라우저·확장 저장소는 읽지 않는다.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { buildOfficialReport, linkableLeaves } from '../../src/domain/requirements/officialRules';
import { scopeStatusEdits } from '../../src/domain/requirements/statusEdits';
import { emptyState, type AppState } from '../../src/domain/state';
import type { CourseExpr, Department, DepartmentMeta, OfficialRule, RequirementBundle, StudentProfile, SupportGap } from '../../src/domain/types';
import { course, T26_2 } from '../fixtures';

test.use({ viewport: { width: 390, height: 820 } });
const readData = (name: string) => JSON.parse(readFileSync(`src/data/${name}.json`, 'utf8'));
const official = readData('official-rules');
const catalog = { departments: readData('departments') as Department[], departmentMeta: readData('department-meta') as DepartmentMeta[],
  bundles: readData('requirement-bundles') as RequirementBundle[], officialRules: official.rules as OfficialRule[], supportGaps: official.supportGaps as SupportGap[] };
const departmentMetaById = (id: string) => catalog.departmentMeta.find((d) => d.id === id);
const departmentFacts = (id: string) => {
  const d = catalog.departments.find((d) => d.id === id); const m = departmentMetaById(id);
  return d && { ...d, college: m?.college };
};
const id = (name: string) => catalog.departments.find((d) => d.name === name)!.id;
const base: StudentProfile = { schemaVersion: 1, homeCampus: 'seoul', cohortYear: 2024, currentYear: 3,
  entryType: 'freshman', primaryDepartmentId: 'seoul-malay-indonesian', programType: 'double', secondaryDepartmentId: 'seoul-business',
  currentTerm: T26_2, facts: { foreignLanguageSpecialAdmission: false, pureForeignAdmission: false } };
const report = (profile: StudentProfile) => buildOfficialReport({ profile, bundles: catalog.bundles, rules: catalog.officialRules,
  supportGaps: catalog.supportGaps, dept: departmentFacts, meta: departmentMetaById, today: '2026-10-30' });

async function seed(page: Page, state: AppState) {
  await page.goto(process.env.HUFSTEP_TEST_URL ?? 'http://127.0.0.1:4173/sidebar.html');
  await page.evaluate((value) => new Promise<void>((resolve, reject) => {
    const r = indexedDB.open('hufstep', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => {
      const tx = r.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(value, 'appState');
      tx.oncomplete = () => { r.result.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    };
  }), state);
  await page.reload(); await expect(page.getByRole('heading', { name: '내 학사현황' })).toBeVisible();
}
async function read(page: Page): Promise<AppState> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const r = indexedDB.open('hufstep', 1); r.onsuccess = () => {
      const tx = r.result.transaction('kv'); const get = tx.objectStore('kv').get('appState');
      get.onsuccess = () => { resolve(get.result); r.result.close(); }; get.onerror = () => reject(get.error);
    };
  }));
}
const stateFor = (profile: StudentProfile) => scopeStatusEdits({ ...emptyState(), profile });
const primary = (page: Page) => page.locator('#st-courses .sc').first();
const secondary = (page: Page) => page.locator('#st-courses .sc').nth(1);

test('LD 선발연도·졸업학기 저장, 즉시 재선택과 새로고침', async ({ page }, info) => {
  await seed(page, stateFor({ ...base, secondaryDepartmentId: id('Language & Diplomacy학부') }));
  await expect(page.getByLabel('이중전공을 선택(배정)받은 연도')).toHaveValue('');
  await page.getByLabel('이중전공을 선택(배정)받은 연도').selectOption('2022');
  await page.getByLabel('졸업 예정 학기 연도').selectOption('2025');
  await page.getByLabel('졸업 예정 학기 학기').selectOption('2');
  await expect(secondary(page)).toContainText('0/4과목');
  await page.getByLabel('이중전공을 선택(배정)받은 연도').selectOption('2023');
  await expect(secondary(page)).toContainText('0/5과목');
  await page.reload(); await expect(secondary(page)).toContainText('0/5과목');
  await expect(page.getByLabel('졸업 예정 학기 학기')).toHaveValue('2');
  await page.screenshot({ path: info.outputPath('ld-inputs.png'), fullPage: true });
  expect((await read(page)).profile!.facts).toMatchObject({ dualSelectionYear: 2023, graduationTerm: '2025-2' });
});

test('언어인지 선발연도 2024/2025 경계와 미정 복귀', async ({ page }, info) => {
  await seed(page, stateFor({ ...base, homeCampus: 'global', primaryDepartmentId: id('통계학과'), secondaryDepartmentId: id('언어인지과학과') }));
  const year = page.getByLabel('이중전공을 선택(배정)받은 연도');
  await year.selectOption('2024'); await expect(secondary(page)).toContainText('0/1과목');
  await year.selectOption('2025'); await expect(secondary(page)).toContainText('0/3과목');
  await page.screenshot({ path: info.outputPath('linguistics-inputs.png'), fullPage: true });
  await year.selectOption(''); await expect(secondary(page)).toContainText('확인 필요');
  await expect.poll(async () => (await read(page)).profile!.facts?.dualSelectionYear).toBeUndefined();
});

test('ELLT 학위과정 미정·BA·BLS 선택 후 목록 갱신', async ({ page }, info) => {
  await seed(page, stateFor({ ...base, secondaryDepartmentId: id('ELLT학과') }));
  const degree = page.getByLabel('학위 과정'); await expect(degree).toHaveValue('');
  await degree.selectOption({ label: 'BA' }); await expect(secondary(page)).toContainText('0/5과목');
  const exams = page.locator('#st-exams');
  const common = exams.locator('.sc').filter({ hasText: '학교 공통' });
  await common.locator('button.sc-row').click();
  await expect(common).toContainText('영어 졸업인증');
  await expect(common).toContainText('하나 선택');
  await expect(common).toContainText('FLEX 621점 이상');
  await expect(common).not.toContainText(/서울 비영어|numeric|OPIcOrderedLevel|학교 외국어 인증 · 언어: 영어 · 하나 선택/);
  await expect(common).not.toContainText(/일률적 2년 지정 안 함|본 기준표만으로|학과별 인정경로·점수는 별도 규칙 필요|graduation/);
  await expect(common).toContainText('제출일에 유효한 성적 필요');
  await expect(common).toContainText('FLEX'); await expect(common).toContainText('610점');
  await page.screenshot({ path: info.outputPath('ellt-common-language.png'), fullPage: true });
  await degree.selectOption({ label: 'BLS' }); await expect(secondary(page)).toContainText('0/6과목');
  await expect.poll(async () => (await read(page)).profile!.facts?.degreeTrack).toBe('BLS');
  await page.screenshot({ path: info.outputPath('ellt-inputs.png'), fullPage: true });
  await degree.selectOption(''); await expect(secondary(page)).toContainText('확인 필요');
});

test('편입 입력칸을 새로 만들지 않고 기존 학기·학년 답은 보존한다', async ({ page }, info) => {
  await seed(page, stateFor({ ...base, entryType: 'transferGeneral',
    facts: { ...base.facts, entryTerm: '2023-2', transferEntryGrade: 2 } }));
  await expect(page.getByLabel('입학(편입학) 학기 연도')).toHaveCount(0);
  await expect(page.getByLabel('편입 학년', { exact: true })).toHaveCount(0);
  await page.reload();
  expect((await read(page)).profile!.facts?.transferEntryGrade).toBe(2);
  expect((await read(page)).profile).toMatchObject({ cohortYear: 2024, facts: { entryTerm: '2023-2' } });
  await page.screenshot({ path: info.outputPath('transfer-inputs.png'), fullPage: true });
});

test('경영 택일 하나·전체 제외 후 9/10 유지, 같은 삭제 버튼으로 복구', async ({ page }) => {
  const p = { ...base, primaryDepartmentId: 'seoul-business', secondaryDepartmentId: 'seoul-malay-indonesian' };
  const r = report(p); const expr = r.courseRules.find((e) => e.rule.courses?.op === 'ALL' && e.rule.courses.items.some((n) => n.op === 'OR'))!.rule.courses!;
  const s = stateFor(p);
  if (expr.op !== 'ALL') throw new Error('경영 ALL 조건을 유지해야 함');
  s.certConfirmations = expr.items.filter((n) => n.op === 'course').map((n) => ({ requirementId: (n as { id: string }).id, confirmedAt: '2026-10-30' }));
  const choice = expr.items.find((n) => n.op === 'OR')!;
  const names = (n: CourseExpr): string[] => n.op === 'course' ? [n.name] : n.items.flatMap(names);
  await seed(page, s); await expect(primary(page)).toContainText('9/10과목');
  await primary(page).locator('.sc-row').click(); await primary(page).getByRole('button', { name: '지우기', exact: true }).click();
  for (const name of names(choice)) {
    await primary(page).getByRole('button', { name: `${name} 삭제`, exact: true }).click();
    await expect(page.getByRole('alertdialog')).toContainText(`‘${name}’`); await expect(page.getByRole('alertdialog')).toContainText('과목을 삭제하시겠습니까?');
    await page.getByRole('alertdialog').getByRole('button', { name: '삭제', exact: true }).click();
    await expect(primary(page)).toContainText('9/10과목');
  }
  await primary(page).getByRole('button', { name: `${names(choice)[0]} 복구`, exact: true }).click();
  await expect(primary(page)).toContainText('9/10과목');
});

test('ELLT 승인 안내는 직접 체크 후에도 유지, 학점·평점 불변', async ({ page }) => {
  const p = { ...base, primaryDepartmentId: id('ELLT학과'), facts: { ...base.facts, degreeTrack: 'BA' } };
  const leaf = linkableLeaves(report(p)).find(({ leaf }) => leaf.name === '고급영어문법(1)')!.leaf;
  const s = stateFor(p); s.courses = [course({ name: '고급영어문법', officialCode: leaf.code!, grade: 'A0', term: T26_2 })];
  await seed(page, s); const before = await page.locator('.remain-card').innerText();
  await primary(page).locator('.sc-row').click();
  const row = primary(page).locator('.sc-item').filter({ has: page.getByText('고급영어문법(1)', { exact: false }) }).first();
  await expect(row).toContainText('대체과목 인정에는 학과 승인이 필요해요. 승인받았는지 확인해 주세요.');
  await row.getByRole('button', { name: '고급영어문법(1) 이수', exact: true }).click();
  await expect(row).toContainText('이수 완료 · 직접 확인'); await expect(row).toContainText('학과 승인이 필요해요');
  expect(await page.locator('.remain-card').innerText()).toBe(before);
  expect((await read(page)).profile!.facts).not.toHaveProperty('approvedCourseReplacement');
});

test('직접 과목 삭제 시 체크 정리, 이름 수정은 ID 보존', async ({ page }) => {
  const s = stateFor(base); s.statusEdits!.extraCourses.push({ id: 'xc-fixed', card: 'primary', name: '가상 직접 과목' });
  await seed(page, s); await primary(page).locator('.sc-row').click();
  await primary(page).getByRole('button', { name: '가상 직접 과목 이수', exact: true }).click();
  await primary(page).getByRole('button', { name: '이름 고치기', exact: true }).click();
  const name = primary(page).getByRole('textbox', { name: '가상 직접 과목 이름' });
  await name.fill('수정한 이름'); await name.press('Enter');
  await expect.poll(async () => (await read(page)).statusEdits!.extraCourses[0]).toEqual({ id: 'xc-fixed', card: 'primary', name: '수정한 이름' });
  await primary(page).getByRole('button', { name: '지우기', exact: true }).click();
  await primary(page).getByRole('button', { name: '수정한 이름 삭제', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '삭제', exact: true }).click();
  await expect.poll(async () => (await read(page)).certConfirmations.some((c) => c.requirementId === 'xc-fixed')).toBe(false);
});

test('EICC 기타언어 한 묶음·영어 졸업평가 분리와 내부 코드 미노출', async ({ page }, info) => {
  await seed(page, stateFor({ ...base, primaryDepartmentId: id('영어통번역(EICC)학과') }));
  for (const button of await page.locator('#st-exams .sc-row').all()) await button.click();
  await expect(page.locator('#st-exams')).toContainText('80시간');
  await expect(page.locator('#st-exams')).toContainText('96시간');
  await expect(page.getByLabel('졸업인증 언어')).toHaveCount(0);
  await expect(page.locator('#st-exams')).not.toContainText(/languageTest|departmentExam|courseCredits|\[object Object\]/);
  await page.screenshot({ path: info.outputPath('eicc-criteria.png'), fullPage: true });
});
