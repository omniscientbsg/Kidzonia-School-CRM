import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the API runs separately; proxying /api keeps the browser on
// one origin, so the refresh cookie and CSP work exactly as in production.
const apiTarget = process.env.VITE_API_TARGET ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  resolve: { conditions: ['source', 'module', 'browser', 'development|production'] },
  server: {
    port: Number(process.env.VITE_PORT ?? 5173),
    strictPort: true,
    proxy: { '/api': { target: apiTarget, changeOrigin: false } },
  },
  build: { outDir: 'dist', sourcemap: true },
});
