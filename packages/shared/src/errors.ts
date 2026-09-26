import { z } from 'zod';

/**
 * Error codes the API can return. The HTTP status is fixed per code so the
 * client can branch on `code` without caring about status numbers.
 */
export const ERROR_STATUS = {
  invalid_input: 400,
  not_logged_in: 401,
  not_allowed: 403,
  not_found: 404,
  conflict: 409,
  logout_blocked: 409,
  business_rule: 422,
  too_many_requests: 429,
  internal: 500,
  unavailable: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(Object.keys(ERROR_STATUS) as [ErrorCode, ...ErrorCode[]]),
    message: z.string(),
    /** Per-field messages for invalid_input, keyed by dotted path. */
    fields: z.record(z.string(), z.string()).optional(),
    requestId: z.string().optional(),
  }),
});

export type ApiErrorBody = z.infer<typeof apiErrorSchema>;
