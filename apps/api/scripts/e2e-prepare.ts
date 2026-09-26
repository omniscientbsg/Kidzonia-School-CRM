/* eslint-disable no-console -- a command-line script reports to the terminal */
import { execSync } from 'node:child_process';
import pg from 'pg';
import { createPrisma } from '../src/db/client.js';
import { createDataAccess } from '../src/db/index.js';
import { isLocalDatabase } from '../src/db/maintenance.js';
import path from 'node:path';
import { LocalFileStorage } from '../src/core/storage.js';
import { seedDemo } from '../src/seed/demo.js';

/**
 * Gives the end-to-end tests a fresh database: drop, create, migrate, seed.
 * Refuses anything that isn't a local database whose name contains "e2e".
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const name = new URL(url).pathname.slice(1);
  if (!isLocalDatabase(url) || !name.includes('e2e')) {
    throw new Error(`Refusing to recreate "${name}": not a local e2e database`);
  }
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  const ident = `"${name.replace(/"/g, '""')}"`;
  await admin.query(`DROP DATABASE IF EXISTS ${ident} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${ident}`);
  await admin.end();

  execSync('pnpm exec prisma migrate deploy', { stdio: 'pipe', env: process.env });
  const prisma = createPrisma(url, 2);
  // The same folder the e2e server reads files from (STORAGE_LOCAL_DIR).
  const storage = new LocalFileStorage(path.resolve(process.env.STORAGE_LOCAL_DIR || 'storage'));
  await seedDemo(createDataAccess(prisma), { storage });
  await prisma.$disconnect();
  console.log(`E2E database "${name}" is ready.`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
