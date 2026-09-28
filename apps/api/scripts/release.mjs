// The release step before the server starts (runbook: "migrations as a release
// step"). Applies pending migrations; in the public demo (DEMO_MODE=1) it also
// loads the demo data into an empty database. Real deployments never seed.
import { execFileSync } from 'node:child_process';

const run = (args) =>
  execFileSync('pnpm', args, { stdio: 'inherit', shell: process.platform === 'win32' });

run(['exec', 'prisma', 'migrate', 'deploy']);
if (process.env.DEMO_MODE === '1') {
  run(['run', 'seed', '--if-empty']);
}
