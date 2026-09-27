// Fails if a migration that was already committed has been changed, renamed or
// deleted (brief section 14: never edit a migration that has run; add a new one).
// CI passes the commit to compare against in BASE (the pull request's base, or
// the commit before a push). Only new migration files are allowed.
import { execFileSync } from 'node:child_process';

const DIR = 'apps/api/prisma/migrations';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

let base = process.env.BASE ?? '';
if (!base || /^0+$/.test(base)) {
  // A new branch: compare with where it left main, if main is known.
  try {
    base = git('merge-base', 'HEAD', 'origin/main');
  } catch {
    console.log('No base commit to compare with; skipping the migration check.');
    process.exit(0);
  }
}

const changed = git('diff', '--name-status', '--diff-filter=MDRT', base, 'HEAD', '--', DIR);
if (changed) {
  console.error(
    `Committed migrations were changed since ${base.slice(0, 8)}:\n${changed}\n` +
      'Never edit a migration that has been committed; add a new one that converts the data.',
  );
  process.exit(1);
}
console.log(`Migrations: only additions since ${base.slice(0, 8)}.`);
