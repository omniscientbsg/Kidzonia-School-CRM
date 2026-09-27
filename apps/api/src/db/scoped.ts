import type { PrismaClient } from '../generated/prisma/client.js';
import { scopeArgs } from './scope-args.js';
import type { ScopeOptions } from './scope-args.js';
import { withStamps } from './stamps.js';
import { assertTrackable, isTrackedWrite, recordWrite, withTrackedSelect } from './tracking.js';

/**
 * A Prisma client that can only read and write one organisation's rows. This
 * is the single place tenancy is enforced in code; composite foreign keys
 * enforce it again in the database. Writes to tracked tables also record
 * activity automatically (see tracking.ts).
 */
export function scopeToOrganisation(
  client: PrismaClient,
  organisationId: string,
  options: ScopeOptions = {},
) {
  return client.$extends({
    name: 'organisation-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          // scopeArgs only adds filters or throws, and withStamps only adds created_by /
          // updated_by, so the shape stays valid for Prisma.
          const scoped = withStamps(
            model,
            operation,
            scopeArgs(model, operation, args, organisationId, options),
          ) as typeof args;
          if (!isTrackedWrite(model, operation)) return query(scoped);
          assertTrackable(model, operation);
          const result = await query(withTrackedSelect(model, scoped) as typeof args);
          recordWrite(model, operation, scoped, result);
          return result;
        },
      },
    },
  });
}

export type ScopedDb = ReturnType<typeof scopeToOrganisation>;

/** What repository functions accept: the scoped client or a transaction on it. */
export type ScopedTx = Omit<
  ScopedDb,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'
>;
