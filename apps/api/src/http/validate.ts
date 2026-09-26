import type { z } from 'zod';
import { invalidInput } from '../lib/errors.js';

/** Validates input with a shared schema; failures become a 400 with a message per field. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.map(String).join('.') || '_';
    fields[path] ??= issue.message;
  }
  const first = Object.values(fields)[0] ?? 'Please check the details and try again.';
  throw invalidInput(first, fields);
}
