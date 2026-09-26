# Progress

## Status

| Phase                           | State                     |
| ------------------------------- | ------------------------- |
| 1. Foundation                   | Done, waiting for review  |
| 2. Registration and Settings    | Next, plan to be approved |
| 3. Tasks core                   | Not started               |
| 4. Time-based features          | Not started               |
| 5. Home, notifications, reports | Not started               |
| 6. Parent messages and polish   | Not started               |

## Phase 1: Foundation (done)

- **Repo:** pnpm workspace (`apps/api`, `apps/web`, `packages/shared`), strict TypeScript, ESLint
  (strict type-checked, zero warnings), Prettier, Docker Compose Postgres, one-command `pnpm dev`,
  GitHub Actions CI, Dockerfile.
- **Shared rules:** module registry with the brief's v1 modules (`tasks`, `dayend`,
  `task_reports`, `task_setup`, `hrms_staff` as coming soon, `users`, `roles`, `schools`,
  `organisation`); permission engine (`can`, `fieldAccess`, `fieldDecision`, `serialize`,
  `checkWrite`, `reachScope`, `navigationFor`, `normalizeActions`, Owner guards); Zod schemas.
- **Database:** Phase 1 tables, composite organisation foreign keys, reports-to loop trigger,
  organisation-id immutability trigger, partial unique indexes, CHECK constraints.
- **Data layer:** organisation-scoped Prisma client, unit of work with automatic activity and
  explicit audit entries in the same transaction, the one cross-organisation auth store.
- **Auth:** one-time codes, optional passwords, organisation picker (remembers the last choice on
  the device), rotating refresh tokens with reuse detection, immediate logout, rate limits with
  daily caps, logout-guard and write-guard hook points for apps.
- **API:** `GET /health`, `POST /auth/request-code|verify-code|login|select-organisation|refresh|logout`,
  `GET /me`, `GET /registry`. JSON logs with request ids, central error handler.
- **Jobs:** pg-boss with an hourly auth cleanup job (idempotent, retried, logged).
- **Web:** sign-in, app shell (top bar, app tabs, launcher, profile menu, left menus from
  permissions), Home greeting, account-ready, coming-soon and not-found pages, phone layout.
- **Seed:** the demo organisation (4 schools, 18 people, 5 roles) plus a second organisation.
- **Tests:** permission engine unit tests for every rule in brief section 6, org-scoping extension
  unit tests, integration tests on a real database, a tenant-isolation suite that fails when a
  route has no isolation case, web component tests, Playwright journeys with axe.

## Next: Phase 2 (Registration and Settings)

Registration flow and setup checklist; Organisation (working days, hours, holidays); Schools;
Users (invite, "No access yet"); Roles & permissions editor; Manage people with scope; field
permissions; automatic roles; Preview as role; pending field changes. A plan will be shared for
approval first.

## Decisions

Decided in the brief and kept as-is unless listed here.

| Decision                                                                                                                                         | Why                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role school scope uses a join table `role_assignment_schools`, not a uuid array (**replaces brief 5.5's `scope_school_ids`**, approved)          | The database can then guarantee each school exists and belongs to the same organisation.                                                                 |
| Every reference between org-scoped tables is a composite foreign key `(organisation_id, x_id)`                                                   | Cross-organisation links are impossible in the database, not just in code.                                                                               |
| `created_by` / `updated_by` have no foreign key                                                                                                  | They are audit stamps set from the request context, never from input, and must survive user deletion (like `audit_log`). Flag if you want them enforced. |
| One mobile in several organisations: verify the code first, then pick an organisation; the last choice is pre-selected on that device (approved) | Mobile is only unique within an organisation.                                                                                                            |
| Tracked-table writes must go through `withUnitOfWork()`; bulk writes that can't report their rows are refused                                    | So activity is never missed and always shares the data's transaction.                                                                                    |
| `GET /me` is whitelisted by its shared Zod schema rather than `serialize()`, and leaves out contact details                                      | It is the signed-in identity, not a Users record; Users records will go through `serialize()` in Phase 2.                                                |
| Access tokens name their session and the session is checked on every request                                                                     | Logout and deactivation take effect immediately rather than after 12 hours.                                                                              |
| Rate limits are stored in Postgres                                                                                                               | Survives restarts and multiple instances without adding Redis (brief: one database).                                                                     |
| Unknown mobile numbers get a normal response but no SMS                                                                                          | Stops account discovery and SMS-pumping costs.                                                                                                           |
| Releasing someone from the logout block is a derived action of `approve`                                                                         | Brief 9.7: anyone who can approve their work can release them.                                                                                           |
| Pinned TypeScript 6.0 (not 7)                                                                                                                    | typescript-eslint doesn't support TypeScript 7 yet.                                                                                                      |
| Prisma 7.10 (the npm `latest` tag points at an 8.0 release candidate)                                                                            | Stable release only.                                                                                                                                     |
| API dev server uses `node --watch` with the tsx loader                                                                                           | `tsx watch` hangs under `concurrently` on Windows.                                                                                                       |

## Open decisions (brief section 13) and their placeholders

| #    | Question                                                | Placeholder in the code                                                                                                                                   |
| ---- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 13.1 | Where parent contacts come from                         | Nothing yet; a `ParentContactSource` interface arrives with parent messages (Phase 6).                                                                    |
| 13.2 | SMS / WhatsApp / OTP provider (DLT, WhatsApp templates) | `MessageProvider` interface (`apps/api/src/core/messaging.ts`) with a console provider that logs instead of sending. Production refuses to start with it. |
| 13.3 | Who a COCO principal reports to                         | Nothing assumed: reporting lines are data. The seed follows the demo (COCO principals report to the Owner).                                               |
| 13.4 | Franchise owners creating roles                         | Seed "Franchise owner" role has no `roles` permission, per "HO only". Changing it is a role setting, not code.                                            |
| 13.5 | One role per user                                       | Enforced by a unique `user_id` on `role_assignments`; the separate table keeps multiple roles possible later.                                             |

## Notes for later phases

- Custom lists (Phase 3) plug in with `registry.withExtraFields('tasks', …)`.
- Tasks registers its logout guard and write guard in `createHooks()` (Phase 4).
- Consider Postgres row-level security as a third tenancy layer once the data model settles.
