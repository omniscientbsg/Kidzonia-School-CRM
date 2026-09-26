import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/support/global-setup.ts'],
    setupFiles: ['test/support/worker-setup.ts'],
    pool: 'forks',
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
