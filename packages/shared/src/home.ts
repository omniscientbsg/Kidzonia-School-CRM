import { z } from 'zod';
import { idSchema } from './ids.js';
import { can, reachOf } from './permissions/engine.js';
import type { PermissionContext } from './permissions/types.js';
import { copyRowSchema, isoDateSchema, statusSchema } from './schemas/tasks.js';
import { TASK_STATUSES } from './tasks/status.js';

/**
 * Home (brief 7.3). The snapshot is chosen from permissions and reach,
 * never from a role's name, so a custom role gets a sensible Home. Each rule
 * is listed in docs/home-snapshot.md with an example role and has a test.
 */

export type SnapshotSection = 'schools' | 'set_tasks' | 'team' | 'today';

export interface SnapshotFacts {
  /** Schools in the person's scope (after the school switcher). */
  scopeSchools: number;
  /** Anyone reports to them. */
  hasTeam: boolean;
  /** They have live tasks reaching more than one school. */
  setsTasksAcrossSchools: boolean;
}

export function snapshotSections(ctx: PermissionContext, facts: SnapshotFacts): SnapshotSection[] {
  const reach = reachOf(ctx, 'tasks');
  const wide = reach === 'school' || reach === 'all';
  // Running the organisation or a group of schools: managing people or schools.
  const runsPeople =
    ctx.role?.isOwner === true || can(ctx, 'users', 'edit') || can(ctx, 'schools', 'edit');
  const managerSees = ctx.managerSwitches.manager_sees_team_tasks ?? true;
  const out: SnapshotSection[] = [];
  // Rule 1: "Your schools".
  if (facts.scopeSchools > 1 && wide && runsPeople) out.push('schools');
  // Rule 2: "Tasks you've set, by school".
  if (
    !out.includes('schools') &&
    wide &&
    can(ctx, 'tasks', 'assign') &&
    facts.setsTasksAcrossSchools
  ) {
    out.push('set_tasks');
  }
  // Rule 3: "Your team today".
  if (
    facts.hasTeam &&
    (reach === 'team' || reach === 'school' || (reach !== 'all' && managerSees))
  ) {
    out.push('team');
  }
  // Rule 4: "Today", when nothing else applies.
  if (out.length === 0) out.push('today');
  return out;
}

export const attentionSchema = z.object({
  key: z.enum(['blocking', 'approvals', 'team_overdue', 'day_end', 'waiting_for_role']),
  count: z.number(),
  label: z.string(),
  path: z.string(),
  hot: z.boolean(),
});

export const feedItemSchema = z.object({
  id: idSchema,
  text: z.string(),
  href: z.string().nullable(),
  actor: z.object({ id: idSchema, fullName: z.string() }).nullable(),
  createdAt: z.string(),
});
export type FeedItem = z.infer<typeof feedItemSchema>;

export const notificationGroupSchema = z.object({
  key: z.string(),
  event: z.string(),
  count: z.number(),
  unread: z.number(),
  createdAt: z.string(),
  text: z.string(),
  href: z.string().nullable(),
  /** The task was cancelled or can no longer be seen (Phase 5 addition e). */
  removed: z.boolean(),
});
export type NotificationGroup = z.infer<typeof notificationGroupSchema>;

const completion = z.object({
  total: z.number(),
  done: z.number(),
  submitted: z.number(),
  overdue: z.number(),
});

export const homeSchema = z.object({
  greeting: z.object({ firstName: z.string(), summary: z.string(), date: isoDateSchema }),
  attention: z.array(attentionSchema),
  sections: z.array(z.enum(['schools', 'set_tasks', 'team', 'today'])),
  schools: z
    .array(
      z.object({
        id: idSchema,
        name: z.string(),
        type: z.enum(['coco', 'franchise']),
        principal: z.string().nullable(),
        progress: completion,
        dayEnd: z.object({ done: z.number(), total: z.number() }),
      }),
    )
    .optional(),
  setTasks: z
    .array(
      z.object({
        taskId: idSchema,
        title: z.string(),
        repeat: z.string(),
        bySchool: z.array(
          z.object({ schoolName: z.string(), done: z.number(), total: z.number() }),
        ),
      }),
    )
    .optional(),
  team: z
    .array(
      z.object({
        person: z.object({
          id: idSchema,
          fullName: z.string(),
          jobTitle: z.string().nullable(),
          schoolName: z.string().nullable(),
        }),
        progress: completion,
        dayEnd: z.enum(['in', 'due']).nullable(),
      }),
    )
    .optional(),
  today: z.object({ progress: completion, items: z.array(copyRowSchema) }).optional(),
  feed: z.array(feedItemSchema),
  notifications: z.array(notificationGroupSchema),
  myTasks: z.array(copyRowSchema),
});
export type Home = z.infer<typeof homeSchema>;

// ---------- notifications ----------

export const notificationPageSchema = z.object({
  items: z.array(notificationGroupSchema),
  nextOffset: z.number().nullable(),
});
export const notificationCountSchema = z.object({ unread: z.number() });
export const markReadSchema = z.object({ keys: z.array(z.string().max(200)).min(1).max(100) });

export const CHANNELS = ['in_app', 'sms'] as const;
export type Channel = (typeof CHANNELS)[number];

/** Events that may also go by SMS / WhatsApp (brief 10.1). */
export const SMS_EVENTS = ['task_assigned', 'task_sent_back', 'task_due_soon'] as const;

/**
 * Default muting (Phase 5 answer 3): SMS/WhatsApp on for assigned and sent
 * back; due soon off, except for tasks that block logout. In-app always on.
 */
export function mutedByDefault(event: string, channel: Channel, blocksLogout: boolean): boolean {
  if (channel === 'in_app') return false;
  if (!(SMS_EVENTS as readonly string[]).includes(event)) return true;
  if (event === 'task_due_soon') return !blocksLogout;
  return false;
}

export const preferencesSchema = z.object({
  events: z.array(
    z.object({
      event: z.string(),
      label: z.string(),
      inApp: z.boolean(),
      /** Null when the event never goes by SMS/WhatsApp. */
      sms: z.boolean().nullable(),
    }),
  ),
});
export const preferenceInputSchema = z.object({
  event: z.string(),
  channel: z.enum(CHANNELS),
  on: z.boolean(),
});

// ---------- reports (brief 9.14) ----------

export const RANGES = ['today', 'this_week', 'this_month', 'custom'] as const;

export const reportFiltersSchema = z.object({
  schoolId: z.union([idSchema, z.literal('head_office')]).optional(),
  roleId: idSchema.optional(),
  department: z.string().max(80).optional(),
  userId: idSchema.optional(),
  categoryId: idSchema.optional(),
  priorityId: idSchema.optional(),
  listValue: z
    .string()
    .regex(/^[0-9a-f-]{36}:[0-9a-f-]{36}$/i)
    .optional(),
  status: z.enum([...TASK_STATUSES, 'open']).optional(),
  range: z.enum(RANGES).default('this_week'),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});
export type ReportFilters = z.infer<typeof reportFiltersSchema>;

const option = z.object({ value: z.string(), label: z.string() });

export const reportSchema = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
  summary: z.object({
    people: z.number(),
    tasks: z.number(),
    percent: z.number(),
    overdue: z.number(),
  }),
  rows: z.array(
    z.object({
      person: z.object({
        id: idSchema,
        fullName: z.string(),
        jobTitle: z.string().nullable(),
        schoolName: z.string().nullable(),
      }),
      roleName: z.string().nullable(),
      total: z.number(),
      done: z.number(),
      submitted: z.number(),
      overdue: z.number(),
      percent: z.number(),
      dayEnd: z.enum(['in', 'due']).nullable(),
    }),
  ),
  options: z.object({
    schools: z.array(option),
    roles: z.array(option),
    departments: z.array(option),
    people: z.array(option),
    categories: z.array(option),
    priorities: z.array(option),
    lists: z.array(z.object({ id: idSchema, name: z.string(), values: z.array(option) })),
  }),
  /** Filters dropped because they point at something no longer visible (addition b). */
  dropped: z.array(z.string()),
  /** Rows are paged; the summary always covers every row. */
  nextOffset: z.number().nullable(),
});
export type Report = z.infer<typeof reportSchema>;

export const savedViewSchema = z.object({
  id: idSchema,
  name: z.string(),
  filters: reportFiltersSchema,
});
export const savedViewInputSchema = z.object({
  name: z.string().trim().min(1, 'Give the view a name').max(60),
  filters: reportFiltersSchema,
});
export const savedViewListSchema = z.object({ items: z.array(savedViewSchema) });

export const personTasksSchema = z.object({
  items: z.array(copyRowSchema),
});

// ---------- search (brief 7.5) ----------

export const searchSchema = z.object({
  pages: z.array(z.object({ label: z.string(), path: z.string() })),
  tasks: z.array(z.object({ id: idSchema, title: z.string(), status: statusSchema.nullable() })),
  people: z.array(
    z.object({
      id: idSchema,
      fullName: z.string(),
      jobTitle: z.string().nullable(),
      schoolName: z.string().nullable(),
    }),
  ),
});
export type SearchResults = z.infer<typeof searchSchema>;

// ---------- school switcher (brief 7.6) ----------

export const selectSchoolSchema = z.object({ schoolId: idSchema.nullable() });
