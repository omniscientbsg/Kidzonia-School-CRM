import { recreateDatabase, templateUrl, withDatabase } from './databases.js';

try {
  process.loadEnvFile();
} catch {
  // CI provides the environment directly.
}

// One database per worker process, cloned from the migrated template.
const template = templateUrl();
const templateName = new URL(template).pathname.slice(1);
const workerName = `${templateName}_w${process.env.VITEST_POOL_ID ?? '0'}`;
const workerUrl = withDatabase(template, workerName);

if (process.env.KZ_WORKER_DB !== workerUrl) {
  await recreateDatabase(template, workerName, templateName);
  process.env.KZ_WORKER_DB = workerUrl;
}
