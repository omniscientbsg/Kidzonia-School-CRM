import { execSync } from 'node:child_process';
import { recreateDatabase, templateUrl } from './databases.js';

/**
 * Builds a fresh, fully migrated template database once per run. Each test
 * worker then clones its own copy, so workers never share data.
 */
export default async function setup(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch {
    // CI provides the environment directly.
  }
  const url = templateUrl();
  const name = new URL(url).pathname.slice(1);
  await recreateDatabase(url, name);
  execSync('pnpm exec prisma migrate deploy', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: url },
  });
}
