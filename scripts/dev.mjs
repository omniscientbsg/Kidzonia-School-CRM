// `pnpm dev`: one command for local development.
// Starts Postgres, applies migrations, seeds an empty database, then runs the
// API and the web app together. Existing data is never wiped.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const apiEnv = path.join(root, 'apps/api/.env');
const isWindows = process.platform === 'win32';

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', shell: isWindows, cwd: root, ...opts });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

if (!existsSync(apiEnv)) {
  copyFileSync(path.join(root, '.env.example'), apiEnv);
  console.log('Created apps/api/.env from .env.example');
}

console.log('Starting Postgres…');
run('docker', ['compose', 'up', '-d', '--wait', 'db']);

console.log('Applying migrations…');
run('pnpm', ['--filter', '@kidzonia/api', 'db:deploy']);

console.log('Seeding if the database is empty…');
run('pnpm', ['--filter', '@kidzonia/api', 'seed', '--if-empty']);

run('pnpm', [
  'exec',
  'concurrently',
  '--kill-others-on-fail',
  '--names',
  'api,web',
  '--prefix-colors',
  'blue,green',
  '"pnpm --filter @kidzonia/api dev"',
  '"pnpm --filter @kidzonia/web dev"',
]);
