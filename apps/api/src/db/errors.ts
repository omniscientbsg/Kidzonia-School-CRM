import { Prisma } from '../generated/prisma/client.js';
import { businessRule, conflict, notFound } from '../lib/errors.js';
import type { AppError } from '../lib/errors.js';

function text(err: unknown): string {
  if (!(err instanceof Error)) return '';
  const cause = (err as { cause?: unknown }).cause;
  return `${err.message} ${cause instanceof Error ? cause.message : JSON.stringify(cause ?? '')}`;
}

/**
 * Turns database errors into messages people can act on. Services validate
 * first and give friendlier messages; this is the backstop when the database
 * catches something the code didn't.
 */
export function mapDbError(err: unknown): AppError | null {
  const msg = text(err);
  if (msg.includes('reports_to_cycle')) {
    return businessRule('That would make someone report to themselves through their team.', {
      reportsToUserId: 'Choose someone who is not in this person’s team.',
    });
  }
  if (msg.includes('organisation_id_immutable')) {
    return businessRule('Records can’t be moved between organisations.');
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002':
        return conflict('Something with those details already exists.');
      case 'P2003':
        // Composite foreign keys land here when a reference points at a row
        // that doesn't exist in this organisation.
        return businessRule('One of the linked records doesn’t exist.');
      case 'P2025':
        return notFound();
      case 'P2004':
        return businessRule('That change breaks a rule on this record.');
    }
  }
  if (/violates check constraint/i.test(msg)) {
    return businessRule('That change breaks a rule on this record.');
  }
  if (/duplicate key value/i.test(msg)) {
    return conflict('Something with those details already exists.');
  }
  if (/violates foreign key constraint/i.test(msg)) {
    return businessRule('One of the linked records doesn’t exist.');
  }
  return null;
}
