import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    // Same-origin in dev: no CORS, and EventSource works out of the box.
    proxy: { '/api': { target: process.env.VITE_API_TARGET ?? 'http://localhost:4000', changeOrigin: true } },
  },
});
