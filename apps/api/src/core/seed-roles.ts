import { normalizeActions, registry } from '@kidzonia/shared';
import type { Action, FieldRule, Reach } from '@kidzonia/shared';
import type { UnitOfWork } from '../db/index.js';

interface SeedRole {
  key: string;
  name: string;
  description: string;
  isOwner: boolean;
  modules: Record<string, { actions: Action[]; reach?: Reach }>;
  fields: Record<string, Record<string, Partial<FieldRule> & Pick<FieldRule, 'access'>>>;
}

/**
 * The roles every new organisation starts with (brief 5.6), matching the
 * clickable demo's defaults. All but Owner are ordinary, editable roles.
 * Owner has no permission rows: the engine gives it everything.
 */
export const SEED_ROLES: readonly SeedRole[] = [
  {
    key: 'owner',
    name: 'Owner',
    description: 'Full access to everything. This role cannot be changed.',
    isOwner: true,
    modules: {},
    fields: {},
  },
  {
    key: 'dept_head',
    name: 'Department head',
    description: 'Runs a head-office department across all schools',
    isOwner: false,
    modules: {
      tasks: { actions: ['view', 'create', 'edit', 'assign', 'approve'], reach: 'all' },
      dayend: { actions: ['view'], reach: 'all' },
      task_reports: { actions: ['view', 'export'], reach: 'all' },
      users: { actions: ['view'], reach: 'all' },
      schools: { actions: ['view'] },
    },
    fields: { users: { mobile: { access: 'hidden' } } },
  },
  {
    key: 'franchise_owner',
    name: 'Franchise owner',
    description: 'Owns and runs one or more franchise schools',
    isOwner: false,
    modules: {
      tasks: {
        actions: ['view', 'create', 'edit', 'delete', 'assign', 'approve'],
        reach: 'school',
      },
      dayend: { actions: ['view', 'create', 'edit'], reach: 'school' },
      task_reports: { actions: ['view', 'export'], reach: 'school' },
      hrms_staff: { actions: ['view', 'create', 'edit'], reach: 'school' },
      users: { actions: ['view', 'create', 'edit'], reach: 'school' },
      schools: { actions: ['view'] },
      organisation: { actions: ['view'] },
    },
    fields: {},
  },
  {
    key: 'principal',
    name: 'Principal',
    description: 'Leads one school and its teachers',
    isOwner: false,
    modules: {
      tasks: { actions: ['view', 'create', 'edit', 'assign', 'approve'], reach: 'team' },
      dayend: { actions: ['view'], reach: 'team' },
      task_reports: { actions: ['view'], reach: 'team' },
      hrms_staff: { actions: ['view'], reach: 'team' },
      users: { actions: ['view'], reach: 'school' },
    },
    fields: {
      hrms_staff: {
        aadhaar: { access: 'hidden' },
        bankDetails: { access: 'hidden' },
        salary: { access: 'hidden' },
      },
    },
  },
  {
    key: 'teacher',
    name: 'Teacher',
    description: 'Does daily tasks and the day-end report',
    isOwner: false,
    modules: {
      tasks: { actions: ['view', 'edit'], reach: 'own' },
      task_reports: { actions: ['view'], reach: 'own' },
      hrms_staff: { actions: ['view'], reach: 'own' },
    },
    fields: {
      tasks: {
        title: { access: 'view' },
        category: { access: 'view' },
        priority: { access: 'view' },
        due: { access: 'view' },
        watchers: { access: 'hidden' },
        remarks: { access: 'view' },
        proof: { access: 'edit' },
      },
      hrms_staff: {
        homeAddress: { access: 'view', ownRecord: 'edit', needsApproval: true },
        bankDetails: { access: 'view', ownRecord: 'edit', needsApproval: true },
      },
    },
  },
];

/** Creates the seed roles for a new organisation. Returns role ids by key. */
export async function createSeedRoles(
  uow: UnitOfWork,
  organisationId: string,
): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const seed of SEED_ROLES) {
    const role = await uow.tx.role.create({
      data: {
        organisationId,
        name: seed.name,
        description: seed.description,
        isOwner: seed.isOwner,
      },
      select: { id: true },
    });
    ids[seed.key] = role.id;
    for (const [moduleKey, grant] of Object.entries(seed.modules)) {
      const mod = registry.module(moduleKey);
      await uow.tx.rolePermission.create({
        data: {
          organisationId,
          roleId: role.id,
          moduleKey,
          actions: normalizeActions(mod, grant.actions),
          reach: mod.hasReach ? (grant.reach ?? 'own') : null,
        },
        select: { id: true },
      });
    }
    for (const [moduleKey, fields] of Object.entries(seed.fields)) {
      for (const [fieldKey, rule] of Object.entries(fields)) {
        await uow.tx.roleFieldPermission.create({
          data: {
            organisationId,
            roleId: role.id,
            moduleKey,
            fieldKey,
            access: rule.access,
            ownRecord: rule.ownRecord ?? 'same',
            needsApproval: rule.needsApproval ?? false,
          },
          select: { id: true },
        });
      }
    }
    uow.audit({ action: 'role.created', entityType: 'role', entityId: role.id, after: seed });
  }
  return ids;
}
