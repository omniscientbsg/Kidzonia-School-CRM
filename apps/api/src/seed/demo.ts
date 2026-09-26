import { normalizeMobile } from '@kidzonia/shared';
import { hashPassword } from '../core/auth/passwords.js';
import { createSeedRoles } from '../core/seed-roles.js';
import { withUnitOfWork } from '../db/index.js';
import type { $Enums, DataAccess } from '../db/index.js';
import type { FileStorage } from '../core/storage.js';
import { seedTasks } from './tasks.js';
import type { TaskSeedIds } from './tasks.js';

/**
 * The clickable demo's organisation, people and roles, so the real app can be
 * compared with the demo screen by screen, with the demo's Tasks data (see
 * tasks.ts). Day-end forms and the feed are added by later phases. A second, small organisation exists to prove
 * isolation and to demo the organisation picker (Priya works at both).
 */

interface DemoSchool {
  key: string;
  name: string;
  city: string;
  type: $Enums.SchoolType;
  ownerKey?: string;
}

interface DemoPerson {
  key: string;
  name: string;
  title: string;
  mobile: string;
  email?: string;
  empId: string;
  school: string | null;
  role: string | null;
  scope: 'all' | string[];
  reportsTo?: string;
  dept?: string;
}

export const DEMO_ORG_NAME = 'Kidzonia Pre-schools';
export const SECOND_ORG_NAME = 'Sunrise Kids Academy';
/** Development-only password for Ananya, to try password sign-in. */
export const DEMO_PASSWORD = 'Kidzonia-demo-2026';

export const DEMO_SCHOOLS: readonly DemoSchool[] = [
  { key: 'jh', name: 'Jubilee Hills', city: 'Hyderabad', type: 'coco' },
  { key: 'gb', name: 'Gachibowli', city: 'Hyderabad', type: 'coco' },
  { key: 'kp', name: 'Kondapur', city: 'Hyderabad', type: 'franchise', ownerKey: 'u4' },
  { key: 'kk', name: 'Kokapet', city: 'Hyderabad', type: 'franchise', ownerKey: 'u4' },
];

export const DEMO_PEOPLE: readonly DemoPerson[] = [
  {
    key: 'u1',
    name: 'Ananya Rao',
    title: 'Managing Director',
    mobile: '98480 11201',
    email: 'ananya@kidzonia.in',
    empId: 'LO-001',
    school: null,
    role: 'owner',
    scope: 'all',
    dept: 'Management',
  },
  {
    key: 'u2',
    name: 'Vikram Mehta',
    title: 'Head of Academics',
    mobile: '98480 11202',
    email: 'vikram@kidzonia.in',
    empId: 'LO-002',
    school: null,
    role: 'dept_head',
    scope: 'all',
    reportsTo: 'u1',
    dept: 'Academics',
  },
  {
    key: 'u3',
    name: 'Farah Khan',
    title: 'Head of Operations',
    mobile: '98480 11203',
    email: 'farah@kidzonia.in',
    empId: 'LO-003',
    school: null,
    role: 'dept_head',
    scope: 'all',
    reportsTo: 'u1',
    dept: 'Operations',
  },
  {
    key: 'u4',
    name: 'Suresh Reddy',
    title: 'Franchise owner',
    mobile: '99590 22104',
    email: 'suresh@kondapur.kidzonia.in',
    empId: 'KP-001',
    school: 'kp',
    role: 'franchise_owner',
    scope: ['kp', 'kk'],
  },
  {
    key: 'u5',
    name: 'Meera Iyer',
    title: 'Principal',
    mobile: '98480 33105',
    email: 'meera@kidzonia.in',
    empId: 'JH-001',
    school: 'jh',
    role: 'principal',
    scope: ['jh'],
    reportsTo: 'u1',
  },
  {
    key: 'u6',
    name: 'Kavita Nair',
    title: 'Principal',
    mobile: '99590 22106',
    email: 'kavita@kondapur.kidzonia.in',
    empId: 'KP-002',
    school: 'kp',
    role: 'principal',
    scope: ['kp'],
    reportsTo: 'u4',
  },
  {
    key: 'u7',
    name: 'Arjun Das',
    title: 'Principal',
    mobile: '98480 33107',
    email: 'arjun@kidzonia.in',
    empId: 'GB-001',
    school: 'gb',
    role: 'principal',
    scope: ['gb'],
    reportsTo: 'u1',
  },
  {
    key: 'u8',
    name: 'Priya Sharma',
    title: 'Teacher, Nursery A',
    mobile: '98480 44108',
    empId: 'JH-014',
    school: 'jh',
    role: 'teacher',
    scope: ['jh'],
    reportsTo: 'u5',
    dept: 'Academics',
  },
  {
    key: 'u9',
    name: 'Rohan Gupta',
    title: 'Teacher, KG 1',
    mobile: '98480 44109',
    empId: 'JH-015',
    school: 'jh',
    role: 'teacher',
    scope: ['jh'],
    reportsTo: 'u5',
    dept: 'Academics',
  },
  {
    key: 'u10',
    name: 'Sneha Pillai',
    title: 'Teacher, KG 2',
    mobile: '98480 44110',
    empId: 'JH-016',
    school: 'jh',
    role: 'teacher',
    scope: ['jh'],
    reportsTo: 'u5',
    dept: 'Academics',
  },
  {
    key: 'u11',
    name: 'Imran Sheikh',
    title: 'Teacher, KG 2',
    mobile: '99590 44111',
    empId: 'KP-010',
    school: 'kp',
    role: 'teacher',
    scope: ['kp'],
    reportsTo: 'u6',
    dept: 'Academics',
  },
  {
    key: 'u12',
    name: 'Divya Menon',
    title: 'Teacher, Nursery',
    mobile: '99590 44112',
    empId: 'KP-011',
    school: 'kp',
    role: 'teacher',
    scope: ['kp'],
    reportsTo: 'u6',
    dept: 'Academics',
  },
  {
    key: 'u13',
    name: 'Lakshmi Rao',
    title: 'Teacher, KG 1',
    mobile: '98480 44113',
    empId: 'GB-010',
    school: 'gb',
    role: 'teacher',
    scope: ['gb'],
    reportsTo: 'u7',
    dept: 'Academics',
  },
  {
    key: 'u17',
    name: 'Karthik Iyer',
    title: 'Teacher, Nursery',
    mobile: '98480 44117',
    empId: 'GB-011',
    school: 'gb',
    role: 'teacher',
    scope: ['gb'],
    reportsTo: 'u7',
    dept: 'Academics',
  },
  {
    key: 'u15',
    name: 'Sanjay Kulkarni',
    title: 'Principal',
    mobile: '99590 22115',
    email: 'sanjay@kokapet.kidzonia.in',
    empId: 'KK-001',
    school: 'kk',
    role: 'principal',
    scope: ['kk'],
    reportsTo: 'u4',
  },
  {
    key: 'u16',
    name: 'Aditi Bose',
    title: 'Teacher, KG 1',
    mobile: '99590 44116',
    empId: 'KK-010',
    school: 'kk',
    role: 'teacher',
    scope: ['kk'],
    reportsTo: 'u15',
    dept: 'Academics',
  },
  {
    key: 'u18',
    name: 'Pooja Verma',
    title: 'Teacher, Nursery',
    mobile: '99590 44118',
    empId: 'KK-011',
    school: 'kk',
    role: 'teacher',
    scope: ['kk'],
    reportsTo: 'u15',
    dept: 'Academics',
  },
  {
    key: 'u14',
    name: 'Rahul Verma',
    title: 'Teacher, Playgroup',
    mobile: '98480 44114',
    empId: 'JH-017',
    school: 'jh',
    role: null,
    scope: ['jh'],
    reportsTo: 'u5',
    dept: 'Academics',
  },
];

const SECOND_SCHOOLS: readonly DemoSchool[] = [
  { key: 'mp', name: 'Madhapur', city: 'Hyderabad', type: 'coco' },
];

const SECOND_PEOPLE: readonly DemoPerson[] = [
  {
    key: 's1',
    name: 'Nisha Kapoor',
    title: 'Director',
    mobile: '97000 55001',
    empId: 'SK-001',
    school: null,
    role: 'owner',
    scope: 'all',
  },
  {
    key: 's2',
    name: 'Priya Sharma',
    title: 'Weekend teacher',
    mobile: '98480 44108',
    empId: 'SK-002',
    school: 'mp',
    role: 'teacher',
    scope: ['mp'],
    reportsTo: 's1',
  },
];

export interface SeededOrg {
  organisationId: string;
  schools: Record<string, string>;
  users: Record<string, string>;
  roles: Record<string, string>;
}

function mobile(m: string): string {
  const n = normalizeMobile(m);
  if (!n) throw new Error(`Bad demo mobile ${m}`);
  return n;
}

async function seedOrganisation(
  data: DataAccess,
  org: { name: string; setupType: $Enums.SetupType; schoolModel: $Enums.SchoolModel },
  schools: readonly DemoSchool[],
  people: readonly DemoPerson[],
  passwords: Record<string, string>,
): Promise<SeededOrg> {
  const { id: organisationId } = await data.createOrganisation(org);
  const db = data.forOrganisation(organisationId);
  const hashes: Record<string, string> = {};
  for (const [key, pw] of Object.entries(passwords)) hashes[key] = await hashPassword(pw);

  return withUnitOfWork(
    db,
    { organisationId, userId: null, requestId: 'seed' },
    async (uow) => {
      const roles = await createSeedRoles(uow, organisationId);
      const schoolIds: Record<string, string> = {};
      for (const s of schools) {
        const row = await uow.tx.school.create({
          data: { organisationId, name: s.name, city: s.city, state: 'Telangana', type: s.type },
          select: { id: true },
        });
        schoolIds[s.key] = row.id;
      }
      const userIds: Record<string, string> = {};
      // People first, then reporting lines: a manager must exist before anyone points at them.
      for (const p of people) {
        const row = await uow.tx.user.create({
          data: {
            organisationId,
            fullName: p.name,
            jobTitle: p.title,
            mobile: mobile(p.mobile),
            email: p.email ?? null,
            employeeId: p.empId,
            homeSchoolId: p.school ? (schoolIds[p.school] ?? null) : null,
            department: p.dept ?? null,
            status: 'active',
            passwordHash: hashes[p.key] ?? null,
          },
          select: { id: true },
        });
        userIds[p.key] = row.id;
      }
      for (const p of people) {
        const id = userIds[p.key];
        if (p.reportsTo && id) {
          await uow.tx.user.update({
            where: { id },
            data: { reportsToUserId: userIds[p.reportsTo] ?? null },
            select: { id: true },
          });
        }
        const roleId = p.role ? roles[p.role] : undefined;
        if (id && roleId) {
          const assignment = await uow.tx.roleAssignment.create({
            data: { organisationId, userId: id, roleId, scopeAllSchools: p.scope === 'all' },
            select: { id: true },
          });
          if (p.scope !== 'all') {
            await uow.tx.roleAssignmentSchool.createMany({
              data: p.scope.map((k) => ({
                organisationId,
                assignmentId: assignment.id,
                schoolId: schoolIds[k] ?? '',
              })),
            });
          }
        }
      }
      for (const s of schools) {
        const schoolId = schoolIds[s.key];
        if (s.ownerKey && schoolId) {
          await uow.tx.school.update({
            where: { id: schoolId },
            data: { franchiseOwnerUserId: userIds[s.ownerKey] ?? null },
            select: { id: true },
          });
        }
      }
      return { organisationId, schools: schoolIds, users: userIds, roles };
    },
    { timeoutMs: 120_000 },
  );
}

export interface SeedOptions {
  /** Where the demo's attached files go; without it only their records are made. */
  storage?: FileStorage | null;
  now?: Date;
}

export async function seedDemo(
  data: DataAccess,
  options: SeedOptions = {},
): Promise<{ demo: SeededOrg; second: SeededOrg; tasks: TaskSeedIds }> {
  const demo = await seedOrganisation(
    data,
    { name: DEMO_ORG_NAME, setupType: 'head_office', schoolModel: 'both' },
    DEMO_SCHOOLS,
    DEMO_PEOPLE,
    { u1: DEMO_PASSWORD },
  );
  const second = await seedOrganisation(
    data,
    { name: SECOND_ORG_NAME, setupType: 'single_school', schoolModel: 'coco' },
    SECOND_SCHOOLS,
    SECOND_PEOPLE,
    {},
  );
  const tasks = await seedTasks(
    data.forOrganisation(demo.organisationId),
    demo.organisationId,
    demo.users,
    options.storage ?? null,
    options.now ?? new Date(),
  );
  return { demo, second, tasks };
}

/**
 * Adds the demo's Tasks data to a development database seeded before Phase 3,
 * without touching anything else (the development database is kept, never
 * wiped). Does nothing if the demo organisation already has task data.
 */
export async function graftDemoTasks(
  data: DataAccess,
  organisationId: string,
  options: SeedOptions = {},
): Promise<boolean> {
  const db = data.forOrganisation(organisationId);
  if ((await db.taskCategory.count()) > 0 || (await db.task.count()) > 0) return false;
  const people = await db.user.findMany({
    where: { deletedAt: null },
    select: { id: true, mobile: true },
  });
  const users: Record<string, string> = {};
  for (const p of DEMO_PEOPLE) {
    const found = people.find((x) => x.mobile === mobile(p.mobile));
    if (found) users[p.key] = found.id;
  }
  await seedTasks(db, organisationId, users, options.storage ?? null, options.now ?? new Date());
  return true;
}
