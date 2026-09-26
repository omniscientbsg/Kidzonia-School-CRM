import type { PrismaClient } from '../generated/prisma/client.js';
import { AuthStore } from './auth-store.js';
import { createOrganisation } from './organisations.js';
import type { NewOrganisation } from './organisations.js';
import { pingDatabase, teamUserIds } from './queries.js';
import { scopeToOrganisation } from './scoped.js';

export type { ScopedDb, ScopedTx } from './scoped.js';
export type { Actor, UnitOfWork } from './unit-of-work.js';
export { withUnitOfWork } from './unit-of-work.js';
export { mapDbError } from './errors.js';
export { TenancyViolation } from './scope-args.js';
export type { $Enums } from '../generated/prisma/client.js';
export type { NewOrganisation } from './organisations.js';

/**
 * Everything the rest of the app may do with the database. Only this module
 * holds the raw client; callers get organisation-scoped clients or narrow,
 * named queries.
 */
export function createDataAccess(prisma: PrismaClient) {
  return {
    forOrganisation: (organisationId: string) => scopeToOrganisation(prisma, organisationId),
    auth: new AuthStore(prisma),
    teamUserIds: (organisationId: string, userId: string) =>
      teamUserIds(prisma, organisationId, userId),
    ping: () => pingDatabase(prisma),
    createOrganisation: (input: NewOrganisation) => createOrganisation(prisma, input),
  };
}

export type DataAccess = ReturnType<typeof createDataAccess>;
