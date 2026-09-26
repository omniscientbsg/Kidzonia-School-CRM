import type { PrismaClient } from '../generated/prisma/client.js';
import type { $Enums } from '../generated/prisma/client.js';

export interface NewOrganisation {
  name: string;
  setupType: $Enums.SetupType;
  schoolModel: $Enums.SchoolModel;
  timezone?: string;
  workingDays?: number[];
  opensAt?: string;
  closesAt?: string;
}

/**
 * Creates an organisation row. This is the only write that can't go through
 * an organisation-scoped client (there is no organisation yet), so it lives
 * here and is used only by registration and seeding.
 */
export async function createOrganisation(
  prisma: PrismaClient,
  input: NewOrganisation,
): Promise<{ id: string }> {
  return prisma.organisation.create({ data: input, select: { id: true } });
}
