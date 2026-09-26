/* eslint-disable no-console -- a command-line script reports to the terminal */
import { createPrisma } from '../src/db/client.js';
import { createDataAccess } from '../src/db/index.js';
import { countOrganisations, resetDatabase } from '../src/db/maintenance.js';
import { DEMO_PASSWORD, seedDemo } from '../src/seed/demo.js';

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
  try {
    const existing = await countOrganisations(prisma);
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
    const { demo, second } = await seedDemo(createDataAccess(prisma));
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
