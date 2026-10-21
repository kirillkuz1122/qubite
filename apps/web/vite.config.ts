import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Адрес Rust-сервера в разработке: запросы /api/* проксируются туда,
// поэтому сайт и API работают с одного адреса (как будет в production).
const apiTarget = process.env.QUBITE_API ?? 'http://127.0.0.1:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    // временные ссылки туннелей, чтобы открыть сайт с телефона: Cloudflare (cloudflared),
    // localhost.run и Pinggy (через ssh), Tailscale (MagicDNS / Funnel)
    allowedHosts: ['.trycloudflare.com', '.lhr.life', '.localhost.run', '.pinggy.link', '.ts.net'],
    // ws — WebSocket «есть новое» для Входящих (/api/v1/sync/ws)
    proxy: { '/api': { target: apiTarget, changeOrigin: false, ws: true } },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
