// 전필 과목 줄의 360px 레이아웃 검사 (실제 styles.css + 같은 마크업).
// 과거 버그: .req 격자의 18px 기호 칸에 긴 체크박스 문구가 들어가 한 글자씩 세로로 줄바꿈됐다.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const LEAF_ROWS = `
  <li class="req"><span aria-hidden="true">○</span><span class="name">말레이세계역사와문화: 말레이시아,싱가포르,브루나이</span>
    <button type="button" class="btn small self-check" aria-pressed="false">직접 체크</button><span class="small">미이수</span></li>
  <li class="req met"><span aria-hidden="true">✓</span><span class="name">초급마.인어(1)</span>
    <button type="button" class="btn small self-check" aria-pressed="true">직접 체크</button>
    <span class="small">이수<span class="contact-checked"> · 내가 체크</span></span></li>
  <li class="req met"><span aria-hidden="true">✓</span><span class="name">초급마.인어회화작문(2)</span><span class="small">이수</span></li>`;

// 학교 확인이 필요한 줄: 회색 한 줄 이유 + ›, 펼치면 전화·메일만 (320px에서도 잘리지 않아야 한다)
const INQUIRY_ROW = `
  <li class="req inquiry"><span aria-hidden="true">○</span>
    <span class="name">졸업시험 또는 FLEX 몽골어 650점</span>
    <button type="button" class="btn small self-check" aria-pressed="false">통과했어요</button>
    <button type="button" class="link inquiry-why" aria-expanded="true">학번별 기준이 확실하지 않아요 <span aria-hidden="true">›</span></button>
    <div class="inquiry-detail"><p class="small">정확한 기준은 학과에 확인할 수 있어요</p>
      <p class="small">문의 전화 <a href="tel:0221732415">02-2173-2415</a></p>
      <p class="small">문의 메일 <a href="mailto:mgl@hufs.ac.kr">mgl@hufs.ac.kr</a></p></div></li>`;

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

for (const width of [320, 390, 590]) {
  test(`${width}px에서 요건 줄과 학교 확인 안내가 가로 스크롤 없이 보인다`, async ({ page }) => {
    const css = readFileSync('src/styles.css', 'utf8');
    await page.setViewportSize({ width, height: 800 });
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>${css}</style><body><div class="card"><ul class="plain">${LEAF_ROWS}${INQUIRY_ROW}</ul></div></body>`);

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const reason = page.locator('.inquiry-why');
    expect(await reason.evaluate((el) => el.getBoundingClientRect().height))
      .toBeLessThanOrEqual(await reason.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight)) + 1);
    // 전화·메일은 한 줄씩 쌓이고, 어느 줄도 화면 밖으로 넘지 않는다
    for (const line of await page.locator('.inquiry-detail p').all()) {
      const box = (await line.boundingBox())!;
      expect(box.x + box.width, '문의처 줄이 화면을 넘지 않아야 한다').toBeLessThanOrEqual(width);
    }
    const phone = page.locator('.inquiry-detail a[href^="tel:"]');
    const mail = page.locator('.inquiry-detail a[href^="mailto:"]');
    await expect(phone).toHaveCount(1);
    await expect(mail).toHaveCount(1);
    // 전화 줄과 메일 줄은 서로 다른 줄에 있다 (두 줄)
    const [py, my] = [(await phone.boundingBox())!.y, (await mail.boundingBox())!.y];
    expect(my).toBeGreaterThan(py);
    await page.screenshot({ path: `test-results/official-inquiry-${width}.png`, fullPage: true });
  });
}
