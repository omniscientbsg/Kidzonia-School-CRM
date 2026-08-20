import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Component tests. The server suite (node --test) covers behaviour; this covers
// the one thing it structurally cannot — whether a screen renders at all.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
    css: false,
  },
})
