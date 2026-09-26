# Kidzonia 360: Build Brief (Core + Tasks)

This is the complete brief for building Kidzonia 360 from scratch. It is a **new codebase**. It reuses ideas from the old Kidzonia School CRM (see section 14, "Lessons from the old build") but none of its code or its JSON-file storage.

A clickable demo of the agreed look and flow exists: https://claude.ai/artifact/WCQXcwfVNEgrWDczUaLNiE. Treat it as the reference for layout, wording and user journeys. Where this brief and the demo disagree, this brief wins.

## How to work on this

- Build in the phases in section 12. Finish one phase, with tests passing, before starting the next.
- Before writing code for a phase, write a short plan (tables, endpoints, screens) and check it against this brief.
- Ask before changing anything marked **Decided**. Anything marked **Open** needs an answer from the product owner before it's built; build a clean stub in the meantime.
- Keep the UI simple and consistent. Every screen should be reachable in at most two clicks from its app tab.
- Use plain, friendly English in the interface. Sentence case, no jargon ("Waiting for approval", not "Pending_Review").

---

## 1. What we're building

Kidzonia 360 is a suite of apps for pre-schools and school groups, like Zoho One is for businesses. One login, one set of users and roles, and many apps on top.

It serves two kinds of customers:

- **A single school**, run by one owner.
- **A head office (HO)** that runs many schools, which can be **COCO** (company-owned, company-operated), **franchise** (owned and run by a franchise owner), or a mix of both.

Version 1 contains:

1. **Core**: registration, organisation, schools, users, roles, module-level and field-level permissions, working calendar.
2. **Tasks app**: assigning work, sub-tasks, repeating tasks, approvals, logout block, watchers, day-end reports, templates, parent messages, reports.
3. **App shell**: top bar with app tabs, Home dashboard (updates, notifications, things needing attention), search.

Everything after v1 (HRMS, Admissions, Fees, Parent communication, Attendance) must plug into Core **without Core changing**. That is the most important architectural goal.

## 2. Scope

**In v1:** everything in sections 5 to 10.

**Not in v1 (but design for it):** HRMS, Admissions, Fees, Parent communication, Attendance, a parent-facing app, native mobile apps (the web app must work well on phones), billing/subscriptions, multiple languages.

HRMS appears in v1 only as a **"Coming soon"** app tab and as a module in the role editor (with sample fields), to prove the plug-in model works.

---

## 3. Tech stack and infrastructure

Keep infrastructure deliberately small: **one app, one database, one server.**

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere | One language for client, server and shared rules |
| Repo | pnpm workspaces: `apps/web`, `apps/api`, `packages/shared` | Shared rules live in one place |
| Client | React 19, Vite, React Router, TanStack Query, Mantine (themed blue/white) | Familiar to the team from the old build |
| Server | Node 22, Express 5 (or Fastify), Zod for validation | Simple and well known |
| Database | PostgreSQL 16 with Prisma | Real transactions, unique indexes, foreign keys |
| Background jobs | pg-boss (runs on Postgres) | Repeating tasks and reminders without adding Redis |
| Files | S3-compatible storage (local disk in development) | Task photos and attachments |
| Auth | Mobile number + one-time code, optional password; JWT access token (12 h) + refresh token | Most Indian school staff log in by phone |
| SMS / WhatsApp | Behind a provider interface; a fake provider in development that logs messages | Provider is **Open** (section 13) |
| Tests | Vitest + Supertest for the API, Vitest + Testing Library for components, Playwright for main journeys | |
| Deploy | One Docker container serving API under `/api` and the built web app, plus managed Postgres | |

**`packages/shared` is where the rules live**: Zod schemas, the module registry, the permission functions, status names and transitions. Both client and server import from it. This replaces the old build's habit of keeping hand-written "mirrors" in sync (section 14).

Timezone: store all times in UTC, display in the school's timezone (default `Asia/Kolkata`).

---

## 4. Multi-tenancy

- Every organisation's data is fully separate. Every business table has an `organisation_id`.
- Every query must be scoped by the logged-in user's organisation. Put this in one place (a repository layer or Prisma middleware), never in individual routes.
- Write a test that creates two organisations and proves neither can read or change the other's data through any endpoint.

---

## 5. Core concepts and data model

Field names below are a guide; adjust naming to Prisma conventions. Every table also has `id` (uuid), `created_at`, `created_by`, `updated_at`, `updated_by`, and soft delete `deleted_at` where it makes sense.

### 5.1 Organisation

`organisations`: name, logo, `setup_type` (`single_school` | `head_office`), `school_model` (`coco` | `franchise` | `both`), timezone, `working_days` (array of weekday numbers 0–6, default Mon–Sat), `opens_at`, `closes_at`.

**Decided:** a single school is still stored as an organisation with one school under it. The head-office layer is just hidden in the UI. This lets a single school grow into a group later without migration.

### 5.2 Schools

`schools`: organisation_id, name, city, state, `type` (`coco` | `franchise`), `franchise_owner_user_id` (nullable), optional own `working_days`, `opens_at`, `closes_at` (null means use the organisation's).

### 5.3 Holidays

`holidays`: organisation_id, name, date (or start and end date for multi-day closures), `school_ids` (empty means all schools).

No task is created on a holiday or non-working day (section 9.5).

### 5.4 Users

A user is a person. Parents are **not** users in v1.

`users`: organisation_id, full_name, mobile (unique within organisation), email (optional), employee_id (optional), job_title, photo, `home_school_id` (null means head office), `reports_to_user_id` (nullable), department (optional, free list), start_date, `status` (`invited` | `active` | `inactive`).

Required when adding a user: **full name, mobile, school**. Everything else is optional.

Adding a user sends an invite by SMS/WhatsApp. The person sets their own password or logs in with a one-time code.

### 5.5 Roles

`roles`: organisation_id, name, description, `is_owner` (boolean, locked), `created_from_role_id` (for "copy from").

`role_permissions`: role_id, `module_key`, `actions` (array, e.g. `["view","create","edit","assign"]`), `reach` (`own` | `team` | `school` | `all`).

`role_field_permissions`: role_id, `module_key`, `field_key`, `access` (`hidden` | `view` | `edit`), `own_record` (`same` | `edit`), `needs_approval` (boolean).

`role_assignments`: user_id, role_id, `scope_all_schools` (boolean), `scope_school_ids` (array).

**Decided for v1:** one role per user (enforce with a unique constraint on user_id), but keep `role_assignments` as its own table so multiple roles can be allowed later.

**Decided:** head office defines roles. Franchise owners can give existing roles to people in their own schools, but cannot create or edit roles. (Confirm with the product owner; easy to relax later.)

### 5.6 Seed roles for a new organisation

When an organisation registers, create these roles (all editable except Owner):

| Role | Summary |
|---|---|
| Owner | Everything, all schools. Locked. Given to the person who registers. |
| Department head | Creates, assigns and approves tasks across all schools; sees reports for all schools |
| Franchise owner | Full Tasks and user management inside their own school(s) |
| Principal | Creates, assigns and approves tasks for their team; sees team reports |
| Teacher | Sees and completes their own tasks |

Match the permission defaults used in the demo.

---

## 6. The permission engine

This is the heart of Core. Put all of it in `packages/shared/permissions` with thorough unit tests.

### 6.1 The module registry

Every app declares its modules in code. Core reads the registry; Core never imports an app.

```ts
registerModule({
  key: 'tasks',
  app: 'tasks',                // which top-bar app it belongs to
  name: 'Tasks',
  description: 'Create, assign, do and approve tasks',
  actions: ['view', 'create', 'edit', 'delete', 'assign', 'approve'],
  hasReach: true,              // supports own / team / school / all
  fields: [
    { key: 'title', label: 'Title' },
    { key: 'description', label: 'Description' },
    { key: 'category', label: 'Category' },
    // ...
  ],
});
```

Adding a module means adding one registration. The role editor, the menu and the field permission screen all build themselves from the registry. **If you find yourself editing Core to add a module, the registry is missing something.**

v1 modules:

| App | Module key | Actions | Reach | Fields |
|---|---|---|---|---|
| Tasks | `tasks` | view, create, edit, delete, assign, approve | yes | title, description, category, priority, custom lists, due, proof (photos/files), approver remarks, watchers |
| Tasks | `dayend` | view, create, edit, delete | yes | – |
| Tasks | `task_reports` | view, export | yes | – |
| Tasks | `task_setup` | view, create, edit, delete | no | – |
| HRMS (coming soon) | `hrms_staff` | view, create, edit, delete | yes | date of birth, home address, Aadhaar, bank details, salary |
| Settings | `users` | view, create, edit, delete | yes | full name, mobile, email, employee ID, school, reports to |
| Settings | `roles` | view, create, edit, delete | no | – |
| Settings | `schools` | view, create, edit, delete | no | name, city, type, franchise owner |
| Settings | `organisation` | view, edit | no | – |

Custom lists added in Task setup (section 9.9) must appear automatically as extra fields of the `tasks` module.

### 6.2 Rules

1. **Nothing is allowed unless a role allows it.** A user with no role can log in and sees only a "Your account is ready, ask [their manager] for access" screen.
2. **Owner** always has everything. The system refuses to delete the Owner role, edit it, or remove the last person holding it.
3. Ticking create, edit, delete, assign or approve automatically ticks **view**. Unticking view clears everything on that module.
4. **Reach** decides whose records someone can act on:
   - `own`: only records assigned to or created by them
   - `team`: themselves plus everyone who reports to them, directly or indirectly (via `reports_to_user_id`)
   - `school`: everyone in the schools in their role assignment's scope
   - `all`: everyone in the organisation
5. **Field access** is checked after module access. If a role has no row for a field, the field follows the module: `edit` if the role can edit the module, otherwise `view`.
   - `hidden`: the field is **removed from API responses** and rejected in writes. Never rely on the client to hide it.
   - `view`: returned, but writes to it are rejected.
   - `edit`: returned and writable.
   - `own_record = edit`: on records that belong to the user (their own profile, a task assigned to them), the field is editable even if access is `view`.
   - `needs_approval`: an edit is saved as a **pending change** that the person's reporting manager (or an Owner) approves. Implement the mechanism generically (`pending_field_changes` table + a small approval screen), even though v1 uses it mainly for demo HRMS fields.
6. The field permission screen for a module is only available once the role has view on that module.

### 6.3 Automatic (implicit) roles

These come from how people are set up. Nobody is "added" to them:

- **Reporting manager**: anyone with people reporting to them. By default they see their team's tasks, approve their team's work, can release their team from the logout block, and see their team in reports. These four switches are editable on the "Automatic roles" tab.
- **Watcher**: anyone added as a watcher on a task sees that task, and edits it if given edit rights on it.

### 6.4 One function, used everywhere

Expose a single server-side check:

```ts
can(user, moduleKey, action, record?) -> boolean
fieldAccess(user, moduleKey, fieldKey, record?) -> 'hidden' | 'view' | 'edit'
visibleUserIds(user, moduleKey) -> string[]
serialize(user, moduleKey, record) -> record with hidden fields removed
```

Every route uses these. The client uses the same functions (from `packages/shared`) to decide what to show, but the server is the authority.

Write tests for every rule above, including: a teacher cannot see a task that's not theirs by guessing its id; a hidden field never appears in any list or detail response; a principal cannot approve work of someone outside their team.

---

## 7. App shell and UX

Match the demo.

### 7.1 Layout

- **Top bar** (solid blue, white text): Kidzonia 360 logo, then **app tabs** (Home, Tasks, HRMS, Settings; only tabs the user's role allows), then search, school switcher, "+" new task, notifications bell with count, "All apps" launcher, profile menu (name, role, organisation, log out).
- **Left menu** inside each app, listing that app's pages. Home has no left menu.
- On phones, app tabs scroll sideways and the left menu becomes a sideways strip of buttons under the top bar.
- **"All apps"** launcher shows every app, with "Coming soon" on those not built yet. A coming-soon app opens a page explaining it will use the same users and roles.

### 7.2 Theme

Blue and white, Zoho-like. Primary blue around `#1A63C6`, white surfaces, a very light blue-grey page background, one amber accent used only for things needing action (logout block, overdue). Support dark mode (navy). Rounded, calm, lots of whitespace. Minimum touch target 44 px. Text contrast at least 4.5:1.

### 7.3 Home (the landing page after login)

Same layout for everyone, contents depend on who they are:

1. Greeting and one-line summary.
2. **Needs your attention**: up to four clickable cards, showing only non-zero items: tasks to submit before logout, work waiting for my approval, overdue in my team, day-end reports not in yet, people waiting for a role.
3. **A snapshot that fits the person**: schools table (HO), department's tasks by school (department head), team table (principal / franchise owner), today's tasks with a progress bar (teacher).
4. **Updates**: an activity feed (section 10.3).
5. **Notifications** panel and **Your tasks** panel.

### 7.4 Menus are built from permissions

The app tabs, left menus, buttons ("New task", "Add user") and table columns all come from `can()` and `fieldAccess()`. Nothing is hard-coded to a role name.

### 7.5 Search

The top-bar search finds pages, tasks and people the user is allowed to see.

### 7.6 School switcher

Shown to anyone whose scope covers more than one school. Choosing a school narrows every screen to that school.

---

## 8. Registration, onboarding and Settings

### 8.1 Registration (public)

Steps (match the demo):

1. **About you**: full name, mobile (verified by one-time code), email, password.
2. **What are you setting up**: a single school, or a head office. If head office: COCO only, franchise only, or both.
3. **Your organisation / school**: name, city, state, working days, opening and closing time.
4. **Your schools** (head office only): name, city, COCO or franchise for each; can be skipped. For a franchise school, optionally the owner's name and mobile, who is invited as that school's Franchise owner.

On finish: create the organisation, schools, seed roles (5.6), make the registrant the Owner, and land them on Home with a **setup checklist**: add schools, create roles, add users, give users a role, create your first task. Items tick themselves off.

### 8.2 Settings app pages

- **Organisation**: name, logo, working days, opening and closing time, holidays list. "End of day" means closing time.
- **Schools**: list with type badge, franchise owner, principal, number of people. Add school (name, city, type; owner details for franchise).
- **Users**: list with a clear **"No access yet"** tag and a banner counting people waiting for a role. Add user drawer: the person (name, mobile, email, job title, employee ID), where they work (school, reports to, department, start date), access (role, or "No access yet"; send invite switch). Columns respect field permissions.
- **Roles & permissions** (Keka-style), two tabs:
  - **Roles**: list of roles with a "N people" button (opens *Manage people*: add a person with a scope of all schools or a specific school; remove) and an Edit button.
  - **Role editor**: role name, description, "Copy from" another role. Left panel lists modules grouped by app (Tasks, HRMS, Settings) with "3/6" or "Off" next to each. Right panel for the chosen module has two tabs: **What they can do** (a checkbox per action with a one-line hint, plus a "Whose records" reach dropdown) and **Field permissions** (a table: field, Hidden/View/Edit segmented control, "On their own records" dropdown, "Changes need approval" switch). "Select all" and "Clear" buttons. **Preview as this role** button.
  - **Automatic roles**: the reporting manager switches and an explanation of watchers.

All Settings changes are written to the audit log (section 10.4).

---

## 9. The Tasks app

### 9.1 Two things: the task and each person's copy

- `tasks` is the rule: what, when, how it completes, who it's for.
- `task_assignments` is one person's copy for one date. People start, submit, get approved and are counted on assignments.
- In the interface, neither word appears; it's "this task" and "today's task".
- Assigning one task to ten people creates ten assignments, and the creator sees "7 of 10 done".

### 9.2 Task fields

`tasks`: organisation_id, title (required), description, category_id, priority_id, `custom_values` (JSON: list_id → value), `due_type` (`end_of_day` | `at_time` | `on_date`), `due_time`, `due_date`, `repeat` (`none` | `daily` | `weekly` | `monthly`, with weekday/day-of-month settings), `repeat_end_date`, `closes_after` (optional: how long after the deadline it can still be submitted), `needs_approval`, `approver_mode` (`creator` | `reporting_manager` | `named_user`), `approver_user_id`, `blocks_logout`, `parent_message` (JSON: template_id, class or audience, or null), `target` (see 9.3), `created_by`, `kind` (`task` | `day_end`), `day_end_form_id`.

`task_subtasks`: task_id, title, order, optional `assignee_user_id`, optional due.

`task_watchers`: task_id, user_id, `access` (`view` | `edit`).

`task_assignments`: task_id, user_id, `service_date`, `due_at`, `closes_at`, `status`, `submitted_at`, `decided_at`, `decided_by`, `remarks`, `answers` (JSON, for day-end forms), a snapshot of the fields the person needs (title, description, sub-tasks) so later edits don't rewrite work in progress.

`task_assignment_subtasks`: assignment_id, subtask_id, done, done_at.

`task_attachments`: assignment_id, file key, name, type, uploaded_by.

### 9.3 Who gets it (targeting)

One shape, not several "kinds":

```ts
target = {
  userIds: [],          // named people
  roleIds: [],          // e.g. all Teachers
  schoolIds: [],        // where; empty = all schools in the creator's reach
  excludeUserIds: [],
  includeNewJoiners: true,   // for repeating tasks: recompute each time, or freeze the list
}
```

Rules:
- A person is only a valid target if the creator can assign to them (`tasks.assign` with enough reach), or it's the creator themselves.
- Naming someone out of reach is an **error shown to the creator**. A broad group match quietly skips people out of reach.
- People with status `inactive` are never targeted.
- The UI offers "All [role] at [school]" quick-add plus a searchable list of people.
- `includeNewJoiners` defaults to false when only named people are chosen, true otherwise.

### 9.4 Statuses

| Status | Shown as | Meaning |
|---|---|---|
| `todo` | To do | Not started |
| `in_progress` | In progress | A sub-task ticked, an answer given or a file added |
| `submitted` | Waiting for approval | Submitted, needs approval |
| `approved` | Approved | Approved by the approver |
| `done` | Done | Completed, no approval needed |
| `sent_back` | Sent back | Approver returned it with remarks |
| `overdue` | Overdue | Past the deadline, still submittable |
| `expired` | Closed | Past `closes_at`; can no longer be done, and is left out of completion rates |
| `cancelled` | Cancelled | Removed by the creator |

Open statuses (still owed): `todo`, `in_progress`, `sent_back`, `overdue`. `expired` is deliberately **not** open.

Allowed transitions live in `packages/shared` and are enforced on the server.

### 9.5 Dates and repeating tasks

Three different dates:
- **Deadline** (`due_at`): after it, status becomes overdue, but the person can still submit.
- **Closes** (`closes_at`): after it, status becomes closed/expired; can't be done.
- **Stop repeating** (`repeat_end_date`): no new copies after this.

"End of day" means the closing time of **that person's school** (falling back to the organisation). An "at a time" deadline is a fixed clock time and is not moved.

Repeating tasks:
- A background job (pg-boss, every 15 minutes, plus once at server start) creates assignments for the next 7 days.
- Skip non-working days and holidays for the person's school.
- **Creating copies must be safe to run twice.** Put a unique index on `(task_id, user_id, service_date)` and use insert-if-not-exists.
- Creating copies only ever **adds**. When a task is edited, only future copies that haven't been started (status `todo`, service date after today) are updated or removed. Work already started or finished is never rewritten.
- The same job marks overdue and expired, and sends reminders.
- Night shifts crossing midnight are not supported in v1; reject them clearly.

### 9.6 Doing, submitting, approving

- The person ticks sub-tasks, answers day-end questions, adds photos/files, then presses **Submit for approval** (or **Mark as done** when no approval is needed).
- A task with sub-tasks can only be submitted once all its sub-tasks are ticked. Required day-end questions must be answered.
- The approver sees submitted work on Home, in Approvals, and in the task's People list. **Approve** or **Send back**, with optional remarks (remarks respect the `approver remarks` field permission).
- Approver is chosen per task: the creator, each person's reporting manager, or a named person.
- If the approver is inactive, fall back to the approver's own reporting manager, then an Owner. (Full escalation ladders are not in v1.)

### 9.7 Logout block

- A task with `blocks_logout` stops the person logging out while their copy for today is open **and its deadline has arrived**.
- The block ends at **submit**, not approval. A slow approver never keeps a junior at work.
- Enforce on the server in two places: the logout endpoint refuses (409) while blocking work is open; and all write endpoints outside Tasks, auth, files and notifications are refused if blocking work from a **previous day** is still open (they walked out anyway). Reads stay open.
- Escape hatches, all required: the person can **ask for release** (notifies their reporting manager); the reporting manager (or anyone with approve reach over them) can **release them for today**; a manager can **cancel or defer** the copy.
- The logout screen lists the blocking tasks with a button to open each.

### 9.8 Watchers (dotted-line managers)

- The creator adds watchers from any department and sets **Can view** or **Can edit** for each.
- Watchers see the task on "Watching", in search, and get notified on submit, approve and send back.
- Being a watcher never makes someone an approver.
- Whether a role may add watchers, or give edit rights, is controlled by the `watchers` field permission on `tasks`.

### 9.9 Task setup (masters)

- **Categories**: name and colour.
- **Priorities**: name, colour and order (top = most urgent). Everything that sorts by urgency uses the order, never the name.
- **Custom lists**: admin-created dropdowns (e.g. "Area": Classroom, Kitchen, Playground). Each list becomes a new field on the task form, a new filter in reports, and a new field in field permissions.
- **Task templates** (see 9.10).
- **Parent message templates** (see 9.12).
- Pickers on the task form have a "+ New" option that opens the same small form as Task setup, for people with `task_setup.create`.

### 9.10 Task templates

- A template is a saved task **without people and without fixed dates**: title, description, category, priority, custom values, due type and time of day, repeat pattern, sub-tasks, approval setting, logout block, parent message setting.
- Created from Task setup or with **Save as template** at the bottom of the New task form.
- The New task form starts with **"Start from a template"**. Choosing one fills in the form; the person then picks who and when.
- Using a template **copies** it. Editing a template never changes tasks already created from it.
- On save, the server removes any people and absolute dates from the template.
- Managed by people with `task_setup` permissions; anyone who can create tasks can use templates.

### 9.11 Day-end reports

- Admins build **day-end forms** from question types: Yes/No, Number, Short text, Pick one, Checklist, each optionally required.
- A form is assigned to one or more **roles**. Every working day, everyone holding those roles automatically gets that form as a task (`kind = day_end`), due at end of day, blocking logout by default.
- A role-specific form needs its own generated task, because the questions are copied onto each day's copy.
- The filed answers keep a copy of the questions, so old reports still read correctly after the form changes.
- Day-end reports page: **Today** tab (who has submitted, "Release for today" button) and **Forms** tab (list and builder).

### 9.12 Messages to parents

- **Parent message templates** in Task setup: a name and a message with fill-in words: `{student_name}`, `{class_name}`, `{event_name}`, `{activity}`, `{school_name}`.
- On a task: a switch "Message parents when done", a template, and who to send to (parents of a class).
- Sent when the copy is approved, or marked done if no approval is needed. Log every message sent (`parent_messages` table: task, assignment, template, recipients count, channel, status).
- **Open:** where parent contacts come from (section 13). Until decided, build a `ParentContactSource` interface and a sender behind a `MessageProvider` interface. In development, log the rendered message instead of sending.

### 9.13 Task screens (left menu in the Tasks app)

- **My tasks**: grouped Today / Coming up / Done, with a banner if anything blocks logout.
- **Assigned by me**: each task with "x of n done" and a progress bar.
- **My team** (reach team or wider): tasks assigned to people in my reach.
- **Watching**.
- **Approvals** (if the role can approve): submitted work with Review and Approve buttons.
- **Day-end reports**, **Reports**, **Task setup** (as permitted).
- **Task detail** opens in a side drawer: category, priority, logout badge, due, repeats, assigned by, approval, description, then **Your work** (sub-tasks, questions, files, submit) and **People** (each person's status, approve/send back for the approver), approver remarks, watchers, parent message preview. Every field respects field permissions.
- **New task** drawer: template picker, title, description, assign to (group quick-add + searchable people list), when (end of day / at a time / on a date, repeat), details (category, priority, custom lists), sub-tasks, rules (needs approval + approver, block logout, message parents + template + class), watchers, **Save as template**, **Assign task**.

### 9.14 Reports

- Filters: school, role, department, person, category, priority, custom lists, status, date range (today, this week, this month, custom).
- Summary numbers: people, tasks, % done or submitted, overdue.
- Table per person: role, school, progress bar, done, waiting approval, overdue, day-end today. Clicking a person opens their tasks.
- **Saved views**: save the current filters with a name, per user.
- **Download** (if `task_reports.export`): CSV of the current table.
- Visibility is applied before filters. Filter options only list what the user can see.
- The same filter code powers the summary numbers and the rows, so the rows behind a number are the rows the number was counted from.

---

## 10. Notifications, activity feed, audit

### 10.1 Notification events

`task_assigned`, `task_due_soon` (1 hour before a timed deadline, and 1 hour before closing time for end-of-day tasks), `task_overdue`, `task_submitted` (to approver and watchers), `task_approved`, `task_sent_back`, `logout_release_requested`, `released_for_today`, `watcher_added`, `user_waiting_for_role` (to people who can edit roles), `field_change_needs_approval`.

- Every event is declared in one list. Sending an unknown event throws. The notification settings screen reads the list, so new events appear automatically.
- Channels: in-app (v1), WhatsApp/SMS for a small set (assigned, sent back, due soon) behind the provider interface.
- Users can mute channels per event.

### 10.2 Bell and Home panel

The bell shows unread count; opening it lists recent notifications, each linking to its task or page. Home shows the same list.

### 10.3 Activity feed (Updates)

- An `activity` table written automatically from the data layer on create, update and delete of tracked tables: who, what, which record, when. **Never the record's contents.**
- The Home "Updates" feed reads it, filtered by what the viewer may see: their own actions, actions aimed at them, and (for team reach or wider) actions by people in their reach. Organisation-wide events (a new holiday) show to everyone; admin events (a new user waiting for a role) show to people with user permissions.

### 10.4 Audit log

- A separate `audit_log` for deliberate records of important changes: roles and permissions, role assignments, field permissions, users, schools, organisation settings, approvals, releases from the logout block.
- Records who, what changed (before and after for settings), and when.
- Viewable by Owners in Settings (a simple list with filters is enough for v1).

---

## 11. API outline

REST under `/api`, JSON, Zod-validated. Suggested routes:

```
POST   /auth/request-code        POST /auth/verify-code       POST /auth/login
POST   /auth/refresh             POST /auth/logout (409 while blocking work is open)
POST   /register

GET    /me                       (user, role, effective permissions, scope)
GET    /registry                 (modules, actions, fields incl. custom lists)

GET/PUT            /organisation
GET/POST/PUT/DEL   /schools
GET/POST/PUT/DEL   /holidays
GET/POST/PUT/DEL   /users        POST /users/:id/invite
GET/POST/PUT/DEL   /roles        GET/PUT /roles/:id/permissions   GET/PUT /roles/:id/fields
GET/POST/DEL       /roles/:id/assignments
GET/PUT            /automatic-roles
GET/POST           /field-changes   POST /field-changes/:id/approve|reject

GET/POST/PUT/DEL   /tasks        GET /tasks/:id
GET                /assignments?tab=my|byme|team|watching|approvals
POST               /assignments/:id/start|submit|approve|send-back|cancel|defer
PUT                /assignments/:id/subtasks/:subtaskId
POST               /assignments/:id/answers
POST/DEL           /assignments/:id/attachments
POST               /release-requests        POST /users/:id/release-today

GET/POST/PUT/DEL   /task-setup/categories | priorities | lists | templates | message-templates
GET/POST/PUT/DEL   /day-end-forms          GET /day-end/today

GET                /reports/tasks          GET /reports/tasks.csv
GET/POST/DEL       /saved-views

GET                /home                   (attention cards, snapshot, feed, notifications in one call)
GET                /notifications          POST /notifications/read
GET                /search?q=
GET                /audit-log
```

Rules:
- `PUT` is a partial update. Validation sees the **merged** record (existing + changes), never just the fragment sent.
- Declare fixed paths before parameter paths (`/tasks/analytics` before `/tasks/:id`).
- Every response passes through `serialize()` so hidden fields never leave the server.
- Errors: 400 invalid input with human-readable messages, 401 not logged in, 403 not allowed, 404 not found (also for records outside the user's reach, so ids can't be probed), 409 conflict (logout block, duplicate), 422 business rule broken.

---

## 12. Build phases and acceptance criteria

Each phase ends with: all tests passing, a working build, seed data updated, and a short note of what was built and anything left open.

**Phase 1: Foundation**
Repo, database, auth (one-time code with a fake provider, password optional), multi-tenant scoping, audit and activity logging in the data layer, module registry, permission engine with full unit tests, app shell (top bar, app tabs, left menus, profile menu, empty Home), theme.
*Done when:* two organisations can't see each other's data; a user with no role sees only the "account ready" screen; menus change when permissions change.

**Phase 2: Registration and Settings**
Registration flow, setup checklist, Organisation (working days, hours, holidays), Schools, Users (invite, "No access yet"), Roles & permissions with the Keka-style editor, Manage people with scope, field permissions, automatic roles, Preview as role, pending field changes.
*Done when:* an owner can register, add a school, add a user, create a role, give it to the user with a school scope, hide a field, and see that field disappear from that user's API responses and screens.

**Phase 3: Tasks core**
Tasks and assignments, targeting, sub-tasks, statuses and transitions, New task drawer, task detail drawer, My tasks / Assigned by me / My team / Watching / Approvals, approve and send back, watchers, categories, priorities, custom lists, task templates.
*Done when:* the teacher, principal and HO journeys in the demo all work end to end with real data.

**Phase 4: Time-based features**
Background jobs, repeating tasks (holiday and working-day aware, safe to run twice), overdue and closed, logout block with all escape hatches, day-end forms and daily generation, reminders.
*Done when:* running the job twice creates no duplicates; a blocking task stops logout until submitted; a release lets the person log out; no task appears on a holiday.

**Phase 5: Home, notifications, reports**
Home with attention cards, snapshots, updates feed and notifications; bell; notification events and settings; reports with filters, saved views and CSV; search; school switcher.
*Done when:* each seeded persona's Home matches the demo; report numbers match the rows behind them.

**Phase 6: Parent messages and polish**
Message templates, parent message on tasks (with stub contact source and provider), message log, audit log screen, mobile polish, accessibility pass, Playwright tests for the main journeys, deployment setup.

---

## 13. Open decisions (ask before building these parts)

1. **Where parent contacts come from** for parent messages: postpone until the Students module, a small contact list in Core (class, student name, parent phone), or a spreadsheet upload per class.
2. **SMS / WhatsApp / OTP provider** (and DLT registration for SMS, WhatsApp Business template approval).
3. **Who a COCO principal reports to**: HO admin directly, or a department head who looks after a group of schools.
4. **Franchise owners creating roles**: currently decided "no, HO only". Confirm.
5. **One role per user**: currently decided for v1. Confirm no one needs two roles at once (e.g. a principal who also teaches).

---

## 14. Lessons from the old Kidzonia build (keep these)

These come from the old architecture document and cost real time to learn:

- **Never edit a migration that has already run in production.** Add a new one that converts the data.
- **Test migrations against a copy of real data**, never the live development database.
- **`PUT` must validate the merged record.** In the old build, renaming a template sent only the name, the server rebuilt the rest from nothing, and the template was wiped.
- **Fixed routes before parameter routes.** `/tasks/analytics` was matched as `/tasks/:id` four times.
- **Creating repeating copies must be safe to run twice.** The old build used a deterministic id; here, use a unique index.
- **Creating copies only adds.** Only unstarted future copies are ever changed by an edit.
- **Three different dates** (deadline, closes, stop repeating). Don't merge them.
- **"End of day" is the person's working hours**, and a copy's date must match the local date of its deadline.
- **One holiday list.** Two lists drift, and someone gets work on a holiday.
- **A strict output whitelist per record type.** A field left out of the serializer is invisible everywhere; a field left in may leak. The permission engine's `serialize()` is that whitelist.
- **Don't widen the manager check to add a feature.** When peers needed to hand work sideways, the right fix was a separate, clearly named function, not an option on the shared one.
- **Named people out of reach are an error; broad matches skip them.** Don't make these the same.
- **The logout block ends at submit.** A slow approver is never the junior's problem.
- **Filter options come from what the user can see**, so no filter returns nothing.
- **Explain *why* in comments**, especially where a simpler-looking approach is wrong.

---

## 15. Seed and demo data

Provide a `pnpm seed` script that creates the demo organisation ("Kidzonia Pre-schools") with the same schools, people, roles, tasks, templates, day-end forms and feed items as the clickable demo, so the product owner can compare the real app with the demo screen by screen. All seeded accounts use the one-time code `123456` in development.
