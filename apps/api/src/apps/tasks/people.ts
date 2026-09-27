import type { Access, Target } from '@kidzonia/shared';
import type { ScopedTx } from '../../db/index.js';
import { AppError, businessRule } from '../../lib/errors.js';
import { userFacts } from '../../core/users/facts.js';

/**
 * Everyone in the organisation, loaded once per request that needs to find
 * people (targeting, approvers). One query instead of one per person keeps a
 * 1,000-person assignment fast; organisations have thousands of people, not
 * millions.
 */
export interface Person {
  id: string;
  fullName: string;
  jobTitle: string | null;
  homeSchoolId: string | null;
  schoolName: string | null;
  reportsToUserId: string | null;
  /** Not inactive and not deleted. */
  active: boolean;
  roleId: string | null;
  roleName: string | null;
  isOwner: boolean;
}

export type People = ReadonlyMap<string, Person>;

export async function loadPeople(tx: ScopedTx): Promise<People> {
  const rows = await tx.user.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      fullName: true,
      jobTitle: true,
      homeSchoolId: true,
      homeSchool: { select: { name: true } },
      reportsToUserId: true,
      status: true,
      roleAssignment: {
        select: { roleId: true, role: { select: { name: true, isOwner: true, deletedAt: true } } },
      },
    },
  });
  return new Map(
    rows.map((u) => {
      const role = u.roleAssignment && !u.roleAssignment.role.deletedAt ? u.roleAssignment : null;
      return [
        u.id,
        {
          id: u.id,
          fullName: u.fullName,
          jobTitle: u.jobTitle,
          homeSchoolId: u.homeSchoolId,
          schoolName: u.homeSchool?.name ?? null,
          reportsToUserId: u.reportsToUserId,
          active: u.status !== 'inactive',
          roleId: role?.roleId ?? null,
          roleName: role?.role.name ?? null,
          isOwner: role?.role.isOwner ?? false,
        },
      ];
    }),
  );
}

export const personRef = (p: Person) => ({
  id: p.id,
  fullName: p.fullName,
  jobTitle: p.jobTitle,
  schoolName: p.schoolName,
});

/** Someone who can actually do tasks: active, with a role (rule 1). */
export const canWork = (p: Person | undefined): p is Person =>
  p !== undefined && p.active && p.roleId !== null;

export interface ResolvedTarget {
  people: Person[];
  /** How many a group matched but were quietly skipped as out of reach. */
  skipped: number;
}

/**
 * Brief 9.3. A person is a valid target when they're the creator or within
 * the creator's `tasks.assign` reach. Naming someone out of reach is an
 * error shown to the creator; a group quietly skips them. Inactive people and
 * people without a role are never included.
 */
export function resolveTarget(
  access: Access,
  people: People,
  target: Target,
  liveRoleIds: ReadonlySet<string>,
  liveSchoolIds: ReadonlySet<string>,
): ResolvedTarget {
  const me = access.userId;
  const canAssign = (p: Person) =>
    p.id === me ||
    access.can('tasks', 'assign', userFacts({ id: p.id, homeSchoolId: p.homeSchoolId }));

  const chosen = new Map<string, Person>();
  const problems: string[] = [];
  for (const id of target.userIds) {
    const p = people.get(id);
    if (!p) {
      problems.push('Someone you chose is no longer in your organisation.');
    } else if (!p.active) {
      problems.push(`${p.fullName} is inactive.`);
    } else if (!p.roleId) {
      problems.push(`${p.fullName} doesn’t have a role yet, so can’t be given tasks.`);
    } else if (!canAssign(p)) {
      problems.push(`${p.fullName} is outside the people you can give tasks to.`);
    } else {
      chosen.set(p.id, p);
    }
  }
  if (problems.length > 0) {
    throw new AppError('business_rule', problems.join(' '), { target: problems[0] ?? '' });
  }

  let skipped = 0;
  const roleFilter = target.roleIds;
  const schoolFilter = target.schoolIds;
  if (
    roleFilter.some((r) => !liveRoleIds.has(r)) ||
    schoolFilter.some((s) => !liveSchoolIds.has(s))
  ) {
    throw businessRule('One of the roles or schools you chose no longer exists.');
  }
  if (roleFilter.length + schoolFilter.length > 0) {
    for (const p of people.values()) {
      if (!canWork(p)) continue;
      if (roleFilter.length > 0 && !roleFilter.includes(p.roleId ?? '')) continue;
      if (schoolFilter.length > 0 && !schoolFilter.includes(p.homeSchoolId ?? '')) continue;
      if (!canAssign(p)) {
        skipped++;
        continue;
      }
      chosen.set(p.id, p);
    }
  }
  for (const id of target.excludeUserIds) chosen.delete(id);
  return { people: [...chosen.values()], skipped };
}

/** The people above someone, nearest first. Loops are impossible (a database trigger). */
export function chainOf(people: People, userId: string): Person[] {
  const out: Person[] = [];
  let next = people.get(userId)?.reportsToUserId ?? null;
  while (next && out.length < 50) {
    const p = people.get(next);
    if (!p) break;
    out.push(p);
    next = p.reportsToUserId;
  }
  return out;
}

/**
 * Who approves one person's copy (brief 9.6). The chosen approver if they can
 * act and aren't the person themselves; otherwise up the chain (the inactive
 * approver's manager, or the person's own manager when they'd approve
 * themselves), then an Owner. Null means nobody can: the copy then needs no
 * approval, and completing it is audited (decision 5).
 */
export function resolveApprover(
  people: People,
  candidateId: string | null,
  assigneeId: string,
  /**
   * The candidate's own manager, for a candidate no longer in `people` (a
   * deleted approver): the search still climbs the approver's chain, not the
   * assignee's.
   */
  candidateManagerId: string | null = null,
): string | null {
  // Deliberately not a type guard: a Person can fail it, which must not narrow to undefined.
  const ok = (p: Person | undefined): boolean => canWork(p) && p.id !== assigneeId;
  const candidate = candidateId ? people.get(candidateId) : undefined;
  if (candidate && ok(candidate)) return candidate.id;
  // A deleted approver isn't in `people`: start from their manager, who counts too.
  const managerFirst =
    !candidate && candidateManagerId ? people.get(candidateManagerId) : undefined;
  const start = candidate && candidate.id !== assigneeId ? candidate.id : assigneeId;
  const chain = managerFirst
    ? [managerFirst, ...chainOf(people, managerFirst.id)]
    : chainOf(people, start);
  const fromChain = chain.find((p) => ok(p));
  if (fromChain) return fromChain.id;
  const owners = [...people.values()].filter((p) => p.isOwner && ok(p));
  owners.sort((a, b) => a.id.localeCompare(b.id));
  return owners[0]?.id ?? null;
}

/** The starting candidate for a copy, by the task's approver mode. */
export function approverCandidate(
  mode: 'creator' | 'reporting_manager' | 'named_user',
  task: { createdBy: string; approverUserId: string | null },
  assignee: Person,
): string | null {
  if (mode === 'creator') return task.createdBy;
  if (mode === 'named_user') return task.approverUserId;
  return assignee.reportsToUserId;
}
