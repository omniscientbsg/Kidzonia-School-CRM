# Brief audit (after Phase 5)

Date: 2026-09-27. What's built, checked against `KIDZONIA_360_BUILD_BRIEF.md` sections 4 to 11 and
the lessons in section 14. Each item names the test that proves it. Test paths are short:

- `api/…` = `apps/api/test/integration/…`
- `iso` = `apps/api/test/isolation/tenant-isolation.test.ts`
- `unit/…` = `apps/api/test/unit/…`
- `shared/…` = `packages/shared/test/…`
- `web/…` = `apps/web/src/…`
- `e2e/…` = `apps/web/e2e/…`

**Legend.** ✅ built as specified. 🔀 built differently (what, why, and whether it was approved). ⏳
not built yet (with the phase it belongs to). 🔧 a gap found by this audit and fixed in the same
change, with its new test. ❓ needs your decision (collected at the end).

## Summary

- **Almost everything in sections 4 to 11 is built and tested.** The differences are either
  approved plan decisions or are now recorded in PROGRESS.
- **Not built, as the brief's phases say:** parent message sending and its log (9.12), and the
  audit log screen with `GET /audit-log` (10.4, 11). Both are Phase 6.
- **Fixed during the audit, each with a test (details in each section):**
  - Watchers now hear about approve and send back.
  - Template edits merge the payload.
  - Task edits re-check "untouched" in the write itself.
  - Approver fallback is correct for deleted approvers and for work nobody can approve.
  - Night shifts are refused on school creation too.
  - Two field-permission leaks are closed.
  - `created_by` / `updated_by` are stamped by the data layer.
  - CI now refuses edits to committed migrations.
  - SMS notifications carry an idempotency key.
  - The New task drawer has an "include people who join later" switch.
  - Clearer submit refusals.
- **Tests:** about 60 added (API 510 → 565, shared 508 → 509, web 17 → 18, plus e2e steps). Every item you
  asked about in 9.3 to 9.11 now has a test that asserts it directly.
- **12 decisions for you** at the end.

---

## 4. Multi-tenancy

- ✅ Every business table has `organisation_id`, and references between tables use composite
  foreign keys. Unscoped tables are only the auth and ops tables (OTP, rate limits, one-time
  tokens, job runs). Tests: `api/data-layer` "rejects a user whose school belongs to another
  organisation" and siblings.
- ✅ Scoping lives in one place: the scoped Prisma client (`db/scoped.ts`). ESLint forbids the raw
  client in routes. Tests: `unit/scope-args.test.ts`; `api/data-layer` "lists only its own rows",
  "updateMany and deleteMany leave other organisations alone", "cannot update or delete another
  organisation's row by id".
- ✅ Two-organisation test for every endpoint, enforced by a coverage check. Tests: `iso` "has a
  case for every authenticated route…" and 123 per-route cases.
  🔧 It also runs the other way now: `iso` "the other way round: the demo Owner sees nothing of the
  second organisation".

## 5. Core concepts and data model

- ✅ `id` (uuid v7), `created_at`, `updated_at` on every main table; soft delete on schools, users,
  roles and holidays (masters are archived, tasks cancelled). Tests: `api/users` "deletes someone
  and frees their mobile number"; `api/schools` "deletes an empty school"; `api/data-layer` "reports
  soft deletes as deletes".
- 🔧 **`created_by` / `updated_by`.** The schema said the data layer sets them, but users, roles,
  role assignments and permission rows were never stamped. They are now stamped centrally from the
  unit of work's actor (`db/stamps.ts`); a stamp the code sets itself is kept. Tests: `api/data-layer`
  "stamps the person acting on writes through the API, users and roles included" and "keeps a
  stamp the code sets itself, and never stamps without a person".
  ❓ D4: `task_assignments` and `task_subtasks` have no stamp columns.

### 5.1 Organisation

- ✅ Every listed field. A single school is stored as an organisation with one school. Tests:
  `api/organisation` "updates part of the record, validating the merged result"; `api/registration`
  "creates a single school with one school row…".
- 🔀 The logo is stored as a storage key (`logo_key`) and served by a route. Naming only; Phase 2
  addition g.

### 5.2 Schools

- ✅ Every listed field, plus `principal_user_id` (approved in Phase 2). Tests: `api/schools` "adds
  a COCO school…", "adds a franchise school and invites its owner…".
- 🔀 A school's own `working_days` uses an empty list rather than null to mean "use the
  organisation's". Same meaning; now recorded in PROGRESS.

### 5.3 Holidays

- ✅ Name, start and end date. Tests: `api/organisation` "adds, lists, edits and removes holidays",
  "checks an edit against the stored record…".
- 🔀 Schools are held in a join table `holiday_schools` (no rows means every school), approved in
  PROGRESS. No task is created on a holiday; see 9.5.

### 5.4 Users

- ✅ Every listed field. Mobile is unique per organisation. Full name, mobile and school are
  required. Invites go through the message provider. Tests: `api/users` "adds someone with a role
  and sends an invite", "refuses a mobile already used…" (409), "validates input with a message per
  field", "keeps every field not sent exactly as it was"; `api/auth` "become active on their first
  sign-in with a code".
- ⏳❓ **Photo.** The column exists but nothing uploads, serves or shows it. D2.

### 5.5 Roles

- ✅ `roles` (with `created_from_role_id`), `role_permissions`, `role_field_permissions`,
  `role_assignments`. Tests: `api/roles` "creates a role, optionally copying another" (now also
  asserts `createdFromRoleId`).
- ✅ One role per person, enforced by the database. Test: `api/data-layer` "rejects a second role for
  the same person, even written directly".
- 🔀 The school scope is held in a join table `role_assignment_schools` (approved).
- ✅ Head office defines roles; franchise owners only hand out existing ones. Tests: `api/users` "lets a
  franchise owner add people…", "stops a franchise owner giving a more powerful role…".

### 5.6 Seed roles

- ✅ The five roles are created at registration; the registrant is Owner; the Owner role is locked.
  Tests: `api/registration` "creates a single school…"; `api/roles` "never lets anyone edit the Owner
  role".
- ❓ The Franchise owner seed has no `users.delete` and no `task_setup`. Is that "full Tasks and user
  management"? D3.

## 6. Permission engine

- ✅ **6.1 Registry.** Modules, actions, reach and fields exactly as the table. Custom lists become
  `tasks` fields. Core never imports an app (lint rule). Tests: `shared/registry` "matches the
  brief's action and reach table", "accepts a new app without any change to Core", "adds
  per-organisation custom-list fields…".
- ✅ **6.2 Rules 1 to 6**, each with a test block in `shared/permissions.test.ts`. The pending-change
  mechanism is tested in `api/users` ("changes that need approval") and in `e2e/settings` "changes
  that need approval go to the manager".
- ✅ **6.3 Automatic roles.** The four manager switches and watchers. Tests: `shared/permissions`
  "automatic roles: reporting manager"; `api/roles` "shows and saves the reporting-manager
  switches".
- 🔀 **6.4 Function shapes.** These are recorded in PROGRESS.
  - `can` / `fieldAccess` / `serialize` take a permission context plus record facts, rather than
    the user and the raw record.
  - `visibleUserIds` became `reachScope`, which returns user ids, school ids and "watched" so it
    can run as SQL. Test: `shared/scope` "reachScope agrees with can() on every record".
- ✅ The three tests the brief asks for:
  - A teacher can't see a task by guessing its id: `api/tasks` "answers 404 for tasks out of reach".
  - A hidden field never appears: `api/roles` "hides Mobile number from Principals"; `api/tasks`
    "hides a field from lists, the drawer and filters"; `api/home` "never shows a hidden title…";
    `api/field-leaks`.
  - A principal can't approve outside their team: `shared/permissions`, and now at the API in
    `api/task-copies` "a principal can't approve work outside their team, even by id".
- 🔀❓ **`serialize()` is not the only way out.** Users, schools, tasks and copies go through it.
  Reports, search, Home, the feed, notifications, day-end and the logout screens build their own
  shapes, with explicit `fieldAccess` checks and tests. The audit found two of those screens
  missing a check. 🔧 Both are fixed: the manager's view of what blocks someone's logout now hides
  task titles, and "Manage people" names now follow the Users field permission. Tests:
  `api/field-leaks` (2 tests). D1: accept this as a documented rule, or add a central guard.

## 7. App shell and UX

- ✅ Top bar with every element in order. The "+" button follows `can(tasks.create)`. Tests:
  `web/shell/shell.test.tsx`; `e2e/home` journeys.
- ✅ A left menu per app, none on Home; strips on phones. Tests: `e2e/foundation` "menus become
  sideways strips @phone"; `e2e/settings` "settings pages fit a phone @phone".
- ✅ All apps launcher; coming-soon page. Tests: shell test "lists every app in the launcher…";
  `e2e/foundation`, which now also checks the "same users, roles and field permissions" sentence.
- ✅ Theme colours and 4.5:1 contrast: axe runs in every journey (light mode).
- 🔀⏳ **Dark mode** follows the device setting only; there is no toggle and no dark-mode axe run.
  Phase 6. D5.
- 🔀⏳ **44 px touch targets.** The shell's own buttons are 44 px; Mantine's default buttons are about
  36 px. Phase 6 accessibility pass. D6.
- ✅ **7.3 Home** in one call, with the snapshot chosen from permissions. Tests: `api/home` persona
  tests, `shared/home` rules 1 to 8, `e2e/home` persona journeys.
- ✅ **7.4** Menus, buttons and columns come from permissions. Tests: `shared/navigation` "never
  refers to a role by name"; `e2e` "the menu changes when the role changes".
- ✅ **7.5 Search.** Tests: `api/home` "finds pages, tasks and people…"; `e2e/home` "search finds a
  task".
- ✅ **7.6 School switcher.** Test: `api/home` "narrows lists on the server…".

## 8. Registration and Settings

- ✅ Registration steps 1 to 4, franchise owner invites, setup checklist. Tests:
  `api/registration` (4 tests); `api/organisation` "ticks itself from live data" and "ticks 'Create
  your roles' once the Owner creates a role"; `e2e/settings` done-when journey.
- ✅ Organisation, Schools, and Users (with the "No access yet" tag and banner).
- ✅ Roles & permissions: roles list, Manage people with scope, editor with grouped modules and
  counts, actions with hints and "Whose records", field permissions table, Preview, Automatic
  roles. Tests: `api/roles`, `api/preview`, `e2e/settings`.
- 🔀❓ "Copy from" exists only when creating a role, not inside the editor for an existing role. D7.
- ✅ "Select all" / "Clear". 🔧 There was no test; now `web/settings/settings.test.tsx` "ticks every
  action with 'Select all' and clears them with 'Clear'".
- ✅ Every Settings change is audited. 🔧 Only organisation changes had a test. Now `api/audit.test.ts`
  (11 tests) covers: role created, permissions, fields, given and removed, automatic roles, user
  created, role changed, deactivated, school created and updated, holiday created and deleted, and
  organisation settings.

## 9. Tasks

### 9.1–9.2 Model

- ✅ The task and each person's copy; "x of n done". Test: `api/tasks` "shows 'x of n done' to the
  creator".
- ✅ Every `tasks`, `task_watchers`, `task_assignments` and `task_attachments` column. The unique
  index is `(task_id, user_id, service_date)`.
- 🔀 `closes_after` is stored as `closes_after_minutes`; `task_assignment_subtasks` has no `done`
  column (a row means ticked); both are in the approved Phase 3 plan.
- ⏳❓ **Sub-task "optional due".** The column exists but nothing can set it. D10.

### 9.3 Targeting

- ✅ **Naming someone out of reach is an error that names them.** Test: `api/tasks` "refuses a named
  person out of reach, naming them" (422, no task created).
- ✅ **A broad match quietly skips people out of reach.** Test: `api/tasks` "quietly skips group
  members out of reach" (201, only people in reach get copies).
- ✅ Inactive people are never targeted. Tests: `api/tasks` "refuses inactive people and people
  without a role when named"; `api/task-schedule` "cancels untouched future copies of someone
  deactivated…".
- ✅ The creator can always target themselves. Test: `api/tasks` "lets someone without Assign give
  tasks only to themselves".
- ✅ `includeNewJoiners` defaults to false for only-named people and true otherwise. Tests:
  `shared/tasks` "includes new joiners by default only for groups"; `api/task-schedule` "picks up
  new joiners on the next run and tells them once".
  🔧 The New task drawer now has the switch (it could only be set through the API).
- ✅ Group quick-add plus people search. Tests: `api/tasks` "previews a group and applies
  exclusions"; `e2e/tasks` "a department head gives a task to every teacher across schools".

### 9.4 Statuses

- ✅ Nine statuses; the allowed moves live in shared code and are enforced on the server. Tests:
  `shared/tasks` "status moves (brief 9.4)" (every from × to × actor); `api/task-copies` "each
  endpoint from every status".
- ✅ The first tick, file or answer starts the work. Tests: `api/task-copies` "starts on the first
  tick…"; `api/task-setup-files` (file); `api/dayend` "giving an answer starts the work" (new).
- 🔀 There is no `POST /assignments/:id/start`: starting happens on the first real action, as 9.4
  defines "in progress". Recorded in PROGRESS. D8 if you want an explicit Start button.

### 9.5 Dates and repeating tasks

- ✅ **Safe to run twice.** Unique index plus insert-if-missing. Test: `api/task-schedule` "makes a
  week of copies, skipping Sundays, and a second run adds nothing". Also "runs one at a time: a
  second run at the same moment skips".
- ✅ **Creating copies only adds.** The job only removes or cancels untouched copies (holidays,
  hours, school moves, leaving), and checks that in the same statement that writes (Phase 4
  addition b). Test: `api/task-schedule` "leaves a copy alone if someone starts it while the job is
  working".
- ✅ **Edits only touch copies not yet started.** Tests: `api/tasks` "updates only untouched copies
  and says what happened" and "includes today's untouched copies while the deadline is ahead, and
  not after" (Phase 3 answer 1). 🔧 The edit path checked "untouched" only in memory, so a tick
  landing mid-edit could be overwritten or deleted. It now re-checks in the write, like the job.
  Tests: `api/tasks` "leaves a copy alone if someone starts it while the edit is working" and "never
  removes a copy someone starts while an edit takes them off the task".
- ✅ **Holidays and working days per school.**
  - One-school holiday, ordinary repeating task: `api/task-schedule` "skips a one-school holiday
    only for that school's people" (new).
  - The school's own working days: "uses a school's own working days over the organisation's"
    (new).
  - Day-end: `api/task-schedule` "makes no day-end copy on a school's holiday…"; `api/dayend` "never
    makes a copy on a Sunday or on a holiday" (new).
- ✅ Copies are made 7 days ahead, every 15 minutes and at start-up. Tests: "makes a week of
  copies…"; `unit/jobs.test.ts` "runs the task schedule every 15 minutes and once at start-up"
  (new).
- ✅ **The three dates stay separate.**
  - After the deadline a copy is overdue but can still be submitted; after closing it is closed,
    can't be submitted, and is left out of completion. Test: `api/task-schedule` "reminds an hour
    before, marks overdue at the deadline, closed at closing time".
  - Stop repeating: `shared/tasks` "never plans a copy whose deadline has passed, and stops at the
    end date".
  - Closing is kept apart from the deadline: "keeps closing separate from the deadline".
- ✅ **"End of day" is that person's school closing time, falling back to the organisation's.**
  Tests: `shared/tasks` "puts 'end of day' at the school's closing time…"; `api/task-schedule`
  "follows a person to their new school's calendar", "moves due times when working hours change…".
- ✅ **An "at a time" deadline is never moved.** Test: `api/task-schedule` "never moves an 'at a
  time' deadline when closing time changes" (new).
- ✅ **A copy's date is the local date of its deadline.** Test: `shared/tasks` "gives every copy a
  service date equal to the local date of its deadline, across DST changes" (new).
- ✅ **Night shifts are refused clearly.** Tests: `api/organisation` (the merged-record test);
  `api/schools` "refuses a night shift when adding a school, including one side inherited" (new).
  🔧 Creating a school had no check; it only hit a database rule with a generic message. The
  message now says shifts past midnight aren't supported.

### 9.6 Doing, submitting, approving

- ✅ Every sub-task must be ticked, and every required question answered. Tests: `api/task-copies`
  "…can't be submitted until everything is ticked"; `api/logout-block` "ends at submit, not
  approval" (day-end questions). 🔧 The refusal said "Tick every sub-task" even for questions; it
  now names the rule that isn't met (asserted in the same test).
- ✅ Approve or send back with remarks; remarks follow field permissions. Tests: `api/task-copies`
  "sends back with remarks the person sees…", "refuses remarks when the approver's role makes them
  view-only"; `e2e/tasks` "a principal sends work back with remarks, then approves it".
- ✅ The three approver modes. Tests: `api/tasks` "lets a named approver outside the usual reach…";
  `api/task-copies` "with 'reporting manager', gives each person's copy to their own manager"
  (new).
- ✅ **Approver fallback: the approver's manager, then an Owner.** Tests: `api/task-copies` "moves
  them to the approver's own manager, who needn't be an Owner", "falls back to an Owner when nobody
  up the approver's chain can approve", "climbs a deleted approver's chain too" (all new).
  🔧 Two fixes:
  - A deleted approver's fallback climbed the _assignee's_ chain; it now climbs the approver's.
  - Submitted work that nobody could approve would have stayed submitted forever; it now completes
    and is audited (decision 5).

### 9.7 Logout block

- ✅ It blocks only while today's copy is open and the deadline has arrived. The default lead
  window is 120 minutes (Phase 4 addition a); 0 means only from the deadline. Tests:
  `api/logout-block` "with the window set to 0, blocks only once the deadline arrives";
  `shared/time` "with 0 minutes, blocks only once the deadline has arrived".
- ✅ **The block ends at submit, not approval.** Test: `api/logout-block` "ends at submit, not
  approval". It now asserts that the copy is `submitted` and undecided when logout succeeds.
- ✅ The logout endpoint answers 409 with the list. Tests: `api/logout-block` "blocks from the start of
  the window…"; `api/auth` "is refused with 409…".
- ✅ **Previous-day write guard.**
  - Writes outside Tasks are refused while an earlier day's blocking work is open, and reads stay
    open: `api/logout-block` "refuses writes outside Tasks while an earlier day's blocking work is
    open".
  - Tasks, files and notifications still work: "still lets Tasks, files and notifications writes
    through, and reads" (new).
  - 🔀❓ The switcher (`PUT /me/school`) and starting a preview (`POST /preview`) are also allowed
    during a walk-out. They're read-side choices that change no data, but the brief's list doesn't
    name them. D9.
- ✅ **Every escape hatch.**
  - Ask for release notifies the manager: "tells the reporting manager, three times a day at
    most".
  - Release for today by the manager or anyone with approve reach, per date with Release all (Phase
    4 answer 3): "lists every blocked date and releases them all…".
  - Cancel lifts the block: "lets Rohan log out once his manager cancels the blocking copy" (new).
  - Defer lifts the block: "…defers the blocking copy to a later working day" (new).
- ✅ The logout screen lists blocking tasks with Open buttons. Test: `e2e/timebased` "Priya is
  blocked at logout…", which now clicks Open and sees the task.

### 9.8 Watchers

- ✅ Any department; view or edit access. Tests: `api/tasks` "lets a watcher outside the usual reach
  see that task, and nothing else", "lets an edit watcher change the task but not who it's for".
- ✅ Watchers are never approvers. Tests: `shared/permissions`; `api/task-copies` "watching, even with
  edit access, never makes someone an approver" (new, 403).
- ✅ The `watchers` field permission controls adding watchers. Test: `api/tasks` "refuses watchers
  from a role whose watchers field is only view" (new).
- 🔧 **Watchers are notified on submit, approve and send back.** Only submit was notified. Now
  approve and send back are too, in the app only (no SMS about someone else's work), without the
  remarks, and worded for the watcher ("Meera Iyer sent back Priya Sharma's work on …"). Test:
  `api/task-copies` "records assigned, watcher added, submitted, approved and sent back".

### 9.9 Task setup

- ✅ Categories, priorities, lists, templates, message templates; "+ New" in pickers for
  `task_setup.create`. Tests: `api/task-setup-files`.
- ✅ **Sorting follows the priorities' order, never their names.** Test: `api/tasks` "sorts by the
  priorities' order, never their names" (new: reordering Low above Urgent changes the list).
- ✅ Custom lists become a form field, a report filter and a field permission. Tests:
  `shared/registry`; `api/task-setup-files` "adds lists and values, which join the registry"; the
  report filter is in `api/reports` "always match…" (`listValue`).

### 9.10 Templates

- ✅ **People and fixed dates are stripped on save, whatever is sent.** Test: `api/task-setup-files`
  "strips people and fixed dates on save, whatever is sent". It sends a target, watchers, a named
  approver, dates and a sub-task person, and all are removed.
- ✅ **Editing a template never changes tasks made from it.** Test: "never changes tasks made from
  it" (create from template, edit it, delete it; the task is unchanged).
- 🔧 **Template edits merge.** A payload fragment used to reset every other template field to its
  default: lesson 14's bug, one level down. Tests: "renames without touching the saved task" and
  "changes only the payload fields sent, keeping the rest" (new; the merged payload is still
  stripped of people and dates).
- ✅ Used by anyone who can create tasks; managed only through Task setup. Test: `e2e/tasks` "a
  template is saved from a task and reused".

### 9.11 Day-end reports

- ✅ The five question types, each optionally required. Test: `shared/time` "checks answers against
  each question".
- ✅ Forms are assigned to roles and follow role changes. Tests: `api/dayend` "gives a new form to
  everyone with its roles…", "switches someone's form … when their role changes".
- ✅ Copies are made every working day, due at end of day, and block logout by default. Test: "blocks
  logout and is due at end of day when the form doesn't say otherwise" (new).
- ✅ **Filed answers keep a copy of the questions.** Forms have immutable versions, and each copy
  snapshots its questions. Tests: `api/dayend` "moves only untouched copies to a new version" (a
  question added after Rohan filed; his copy still reads the old questions and answers); "removing a
  form keeps a filed report with its questions and answers" (new).
- ✅ The Today tab with Release, and the Forms builder. Tests: `api/dayend` "shows a principal their
  team's reports, and lets them release"; `e2e/timebased`.

### 9.12 Parent messages

- ✅ Message templates in Task setup. The setting on a task is stored and previewed (Phase 3
  answer 2). Test: `api/tasks` "keeps the parent message setting and shows its preview" (new).
- ⏳ Sending on approval or done, the `parent_messages` log, `ParentContactSource`, and the logging
  sender. **Phase 6**; open decision 13.1.

### 9.13 Screens

- ✅ My tasks, Assigned by me, My team, Watching, Approvals, the drawer, and the New task drawer.
  Tests: `e2e/tasks` (4 journeys); `api/tasks` list tests.

### 9.14 Reports

- ✅ All filters, the summary, rows, the person drawer, saved views, CSV, visibility before filters,
  and options from what's visible. The same filter code feeds the numbers and the rows. Tests:
  `api/reports` "always match, for many filter combinations and people" (now including department
  and person), "lists only visible options…", time zone, saved views, CSV, and "never shows a task
  title the role hides…" (new); `e2e/home` report journey.
- 🔀❓ Each filter takes one value, and one custom-list value at a time. D11.

## 10. Notifications, activity, audit

- ✅ **10.1** The events are declared in one list, and an unknown event throws. Tests: `shared/time`
  "lists exactly the brief's events"; `api/task-schedule` "refuses unknown events". The settings
  screen lists every declared event: `api/notifications` "lists every declared event, with in-app
  on by default" (new). SMS for assigned, sent back and due soon; muting. Tests: `api/notifications`.
- 🔧 SMS/WhatsApp messages now carry an idempotency key per outbox row and channel, so a crash
  mid-group can't text anyone twice once the real provider passes it on (13.2). Test:
  `api/notifications` "sends the same idempotency key on a re-send after a crash…".
- ✅ **10.2** Bell and Home list. Tests: `web/shell/bell.test.tsx`; `api/notifications`; `e2e/home`.
- ✅ **10.3** Activity is written by the data layer and never holds record contents. Test:
  `api/data-layer` "records who changed which record, never its contents". The feed audience:
  `api/home`, plus "shows a new holiday in every persona's updates" and "shows 'waiting for a role'
  only to people who can see Users" (new).
- ✅ **10.4** The `audit_log` table and its entries (see section 8).
- ⏳ **The audit log screen** for Owners, with filters. **Phase 6.**

## 11. API outline

- ✅ Every route exists except `GET /audit-log` (⏳ Phase 6).
- 🔀 Some routes differ in path or split. All are now recorded in PROGRESS:
  - `/tasks?view=byme|team|watching` sit beside `/assignments?tab=my|approvals` (approved).
  - Release is `POST /users/:id/release`, per date, not `/release-today` (the behaviour was
    approved in Phase 4).
  - `/task-setup` is one combined GET, with writes per item.
  - Pending field changes are created by `PUT /users/:id` rather than `POST /field-changes`.
  - There is no `/start` (see 9.4).
- ✅ **PUT validates the merged record.** Tests: `api/organisation`, `api/schools`, `api/tasks`
  "validates the merged record, not the fragment", `api/users` "keeps every field not sent…",
  `api/organisation` holidays (new), and templates (🔧 above).
- ✅ **Fixed paths before parameter paths**, checked at start-up. Test: `unit/config-and-tokens`
  "rejects a fixed path declared after a parameter path…".
- 🔀 **`serialize()` on every response:** see 6.4 and D1.
- ✅ **Error codes** 400/401/403/404/409/422. Tests: `api/me-and-platform`, `api/users` "answers 404
  for people outside reach and 403 without edit", `api/task-copies` "answers a repeated submit with
  409…", and the isolation suite.

## 14. Lessons from the old build

- ✅ **Never edit a committed migration.** The history shows only additions. 🔧 CI now enforces it:
  `scripts/check-migrations.mjs` fails the build if a committed migration is changed, renamed or
  deleted.
- ⏳❓ **Test migrations against a copy of real data.** There's no process yet. It belongs in Phase 6
  deployment. D12.
- ✅ **PUT validates the merged record.** 🔧 Templates were the gap; now fixed (9.10).
- ✅ **Fixed routes before parameter routes**, checked at start-up (section 11).
- ✅ **Copies safe to run twice; creating copies only adds; three dates;** end of day follows working
  hours and the copy's date matches its deadline (9.5).
- ✅ **One holiday list.** A single table, read by one calendar loader. Test: `api/task-schedule`
  holiday tests.
- 🔀 **A strict output whitelist.** `serialize()` is the whitelist for records; the composed screens
  are explicit (D1).
- ✅ **Don't widen the manager check.** `canRelease` is its own function, and release comes from
  approve in the registry. Test: `shared/permissions` "release is derived from approve".
- ✅ **Named people out of reach are an error; broad matches skip them** (9.3).
- ✅ **The logout block ends at submit** (9.7).
- ✅ **Filter options come from what the user can see** (9.14).
- ✅ **Comments explain why** throughout (not testable).

---

## For your decision

| #   | Question                                                                                                                                                                                                 | Recommendation                                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **`serialize()` as the single output path.** Composed screens (reports, search, Home, feed, notifications, day-end, logout) check `fieldAccess` themselves. The audit found two that didn't (now fixed). | Accept it as a documented rule, and add a test helper that hides every field of a role and checks every composed endpoint for leaks (Phase 6). |
| D2  | **User photo.** The column exists, but there's no upload or display.                                                                                                                                     | Phase 6 polish (same pipeline as the logo), or drop it for v1.                                                                                 |
| D3  | **Franchise owner seed** lacks `users.delete` and `task_setup`.                                                                                                                                          | Keep as is (they manage people but can't delete; head office owns setup) unless the demo says otherwise.                                       |
| D4  | **Stamps on copies and sub-tasks.** `task_assignments` / `task_subtasks` have no `created_by` / `updated_by`; changes are traced through `decided_by`, `cancelled_by` and activity.                      | Accept: activity already records every change with its actor.                                                                                  |
| D5  | **Dark mode** follows the device only.                                                                                                                                                                   | Phase 6: add a Light / Dark / Device choice in the profile menu, and run axe in dark mode too.                                                 |
| D6  | **44 px touch targets.** Mantine buttons are about 36 px.                                                                                                                                                | Phase 6: make buttons at least 44 px on touch screens (`pointer: coarse`), keeping desktop compact.                                            |
| D7  | **"Copy from"** only when creating a role.                                                                                                                                                               | Add "Copy from…" inside the editor too (overwrites the grants after a confirmation).                                                           |
| D8  | **Starting a task.** It starts on the first tick, file or answer; there's no Start button.                                                                                                               | Keep implicit.                                                                                                                                 |
| D9  | **Walk-out guard exemptions** for the school switcher and starting a preview.                                                                                                                            | Keep them: they change no organisation data.                                                                                                   |
| D10 | **Sub-task due times** (brief 9.2 "optional due").                                                                                                                                                       | Drop for v1 (the column stays unused); revisit with real use.                                                                                  |
| D11 | **Report filters** take one value each, and one custom-list value.                                                                                                                                       | Keep for v1; multi-select in a later phase if asked.                                                                                           |
| D12 | **Testing migrations on a copy of real data** (lesson 14).                                                                                                                                               | Phase 6 deployment: a documented restore-to-staging step and a script that runs pending migrations on a fresh restore before each release.     |
