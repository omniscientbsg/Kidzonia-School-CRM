# Progress

## Status

| Phase                           | State                     |
| ------------------------------- | ------------------------- |
| 1. Foundation                   | Done                      |
| 2. Registration and Settings    | Done, waiting for review  |
| 3. Tasks core                   | Next, plan to be approved |
| 4. Time-based features          | Not started               |
| 5. Home, notifications, reports | Not started               |
| 6. Parent messages and polish   | Not started               |

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

## Next: Phase 3 (Tasks core)

Tasks and assignments, targeting, sub-tasks, statuses and transitions, New task drawer, task
detail drawer, My tasks / Assigned by me / My team / Watching / Approvals, approve and send back,
watchers, categories, priorities, custom lists, task templates. A plan will be shared for approval
first.

## Decisions

Decided in the brief and kept as-is unless listed here.

| Decision                                                                                                                                   | Why                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Role school scope uses a join table `role_assignment_schools`, not a uuid array (**replaces brief 5.5's `scope_school_ids`**, approved)    | The database can guarantee each school exists and belongs to the same organisation.           |
| Holiday schools use a join table `holiday_schools` (approved)                                                                              | Same reason.                                                                                  |
| Every reference between org-scoped tables is a composite foreign key `(organisation_id, x_id)`                                             | Cross-organisation links are impossible in the database, not just in code.                    |
| `created_by` / `updated_by` have no foreign key                                                                                            | Audit stamps set from the request context, never from input; they must survive user deletion. |
| One mobile in several organisations: verify the code, then pick an organisation; the last choice is pre-selected on that device (approved) | Mobile is only unique within an organisation.                                                 |
| Tracked-table writes go through `withUnitOfWork()`; bulk writes that can't report their rows are refused                                   | Activity is never missed and always shares the data's transaction.                            |
| Role permission rows aren't tracked one by one; saving them updates the role row, which records one "role updated" activity                | One meaningful event per save rather than one per row.                                        |
| `GET /me` is whitelisted by its shared Zod schema and leaves out contact details                                                           | It is identity, not a Users record. Users records go through `serialize()`.                   |
| Access tokens name their session and it is checked on every request                                                                        | Logout and deactivation take effect immediately.                                              |
| Rate limits stored in Postgres                                                                                                             | Survive restarts and replicas without Redis.                                                  |
| Unknown mobile numbers get a normal response but no SMS (sign-in); registration codes are always sent                                      | Stops account discovery and SMS pumping; registration is capped by the same limits.           |
| Power rule ("no more powerful than your own") for giving roles, editing roles, and managing people (approved, additions b and c)           | Stops privilege escalation through role management.                                           |
| Preview is header-based and validated on every request; starting one is audited (approved, addition a)                                     | Read-only, and never shows the previewer more than their own role allows.                     |
| Starter roles carry a `seed_key`                                                                                                           | Code finds "the franchise owner role" without matching on an editable name.                   |
| Pending-change approver: nearest active manager up the chain, else an Owner; Owners may always decide                                      | Brief 6.2 rule 5 plus addition e.                                                             |
| Schools list is limited to the person's school scope (schools has no reach in the registry)                                                | Matches the demo: franchise owners see their own schools.                                     |
| "Your details" (`/profile`) and "Changes to approve" (`/changes`) are reached from the profile menu, not the Settings menu                 | They're personal, not a module someone is granted.                                            |
| Deleting a user is a soft delete, refused while people report to them                                                                      | Keeps the audit trail and the reporting tree intact.                                          |
| Pinned TypeScript 6.0 (not 7); Prisma 7.10                                                                                                 | Tool compatibility and stable releases only.                                                  |
| API dev server uses `node --watch` with the tsx loader                                                                                     | `tsx watch` hangs under `concurrently` on Windows.                                            |

## Open decisions (brief section 13) and their placeholders

| #    | Question                                                | Placeholder in the code                                                                                                                                                     |
| ---- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 13.1 | Where parent contacts come from                         | Nothing yet; a `ParentContactSource` interface arrives with parent messages (Phase 6).                                                                                      |
| 13.2 | SMS / WhatsApp / OTP provider (DLT, WhatsApp templates) | `MessageProvider` interface (`apps/api/src/core/messaging.ts`) with a console provider that logs codes and invites instead of sending. Production refuses to start with it. |
| 13.3 | Who a COCO principal reports to                         | No code needed: reports-to is set per person. The seed follows the demo.                                                                                                    |
| 13.4 | Franchise owners creating roles                         | Default stands: head office defines roles; franchise owners only hand out existing ones (seed role has no `roles` permission, and the power rule applies).                  |
| 13.5 | One role per user                                       | Default stands for v1: unique `user_id` on `role_assignments`; the separate table keeps multiple roles possible later.                                                      |

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

- Custom lists (Phase 3) plug in with `registry.withExtraFields('tasks', …)`.
- Tasks registers its logout guard and write guard in `createHooks()` (Phase 4).
- Holidays are read by Phase 4 repeating-task generation directly from the database.
- Consider Postgres row-level security as a third tenancy layer once the data model settles.
