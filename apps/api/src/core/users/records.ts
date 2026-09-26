import type { Prisma, ScopedTx } from '../../db/index.js';

/** Everything a Users record response can contain; serialize() then trims it. */
export const USER_SELECT = {
  id: true,
  fullName: true,
  mobile: true,
  email: true,
  employeeId: true,
  jobTitle: true,
  homeSchoolId: true,
  homeSchool: { select: { name: true } },
  reportsToUserId: true,
  reportsTo: { select: { fullName: true } },
  department: true,
  startDate: true,
  status: true,
  invitedAt: true,
  lastLoginAt: true,
  roleAssignment: {
    select: {
      roleId: true,
      scopeAllSchools: true,
      role: { select: { name: true, isOwner: true } },
      schools: { select: { schoolId: true } },
    },
  },
  _count: { select: { directReports: { where: { deletedAt: null } } } },
} as const satisfies Prisma.UserSelect;

export type UserRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** The full record in API shape, before field permissions are applied. */
export function toUserRecord(u: UserRow) {
  const a = u.roleAssignment;
  return {
    id: u.id,
    fullName: u.fullName,
    mobile: u.mobile,
    email: u.email,
    employeeId: u.employeeId,
    jobTitle: u.jobTitle,
    photoUrl: null,
    homeSchoolId: u.homeSchoolId,
    homeSchoolName: u.homeSchool?.name ?? null,
    reportsToUserId: u.reportsToUserId,
    reportsToName: u.reportsTo?.fullName ?? null,
    department: u.department,
    startDate: day(u.startDate),
    status: u.status,
    role: a
      ? {
          id: a.roleId,
          name: a.role.name,
          isOwner: a.role.isOwner,
          scope: { allSchools: a.scopeAllSchools, schoolIds: a.schools.map((s) => s.schoolId) },
        }
      : null,
    directReportsCount: u._count.directReports,
    invitedAt: u.invitedAt?.toISOString() ?? null,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  };
}

export type UserRecord = ReturnType<typeof toUserRecord>;

/** The editable props, in input shape (as a PUT would send them). */
export function editableValues(u: UserRow) {
  return {
    fullName: u.fullName,
    mobile: u.mobile,
    email: u.email,
    employeeId: u.employeeId,
    jobTitle: u.jobTitle,
    homeSchoolId: u.homeSchoolId,
    reportsToUserId: u.reportsToUserId,
    department: u.department,
    startDate: day(u.startDate),
  };
}

export type EditableUser = ReturnType<typeof editableValues>;

export async function findLiveUser(tx: ScopedTx, id: string): Promise<UserRow | null> {
  return tx.user.findFirst({ where: { id, deletedAt: null }, select: USER_SELECT });
}

/** Turns input-shape values into the Prisma update shape. */
export function toUserData(v: Partial<EditableUser>): Prisma.UserUncheckedUpdateInput {
  const { startDate, ...rest } = v;
  return {
    ...rest,
    ...(startDate === undefined
      ? {}
      : { startDate: startDate ? new Date(`${startDate}T00:00:00Z`) : null }),
  };
}
