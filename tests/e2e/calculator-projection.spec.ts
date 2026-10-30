// 합성 성적과 새 브라우저 저장소로 시간표 → 예상 평점 → 재접속 흐름을 확인한다.
import { expect, test, type Page } from '@playwright/test';
import { emptyState, type AppState } from '../../src/domain/state';
import { course, T26_2 } from '../fixtures';

function initialState(): AppState {
  const current = course({ id: 'scheduled', name: '예상 계산 검증 과목', term: T26_2,
    origin: 'timetable', status: 'inProgress', gradingMode: 'graded' });
  return { ...emptyState(),
    profile: { schemaVersion: 1, homeCampus: 'seoul', cohortYear: 2024, currentYear: 3,
      entryType: 'freshman', primaryDepartmentId: 'seoul-business', programType: 'single', currentTerm: T26_2 },
    courses: [course({ id: 'past', grade: 'B0' }), current],
    classTimes: [{ courseId: current.id, day: 0, start: '09:00', end: '10:00' }],
    settings: { ...emptyState().settings, lastView: 'calculator' },
  };
}

async function seed(page: Page, state: AppState) {
  await page.goto('http://127.0.0.1:4173/sidebar.html');
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
  await expect(page.getByRole('heading', { name: '학점 계산', exact: true })).toBeVisible();
}

test('시간표 예상 등급 변경·해제·재접속, 실제 평점 보존', async ({ page }) => {
  await seed(page, initialState());
  const grade = page.getByRole('combobox', { name: '예상 계산 검증 과목 예상 등급' });
  const projected = page.locator('.gpa-card.dark .gpa-num');
  await expect(projected).toHaveText('—');
  await grade.selectOption('A+');
  await expect(projected).toHaveText('3.75');
  await expect(page.locator('.gpa-card.light .gpa-num')).toHaveText('3.00');
  await grade.selectOption('F');
  await expect(projected).toHaveText('1.50');
  await grade.selectOption('');
  await expect(projected).toHaveText('—');
  await grade.selectOption('A0');
  await expect(projected).toHaveText('3.50');
  await page.reload();
  await expect(grade).toHaveValue('A0');
  await expect(projected).toHaveText('3.50');
  await expect(page.locator('.gpa-card.light .gpa-num')).toHaveText('3.00');
});

for (const summary of [false, true]) {
  test(`과거 상세 성적 누락: 요약 평점 ${summary ? '있음' : '없음'}`, async ({ page }) => {
    const state = initialState();
    state.courses = state.courses.filter((c) => c.origin === 'timetable');
    state.snapshots = [{ id: 'summary', importedAt: '', source: 'summaryInput', courseIds: [],
      reportedEarnedByArea: {}, completeness: { earnedTotals: true, courses: false, gpa: false }, warnings: [],
      ...(summary ? { reportedGpa: { hundredths: 300, gpaUnits: 3000 } } : {}) }];
    await seed(page, state);
    await page.getByRole('combobox', { name: '예상 계산 검증 과목 예상 등급' }).selectOption('A+');
    await expect(page.locator('.term-card.current .term-head')).toContainText('4.50');
    await expect(page.locator('.gpa-card.dark .gpa-num')).toHaveText(summary ? '3.13' : '—');
    await expect(page.getByText(summary ? '예상 누적 평점은 기존 요약 평점과' : '기존 성적 자료가 불완전해', { exact: false })).toBeVisible();
  });
}
