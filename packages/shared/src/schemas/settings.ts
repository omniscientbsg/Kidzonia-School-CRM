import { z } from 'zod';
import { idSchema } from '../ids.js';
import { pageQuerySchema } from '../pagination.js';
import { ACTIONS, FIELD_ACCESS, REACHES } from '../registry/index.js';
import { OWN_RECORD_RULES } from '../permissions/index.js';
import { mobileSchema, timeOfDaySchema, workingDaysSchema } from './common.js';

const text = (label: string, max = 120) =>
  z
    .string({ message: `Enter ${label}` })
    .trim()
    .min(1, `Enter ${label}`)
    .max(max, `Keep ${label} under ${max} characters`);

/** Optional free text: empty strings become null so "clear this" works. */
const optionalText = (max = 120) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters`)
    .nullish()
    .transform((v) => (v ? v : null));

export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-02')
  .refine((v) => !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()), 'That date doesn’t exist');

export const timezoneSchema = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'Choose a valid time zone');

export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(200, 'Keep the password under 200 characters');

export const setupTypeSchema = z.enum(['single_school', 'head_office']);
export const schoolModelSchema = z.enum(['coco', 'franchise', 'both']);
export const schoolTypeSchema = z.enum(['coco', 'franchise']);
export const userStatusSchema = z.enum(['invited', 'active', 'inactive']);

export const schoolScopeSchema = z
  .object({ allSchools: z.boolean(), schoolIds: z.array(idSchema).max(500) })
  .refine((s) => s.allSchools || s.schoolIds.length > 0, {
    message: 'Choose all schools or at least one school',
    path: ['schoolIds'],
  });

// ---------- registration ----------

export const registerVerifyResponseSchema = z.object({ registrationToken: z.string() });

export const registerSchema = z
  .object({
    registrationToken: z.string().min(1),
    fullName: text('your full name'),
    email: z.email('Enter a valid email').nullish(),
    password: passwordSchema,
    setupType: setupTypeSchema,
    schoolModel: schoolModelSchema,
    organisation: z.object({
      name: text('a name'),
      city: text('the city', 80),
      state: optionalText(80),
      workingDays: workingDaysSchema,
      opensAt: timeOfDaySchema,
      closesAt: timeOfDaySchema,
    }),
    schools: z
      .array(
        z.object({
          name: text('the school name'),
          city: text('the city', 80),
          type: schoolTypeSchema,
          owner: z.object({ fullName: text('the owner’s name'), mobile: mobileSchema }).nullish(),
        }),
      )
      .max(200)
      .default([]),
  })
  .superRefine((r, ctx) => {
    if (r.organisation.opensAt >= r.organisation.closesAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['organisation', 'closesAt'],
        message: 'Closing time must be after opening time',
      });
    }
    if (r.setupType === 'single_school' && r.schools.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['schools'],
        message: 'A single school has no other schools',
      });
    }
    r.schools.forEach((s, i) => {
      if (s.owner && s.type !== 'franchise') {
        ctx.addIssue({
          code: 'custom',
          path: ['schools', i, 'owner'],
          message: 'Only franchise schools have an owner',
        });
      }
    });
  });
export type RegisterInput = z.input<typeof registerSchema>;

// ---------- organisation ----------

export const organisationSchema = z.object({
  id: idSchema,
  name: z.string(),
  logoUrl: z.string().nullable(),
  setupType: setupTypeSchema,
  schoolModel: schoolModelSchema,
  timezone: z.string(),
  workingDays: z.array(z.number()),
  opensAt: z.string(),
  closesAt: z.string(),
  logoutBlockLeadMinutes: z.number(),
});
export type Organisation = z.infer<typeof organisationSchema>;

export const updateOrganisationSchema = z
  .object({
    name: text('a name'),
    setupType: setupTypeSchema,
    schoolModel: schoolModelSchema,
    timezone: timezoneSchema,
    workingDays: workingDaysSchema,
    opensAt: timeOfDaySchema,
    closesAt: timeOfDaySchema,
    /** Minutes before a blocking task's deadline that logout is blocked (0 = from the deadline). */
    logoutBlockLeadMinutes: z
      .number()
      .int()
      .min(0, 'Use 0 or more minutes')
      .max(720, 'At most 12 hours'),
  })
  .partial();

/** What a new holiday would fall on (Phase 4 answer 1): one-time tasks keep their date. */
export const holidayImpactInputSchema = z.object({
  startDate: dateOnlySchema,
  endDate: dateOnlySchema.nullish(),
  schoolIds: z.array(idSchema).max(500).default([]),
});
export const holidayImpactSchema = z.object({
  oneTimeTasks: z.number(),
  copies: z.number(),
  titles: z.array(z.string()),
});

export const checklistSchema = z.object({
  dismissed: z.boolean(),
  items: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      detail: z.string(),
      done: z.boolean(),
      path: z.string(),
    }),
  ),
});
export type Checklist = z.infer<typeof checklistSchema>;

// ---------- holidays ----------

export const holidaySchema = z.object({
  id: idSchema,
  name: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  schoolIds: z.array(idSchema),
});
export type Holiday = z.infer<typeof holidaySchema>;

const holidayFields = z.object({
  name: text('a name', 80),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema.nullish(),
  /** Empty means every school. */
  schoolIds: z.array(idSchema).max(500),
});
const endAfterStart = (h: {
  startDate?: string | undefined;
  endDate?: string | null | undefined;
}) => !h.startDate || !h.endDate || h.endDate >= h.startDate;

export const createHolidaySchema = holidayFields.refine(endAfterStart, {
  message: 'The last day can’t be before the first day',
  path: ['endDate'],
});
export const updateHolidaySchema = holidayFields.partial();
export { endAfterStart as holidayEndAfterStart };

export const holidayListQuerySchema = pageQuerySchema.extend({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

// ---------- schools ----------

export const schoolSchema = z.object({
  id: idSchema,
  name: z.string().optional(),
  city: z.string().optional(),
  state: z.string().nullable().optional(),
  type: schoolTypeSchema.optional(),
  franchiseOwnerUserId: idSchema.nullable().optional(),
  franchiseOwnerName: z.string().nullable().optional(),
  principalUserId: idSchema.nullable().optional(),
  principalName: z.string().nullable().optional(),
  workingDays: z.array(z.number()).optional(),
  opensAt: z.string().nullable().optional(),
  closesAt: z.string().nullable().optional(),
  peopleCount: z.number().optional(),
});
export type School = z.infer<typeof schoolSchema>;

const schoolFields = z.object({
  name: text('the school name'),
  city: text('the city', 80),
  state: optionalText(80),
  type: schoolTypeSchema,
  franchiseOwnerUserId: idSchema.nullable(),
  principalUserId: idSchema.nullable(),
  /** Empty means "use the organisation's working days". */
  workingDays: z.array(z.number().int().min(0).max(6)).max(7),
  opensAt: timeOfDaySchema.nullable(),
  closesAt: timeOfDaySchema.nullable(),
});

export const createSchoolSchema = schoolFields
  .partial({
    state: true,
    franchiseOwnerUserId: true,
    principalUserId: true,
    workingDays: true,
    opensAt: true,
    closesAt: true,
  })
  .extend({
    /** Franchise schools can invite their owner in the same step. */
    inviteOwner: z
      .object({ fullName: text('the owner’s name'), mobile: mobileSchema, roleId: idSchema })
      .nullish(),
  });
export const updateSchoolSchema = schoolFields.partial();

// ---------- users ----------

export const roleRefSchema = z.object({ id: idSchema, name: z.string(), isOwner: z.boolean() });

/** A Users record as returned: every field is optional because field permissions may hide it. */
export const userSchema = z.object({
  id: idSchema,
  fullName: z.string().optional(),
  mobile: z.string().optional(),
  email: z.string().nullable().optional(),
  employeeId: z.string().nullable().optional(),
  jobTitle: z.string().nullable().optional(),
  photoUrl: z.string().nullable().optional(),
  homeSchoolId: idSchema.nullable().optional(),
  homeSchoolName: z.string().nullable().optional(),
  reportsToUserId: idSchema.nullable().optional(),
  reportsToName: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  status: userStatusSchema.optional(),
  role: z
    .object({
      id: idSchema,
      name: z.string(),
      isOwner: z.boolean(),
      scope: z.object({ allSchools: z.boolean(), schoolIds: z.array(idSchema) }),
    })
    .nullable()
    .optional(),
  directReportsCount: z.number().optional(),
  invitedAt: z.string().nullable().optional(),
  lastLoginAt: z.string().nullable().optional(),
});
export type User = z.infer<typeof userSchema>;

/** PUT /me/photo and PUT /users/:id/photo (brief audit D2). */
export const photoResultSchema = z.object({ photoUrl: z.string().nullable() });
export type PhotoResult = z.infer<typeof photoResultSchema>;

export const USER_SORTS = ['name', 'mobile', 'employeeId', 'school', 'createdAt'] as const;

export const userListQuerySchema = pageQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  schoolId: z.union([idSchema, z.literal('head_office')]).optional(),
  roleId: z.union([idSchema, z.literal('none')]).optional(),
  status: userStatusSchema.optional(),
  sort: z.enum(USER_SORTS).default('name'),
});

export const userSummarySchema = z.object({ total: z.number(), waitingForRole: z.number() });

const userFields = z.object({
  fullName: text('the full name'),
  mobile: mobileSchema,
  email: z.email('Enter a valid email').nullable(),
  employeeId: optionalText(40),
  jobTitle: optionalText(80),
  /** Null means head office. */
  homeSchoolId: idSchema.nullable(),
  reportsToUserId: idSchema.nullable(),
  department: optionalText(80),
  startDate: dateOnlySchema.nullable(),
});

export const roleGiveSchema = z.object({ roleId: idSchema, scope: schoolScopeSchema });

export const createUserSchema = userFields
  .partial({
    email: true,
    employeeId: true,
    jobTitle: true,
    reportsToUserId: true,
    department: true,
    startDate: true,
  })
  .extend({
    /** Null: "No access yet". */
    role: roleGiveSchema.nullish(),
    sendInvite: z.boolean().default(true),
  });
export const updateUserSchema = userFields.partial();

/** Setting someone's role from the Users screen (null takes it away). */
export const setUserRoleSchema = z.object({ role: roleGiveSchema.nullable() });

export const deactivateUserSchema = z.object({
  /** Move the person's direct reports to this manager in the same step. */
  moveReportsTo: idSchema.nullish(),
});

// ---------- roles ----------

export const moduleGrantInputSchema = z.object({
  actions: z.array(z.enum(ACTIONS)).max(ACTIONS.length),
  reach: z.enum(REACHES).nullable(),
});
export const fieldRuleInputSchema = z.object({
  access: z.enum(FIELD_ACCESS),
  ownRecord: z.enum(OWN_RECORD_RULES),
  needsApproval: z.boolean(),
});

export const roleSummarySchema = z.object({
  id: idSchema,
  name: z.string(),
  description: z.string().nullable(),
  isOwner: z.boolean(),
  peopleCount: z.number(),
  modulesOn: z.number(),
});
export type RoleSummary = z.infer<typeof roleSummarySchema>;

export const roleDetailSchema = roleSummarySchema.extend({
  modules: z.record(z.string(), moduleGrantInputSchema),
  fields: z.record(z.string(), z.record(z.string(), fieldRuleInputSchema)),
  /** Whether the current user may change this role (Owner role and power rule). */
  canEdit: z.boolean(),
});
export type RoleDetail = z.infer<typeof roleDetailSchema>;

export const createRoleSchema = z.object({
  name: text('a role name', 60),
  description: optionalText(200),
  copyFromRoleId: idSchema.nullish(),
});
export const updateRoleSchema = z
  .object({ name: text('a role name', 60), description: optionalText(200) })
  .partial();

export const rolePermissionsSchema = z.object({
  modules: z.record(z.string(), moduleGrantInputSchema),
});
export const roleFieldsSchema = z.object({
  fields: z.record(z.string(), z.record(z.string(), fieldRuleInputSchema)),
});

export const assignmentSchema = z.object({
  userId: idSchema,
  fullName: z.string(),
  jobTitle: z.string().nullable(),
  homeSchoolName: z.string().nullable(),
  scope: z.object({ allSchools: z.boolean(), schoolIds: z.array(idSchema) }),
});
export type Assignment = z.infer<typeof assignmentSchema>;

export const addAssignmentSchema = z.object({ userId: idSchema, scope: schoolScopeSchema });

export const automaticRolesSchema = z.object({
  switches: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      description: z.string(),
      enabled: z.boolean(),
    }),
  ),
});
export const updateAutomaticRolesSchema = z.object({
  switches: z.record(z.string(), z.boolean()),
});

// ---------- pending field changes ----------

export const fieldChangeSchema = z.object({
  id: idSchema,
  moduleKey: z.string(),
  moduleName: z.string(),
  recordId: idSchema,
  fieldKey: z.string(),
  fieldLabel: z.string(),
  subject: z.object({ id: idSchema, fullName: z.string() }),
  requestedBy: z.object({ id: idSchema, fullName: z.string() }),
  oldValue: z.unknown(),
  newValue: z.unknown(),
  status: z.enum(['pending', 'approved', 'rejected', 'superseded', 'out_of_date']),
  reason: z.string().nullable(),
  createdAt: z.string(),
});
export type FieldChange = z.infer<typeof fieldChangeSchema>;

export const fieldChangeListQuerySchema = pageQuerySchema.extend({
  /** "mine": requested by me. "to_approve": waiting for my decision. */
  view: z.enum(['mine', 'to_approve']).default('to_approve'),
});
export const rejectFieldChangeSchema = z.object({ reason: optionalText(300) });

// ---------- your details ----------

export const profileUpdateSchema = updateUserSchema;
export const profileResultSchema = z.object({
  user: userSchema,
  /** Fields saved as pending changes instead of straight away. */
  pending: z.array(z.string()),
});
export const changePasswordSchema = z.object({
  currentPassword: z.string().max(200).nullish(),
  newPassword: passwordSchema,
});

// ---------- preview ----------

export const previewStartSchema = z.object({ userId: idSchema });
