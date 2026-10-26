import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 사이드바 페이지(sidebar.html)와 서비스 워커(background.js) 두 개의 진입점을 함께 빌드한다.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    modulePreload: { polyfill: false }, // CSP(script-src 'self')에서 인라인 스크립트가 생기지 않게
    rollupOptions: {
      input: { sidebar: 'sidebar.html', background: 'src/background/index.ts' },
      output: {
        // manifest.json이 가리키는 고정 경로 'background.js'를 만든다.
        entryFileNames: (chunk: { name: string }) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
  worker: { format: 'es' },
  test: { environment: 'node', env: { TZ: 'Asia/Seoul' }, include: ['tests/unit/**/*.test.{ts,tsx}'] },
} as never);
