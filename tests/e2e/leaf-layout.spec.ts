// 전필 과목 줄의 360px 레이아웃 검사 (실제 styles.css + 같은 마크업).
// 과거 버그: .req 격자의 18px 기호 칸에 긴 체크박스 문구가 들어가 한 글자씩 세로로 줄바꿈됐다.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const LEAF_ROWS = `
  <li class="req"><span aria-hidden="true">○</span><span class="name">말레이세계역사와문화: 말레이시아,싱가포르,브루나이</span>
    <button type="button" class="btn small self-check" aria-pressed="false">직접 체크</button><span class="small">미이수</span></li>
  <li class="req met"><span aria-hidden="true">✓</span><span class="name">초급마.인어(1)<span class="contact-checked"> 직접 확인</span></span>
    <button type="button" class="btn small self-check" aria-pressed="true">직접 체크</button><span class="small">이수</span></li>
  <li class="req met"><span aria-hidden="true">=</span><span class="name">초급마.인어회화작문(2)</span><span class="small">이름 일치 (개설학과·과목명)</span></li>`;

test('360px 사이드바에서 ‘직접 체크’ 버튼이 한 줄로 보이고 가로 스크롤이 없다', async ({ page }) => {
  const css = readFileSync('src/styles.css', 'utf8');
  await page.setViewportSize({ width: 360, height: 700 });
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>${css}</style><body><div class="card"><ul class="plain">${LEAF_ROWS}</ul></div></body>`);

  for (const btn of await page.locator('.self-check').all()) {
    const box = (await btn.boundingBox())!;
    expect(box.width, '버튼 너비 — 좁으면 글자가 세로로 쪼개진 것').toBeGreaterThan(60);
    expect(box.height, '버튼 높이 — 크면 여러 줄로 쪼개진 것').toBeLessThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.screenshot({ path: 'test-results/official-leaf-360.png', fullPage: true });
});
