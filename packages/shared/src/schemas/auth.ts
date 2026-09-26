import { z } from 'zod';
import { idSchema } from '../ids.js';
import { mobileSchema } from './common.js';

export const OTP_LENGTH = 6;

export const requestCodeSchema = z.object({ mobile: mobileSchema });
export type RequestCodeInput = z.input<typeof requestCodeSchema>;

export const requestCodeResponseSchema = z.object({
  challengeId: idSchema,
  /** Seconds until the code stops working. */
  expiresIn: z.number().int(),
  /** Seconds before another code can be requested. */
  resendIn: z.number().int(),
});
export type RequestCodeResponse = z.infer<typeof requestCodeResponseSchema>;

export const verifyCodeSchema = z.object({
  challengeId: idSchema,
  code: z
    .string()
    .trim()
    .regex(new RegExp(`^\\d{${OTP_LENGTH}}$`), `Enter the ${OTP_LENGTH}-digit code`),
});
export type VerifyCodeInput = z.input<typeof verifyCodeSchema>;

export const passwordLoginSchema = z.object({
  mobile: mobileSchema,
  password: z.string().min(1, 'Enter your password').max(200),
});
export type PasswordLoginInput = z.input<typeof passwordLoginSchema>;

export const selectOrganisationSchema = z.object({
  selectionToken: z.string().min(1),
  organisationId: idSchema,
});
export type SelectOrganisationInput = z.input<typeof selectOrganisationSchema>;

export const organisationChoiceSchema = z.object({
  id: idSchema,
  name: z.string(),
  logoUrl: z.string().nullable(),
});

/**
 * One mobile can belong to people in several organisations. Signing in either
 * finishes straight away or asks which organisation to open.
 */
export const signInResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('signed_in'),
    accessToken: z.string(),
    /** ISO timestamp when the access token expires. */
    expiresAt: z.string(),
  }),
  z.object({
    status: z.literal('choose_organisation'),
    selectionToken: z.string(),
    organisations: z.array(organisationChoiceSchema).min(2),
  }),
]);
export type SignInResult = z.infer<typeof signInResultSchema>;

export const refreshResultSchema = z.object({
  accessToken: z.string(),
  expiresAt: z.string(),
});
export type RefreshResult = z.infer<typeof refreshResultSchema>;
