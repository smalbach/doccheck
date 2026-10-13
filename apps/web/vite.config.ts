import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the API runs on :3000; in production the API serves this build from the same origin.
const api = process.env.API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: Object.fromEntries(['/shipments', '/demo', '/rules', '/health'].map((p) => [p, api])),
  },
});
