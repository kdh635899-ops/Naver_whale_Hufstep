import { expect, test } from '@playwright/test';
import { emptyState } from '../../src/domain/state';

test.use({ viewport: { width: 390, height: 650 } });

test('내 정보 수정의 모든 메뉴가 아래로 펼쳐지고 키보드 선택이 저장된다', async ({ page }) => {
  await page.goto('http://127.0.0.1:4173/sidebar.html');
  const state = emptyState();
  state.profile = {
    schemaVersion: 1, homeCampus: 'seoul', cohortYear: 2024, currentYear: 3,
    entryType: 'freshman', primaryDepartmentId: 'seoul-malay-indonesian',
    programType: 'double', secondaryDepartmentId: 'seoul-business',
    currentTerm: { academicYear: 2026, semester: '2' },
  };
  state.settings.lastView = 'mypage';
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
  await page.getByRole('button', { name: '학적 정보 수정하기' }).click();
  const dialog = page.getByRole('dialog', { name: '내 정보 수정' });
  await dialog.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((animation) => animation.finished)));
  const controls = dialog.getByRole('combobox');
  await expect(controls).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const control = controls.nth(i);
    await control.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const entry = dialog.getByRole('combobox', { name: '입학유형' });
    const before = await entry.boundingBox();
    await control.click();
    const list = dialog.getByRole('listbox');
    await expect(list).toBeVisible();
    const triggerBox = await control.boundingBox();
    const listBox = await list.boundingBox();
    expect(listBox!.y).toBeGreaterThanOrEqual(triggerBox!.y + triggerBox!.height);
    // 펼쳐도 아래 입력칸의 위치가 바뀌지 않아야 한다.
    const after = await entry.boundingBox();
    expect(after!.y).toBeCloseTo(before!.y, 0);
    {
      // 주전공·이중전공을 포함한 모든 메뉴의 양 끝 항목이 온전히 보여야 한다.
      await list.hover();
      for (const edge of ['start', 'end'] as const) {
        await page.mouse.wheel(0, edge === 'start' ? -20000 : 20000);
        await expect.poll(() => list.evaluate((el, side) => side === 'start' ? el.scrollTop
          : Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop), edge)).toBeLessThanOrEqual(1);
        const panel = await list.boundingBox();
        const option = await (edge === 'start' ? list.getByRole('option').first() : list.getByRole('option').last()).boundingBox();
        expect(option!.y).toBeGreaterThanOrEqual(panel!.y + 1);
        expect(option!.y + option!.height).toBeLessThanOrEqual(panel!.y + panel!.height - 1);
      }
    }
    await control.press('Escape');
    await expect(list).toHaveCount(0);
    await expect(dialog).toBeVisible();
    if (i === 1) {
      // 주전공의 마지막 학과도 실제 선택할 수 있는지 확인하고 원래 값으로 돌린다.
      const original = await control.innerText();
      await control.click();
      const lastDepartment = list.getByRole('option').last();
      const name = await lastDepartment.innerText();
      await list.hover();
      await page.mouse.wheel(0, 20000);
      await lastDepartment.click();
      await expect(control).toHaveText(name);
      await control.click();
      await list.getByRole('option', { name: original, exact: true }).click();
      await expect(control).toHaveText(original);
    }
  }
  const year = dialog.getByRole('combobox', { name: '현재 학년' });
  await year.press('ArrowDown');
  await year.press('End');
  await year.press('Enter');
  await expect(year).toHaveText('4학년');
  await dialog.getByRole('combobox', { name: '학번', exact: true }).click();
  const cohortList = dialog.getByRole('listbox', { name: '학번', exact: true });
  // 휠로 맨 위까지 올렸을 때 선택된 학번 쪽으로 되돌아가지 않아야 한다.
  await cohortList.hover();
  await page.mouse.wheel(0, 800);
  await expect.poll(() => cohortList.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await page.mouse.wheel(0, -1600);
  await expect.poll(() => cohortList.evaluate((el) => el.scrollTop)).toBe(0);
  await expect(async () => {
    const panel = await cohortList.boundingBox();
    const firstYear = await dialog.getByRole('option', { name: '19학번', exact: true }).boundingBox();
    expect(firstYear!.y).toBeGreaterThanOrEqual(panel!.y + 1);
    expect(firstYear!.y + firstYear!.height).toBeLessThanOrEqual(panel!.y + panel!.height - 1);
  }).toPass();
  // 미선택 상태에서도 맨 아래 26학번까지 내려갈 수 있어야 한다.
  await dialog.getByRole('option', { name: '선택', exact: true }).click();
  await dialog.getByRole('combobox', { name: '학번', exact: true }).click();
  await cohortList.hover();
  await page.mouse.wheel(0, 1600);
  await expect.poll(() => cohortList.evaluate((el) => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop))).toBeLessThanOrEqual(1);
  const bottomPanel = await cohortList.boundingBox();
  const lastYear = await dialog.getByRole('option', { name: '26학번', exact: true }).boundingBox();
  expect(lastYear!.y).toBeGreaterThanOrEqual(bottomPanel!.y + 1);
  expect(lastYear!.y + lastYear!.height).toBeLessThanOrEqual(bottomPanel!.y + bottomPanel!.height - 1);
  // 이후 키보드 이동도 그대로 동작한다.
  await dialog.getByRole('combobox', { name: '학번', exact: true }).press('End');
  await dialog.getByRole('option', { name: '23학번', exact: true }).click();
  await dialog.getByRole('button', { name: '저장', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.info-row').filter({ hasText: '학번 / 현재 학년' })).toContainText('23학번 / 4학년');
  await page.reload();
  await expect(page.locator('.info-row').filter({ hasText: '학번 / 현재 학년' })).toContainText('23학번 / 4학년');
});
