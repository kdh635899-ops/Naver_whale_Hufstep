// 종정시 개인별시간표 붙여넣기 → 미리보기·취소·확정 → 중복 방지 → 학사현황 예정 학점, 시간표 스크롤·칸 끌기 등록을 합성 자료로 검사한다.
import { expect, test, type Page } from '@playwright/test';
import { CONSENT_VERSION, emptyState, type AppState } from '../../src/domain/state';

test.use({ baseURL: 'http://127.0.0.1:4173', viewport: { width: 390, height: 820 } });

async function seed(page: Page) {
  await page.clock.setFixedTime(new Date('2026-11-15T03:00:00Z'));
  const state = emptyState();
  state.profile = { schemaVersion: 1, homeCampus: 'seoul', cohortYear: 2024, entryType: 'freshman',
    primaryDepartmentId: 'seoul-malay-indonesian', programType: 'double', secondaryDepartmentId: 'seoul-business',
    currentYear: 3, currentTerm: { academicYear: 2026, semester: '2' },
    facts: { foreignLanguageSpecialAdmission: false, pureForeignAdmission: false } };
  state.consent.academicData = { version: CONSENT_VERSION, at: '2026-11-15T03:00:00Z' };
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

// 종정시 표 모양의 합성 HTML: 교시 머리 칸, 빈 칸, rowspan으로 이어진 수업, 범위 밖(13교시) 수업
const HTML = `<table><tbody>
<tr><th>교시</th><th>월</th><th>화</th><th>수</th><th>목</th><th>금</th></tr>
<tr><td>1교시</td><td rowspan="2">가상 전공 A<br>(본관 101)</td><td></td><td>가상 전공 A<br>(본관 101)</td><td></td><td></td></tr>
<tr><td>2교시</td><td></td><td></td><td></td><td>가상 교양 B<br>(사회관 2)<br>2학점</td></tr>
<tr><td>13교시</td><td></td><td></td><td></td><td></td><td>가상 심야 C</td></tr>
</tbody></table>`;

async function openAndPaste(page: Page, html = HTML, text = '') {
  await page.getByRole('button', { name: '종정시 시간표 붙여넣기' }).click();
  const sheet = page.getByRole('dialog', { name: '시간표 가져오기' });
  await sheet.getByLabel('붙여넣기').evaluate((el, [h, t]) => {
    const data = new DataTransfer();
    if (h) data.setData('text/html', h);
    data.setData('text/plain', t);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, [html, text]);
  return sheet;
}

async function confirmImport(page: Page) {
  const sheet = await openAndPaste(page);
  const a = sheet.locator('.tt-import-item').filter({ hasText: '가상 전공 A' });
  await a.getByText('3학점', { exact: true }).click();
  await a.getByLabel('학점 반영 영역').selectOption('primary');
  await sheet.locator('.tt-import-item').filter({ hasText: '가상 교양 B' }).getByLabel('학점 반영 영역').selectOption('liberalArts');
  await expect(sheet.locator('.tt-import-sum')).toHaveText('총 2과목 · 5학점');
  await sheet.getByRole('button', { name: '확정하고 반영' }).click();
  await expect(sheet).toBeHidden();
}

test('붙여넣기 미리보기·취소·확정·중복 방지·예정 학점 반영', async ({ page }, testInfo) => {
  await seed(page);
  const earned = await page.locator('.remain-card .got').innerText();
  await tab(page, '시간표').click();

  // 미리보기: 안내 문구, 원본 학점만 미리 선택, 범위 밖 안내, 빈 칸 보존(수요일)·연속 교시 병합(월 09:00~10:50)
  // 붙여넣기 단계에서 종정시로 가는 링크 (새 탭, 앱은 접속하지 않음)
  await page.getByRole('button', { name: '종정시 시간표 붙여넣기' }).click();
  const link = page.getByRole('dialog', { name: '시간표 가져오기' }).getByRole('link', { name: '종합정보시스템 바로가기 →' });
  await expect(link).toHaveAttribute('href', 'https://wis.hufs.ac.kr/src08/jsp/index.jsp');
  await expect(link).toHaveAttribute('target', '_blank');
  await page.getByRole('dialog', { name: '시간표 가져오기' }).getByRole('button', { name: '닫기' }).click();

  const sheet = await openAndPaste(page);
  await expect(sheet.getByRole('note')).toHaveText('수업 시간과 학점은 다를 수 있어요. 과목별 실제 학점을 확인해 주세요.');
  const a = sheet.locator('.tt-import-item').filter({ hasText: '가상 전공 A' });
  await expect(a).toContainText('월 09:00~10:50 · 본관 101 / 수 09:00~09:50 · 본관 101');
  await expect(a.getByRole('radio', { checked: true })).toHaveCount(0);
  await expect(sheet.locator('.tt-import-item').filter({ hasText: '가상 교양 B' }).getByRole('radio', { name: '2학점' })).toBeChecked();
  await expect(sheet).toContainText('가상 심야 C · 금 21:00~21:50');
  await page.screenshot({ path: testInfo.outputPath('import-preview.png') });

  // 학점·영역을 고르지 않으면 저장하지 않는다
  await sheet.getByRole('button', { name: '확정하고 반영' }).click();
  await expect(sheet.getByRole('alert')).toContainText('학점');

  // 취소(닫기): 아무것도 저장하지 않는다
  await sheet.getByRole('button', { name: '닫기' }).click();
  await expect(sheet).toBeHidden();
  expect((await readState(page)).courses).toHaveLength(0);

  // 확정 → 저장
  await confirmImport(page);
  let state = await readState(page);
  expect(state.courses.map((c) => [c.name, c.creditUnits, c.area])).toEqual([['가상 전공 A', 300, 'primary'], ['가상 교양 B', 200, 'liberalArts']]);
  expect(state.classTimes).toHaveLength(3);

  // 메모를 남긴 뒤 같은 표를 다시 넣어도 과목·시간이 늘지 않고 메모가 남는다
  const memoTarget = state.courses[0].id;
  await page.locator(`[data-course="${memoTarget}"]`).first().click();
  const exam = page.getByRole('dialog', { name: '시험 정보' });
  await exam.getByLabel('내 메모').fill('합성 메모');
  await exam.getByRole('button', { name: '시험 정보 추가' }).click();
  await expect(exam).toBeHidden();
  await page.locator('.tt').screenshot({ path: testInfo.outputPath('timetable-with-info.png') });
  await confirmImport(page);
  state = await readState(page);
  expect(state.courses).toHaveLength(2);
  expect(state.classTimes).toHaveLength(3);
  expect(state.courseMemos).toEqual([expect.objectContaining({ courseId: memoTarget, text: '합성 메모' })]);

  // 학사현황: 이번 학기 5학점을 합계에 하나로 합친다 (붙여넣기 전에는 기록이 없었다)
  expect(earned).toBe('종정시 정보를 저장하면 표시돼요');
  await tab(page, '학사 현황').click();
  await expect(page.locator('.remain-card .got')).toHaveText('5/134 학점 취득 (이번 학기 포함)');
  await expect(page.locator('.area-row').filter({ hasText: '주전공' })).toContainText('3/54학점');
  await expect(page.locator('.area-row').filter({ hasText: '교양' })).toContainText('2/32학점');
  await page.screenshot({ path: testInfo.outputPath('status-planned.png'), fullPage: true });
});

test('시간 눈금 끌기·휠 스크롤, 칸 끌기 등록은 그대로', async ({ page }) => {
  await seed(page);
  await tab(page, '시간표').click();
  const scroller = page.locator('.tt-scroll');
  expect((await scroller.boundingBox())!.height).toBe(560); // 보이는 높이는 예전(8시간)과 같다
  await expect(page.locator('.tt-cell.hour')).toHaveText(['9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20']);

  // 왼쪽 눈금을 위로 끌면 늦은 시간이 보인다
  const gutter = (await page.locator('.tt-cell.hour').nth(5).boundingBox())!;
  await page.mouse.move(gutter.x + 10, gutter.y + 30);
  await page.mouse.down();
  await page.mouse.move(gutter.x + 10, gutter.y - 120, { steps: 6 });
  await page.mouse.up();
  expect(await scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
  await page.waitForTimeout(400);
  await expect(page.getByRole('alertdialog')).toHaveCount(0); // 눈금 끌기는 칸 고르기가 아니다

  // 휠
  await scroller.evaluate((el) => { el.scrollTop = 0; });
  await scroller.hover();
  await page.mouse.wheel(0, 300);
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);

  // 스크롤된 상태에서 화요일 17~19시를 끌어 등록 → 보이는 시각 그대로 저장
  const cell = page.locator('.tt-grid .tt-cell:not(.hour)').nth(5 * 8 + 1); // 17시 행, 화요일
  await cell.scrollIntoViewIfNeeded();
  const first = (await cell.boundingBox())!;
  await page.mouse.move(first.x + first.width / 2, first.y + 10);
  await page.mouse.down();
  await page.mouse.move(first.x + first.width / 2, first.y + 80, { steps: 5 });
  await page.mouse.up();
  await page.getByRole('alertdialog').getByRole('button', { name: '시간표 추가', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: '수업 정보', exact: true });
  await sheet.getByLabel('과목명').fill('가상 저녁 수업');
  await sheet.getByRole('button', { name: '수업 시간표 추가', exact: true }).click();
  await expect(sheet).toBeHidden();
  expect((await readState(page)).classTimes).toEqual([expect.objectContaining({ day: 1, start: '17:00', end: '19:00' })]);
});

// 종정시를 일반 텍스트로 복사한 모양 (합성): 칸 안 줄바꿈, 빈 칸, 긴 과목명, 3교시 연강
const TEXT = [
  '2026년도 2학기 신청학점수: 9학점', 'Print Print Tip', '개인별시간표 조회', '\t월\t화\t수\t목\t금\t토',
  ...[1, 2].map((n) => `${n}\t가상회화실습(2)\n(가상관1211)\t가상초급회화2\n(가상관1211)\t가상지역학\n(가상관1210)\t\t\t`),
  '3\t가상비교\n(가상관1211)\t\t가상지역학\n(가상관1210)\t가상중급작문(2)\n(가상관1211)\t\t',
  ...[7, 8, 9].map((n) => `${n}\t가상세계역사와문화:가상국가,가상국가,가상국가\n(가상관1302)\t\t\t\t\t`),
  '10\t\t\t\t\t\t',
].join('\n');

test('일반 텍스트 복사(칸 안 줄바꿈)도 요일·교시대로 들어가고 블록이 겹치지 않는다', async ({ page }, testInfo) => {
  await seed(page);
  await page.setViewportSize({ width: 360, height: 820 });
  await tab(page, '시간표').click();
  const sheet = await openAndPaste(page, '', TEXT);
  await expect(sheet.locator('.tt-import-item')).toHaveCount(6);
  await expect(sheet.getByText('해석하지 못한 행', { exact: false })).toHaveCount(0);
  await expect(sheet.locator('.tt-import-item').filter({ hasText: '가상지역학' })).toContainText('수 09:00~11:50 · 가상관1210');
  // 영역은 학사정보의 전공과 교양·자유선택만, 기본은 주전공
  const area = sheet.locator('.tt-import-item').first().getByLabel('학점 반영 영역');
  await expect(area).toHaveValue('primary');
  await expect(area.locator('option')).toHaveText(['주전공 · 말레이·인도네시아어과', '이중전공 · 경영학부', '교양', '자유선택']);
  for (const item of await sheet.locator('.tt-import-item').all()) await item.getByText('2학점', { exact: true }).click();
  await expect(sheet.locator('.tt-import-sum')).toHaveText('총 6과목 · 12학점');
  await page.screenshot({ path: testInfo.outputPath('import-text-360.png') });
  // 새 팝업의 토글·선택 상자도 앱 글씨체(Pretendard)를 쓴다
  for (const el of [sheet.locator('.seg label').first(), area, sheet.locator('.tt-import-sum'), sheet.getByRole('button', { name: '확정하고 반영' })]) {
    expect(await el.evaluate((n) => getComputedStyle(n).fontFamily)).toMatch(/^"?Pretendard/);
  }
  await sheet.getByRole('button', { name: '확정하고 반영' }).click();
  await expect(sheet).toBeHidden();

  // 블록끼리 겹치지 않는다
  const boxes = await page.locator('.tt-blk').evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }));
  expect(boxes).toHaveLength(6);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const [a, b] = [boxes[i], boxes[j]];
    expect(a[0] < b[2] - 1 && b[0] < a[2] - 1 && a[1] < b[3] - 1 && b[1] < a[3] - 1, `${i}·${j} 겹침`).toBe(false);
  }
  // 블록 안에서도 과목명·시험정보 추가·삭제 아이콘이 겹치지 않는다 (50분 블록 포함)
  for (const blk of await page.locator('.tt-blk').all()) {
    const [nm, add, del] = await Promise.all(['.nm', '.tt-add', '.tt-del'].map((q) => blk.locator(q).boundingBox()));
    expect(nm!.y + nm!.height).toBeLessThanOrEqual(add!.y + 1);
    const icon = (await blk.locator('.tt-add .icon').boundingBox())!;
    expect(icon.x + icon.width <= del!.x || icon.y >= del!.y + del!.height || icon.y + icon.height <= del!.y).toBe(true);
  }
  // 시간표 블록 글자: 모든 블록에서 같은 글씨체·크기 (과목명 11px, 시험정보 추가 9px)
  const fonts = await page.locator('.tt-blk').evaluateAll((els) => els.map((el) => {
    const nm = getComputedStyle(el.querySelector('.nm')!), add = getComputedStyle(el.querySelector('.tt-add')!);
    return [nm.fontFamily.split(',')[0], nm.fontSize, add.fontFamily.split(',')[0], add.fontSize];
  }));
  expect(new Set(fonts.map((f) => f.join('|')))).toEqual(new Set([`${fonts[0][0]}|11px|${fonts[0][0]}|9px`]));
  expect(fonts[0][0]).toMatch(/^"?Pretendard/);
  await page.screenshot({ path: testInfo.outputPath('timetable-360.png'), fullPage: true });
});
