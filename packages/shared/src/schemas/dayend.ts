import { z } from 'zod';
import { idSchema } from '../ids.js';
import { isoDateSchema, statusSchema } from './tasks.js';

/**
 * Day-end report forms (brief 9.11). Questions are versioned: each day's copy
 * keeps the version it was given, and its answers are read with it.
 */

export const QUESTION_TYPES = ['yes_no', 'number', 'short_text', 'pick_one', 'checklist'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  yes_no: 'Yes / No',
  number: 'Number',
  short_text: 'Short text',
  pick_one: 'Pick one',
  checklist: 'Checklist',
};

export const questionSchema = z
  .object({
    /** Stable across versions while the question exists. */
    id: z.string().min(1).max(40),
    text: z.string().trim().min(1, 'Write the question').max(200),
    type: z.enum(QUESTION_TYPES),
    required: z.boolean(),
    options: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  })
  .superRefine((q, ctx) => {
    if ((q.type === 'pick_one' || q.type === 'checklist') && q.options.length < 2) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'Add at least two choices' });
    }
  });
export type Question = z.infer<typeof questionSchema>;

const questionsSchema = z
  .array(questionSchema)
  .min(1, 'Add at least one question')
  .max(30, 'At most 30 questions')
  .refine((qs) => new Set(qs.map((q) => q.id)).size === qs.length, 'Question ids must be unique');

export const dayEndFormInputSchema = z.object({
  name: z.string().trim().min(1, 'Give the form a name').max(80),
  roleIds: z.array(idSchema).min(1, 'Choose at least one role').max(50),
  blocksLogout: z.boolean().default(true),
  questions: questionsSchema,
});
export const dayEndFormUpdateSchema = dayEndFormInputSchema.partial();

export const dayEndFormSchema = z.object({
  id: idSchema,
  name: z.string(),
  roleIds: z.array(idSchema),
  blocksLogout: z.boolean(),
  version: z.number(),
  questions: z.array(questionSchema),
  updatedAt: z.string(),
});
export type DayEndForm = z.infer<typeof dayEndFormSchema>;

export const dayEndFormListSchema = z.object({
  items: z.array(dayEndFormSchema),
  roles: z.array(z.object({ id: idSchema, name: z.string() })),
  nextCursor: z.string().nullable(),
});

/** One answer per question id. */
export const answerValueSchema = z.union([
  z.boolean(),
  z.number(),
  z.string().max(1000),
  z.array(z.string().max(80)).max(20),
  z.null(),
]);
export const answersInputSchema = z.object({
  answers: z.record(z.string(), answerValueSchema),
});
export type AnswerValue = z.infer<typeof answerValueSchema>;

const empty = (v: AnswerValue | undefined) =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** Problems with answers against their questions: wrong type, unknown choice. */
export function answerProblems(
  questions: readonly Question[],
  answers: Readonly<Record<string, AnswerValue>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, v] of Object.entries(answers)) {
    const q = questions.find((x) => x.id === id);
    if (!q) {
      out[id] = 'That question isn’t on this form.';
      continue;
    }
    if (empty(v)) continue;
    const ok =
      (q.type === 'yes_no' && typeof v === 'boolean') ||
      (q.type === 'number' && typeof v === 'number' && Number.isFinite(v)) ||
      (q.type === 'short_text' && typeof v === 'string') ||
      (q.type === 'pick_one' && typeof v === 'string' && q.options.includes(v)) ||
      (q.type === 'checklist' && Array.isArray(v) && v.every((x) => q.options.includes(x)));
    if (!ok) out[id] = 'That answer doesn’t fit the question.';
  }
  return out;
}

/** Required questions without an answer (submit needs them all, brief 9.6). */
export function missingRequired(
  questions: readonly Question[],
  answers: Readonly<Record<string, AnswerValue>> | null,
): Question[] {
  return questions.filter((q) => q.required && empty(answers?.[q.id]));
}

/** Day-end reports, Today tab (brief 9.11). */
export const dayEndTodaySchema = z.object({
  date: isoDateSchema,
  rows: z.array(
    z.object({
      copyId: idSchema,
      taskId: idSchema,
      formName: z.string(),
      person: z.object({
        id: idSchema,
        fullName: z.string(),
        jobTitle: z.string().nullable(),
        schoolName: z.string().nullable(),
      }),
      status: statusSchema,
      submittedAt: z.string().nullable(),
      blocking: z.boolean(),
      canRelease: z.boolean(),
    }),
  ),
});
export type DayEndToday = z.infer<typeof dayEndTodaySchema>;

// ---------- logout block and its escape hatches (brief 9.7) ----------

export const blockingSchema = z.object({
  /** Dates with open blocking work, oldest first, and what blocks each. */
  dates: z.array(
    z.object({
      date: isoDateSchema,
      tasks: z.array(z.object({ title: z.string(), path: z.string() })),
    }),
  ),
  /** Whether the viewer may release this person. */
  canRelease: z.boolean(),
});
export type Blocking = z.infer<typeof blockingSchema>;

export const releaseInputSchema = z.object({
  dates: z.array(isoDateSchema).min(1).max(60),
  reason: z.string().trim().max(300).nullable().default(null),
});

export const releaseRequestInputSchema = z.object({
  note: z.string().trim().max(300).nullable().default(null),
});

export const deferInputSchema = z.object({
  toDate: isoDateSchema,
  reason: z.string().trim().min(3, 'Say briefly why').max(300),
});

export const jobStatusSchema = z.object({
  lastSuccessAt: z.string().nullable(),
  lastRunAt: z.string().nullable(),
  lastStatus: z.string().nullable(),
  /** No successful run for over an hour (Phase 4 addition a). */
  stale: z.boolean(),
});
export type JobStatus = z.infer<typeof jobStatusSchema>;
