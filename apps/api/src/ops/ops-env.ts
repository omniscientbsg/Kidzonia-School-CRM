import { z } from 'zod';

/**
 * Settings for the operations scripts (backup, restore, staging migration
 * test). Read on their own rather than through loadConfig(): these scripts run
 * as one-off jobs that don't need, and shouldn't be handed, the app's JWT and
 * OTP secrets.
 */

const blankable = <T extends z.ZodType<unknown, string>>(schema: T) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined))
    .pipe(schema.optional());

const opsEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.string().default('info'),
    /** The live database: backed up, and never restored over without an explicit flag. */
    DATABASE_URL: blankable(z.url()),
    STAGING_DATABASE_URL: blankable(z.url()),
    /** Where backups go. A bucket of their own, private, ideally with versioning or object lock. */
    BACKUP_BUCKET: blankable(z.string()),
    BACKUP_PREFIX: z.string().default('db-backups/'),
    BACKUP_KEEP_DAYS: z.coerce.number().int().positive().default(30),
    // Backup bucket connection; each falls back to the file-storage S3_* value.
    BACKUP_S3_REGION: blankable(z.string()),
    BACKUP_S3_ENDPOINT: blankable(z.url()),
    BACKUP_S3_ACCESS_KEY_ID: blankable(z.string()),
    BACKUP_S3_SECRET_ACCESS_KEY: blankable(z.string()),
    S3_REGION: blankable(z.string()),
    S3_ENDPOINT: blankable(z.url()),
    S3_ACCESS_KEY_ID: blankable(z.string()),
    S3_SECRET_ACCESS_KEY: blankable(z.string()),
    /** Folder holding pg_dump and pg_restore when they're not on PATH. */
    PG_BIN: blankable(z.string()),
    /**
     * Local testing only: run pg_dump/pg_restore inside this Postgres container
     * (the docker-compose `db` service) when the host has no Postgres tools.
     */
    PG_DOCKER_CONTAINER: blankable(z.string()),
    /** Database to connect to when dropping and creating another one. */
    PG_MAINTENANCE_DB: z.string().default('postgres'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.PG_DOCKER_CONTAINER) {
      ctx.addIssue({
        code: 'custom',
        path: ['PG_DOCKER_CONTAINER'],
        message: 'Local testing only; the image has the Postgres tools installed',
      });
    }
  });

export type OpsEnv = z.infer<typeof opsEnvSchema>;

export function loadOpsEnv(env: NodeJS.ProcessEnv = process.env): OpsEnv {
  const parsed = opsEnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${problems.join('\n')}`);
  }
  return parsed.data;
}

/** Fails with a clear message when a script needs a setting that isn't there. */
export function required<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`${name} is required`);
  return value;
}
