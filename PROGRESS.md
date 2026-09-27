# Progress

## Status

| Phase                           | State       |
| ------------------------------- | ----------- |
| 1. Foundation                   | Done        |
| 2. Registration and Settings    | Done        |
| 3. Tasks core                   | Done        |
| 4. Time-based features          | Done        |
| 5. Home, notifications, reports | Done        |
| 6. Parent messages and polish   | Not started |

## Brief audit (after Phase 5)

[`docs/brief-audit.md`](docs/brief-audit.md): sections 4 to 11 and 14, item by item, with the test that
proves each. Gaps it found were fixed in the same change (watchers told about approve and send back;
template edits merge; task edits re-check untouched copies in the write; approver fallback; night
shifts on new schools; two field-permission leaks; data-layer audit stamps; CI check on committed
migrations; SMS idempotency keys). Twelve decisions are listed for the product owner.

## Phase 5: Home, notifications, reports (done)

Plan: [`docs/plans/phase-5-home-notifications-reports.md`](docs/plans/phase-5-home-notifications-reports.md);
snapshot rules: [`docs/home-snapshot.md`](docs/home-snapshot.md).

- **Home in one call** (`GET /home`): greeting and summary, attention cards, the snapshot chosen
  from permissions and reach (never role names; one test per rule), Updates, Notifications, Your
  tasks. Owner across 1,000+ people: about 200 ms locally (budget 400 ms; the test allows 1,500 ms).
- **Updates feed** (10.3): task actions carry verbs (`uow.act`: assigned, submitted, approved,
  sent back, missed, ...), `activity.task_id` lets visibility run inside the query before the
  limit; titles and names follow field permissions; batched lookups.
- **Notifications:** a delivery worker every minute (lease, idempotent, batched: 1,000 events in
  about 2 s), in-app plus SMS/WhatsApp through the provider with answer 3's rules (defaults,
  "assigned" once for repeating tasks, quiet hours held until 07:00 and dropped if no longer
  relevant, daily cap with a log entry, inactive people skipped, current mobile), retries with
  backoff, claimed sends so a crash re-sends at most one chunk of 25. Bell with unread count
  (polled every minute and on focus, announced politely), mark read, mark all read, grouping,
  "This task was removed", muting per event and channel, 90-day clean-up.
- **Reports** (9.14): one filter function for summary, rows and CSV (tested over many filter
  combinations and people); options only from what's visible; organisation time zone; saved
  views per person (dropped filters with a notice); person drawer (404 out of reach); CSV with
  field-permission columns, formula-injection protection, streaming, audit and a per-person rate
  limit.
- **Search** (7.5): pages, tasks and people, visibility in the query, trigram indexes.
- **School switcher** (7.6): stored per person, only schools in scope, applied on the server
  through the list scopes; the bell, notifications and your own Approvals are never narrowed;
  narrowed screens show "Showing X only · Show all".
- **Seed:** the demo's Updates and each persona's notifications (added to existing development
  databases).
- **Tests:** API integration for Home, notifications, reports, search, switcher and the time
  budget; 123 isolation cases; web unit test for the bell; 7 new Playwright journeys (each
  persona's Home, a notification received and opened, a report filtered, saved and downloaded,
  search finds a task), all with axe.

## Phase 4: Time-based features (done)

Plan: [`docs/plans/phase-4-time-based.md`](docs/plans/phase-4-time-based.md).

- **The job** (`apps/api/src/apps/tasks/schedule.ts`): `task-schedule` every 15 minutes and at
  start-up; one run at a time (pg-boss singleton queue plus a `job_runs` lease: a partial unique
  index allows one running row); every run logged; Owners see the last run in Settings ->
  Organisation; each server warns after an hour without a success. Never copies for past dates;
  the gap after downtime is logged and stored on the run.
- **Copies for the week** for repeating tasks and day-end forms (each school's calendar, addition
  c), batched inserts, safe to run twice.
- **Changes after copies exist** only touch untouched copies (to-do, no ticks, files or answers),
  checked in the same statement that writes (addition b; race tested): holidays (repeating only;
  warnings both ways), working days and hours, school moves, deactivation and role loss (cancelled
  with a reason), day-end form versions and role changes, group joiners and leavers. Holiday,
  hours, school and role changes ask for an early run for that organisation.
- **Overdue and closed**, and one shared completion count that leaves closed and cancelled copies
  out everywhere.
- **Logout block** with the organisation's window (default 120 minutes before the deadline, 0 =
  only after), 409 on logout, walk-out guard on other writes, ask for release (3 a day), release
  per date with "Release all" (one row and one audit entry per date), defer (answer 2).
- **Day-end reports:** forms with immutable versions and roles, answers checked against each
  copy's own questions, Today tab, form builder; "Assigned by" shows the form's name.
- **Reminder events** in `notification_outbox` (brief 10.1 list, dedupe keys): assigned, due
  soon, overdue, submitted, approved, sent back, release requested, released, watcher added,
  waiting for a role, field change needs approval.
- **Time in tests:** API tests pin the clock to a Monday; Playwright's server starts at `E2E_NOW`
  and moves with a test-only clock route (`E2E_TEST_HOOKS`, refused in production). The app
  follows the server's clock for "Today" (`/me` sends `serverTime`).
- **Seed:** the demo's day-end forms and today's reports with the demo's statuses (added to
  existing development databases).
- **Tests:** 461 API tests (schedule, logout block, day-end, 108 isolation cases), 498 shared
  tests, 21 Playwright journeys (Priya blocked and released; a day-end report on a phone).

## Phase 3: Tasks core (done)

Plan: [`docs/plans/phase-3-tasks-core.md`](docs/plans/phase-3-tasks-core.md).

- **Tables** (migrations `tasks` and `task_rules`): categories, priorities, custom lists and
  values, parent message templates, task templates, tasks (Phase 4 repeat fields and
  `generated_through` included), sub-tasks, watchers, per-person copies with `service_date`,
  `due_at`, `closes_at` and UNIQUE `(task_id, user_id, service_date)`, ticks, attachments.
- **Calendar** (`packages/shared/src/tasks/calendar.ts`): time zones, working days, holidays per
  school, daily / weekly / monthly patterns, month-end clamp, never a copy whose deadline passed.
  Phase 3 makes the first copy; Phase 4 schedules the same function.
- **Statuses:** the moves and who makes each live in `packages/shared`; the server moves copies
  with conditional updates (409 with the current status on repeats and races).
- **Targeting:** named people out of reach are an error naming them; groups skip them quietly;
  inactive and role-less people never included; `TASK_MAX_RECIPIENTS` (1,000). Tested at the limit.
- **Visibility:** approvers, creators and sub-task people are _participants_ with access to that
  one record only; lists use their own membership columns. Editing a task needs reach over its
  creator (or being its creator or an edit watcher).
- **Edits** update untouched copies (to-do, and later than today or today before the deadline);
  the response and the app say how many were updated and how many kept the old version.
- **Files:** photos shrunk on the phone and re-encoded on the server (metadata and GPS stripped);
  PDFs with scripts (also in compressed streams), macro Office files and old .doc/.xls refused.
- **Screens:** My tasks, Assigned by me, My team, Watching, Approvals, task drawer, New / Edit task
  drawer, Task setup (templates, categories, priorities, lists, parent messages). Phone first.
- **Seed:** the demo's masters, templates and tasks t1-t8 with every copy, relative to today;
  added automatically to existing development databases (nothing is wiped).
- **Tests:** 415 API tests (tasks, copies from every status, setup, files, scale, 95 isolation
  cases), 486 shared tests (full status matrix), 19 Playwright journeys with axe, including Priya's
  steps on a phone.

## Phase 2: Registration and Settings (done)

Plan: [`docs/plans/phase-2-registration-settings.md`](docs/plans/phase-2-registration-settings.md).

- **Registration:** four steps as in the demo, mobile proved with a one-time code, single-use
  registration token, the whole sign-up in one transaction (organisation, schools, seed roles,
  Owner, invited franchise owners), per-IP daily cap. A single school is stored as an organisation
  with one school.
- **Organisation:** name, logo, time zone, working days, hours (merged-record validation),
  holidays for all or chosen schools, setup checklist on Home that ticks itself.
- **Logo upload:** type sniffed from the file's bytes (PNG, JPEG, WebP only; no SVG), re-encoded
  with sharp so all metadata is dropped, served with a fixed image type, `nosniff` and a
  `default-src 'none'; sandbox` CSP. Storage behind an interface: local disk and S3-compatible.
- **Schools:** list limited to each person's scope, principal and franchise owner, invite a new
  franchise owner with a role, soft delete refused while people or role scopes use the school.
- **Users:** paginated list with search, school and status filters; columns, search, filters and
  sorting all respect field permissions (hidden fields can't be searched, filtered or sorted);
  add / edit drawer; re-send invite (daily cap); deactivate (signs out at once, can move direct
  reports in the same step); reactivate; soft delete; last-Owner protection.
- **Power rule:** nobody but an Owner can give, or edit a role into, more than their own role
  allows (actions, reach, field access, own-record edit, approval). Scopes given must be within
  the giver's scope. Nobody can change, deactivate or delete someone whose role is more powerful.
  New school and new manager must be within the editor's reach; reports-to still passes the loop
  check.
- **Roles & permissions:** roles list with people counts, Manage people with scope, Keka-style
  editor (sections by app, actions with hints, whose records, field permissions table, select
  all / clear, copy from), automatic roles, refuse deleting roles people hold.
- **Preview as this role:** read-only, audited, only for people who can edit roles and only of
  people in their reach; shows only what both people may see (tested with the salary case).
- **Pending field changes:** generic per-module handlers (Users registered now), one open request
  per field per record (a new one replaces the old), approval checks the old value still matches
  (else "out of date"), approver is the nearest active manager up the chain, else an Owner.
  Approvers whose role hides the field decide without seeing the values.
- **Your details:** your own record as your field permissions allow, and a password change
  (signs out other devices).
- **Single-use tokens:** the organisation-picker and registration tokens now work only once.
- **Tests:** 143 shared, 249 API (integration on a real database, isolation cases for all 56
  signed-in routes), 16 web component, 15 Playwright journeys with axe, including the brief's "done when"
  journey end to end.

## Phase 1: Foundation (done)

- **Repo:** pnpm workspace (`apps/api`, `apps/web`, `packages/shared`), strict TypeScript, ESLint
  (strict type-checked, zero warnings), Prettier, Docker Compose Postgres, one-command `pnpm dev`,
  GitHub Actions CI, Dockerfile.
- **Shared rules:** module registry, permission engine, Zod schemas.
- **Database:** composite organisation foreign keys, reports-to loop trigger, organisation-id
  immutability trigger, partial unique indexes, CHECK constraints.
- **Data layer:** organisation-scoped Prisma client, unit of work with automatic activity and
  explicit audit entries, the one cross-organisation auth store.
- **Auth, API, jobs, web shell, seed and tests** as described in the Phase 1 plan.

## Next: Phase 6 (Parent messages and polish)

A plan will be shared for approval first.

## Decisions

Decided in the brief and kept as-is unless listed here.

| Decision                                                                                                                                                                                         | Why                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Role school scope uses a join table `role_assignment_schools`, not a uuid array (**replaces brief 5.5's `scope_school_ids`**, approved)                                                          | The database can guarantee each school exists and belongs to the same organisation.                        |
| Holiday schools use a join table `holiday_schools` (approved)                                                                                                                                    | Same reason.                                                                                               |
| Every reference between org-scoped tables is a composite foreign key `(organisation_id, x_id)`                                                                                                   | Cross-organisation links are impossible in the database, not just in code.                                 |
| `created_by` / `updated_by` have no foreign key                                                                                                                                                  | Audit stamps set from the request context, never from input; they must survive user deletion.              |
| One mobile in several organisations: verify the code, then pick an organisation; the last choice is pre-selected on that device (approved)                                                       | Mobile is only unique within an organisation.                                                              |
| Tracked-table writes go through `withUnitOfWork()`; bulk writes that can't report their rows are refused                                                                                         | Activity is never missed and always shares the data's transaction.                                         |
| Role permission rows aren't tracked one by one; saving them updates the role row, which records one "role updated" activity                                                                      | One meaningful event per save rather than one per row.                                                     |
| `GET /me` is whitelisted by its shared Zod schema and leaves out contact details                                                                                                                 | It is identity, not a Users record. Users records go through `serialize()`.                                |
| Access tokens name their session and it is checked on every request                                                                                                                              | Logout and deactivation take effect immediately.                                                           |
| Rate limits stored in Postgres                                                                                                                                                                   | Survive restarts and replicas without Redis.                                                               |
| Unknown mobile numbers get a normal response but no SMS (sign-in); registration codes are always sent                                                                                            | Stops account discovery and SMS pumping; registration is capped by the same limits.                        |
| Power rule ("no more powerful than your own") for giving roles, editing roles, and managing people (approved, additions b and c)                                                                 | Stops privilege escalation through role management.                                                        |
| Preview is header-based and validated on every request; starting one is audited (approved, addition a)                                                                                           | Read-only, and never shows the previewer more than their own role allows.                                  |
| Starter roles carry a `seed_key`                                                                                                                                                                 | Code finds "the franchise owner role" without matching on an editable name.                                |
| Pending-change approver: nearest active manager up the chain, else an Owner; Owners may always decide                                                                                            | Brief 6.2 rule 5 plus addition e.                                                                          |
| Schools list is limited to the person's school scope (schools has no reach in the registry)                                                                                                      | Matches the demo: franchise owners see their own schools.                                                  |
| "Your details" (`/profile`) and "Changes to approve" (`/changes`) are reached from the profile menu, not the Settings menu                                                                       | They're personal, not a module someone is granted.                                                         |
| Deleting a user is a soft delete, refused while people report to them                                                                                                                            | Keeps the audit trail and the reporting tree intact.                                                       |
| Pinned TypeScript 6.0 (not 7); Prisma 7.10                                                                                                                                                       | Tool compatibility and stable releases only.                                                               |
| API dev server uses `node --watch` with the tsx loader                                                                                                                                           | `tsx watch` hangs under `concurrently` on Windows.                                                         |
| Phase 3 decisions 1-6 and additions a-c (see the Phase 3 plan)                                                                                                                                   | Approved with the plan.                                                                                    |
| `tasks.created_by` has a foreign key, unlike other `created_by` stamps                                                                                                                           | The creator is a business fact (who may edit, who approves by default).                                    |
| Copy lists are `/assignments?tab=my\|approvals`; task lists are `/tasks?view=byme\|team\|watching`                                                                                               | Brief 11 suggested one route; the two return different things (copies vs tasks with progress).             |
| Group targets are stored as a rule (roles × schools), shown as one chip, not expanded to checkboxes as in the demo                                                                               | Keeps `includeNewJoiners` meaningful for repeating tasks.                                                  |
| One activity row per task action, naming everyone affected in `subject_user_ids` (GIN-indexed); copies roll up into their task (changed at Phase 3 review)                                       | A task for 1,000 people writes one row; each person's feed still finds it (`activityAbout`).               |
| Time-zone maths without a date library (`Intl` only)                                                                                                                                             | Small and tested (including a DST zone); the plan had suggested date-fns.                                  |
| Cancelling a copy is never open to the person themselves                                                                                                                                         | Roles often grant edit on one's own records; that must not mean cancelling one's own work.                 |
| Phase 4 answers 1-5 and additions a-c (see the Phase 4 plan)                                                                                                                                     | Approved with the plan.                                                                                    |
| Job lease in `job_runs` (partial unique index on running rows) as well as the pg-boss singleton queue                                                                                            | Holds across servers; a crashed run's lease expires after 30 minutes.                                      |
| My tasks shows each repeating task once under Coming up (its next copy)                                                                                                                          | A week of copies per task would bury the list.                                                             |
| `/me` sends `serverTime`; the app groups by the server's date                                                                                                                                    | Phones with wrong clocks, and pinned test dates, still show the right "Today".                             |
| Phase 5 answers 1-5 and additions a-e (see the Phase 5 plan)                                                                                                                                     | Approved with the plan.                                                                                    |
| Route shapes differ from brief 11 in places: `POST /users/:id/release` (per date), one `GET /task-setup`, pending changes created by `PUT /users/:id`, no `/assignments/:id/start` (brief audit) | Same behaviour, fewer round trips; a copy starts on its first tick, file or answer (brief 9.4).            |
| Permission functions take a context plus record facts; `visibleUserIds` is `reachScope` (user ids, school ids, watched) (brief audit)                                                            | The same rules run in memory (`can`) and as SQL (`reachScope`), tested to agree.                           |
| A school's `working_days` empty list means "use the organisation's" (brief audit)                                                                                                                | Same meaning as the brief's null; simpler to edit.                                                         |
| Watchers hear about approve and send back in the app only, without remarks (brief audit)                                                                                                         | Brief 9.8; remarks follow their own field permission, and SMS is for the person's own work.                |
| `created_by` / `updated_by` stamped centrally by the data layer from the unit of work's actor (brief audit)                                                                                      | One place, like scoping; copies and sub-task ticks are traced through activity instead (D4).               |
| Notification text is written when read, for the reader; rows store ids only                                                                                                                      | Field permissions and visibility changes apply to old notifications too.                                   |
| Report filters live in the address; saved views store the filters                                                                                                                                | Reports can be bookmarked and shared; a view is just a named address.                                      |
| Out-of-reach people in the report drawer answer 404 (not an empty list)                                                                                                                          | Same rule as every other record.                                                                           |
| SMS/WhatsApp sends are claimed in bulk, sent 25 at a time, marked per chunk; each message carries an idempotency key (`<outboxId>:sms`) (Phase 5 review)                                         | Fast for big assignments; a crash re-sends at most one chunk, and the key lets the vendor drop the repeat. |

## Open decisions (brief section 13) and their placeholders

| #    | Question                                                | Placeholder in the code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 13.1 | Where parent contacts come from                         | Tasks store the "message parents" setting and show the preview; nothing is sent. Class names are a placeholder list. `ParentContactSource` arrives in Phase 6.                                                                                                                                                                                                                                                                                                                                                        |
| 13.2 | SMS / WhatsApp / OTP provider (DLT, WhatsApp templates) | `MessageProvider` interface (`apps/api/src/core/messaging.ts`) with a console provider that logs codes and invites instead of sending. Production refuses to start with it. **When chosen:** the real adapter must pass each notification's `idempotencyKey` (`<outboxId>:sms`, the same on every attempt) to the vendor's idempotency / client-reference field, or keep its own record of keys already sent, so a crash mid-group never texts anyone twice (tested with the in-memory provider, which honours keys). |
| 13.3 | Who a COCO principal reports to                         | No code needed: reports-to is set per person. The seed follows the demo.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 13.4 | Franchise owners creating roles                         | Default stands: head office defines roles; franchise owners only hand out existing ones (seed role has no `roles` permission, and the power rule applies).                                                                                                                                                                                                                                                                                                                                                            |
| 13.5 | One role per user                                       | Default stands for v1: unique `user_id` on `role_assignments`; the separate table keeps multiple roles possible later.                                                                                                                                                                                                                                                                                                                                                                                                |

## Phase 2 follow-ups (done)

- **Automatic-role switches are Owner-only** (decided after Phase 2): they change every manager's
  powers at once. Others with roles.view see them read-only; the API refuses changes with 403.
- **Both storage drivers are tested for real.** The S3 driver runs the same contract tests as the
  local-disk driver against an S3-compatible server in docker-compose and in CI, including a check
  that wrong credentials are refused. **SeaweedFS instead of MinIO:** MinIO no longer publishes
  public container images (Docker Hub, quay.io and Bitnami all refuse the pull), so the local and
  CI S3 service is SeaweedFS 4.47 with S3 credentials configured. The production bucket waits for
  deployment.
- **13.2 (SMS provider):** decision pending with the product owner; the production guard stays.

## Notes for later phases

- Progress on task lists loads each listed task's visible copies; for very large repeating tasks, move it to a grouped SQL query.
- Holidays are read by Phase 4 repeating-task generation directly from the database.
- Consider Postgres row-level security as a third tenancy layer once the data model settles.
