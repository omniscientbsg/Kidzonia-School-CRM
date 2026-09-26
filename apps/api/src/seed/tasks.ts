import sharp from 'sharp';
import { addDays, localDate, weekdayOf, zonedInstant } from '@kidzonia/shared';
import type { IsoDate } from '@kidzonia/shared';
import { uuidv7 } from 'uuidv7';
import type { FileStorage } from '../core/storage.js';
import { DbNull, withUnitOfWork } from '../db/index.js';
import type { $Enums, ScopedDb, UnitOfWork } from '../db/index.js';

/**
 * The clickable demo's Tasks data (brief 15): categories, priorities, the
 * Area list, parent messages, task templates and tasks t1 to t8 with every
 * person's copy, so the real app can be compared with the demo screen by
 * screen. Dates are relative to the day the seed runs ("Today" is today).
 * Day-end forms come with Phase 4.
 */

type Key = string;
type Status = $Enums.AssignmentStatus;

interface DemoCopy {
  user: Key;
  status: Status;
  /** Ticked sub-task indexes. */
  done?: number[];
  files?: string[];
}

interface DemoTask {
  key: string;
  title: string;
  description: string;
  createdBy: Key;
  category: string;
  priority: string;
  area?: string;
  due: { type: $Enums.TaskDueType; time?: string; inDays?: number };
  repeat: $Enums.TaskRepeat;
  approval: boolean;
  blocksLogout?: boolean;
  watchers?: { user: Key; access: $Enums.WatcherAccess }[];
  subtasks?: { title: string; assignee?: Key }[];
  parentMessage?: { template: string; className: string };
  copies: DemoCopy[];
}

const CATEGORIES = [
  ['Academics', '#2B5896'],
  ['Safety', '#B42318'],
  ['Operations', '#1C5A51'],
  ['Events', '#8A4FBF'],
  ['Admin', '#6B6F2A'],
] as const;

const PRIORITIES = [
  ['Urgent', '#B42318'],
  ['High', '#D9770A'],
  ['Medium', '#2B5896'],
  ['Low', '#5F6A67'],
] as const;

const AREA_VALUES = ['Classroom', 'Kitchen', 'Playground', 'Transport', 'Office'];

const MESSAGES = [
  [
    'tpl1',
    'Consent received',
    'Dear parent, we have received the consent form for {student_name} for the {event_name}. Thank you.',
  ],
  [
    'tpl2',
    'Event update',
    'Dear parent, preparations for {event_name} are complete. Timings for {class_name} are now on the school app.',
  ],
  [
    'tpl3',
    'Class activity done',
    'Dear parent, today {class_name} completed {activity}. Photos are on the school app.',
  ],
] as const;

const TEMPLATES = [
  {
    name: 'Classroom safety check',
    title: 'Classroom safety check',
    description: 'Walk through your classroom before children leave and confirm each point.',
    category: 'Safety',
    priority: 'Urgent',
    area: 'Classroom',
    dueType: 'end_of_day' as const,
    dueTime: null,
    repeat: 'daily' as const,
    subtasks: ['Fire exit is clear', 'First-aid kit is stocked', 'All sockets are covered'],
    needsApproval: true,
    blocksLogout: true,
    parentMessage: null,
  },
  {
    name: 'Weekly lesson plan',
    title: 'Submit weekly lesson plan',
    description: 'Upload next week’s plan with the worksheet list for each subject.',
    category: 'Academics',
    priority: 'Medium',
    area: 'Classroom',
    dueType: 'at_time' as const,
    dueTime: '13:00',
    repeat: 'weekly' as const,
    subtasks: ['Upload plan for each subject', 'Attach worksheet list'],
    needsApproval: true,
    blocksLogout: false,
    parentMessage: null,
  },
  {
    name: 'Event preparation',
    title: 'Prepare for [event name]',
    description: 'Share the schedule, costume list and music for the event.',
    category: 'Events',
    priority: 'Medium',
    area: null,
    dueType: 'on_date' as const,
    dueTime: null,
    repeat: 'none' as const,
    subtasks: ['Schedule', 'Costume list', 'Music track'],
    needsApproval: true,
    blocksLogout: false,
    parentMessage: { template: 'tpl2', className: 'Nursery A' },
  },
];

const TEACHERS = ['u8', 'u9', 'u10', 'u11', 'u12', 'u13', 'u17', 'u16', 'u18'];
const c = (user: Key, status: Status, extra: Omit<DemoCopy, 'user' | 'status'> = {}): DemoCopy => ({
  user,
  status,
  ...extra,
});

export const DEMO_TASKS: readonly DemoTask[] = [
  {
    key: 't1',
    title: 'Mark class attendance',
    description: 'Mark attendance for your class in the register before assembly ends.',
    createdBy: 'u2',
    category: 'Academics',
    priority: 'High',
    area: 'Classroom',
    due: { type: 'at_time', time: '09:30' },
    repeat: 'daily',
    approval: false,
    copies: TEACHERS.map((u) => c(u, u === 'u12' || u === 'u17' ? 'overdue' : 'done')),
  },
  {
    key: 't2',
    title: 'Submit weekly lesson plan',
    description: 'Upload next week’s lesson plan with the worksheet list for each subject.',
    createdBy: 'u2',
    category: 'Academics',
    priority: 'Medium',
    area: 'Classroom',
    due: { type: 'at_time', time: '13:00' },
    repeat: 'weekly',
    approval: true,
    watchers: ['u5', 'u6', 'u7', 'u15'].map((user) => ({ user, access: 'view' as const })),
    subtasks: [{ title: 'Upload plan for each subject' }, { title: 'Attach worksheet list' }],
    copies: [
      c('u8', 'in_progress', { done: [0] }),
      c('u9', 'submitted', { done: [0, 1], files: ['Lesson_plan_KG1.pdf'] }),
      c('u10', 'approved', { done: [0, 1] }),
      c('u11', 'submitted', { done: [0, 1], files: ['Plan_KG2.pdf'] }),
      c('u12', 'todo'),
      c('u13', 'approved', { done: [0, 1] }),
      c('u17', 'submitted', { done: [0, 1], files: ['Nursery_plan.pdf'] }),
      c('u16', 'todo'),
      c('u18', 'approved', { done: [0, 1] }),
    ],
  },
  {
    key: 't3',
    title: 'Classroom safety check',
    description: 'Walk through your classroom before children leave and confirm each point.',
    createdBy: 'u5',
    category: 'Safety',
    priority: 'Urgent',
    area: 'Classroom',
    due: { type: 'end_of_day' },
    repeat: 'daily',
    approval: true,
    blocksLogout: true,
    subtasks: [
      { title: 'Fire exit is clear' },
      { title: 'First-aid kit is stocked' },
      { title: 'All sockets are covered' },
    ],
    copies: [
      // The demo shows "To do" with one tick; here the first tick starts the work (brief 9.4).
      c('u8', 'in_progress', { done: [0] }),
      c('u9', 'submitted', { done: [0, 1, 2], files: ['Room_KG1.jpg'] }),
      c('u10', 'approved', { done: [0, 1, 2] }),
    ],
  },
  {
    key: 't4',
    title: 'Plan Annual Day rehearsal for Nursery A',
    description: 'Share the rehearsal schedule, costume list and music for the Annual Day item.',
    createdBy: 'u5',
    category: 'Events',
    priority: 'Medium',
    due: { type: 'on_date', inDays: 4 },
    repeat: 'none',
    approval: true,
    watchers: [
      { user: 'u2', access: 'view' },
      { user: 'u3', access: 'edit' },
    ],
    subtasks: [
      { title: 'Rehearsal schedule', assignee: 'u8' },
      { title: 'Costume list' },
      { title: 'Music track' },
    ],
    parentMessage: { template: 'tpl2', className: 'Nursery A' },
    copies: [c('u8', 'in_progress', { done: [0] })],
  },
  {
    key: 't5',
    title: 'Kitchen hygiene audit',
    description:
      'Complete the weekly kitchen audit and attach photos of storage and serving areas.',
    createdBy: 'u3',
    category: 'Operations',
    priority: 'High',
    area: 'Kitchen',
    due: { type: 'at_time', time: '15:00' },
    repeat: 'weekly',
    approval: true,
    subtasks: [{ title: 'Storage area photos' }, { title: 'Serving area photos' }],
    copies: [
      c('u5', 'submitted', { done: [0, 1], files: ['Kitchen_1.jpg', 'Kitchen_2.jpg'] }),
      c('u6', 'approved', { done: [0, 1] }),
      c('u7', 'overdue'),
      c('u15', 'todo'),
    ],
  },
  {
    key: 't6',
    title: 'Update parent contact sheet',
    description: 'Check every parent phone number against the admission forms.',
    createdBy: 'u4',
    category: 'Admin',
    priority: 'Low',
    area: 'Office',
    due: { type: 'on_date', inDays: 2 },
    repeat: 'none',
    approval: false,
    copies: [c('u6', 'in_progress'), c('u15', 'todo')],
  },
  {
    key: 't7',
    title: 'Collect field trip consent forms',
    description: 'Collect signed consent forms for the zoo trip on 3 October.',
    createdBy: 'u6',
    category: 'Events',
    priority: 'High',
    due: { type: 'on_date', inDays: 3 },
    repeat: 'none',
    approval: true,
    watchers: [{ user: 'u4', access: 'view' }],
    parentMessage: { template: 'tpl1', className: 'KG 2' },
    copies: [c('u11', 'submitted', { files: ['Consent_forms.pdf'] }), c('u12', 'todo')],
  },
  {
    key: 't8',
    title: 'Share weekly school update',
    description: 'Admissions, staff attendance and any issues from this week.',
    createdBy: 'u1',
    category: 'Admin',
    priority: 'Medium',
    due: { type: 'at_time', time: '17:00' },
    repeat: 'weekly',
    approval: true,
    copies: [c('u5', 'submitted'), c('u7', 'submitted'), c('u6', 'todo'), c('u15', 'in_progress')],
  },
];

/** A real (tiny) file of each kind, so the demo's attachments open. */
async function placeholder(name: string): Promise<{ data: Buffer; type: string }> {
  if (name.endsWith('.jpg')) {
    const data = await sharp({
      create: { width: 640, height: 480, channels: 3, background: '#cfe3dc' },
    })
      .jpeg({ quality: 70 })
      .toBuffer();
    return { data, type: 'image/jpeg' };
  }
  const pdf = [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] >> endobj',
    'trailer << /Root 1 0 R >>',
    '%%EOF',
  ].join('\n');
  return { data: Buffer.from(pdf, 'latin1'), type: 'application/pdf' };
}

export interface TaskSeedIds {
  categories: Record<string, string>;
  priorities: Record<string, string>;
  areaListId: string;
  area: Record<string, string>;
  messages: Record<string, string>;
  tasks: Record<string, string>;
}

export async function seedTasks(
  db: ScopedDb,
  organisationId: string,
  users: Readonly<Record<string, string>>,
  storage: FileStorage | null,
  now: Date,
): Promise<TaskSeedIds> {
  const org = await db.organisation.findFirstOrThrow({
    select: { timezone: true, closesAt: true },
  });
  const today = localDate(now, org.timezone);
  const u = (k: Key) => {
    const id = users[k];
    if (!id) throw new Error(`No demo person ${k}`);
    return id;
  };
  const people = await db.user.findMany({
    where: { id: { in: Object.values(users) } },
    select: { id: true, homeSchoolId: true },
  });
  const schoolOf = new Map(people.map((p) => [p.id, p.homeSchoolId]));
  const files: { key: string; name: string; type: string; data: Buffer }[] = [];

  const ids = await withUnitOfWork(
    db,
    { organisationId, userId: null, requestId: 'seed' },
    async (uow: UnitOfWork) => {
      const tx = uow.tx;
      const out: TaskSeedIds = {
        categories: {},
        priorities: {},
        areaListId: '',
        area: {},
        messages: {},
        tasks: {},
      };
      for (const [i, [name, color]] of CATEGORIES.entries()) {
        const row = await tx.taskCategory.create({
          data: { organisationId, name, color, sortOrder: i },
          select: { id: true },
        });
        out.categories[name] = row.id;
      }
      for (const [i, [name, color]] of PRIORITIES.entries()) {
        const row = await tx.taskPriority.create({
          data: { organisationId, name, color, sortOrder: i },
          select: { id: true },
        });
        out.priorities[name] = row.id;
      }
      const list = await tx.taskList.create({
        data: { organisationId, name: 'Area' },
        select: { id: true },
      });
      out.areaListId = list.id;
      for (const [i, value] of AREA_VALUES.entries()) {
        const row = await tx.taskListValue.create({
          data: { organisationId, listId: list.id, value, sortOrder: i },
          select: { id: true },
        });
        out.area[value] = row.id;
      }
      for (const [key, name, body] of MESSAGES) {
        const row = await tx.parentMessageTemplate.create({
          data: { organisationId, name, body },
          select: { id: true },
        });
        out.messages[key] = row.id;
      }
      for (const t of TEMPLATES) {
        await tx.taskTemplate.create({
          data: {
            organisationId,
            name: t.name,
            payload: {
              title: t.title,
              description: t.description,
              categoryId: out.categories[t.category] ?? null,
              priorityId: out.priorities[t.priority] ?? null,
              customValues: t.area ? { [list.id]: out.area[t.area] ?? null } : {},
              dueType: t.dueType,
              dueTime: t.dueTime,
              repeat: t.repeat,
              repeatWeekdays: t.repeat === 'weekly' ? [1] : [],
              repeatMonthDay: null,
              closesAfterMinutes: null,
              needsApproval: t.needsApproval,
              approverMode: 'creator',
              blocksLogout: t.blocksLogout,
              parentMessage: t.parentMessage
                ? {
                    templateId: out.messages[t.parentMessage.template] ?? '',
                    className: t.parentMessage.className,
                  }
                : null,
              subtasks: t.subtasks.map((title) => ({ title })),
            },
          },
          select: { id: true },
        });
      }

      for (const [ti, t] of DEMO_TASKS.entries()) {
        const date: IsoDate = t.due.inDays ? addDays(today, t.due.inDays) : today;
        const creator = u(t.createdBy);
        const task = await tx.task.create({
          data: {
            organisationId,
            title: t.title,
            description: t.description,
            categoryId: out.categories[t.category] ?? null,
            priorityId: out.priorities[t.priority] ?? null,
            customValues: t.area ? { [list.id]: out.area[t.area] ?? '' } : {},
            dueType: t.due.type,
            dueTime: t.due.time ?? null,
            dueDate: t.due.type === 'on_date' ? new Date(`${date}T00:00:00Z`) : null,
            repeat: t.repeat,
            repeatWeekdays: t.repeat === 'weekly' ? [weekdayOf(today)] : [],
            repeatStartDate: new Date(`${today}T00:00:00Z`),
            needsApproval: t.approval,
            approverMode: 'creator',
            blocksLogout: t.blocksLogout ?? false,
            parentMessage: t.parentMessage
              ? {
                  templateId: out.messages[t.parentMessage.template] ?? '',
                  className: t.parentMessage.className,
                }
              : DbNull,
            target: {
              userIds: t.copies.map((x) => u(x.user)),
              roleIds: [],
              schoolIds: [],
              excludeUserIds: [],
              includeNewJoiners: false,
            },
            createdBy: creator,
            generatedThrough: new Date(`${date}T00:00:00Z`),
            // Keeps "Assigned by me" in the demo's order.
            createdAt: new Date(now.getTime() - (DEMO_TASKS.length - ti) * 60_000),
          },
          select: { id: true, createdBy: true },
        });
        out.tasks[t.key] = task.id;
        const subtasks: {
          id: string;
          title: string;
          sortOrder: number;
          assigneeUserId: string | null;
        }[] = [];
        for (const [i, s] of (t.subtasks ?? []).entries()) {
          subtasks.push(
            await tx.taskSubtask.create({
              data: {
                organisationId,
                taskId: task.id,
                title: s.title,
                sortOrder: i,
                assigneeUserId: s.assignee ? u(s.assignee) : null,
              },
              select: { id: true, title: true, sortOrder: true, assigneeUserId: true },
            }),
          );
        }
        if (t.watchers?.length) {
          await tx.taskWatcher.createMany({
            data: t.watchers.map((w) => ({
              organisationId,
              taskId: task.id,
              userId: u(w.user),
              access: w.access,
            })),
          });
        }
        const time = t.due.type === 'end_of_day' ? org.closesAt : (t.due.time ?? org.closesAt);
        const dueAt = zonedInstant(date, time, org.timezone);
        const snapshot = {
          title: t.title,
          description: t.description,
          subtasks: subtasks.map((s) => ({
            id: s.id,
            title: s.title,
            order: s.sortOrder,
            assigneeUserId: s.assigneeUserId,
          })),
        };
        for (const [ci, copy] of t.copies.entries()) {
          const userId = u(copy.user);
          const waited = ['submitted', 'approved', 'done'].includes(copy.status);
          const decided = ['approved', 'done'].includes(copy.status);
          const at = new Date(now.getTime() - (20 + ci * 7) * 60_000);
          const row = await tx.taskAssignment.create({
            data: {
              organisationId,
              taskId: task.id,
              userId,
              schoolId: schoolOf.get(userId) ?? null,
              serviceDate: new Date(`${date}T00:00:00Z`),
              dueAt,
              status: copy.status,
              needsApproval: t.approval,
              approverUserId: t.approval ? creator : null,
              blocksLogout: t.blocksLogout ?? false,
              snapshot,
              submittedAt: waited ? at : null,
              decidedAt: decided ? at : null,
              decidedBy: decided && t.approval ? creator : null,
            },
            select: { id: true, userId: true, schoolId: true },
          });
          const ticked = (copy.done ?? [])
            .map((i) => subtasks[i]?.id)
            .filter((x) => x !== undefined);
          if (ticked.length > 0) {
            await tx.taskAssignmentSubtask.createMany({
              data: ticked.map((subtaskId) => ({
                organisationId,
                assignmentId: row.id,
                subtaskId,
                doneBy: userId,
              })),
            });
          }
          for (const name of copy.files ?? []) {
            const file = await placeholder(name);
            const ext = name.split('.').pop() ?? 'bin';
            const key = `org/${organisationId}/tasks/${row.id}/${uuidv7()}.${ext}`;
            files.push({ key, name, type: file.type, data: file.data });
            await tx.taskAttachment.create({
              data: {
                organisationId,
                assignmentId: row.id,
                storageKey: key,
                fileName: name,
                contentType: file.type,
                sizeBytes: file.data.length,
                uploadedBy: userId,
              },
              select: { id: true },
            });
          }
        }
      }
      return out;
    },
    { timeoutMs: 120_000 },
  );
  if (storage) for (const f of files) await storage.put(f.key, f.data, f.type);
  return ids;
}
