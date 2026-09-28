import { z } from 'zod';

const secret = (name: string) =>
  z.string({ message: `${name} is required` }).min(32, `${name} must be at least 32 characters`);

/** Providers that only log messages; new real providers join the enum below. */
const DEV_ONLY_PROVIDERS: ReadonlySet<string> = new Set(['console']);

/** An optional setting where an empty value (as in .env.example) means "not set". */
const blankable = <T extends z.ZodType<unknown, string>>(schema: T) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined))
    .pipe(schema.optional());

const count = z.coerce.number().int().positive();

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    DATABASE_URL: z.url({ message: 'DATABASE_URL must be a postgres URL' }),
    DATABASE_POOL_SIZE: z.coerce.number().int().positive().default(10),

    JWT_SECRET: secret('JWT_SECRET'),
    JWT_SECRET_PREVIOUS: z
      .string()
      .optional()
      .transform((v) => (v ? v : undefined))
      .pipe(secret('JWT_SECRET_PREVIOUS').optional()),
    OTP_PEPPER: secret('OTP_PEPPER'),

    ACCESS_TOKEN_TTL_MINUTES: count.default(720),
    REFRESH_TOKEN_TTL_DAYS: count.default(30),

    OTP_TTL_SECONDS: count.default(300),
    OTP_MAX_ATTEMPTS: count.default(5),
    OTP_RESEND_SECONDS: count.default(30),
    DEV_FIXED_OTP: z
      .string()
      .optional()
      .transform((v) => (v ? v : undefined))
      .pipe(
        z
          .string()
          .regex(/^\d{6}$/, 'DEV_FIXED_OTP must be 6 digits')
          .optional(),
      ),

    RL_OTP_PER_MOBILE_10MIN: count.default(3),
    RL_OTP_PER_IP_10MIN: count.default(10),
    RL_OTP_PER_MOBILE_DAY: count.default(10),
    RL_OTP_PER_IP_DAY: count.default(50),
    RL_LOGIN_PER_MOBILE_15MIN: count.default(10),
    RL_LOGIN_PER_IP_15MIN: count.default(30),
    RL_REGISTER_PER_IP_DAY: count.default(5),
    RL_INVITE_PER_USER_DAY: count.default(3),

    /** Where invite messages send people. */
    APP_URL: z.url().default('http://localhost:5173'),
    REGISTRATION_TOKEN_TTL_MINUTES: count.default(30),

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('storage'),
    S3_BUCKET: blankable(z.string()),
    S3_REGION: blankable(z.string()),
    S3_ENDPOINT: blankable(z.url()),
    S3_ACCESS_KEY_ID: blankable(z.string()),
    S3_SECRET_ACCESS_KEY: blankable(z.string()),

    MESSAGE_PROVIDER: z.enum(['console']).default('console'),

    /** Most people one task can go to (decision 3: 40 schools x 15 teachers fits). */
    TASK_MAX_RECIPIENTS: count.default(1000),
    /** Photos before they're shrunk on the server. */
    TASK_IMAGE_MAX_MB: count.default(15),
    /** PDFs, Word and Excel files. */
    TASK_FILE_MAX_MB: count.default(10),
    TASK_FILES_PER_COPY: count.default(10),
    /** Deferring a copy: from tomorrow up to this many days ahead (Phase 4 answer 2). */
    TASK_DEFER_MAX_DAYS: count.default(14),
    /** In-app notifications are kept this long from when they were created (Phase 5 answer 2). */
    NOTIFICATIONS_KEEP_DAYS: count.default(90),
    /** Most SMS/WhatsApp notifications one organisation sends per day (Phase 5 answer 3). */
    SMS_DAILY_CAP_PER_ORG: count.default(500),
    /** Report downloads per person per hour (Phase 5 addition c). */
    RL_EXPORTS_PER_USER_HOUR: count.default(10),
    /** Most messages to parents one organisation sends per day (Phase 6 answer 3). */
    PARENT_DAILY_CAP_PER_ORG: count.default(2000),
    /** Most messages one parent receives per day, so nobody is flooded (Phase 6 answer 3). */
    PARENT_DAILY_LIMIT_PER_PARENT: count.default(3),
    /** Rows in one parent-contacts CSV upload. */
    CONTACTS_CSV_MAX_ROWS: count.default(2000),
    /** Test-only routes to move the clock and run jobs (Playwright). Refused in production. */
    E2E_TEST_HOOKS: z.enum(['0', '1']).default('0'),
    /**
     * A public demo with made-up data (e.g. on Render): a production build that
     * may use the logging message provider and the fixed sign-in code, and may
     * load the demo seed. Never for real schools: anyone who knows the code can
     * sign in as anyone. The web app shows a "Demo" banner (VITE_DEMO_MODE).
     */
    DEMO_MODE: z.enum(['0', '1']).default('0'),
    /** Set by Render: the service's public URL, used for CORS when CORS_ORIGINS is empty. */
    RENDER_EXTERNAL_URL: blankable(z.url()),

    /**
     * Error tracking (Sentry-compatible DSN). Off unless set, in every environment,
     * so development and tests never send anything.
     */
    ERROR_TRACKING_DSN: blankable(z.url()),
    /** Label for reports, e.g. "production" or "staging"; defaults to NODE_ENV. */
    ERROR_TRACKING_ENVIRONMENT: blankable(z.string()),
    /**
     * The DSN baked into the web app at build time (VITE_ERROR_TRACKING_DSN). The
     * server only needs it to allow the browser to send reports in the CSP.
     */
    WEB_ERROR_TRACKING_DSN: blankable(z.url()),
    /** The release being run (the image's version tag), attached to error reports. */
    APP_VERSION: blankable(z.string()),
  })
  .transform((env) =>
    // On Render the app's own address is known only at run time.
    env.CORS_ORIGINS.length === 0 && env.RENDER_EXTERNAL_URL
      ? { ...env, CORS_ORIGINS: [env.RENDER_EXTERNAL_URL.replace(/\/$/, '')] }
      : env,
  )
  .superRefine((env, ctx) => {
    const demo = env.DEMO_MODE === '1';
    if (env.NODE_ENV === 'production' && env.DEV_FIXED_OTP && !demo) {
      // A fixed code in production would let anyone sign in as anyone.
      ctx.addIssue({
        code: 'custom',
        path: ['DEV_FIXED_OTP'],
        message: 'DEV_FIXED_OTP must not be set in production',
      });
    }
    if (env.NODE_ENV === 'production' && DEV_ONLY_PROVIDERS.has(env.MESSAGE_PROVIDER) && !demo) {
      ctx.addIssue({
        code: 'custom',
        path: ['MESSAGE_PROVIDER'],
        message: 'A real message provider is required in production (open decision 13.2)',
      });
    }
    if (env.STORAGE_DRIVER === 's3' && (!env.S3_BUCKET || !env.S3_REGION)) {
      ctx.addIssue({ code: 'custom', path: ['S3_BUCKET'], message: 'Set S3_BUCKET and S3_REGION' });
    }
    if (env.NODE_ENV === 'production' && env.E2E_TEST_HOOKS === '1') {
      // These routes move the clock and run jobs on demand: tests only.
      ctx.addIssue({ code: 'custom', path: ['E2E_TEST_HOOKS'], message: 'Never in production' });
    }
    if (env.NODE_ENV === 'production' && env.CORS_ORIGINS.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: 'Set CORS_ORIGINS' });
    }
  });

export type Config = z.infer<typeof envSchema>;

/** Parses the environment once at boot; the server refuses to start on any problem. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${problems.join('\n')}`);
  }
  return parsed.data;
}
