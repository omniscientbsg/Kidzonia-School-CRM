import { isWorkingDay, zonedInstant } from '@kidzonia/shared';
import type { Question } from '@kidzonia/shared';
import { loadCalendars } from '../apps/tasks/calendars.js';
import { withUnitOfWork } from '../db/index.js';
import type { $Enums, ScopedDb } from '../db/index.js';

/**
 * The demo's day-end forms (brief 9.11, 15) and today's reports with the
 * demo's statuses. Copies follow each school's calendar (Phase 4 addition c):
 * none on a holiday or a non-working day.
 */

const TEACHER: Question[] = [
  {
    id: 'guardian',
    text: 'Did every child go home with a known guardian?',
    type: 'yes_no',
    required: true,
    options: [],
  },
  {
    id: 'present',
    text: 'How many children were present?',
    type: 'number',
    required: true,
    options: [],
  },
  {
    id: 'unwell',
    text: 'Was any child unwell or hurt today?',
    type: 'yes_no',
    required: true,
    options: [],
  },
  {
    id: 'concerns',
    text: 'Concerns raised by parents today',
    type: 'short_text',
    required: false,
    options: [],
  },
];

const PRINCIPAL: Question[] = [
  { id: 'absent', text: 'Staff absent today', type: 'number', required: true, options: [] },
  { id: 'incident', text: 'Any incident to report?', type: 'yes_no', required: true, options: [] },
  {
    id: 'visitors',
    text: 'Visitors and parent meetings',
    type: 'short_text',
    required: false,
    options: [],
  },
];

const DONE_TODAY = new Set(['u9', 'u11', 'u13', 'u18', 'u7']);

const ANSWERS: Record<string, Record<string, boolean | number | string>> = {
  teacher: { guardian: true, present: 18, unwell: false, concerns: '' },
  principal: { absent: 1, incident: false, visitors: 'Two admission visits' },
};

export async function seedDayEnd(
  db: ScopedDb,
  organisationId: string,
  users: Readonly<Record<string, string>>,
  roles: Readonly<Record<string, string>>,
  now: Date,
): Promise<Record<string, string>> {
  const cals = await loadCalendars(db, now);
  const today = cals.today;
  const forms = [
    { key: 'f1', name: 'Teacher day-end report', role: 'teacher', questions: TEACHER },
    { key: 'f2', name: 'Principal day-end report', role: 'principal', questions: PRINCIPAL },
  ];
  const people = await db.user.findMany({
    where: { deletedAt: null, status: { not: 'inactive' } },
    select: { id: true, homeSchoolId: true, roleAssignment: { select: { roleId: true } } },
  });
  const keyOf = new Map(Object.entries(users).map(([k, id]) => [id, k]));
  const creator = users.u1 ?? '';
  const out: Record<string, string> = {};

  await withUnitOfWork(
    db,
    { organisationId, userId: null, requestId: 'seed' },
    async (uow) => {
      const tx = uow.tx;
      for (const f of forms) {
        const roleId = roles[f.role] ?? '';
        const form = await tx.dayEndForm.create({
          data: { organisationId, name: f.name, blocksLogout: true, createdBy: creator },
          select: { id: true },
        });
        out[f.key] = form.id;
        const version = await tx.dayEndFormVersion.create({
          data: {
            organisationId,
            formId: form.id,
            version: 1,
            questions: f.questions,
            createdBy: creator,
          },
          select: { id: true },
        });
        await tx.dayEndFormRole.create({
          data: { organisationId, formId: form.id, roleId },
          select: { formId: true },
        });
        const task = await tx.task.create({
          data: {
            organisationId,
            kind: 'day_end',
            title: f.name,
            description: 'Fill this in before you log out today.',
            dueType: 'end_of_day',
            repeat: 'daily',
            repeatStartDate: new Date(`${today}T00:00:00Z`),
            blocksLogout: true,
            target: {
              userIds: [],
              roleIds: [roleId],
              schoolIds: [],
              excludeUserIds: [],
              includeNewJoiners: true,
            },
            dayEndFormId: form.id,
            createdBy: creator,
          },
          select: { id: true, createdBy: true },
        });
        const snapshot = {
          title: f.name,
          description: 'Fill this in before you log out today.',
          subtasks: [],
          form: { formId: form.id, versionId: version.id, version: 1, questions: f.questions },
        };
        for (const p of people.filter((x) => x.roleAssignment?.roleId === roleId)) {
          const cal = cals.forSchool(p.homeSchoolId);
          if (!isWorkingDay(cal, today)) continue;
          const done = DONE_TODAY.has(keyOf.get(p.id) ?? '');
          const at = new Date(now.getTime() - 15 * 60_000);
          const status: $Enums.AssignmentStatus = done ? 'done' : 'todo';
          await tx.taskAssignment.create({
            data: {
              organisationId,
              taskId: task.id,
              userId: p.id,
              schoolId: p.homeSchoolId,
              serviceDate: new Date(`${today}T00:00:00Z`),
              dueAt: zonedInstant(today, cal.closesAt, cal.timezone),
              status,
              needsApproval: false,
              blocksLogout: true,
              snapshot,
              ...(done ? { answers: ANSWERS[f.role], submittedAt: at, decidedAt: at } : {}),
            },
            select: { id: true, taskId: true, userId: true, schoolId: true },
          });
        }
      }
    },
    { timeoutMs: 60_000 },
  );
  // Only today is seeded; the schedule makes the days after.
  return out;
}
