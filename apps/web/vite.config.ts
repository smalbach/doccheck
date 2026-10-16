import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the API runs on :3000; in production the API serves this build from the same origin.
const api = process.env.API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Keep the browser's Host header: the API refuses state-changing requests whose Origin is another host.
    // The progress streams (/events, /shipments/:id/events) are server-sent events: the proxy pipes
    // them through as they come (the API sends no compression and X-Accel-Buffering: no).
    proxy: Object.fromEntries(['/auth', '/admin', '/shipments', '/events', '/demo', '/rules', '/health', '/results', '/insights', '/mail', '/orgs', '/audit', '/approvals', '/notifications'].map((p) => [p, { target: api, changeOrigin: false }])),
  },
});
