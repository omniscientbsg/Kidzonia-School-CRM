import pg from 'pg';

/** The template database tests clone from. Never the development database. */
export function templateUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set (see .env.example)');
  const name = new URL(url).pathname.slice(1);
  if (!name.includes('test')) {
    throw new Error(`TEST_DATABASE_URL must point at a test database, got "${name}"`);
  }
  return url;
}

export function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** Runs admin statements against the server's maintenance database. */
export async function admin(url: string, fn: (client: pg.Client) => Promise<void>): Promise<void> {
  const client = new pg.Client({ connectionString: withDatabase(url, 'postgres') });
  await client.connect();
  try {
    await fn(client);
  } finally {
    await client.end();
  }
}

export async function recreateDatabase(url: string, name: string, template?: string) {
  await admin(url, async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${ident(name)} WITH (FORCE)`);
    await c.query(
      `CREATE DATABASE ${ident(name)}${template ? ` TEMPLATE ${ident(template)}` : ''}`,
    );
  });
}
