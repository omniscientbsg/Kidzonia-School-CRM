/* eslint-disable no-console -- a command-line script reports to the terminal */
import { createPrisma } from '../src/db/client.js';
import { createDataAccess } from '../src/db/index.js';
import { countOrganisations, resetDatabase } from '../src/db/maintenance.js';
import path from 'node:path';
import { LocalFileStorage, S3FileStorage } from '../src/core/storage.js';
import type { FileStorage } from '../src/core/storage.js';
import {
  DEMO_ORG_NAME,
  DEMO_PASSWORD,
  graftDemoDayEnd,
  graftDemoTasks,
  seedDemo,
} from '../src/seed/demo.js';

/** The same storage the server uses, from the same settings (without the rest of the config). */
function storageFromEnv(): FileStorage {
  const env = process.env;
  if (env.STORAGE_DRIVER === 's3' && env.S3_BUCKET && env.S3_REGION) {
    return new S3FileStorage(env.S3_BUCKET, {
      region: env.S3_REGION,
      ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
      ...(env.S3_ACCESS_KEY_ID ? { accessKeyId: env.S3_ACCESS_KEY_ID } : {}),
      ...(env.S3_SECRET_ACCESS_KEY ? { secretAccessKey: env.S3_SECRET_ACCESS_KEY } : {}),
    });
  }
  return new LocalFileStorage(path.resolve(env.STORAGE_LOCAL_DIR || 'storage'));
}

/**
 * pnpm seed           -> seeds an empty database, refuses one that has data
 * pnpm seed --reset   -> empties a LOCAL database first, then seeds
 * --if-empty           -> seeds an empty database, quietly does nothing otherwise (pnpm dev)
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  if (process.env.NODE_ENV === 'production') throw new Error('Seeding is disabled in production');
  const reset = process.argv.includes('--reset');
  const ifEmpty = process.argv.includes('--if-empty');
  const prisma = createPrisma(url, 2);
  const storage = storageFromEnv();
  try {
    const existing = await countOrganisations(prisma);
    if (existing > 0 && !reset) {
      // Databases seeded before Tasks existed get the demo's Tasks data added.
      const data = createDataAccess(prisma);
      const demo = await prisma.organisation.findFirst({ where: { name: DEMO_ORG_NAME } });
      if (demo) {
        const tasks = await graftDemoTasks(data, demo.id, { storage });
        const forms = await graftDemoDayEnd(data, demo.id);
        if (tasks)
          console.log('Added the demo’s tasks, templates and categories to the existing data.');
        if (forms) console.log('Added the demo’s day-end forms to the existing data.');
        if (tasks || forms) return;
      }
    }
    if (existing > 0 && ifEmpty) {
      console.log('The database already has data; not seeding.');
      return;
    }
    if (existing > 0 && !reset) {
      console.error(
        `The database already has ${existing} organisation(s). Nothing was changed.\n` +
          'Run "pnpm seed --reset" to empty this local database and seed it again.',
      );
      process.exitCode = 1;
      return;
    }
    if (reset) await resetDatabase(prisma, url);
    const { demo, second } = await seedDemo(createDataAccess(prisma), { storage });
    console.log(
      `Seeded "${demo.organisationId}" (demo, ${Object.keys(demo.users).length} people) and ` +
        `"${second.organisationId}" (second organisation).`,
    );
    console.log('Sign in with any seeded mobile number and the code 123456.');
    console.log(`Ananya (98480 11201) also has the password: ${DEMO_PASSWORD}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
