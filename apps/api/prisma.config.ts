import { defineConfig, env } from 'prisma/config';

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
  datasource: {
    url: env('DATABASE_URL'),
  },
});
