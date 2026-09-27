import { Prisma } from '../generated/prisma/client.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { AuthStore } from './auth-store.js';
import { JobStore } from './jobs.js';
import { createOrganisation } from './organisations.js';
import type { NewOrganisation } from './organisations.js';
import {
  activeOwnerIds,
  activityAbout,
  managerChain,
  pingDatabase,
  teamUserIds,
} from './queries.js';
import { scopeToOrganisation } from './scoped.js';

export type { ScopedDb, ScopedTx } from './scoped.js';
export type { Actor, UnitOfWork } from './unit-of-work.js';
export { withUnitOfWork } from './unit-of-work.js';
export { mapDbError } from './errors.js';
export { TenancyViolation } from './scope-args.js';
export type { $Enums } from '../generated/prisma/client.js';
export type { Prisma };
/** Writes SQL NULL into a nullable JSON column (a plain null is ambiguous to Prisma). */
export const DbNull = Prisma.DbNull;
export type { NewOrganisation } from './organisations.js';
export type { ChainLink } from './queries.js';
export type { JobLease } from './jobs.js';

/**
 * Everything the rest of the app may do with the database. Only this module
 * holds the raw client; callers get organisation-scoped clients or narrow,
 * named queries.
 */
export function createDataAccess(prisma: PrismaClient) {
  return {
    forOrganisation: (organisationId: string) => scopeToOrganisation(prisma, organisationId),
    /** Registration only: a scoped client allowed to create its own organisation row. */
    forNewOrganisation: (organisationId: string) =>
      scopeToOrganisation(prisma, organisationId, { creatingOrganisation: true }),
    auth: new AuthStore(prisma),
    jobs: new JobStore(prisma),
    teamUserIds: (organisationId: string, userId: string) =>
      teamUserIds(prisma, organisationId, userId),
    managerChain: (organisationId: string, userId: string) =>
      managerChain(prisma, organisationId, userId),
    activeOwnerIds: (organisationId: string) => activeOwnerIds(prisma, organisationId),
    activityAbout: (organisationId: string, userId: string, limit = 50) =>
      activityAbout(prisma, organisationId, userId, limit),
    ping: () => pingDatabase(prisma),
    createOrganisation: (input: NewOrganisation) => createOrganisation(prisma, input),
  };
}

export type DataAccess = ReturnType<typeof createDataAccess>;
