import { z } from 'zod';
import { idSchema } from '../ids.js';
import { ACTIONS, FIELD_ACCESS, REACHES } from '../registry/index.js';
import { OWN_RECORD_RULES } from '../permissions/index.js';
import type { PermissionContext } from '../permissions/index.js';
import type { Registry } from '../registry/index.js';

export const moduleGrantSchema = z.object({
  actions: z.array(z.enum(ACTIONS)),
  reach: z.enum(REACHES).nullable(),
});

export const fieldRuleSchema = z.object({
  access: z.enum(FIELD_ACCESS),
  ownRecord: z.enum(OWN_RECORD_RULES),
  needsApproval: z.boolean(),
});

export const roleGrantsSchema = z.object({
  roleId: idSchema,
  roleName: z.string(),
  isOwner: z.boolean(),
  modules: z.record(z.string(), moduleGrantSchema),
  fields: z.record(z.string(), z.record(z.string(), fieldRuleSchema)),
});

const personSchema = z.object({
  id: idSchema,
  fullName: z.string(),
  jobTitle: z.string().nullable(),
});

export const meSchema = z.object({
  user: z.object({
    id: idSchema,
    fullName: z.string(),
    mobile: z.string(),
    email: z.string().nullable(),
    jobTitle: z.string().nullable(),
    photoUrl: z.string().nullable(),
    homeSchoolId: idSchema.nullable(),
    homeSchoolName: z.string().nullable(),
  }),
  organisation: z.object({
    id: idSchema,
    name: z.string(),
    logoUrl: z.string().nullable(),
    setupType: z.enum(['single_school', 'head_office']),
    timezone: z.string(),
  }),
  role: roleGrantsSchema.nullable(),
  scope: z.object({ allSchools: z.boolean(), schoolIds: z.array(idSchema) }),
  teamUserIds: z.array(idSchema),
  managerSwitches: z.record(z.string(), z.boolean()),
  /** Who to ask for access: the reporting manager, else an Owner. */
  askForAccess: personSchema.nullable(),
});
export type Me = z.infer<typeof meSchema>;

/** Builds the same permission context the server uses, from GET /me. */
export function contextFromMe(me: Me, registry: Registry): PermissionContext {
  return {
    registry,
    userId: me.user.id,
    role: me.role,
    scope: me.scope,
    teamUserIds: new Set(me.teamUserIds),
    managerSwitches: me.managerSwitches,
  };
}
