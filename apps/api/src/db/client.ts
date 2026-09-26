import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

export { PrismaClient };

/**
 * The raw, unscoped client. Only the data layer, background jobs and the
 * composition root may import this module (enforced by lint); everything else
 * gets an organisation-scoped client from the request.
 */
export function createPrisma(connectionString: string, poolSize = 10): PrismaClient {
  const adapter = new PrismaPg({ connectionString, max: poolSize });
  return new PrismaClient({ adapter });
}
