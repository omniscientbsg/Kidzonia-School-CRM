import { defineConfig } from 'prisma/config';

// Prisma 7 no longer reads .env on its own; scripts load it with --env-file.
try {
  process.loadEnvFile();
} catch {
  // No .env file: rely on the real environment (CI, Docker).
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  // Only migrate/seed need a database; `prisma generate` (e.g. in the Docker
  // build) must work without one, so the URL is optional here.
  ...(process.env.DATABASE_URL ? { datasource: { url: process.env.DATABASE_URL } } : {}),
});
