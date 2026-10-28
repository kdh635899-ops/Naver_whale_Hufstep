import { defineConfig } from '@playwright/test';

// 실제 웨일을 임시 프로필로 띄워 dist/ 확장앱을 검사한다 (tests/e2e/whale.spec.ts 참고).
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180_000,
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  webServer: {
    command: 'npm exec vite preview -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173/sidebar.html',
    reuseExistingServer: !process.env.CI,
  },
  // 설치된 Chrome을 쓴다 (Playwright 전용 브라우저를 따로 내려받지 않도록)
  use: { channel: 'chrome' },
});
