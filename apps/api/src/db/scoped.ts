import type { PrismaClient } from '../generated/prisma/client.js';
import { scopeArgs } from './scope-args.js';
import { assertTrackable, isTrackedWrite, recordWrite, withTrackedSelect } from './tracking.js';

/**
 * A Prisma client that can only read and write one organisation's rows. This
 * is the single place tenancy is enforced in code; composite foreign keys
 * enforce it again in the database. Writes to tracked tables also record
 * activity automatically (see tracking.ts).
 */
export function scopeToOrganisation(client: PrismaClient, organisationId: string) {
  return client.$extends({
    name: 'organisation-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          // scopeArgs only adds filters or throws, so the shape stays valid for Prisma.
          const scoped = scopeArgs(model, operation, args, organisationId) as typeof args;
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
