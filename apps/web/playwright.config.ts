import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const API_PORT = 4100;
const DB_URL =
  process.env.E2E_DATABASE_URL ?? 'postgresql://kidzonia:kidzonia@localhost:55432/kidzonia_e2e';
export const E2E_DATABASE_URL = DB_URL;

/**
 * End-to-end tests run the production build: the API serves the built web
 * app on one origin, exactly as the Docker image does (same CSP, same cookies).
 * The API recreates and seeds its own e2e database on start.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${API_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, grepInvert: /@phone/ },
    { name: 'phone', use: { ...devices['Pixel 7'] }, grep: /@phone/ },
  ],
  webServer: {
    command: 'pnpm --filter @kidzonia/api e2e:serve',
    url: `http://localhost:${API_PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    env: {
      NODE_ENV: 'test',
      PORT: String(API_PORT),
      DATABASE_URL: DB_URL,
      WEB_DIST: path.resolve(import.meta.dirname, 'dist'),
      CORS_ORIGINS: `http://localhost:${API_PORT}`,
      LOG_LEVEL: 'warn',
      STORAGE_LOCAL_DIR: 'storage-e2e',
      JWT_SECRET: 'e2e-only-jwt-secret-0123456789abcdef0123456789',
      OTP_PEPPER: 'e2e-only-otp-pepper-0123456789abcdef0123456789',
      DEV_FIXED_OTP: '123456',
      // Tests sign the same people in many times.
      RL_OTP_PER_MOBILE_10MIN: '1000',
      RL_OTP_PER_IP_10MIN: '1000',
      RL_OTP_PER_MOBILE_DAY: '1000',
      RL_OTP_PER_IP_DAY: '1000',
    },
  },
});
