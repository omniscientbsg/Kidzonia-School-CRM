import { z } from 'zod';
import { idSchema } from '../ids.js';
import { ACTIONS, FIELD_ACCESS, REACHES } from '../registry/index.js';
import { OWN_RECORD_RULES } from '../permissions/index.js';
import { createAccess } from '../permissions/index.js';
import type { Access, PermissionContext } from '../permissions/index.js';
import type { Registry } from '../registry/index.js';
import { orgRegistry } from '../tasks/fields.js';

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

/**
 * GET /me: who is signed in and what they may do. It is identity, not a Users
 * record, so it is whitelisted by this schema (unknown keys are stripped)
 * rather than by field permissions, and deliberately leaves out contact details.
 */
export const meSchema = z.object({
  user: z.object({
    id: idSchema,
    fullName: z.string(),
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
  /** Changes waiting for this person's decision (badge in the menu). */
  changesToApprove: z.number(),
  /** The server's clock, so "today" and deadlines don't depend on the device's clock. */
  serverTime: z.string(),
  /** The organisation's live custom lists: each is also a field of `tasks`. */
  customLists: z.array(z.object({ id: idSchema, name: z.string() })),
  /**
   * Set during "Preview as this role": the signed-in person doing the preview.
   * The app then shows only what both people may see, and nothing can change.
   */
  preview: z
    .object({
      previewer: personSchema,
      role: roleGrantsSchema.nullable(),
      scope: z.object({ allSchools: z.boolean(), schoolIds: z.array(idSchema) }),
      teamUserIds: z.array(idSchema),
      managerSwitches: z.record(z.string(), z.boolean()),
    })
    .nullable(),
});
export type Me = z.infer<typeof meSchema>;

/** The same Access the server uses for this person (preview-aware). */
export function accessFromMe(me: Me, base: Registry): Access {
  // The same organisation registry the server builds, custom lists included.
  const registry = orgRegistry(base, me.customLists);
  const primary = contextFromMe(me, registry);
  if (!me.preview) return createAccess(primary);
  const previewer: PermissionContext = {
    registry,
    userId: me.preview.previewer.id,
    role: me.preview.role,
    scope: me.preview.scope,
    teamUserIds: new Set(me.preview.teamUserIds),
    managerSwitches: me.preview.managerSwitches,
  };
  return createAccess(primary, [previewer], true);
}

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
