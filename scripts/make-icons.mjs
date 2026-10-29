// 앱의 원본 로고를 브라우저 캔버스로 줄여 확장앱·알림 아이콘을 만든다.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const source = readFileSync(new URL('../src/assets/logo/app-logo.png', import.meta.url));
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage();
  const icons = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    if (image.naturalWidth !== image.naturalHeight) throw new Error('앱 로고는 정사각형이어야 합니다.');
    return [16, 32, 48, 64, 128, 256].map((size) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const context = canvas.getContext('2d');
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, size, size);
      // 축소로 부드러워진 경계만 약하게 선명하게 한다. 글자·도형·배치는 바꾸지 않는다.
      const pixels = context.getImageData(0, 0, size, size);
      const original = new Uint8ClampedArray(pixels.data);
      for (let y = 1; y < size - 1; y++) {
        for (let x = 1; x < size - 1; x++) {
          const offset = (y * size + x) * 4;
          for (let channel = 0; channel < 3; channel++) {
            const i = offset + channel;
            const neighbors = (original[i - 4] + original[i + 4]
              + original[i - size * 4] + original[i + size * 4]) / 4;
            pixels.data[i] = original[i] + 0.4 * (original[i] - neighbors);
          }
        }
      }
      context.putImageData(pixels, 0, 0);
      return { size, base64: canvas.toDataURL('image/png').split(',')[1] };
    });
  }, source.toString('base64'));
  for (const { size, base64 } of icons) {
    const png = Buffer.from(base64, 'base64');
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
    writeFileSync(new URL(`../public/icons/icon${size}.png`, import.meta.url), png);
  }
  console.log('원본 디자인을 유지한 16·32·48·64·128·256px 아이콘 생성 완료');
} finally {
  await browser.close();
}
