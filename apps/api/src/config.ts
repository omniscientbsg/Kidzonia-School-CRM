import { z } from 'zod';

const secret = (name: string) =>
  z.string({ message: `${name} is required` }).min(32, `${name} must be at least 32 characters`);

/** Providers that only log messages; new real providers join the enum below. */
const DEV_ONLY_PROVIDERS: ReadonlySet<string> = new Set(['console']);

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

    MESSAGE_PROVIDER: z.enum(['console']).default('console'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.DEV_FIXED_OTP) {
      // A fixed code in production would let anyone sign in as anyone.
      ctx.addIssue({
        code: 'custom',
        path: ['DEV_FIXED_OTP'],
        message: 'DEV_FIXED_OTP must not be set in production',
      });
    }
    if (env.NODE_ENV === 'production' && DEV_ONLY_PROVIDERS.has(env.MESSAGE_PROVIDER)) {
      ctx.addIssue({
        code: 'custom',
        path: ['MESSAGE_PROVIDER'],
        message: 'A real message provider is required in production (open decision 13.2)',
      });
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
