/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 개발 서버는 /api 를 백엔드(기본 http://localhost:3000)로 넘긴다. 같은 출처로 동작해야 세션 쿠키(SameSite=Lax)가 전달된다.
// 운영 배포도 정적 파일과 /api 를 같은 출처(리버스 프록시)로 제공하는 것을 전제로 한다.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: process.env.API_PROXY_TARGET ?? 'http://localhost:3000', changeOrigin: false },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
