# Kidzonia 360

A suite of apps for pre-schools and school groups: one login, one set of users and roles, many apps
on top. Version 1 is **Core** (organisation, schools, users, roles, permissions) plus the **Tasks**
app. The product brief is [`KIDZONIA_360_BUILD_BRIEF.md`](KIDZONIA_360_BUILD_BRIEF.md); progress and
decisions are in [`PROGRESS.md`](PROGRESS.md).

## Quick start

Needs Node 22+, pnpm 11 (`corepack enable`) and Docker.

```sh
pnpm install
pnpm dev
```

`pnpm dev` starts Postgres and an S3-compatible store (SeaweedFS) in Docker, applies migrations, seeds the demo organisation if the
database is empty, and runs the API (http://localhost:4000) and the web app
(http://localhost:5173) together. Open http://localhost:5173 and sign in with any seeded mobile
number and the development code **123456**, for example:

| Person       | Mobile      | Sees                                  |
| ------------ | ----------- | ------------------------------------- |
| Ananya Rao   | 98480 11201 | Owner, everything                     |
| Meera Iyer   | 98480 33105 | Principal, her team                   |
| Rohan Gupta  | 98480 44109 | Teacher, own work                     |
| Rahul Verma  | 98480 44114 | No role yet ("Your account is ready") |
| Priya Sharma | 98480 44108 | In two organisations (picker)         |

Ananya also has a password (printed by `pnpm seed`). To try sign-up, open
http://localhost:5173/register; every code is 123456 in development.

## Scripts

| Command                | What it does                                                           |
| ---------------------- | ---------------------------------------------------------------------- |
| `pnpm dev`             | Everything for local development (see above)                           |
| `pnpm lint`            | ESLint, zero warnings allowed                                          |
| `pnpm format`          | Prettier (`format:check` to verify only)                               |
| `pnpm typecheck`       | TypeScript in every package                                            |
| `pnpm test`            | Unit and integration tests (shared, API against real Postgres, web)    |
| `pnpm test:e2e`        | Builds the web app and runs Playwright + axe against it                |
| `pnpm build`           | Production build of every package                                      |
| `pnpm check`           | All of the above; a phase is done only when this passes                |
| `pnpm seed`            | Seeds an empty database; `pnpm seed --reset` empties a local one first |
| `pnpm db:up / db:down` | Start / stop the Postgres container                                    |

API-only: `pnpm --filter @kidzonia/api db:migrate` creates a new migration during development.

## Folder layout

```
apps/api/               Express 5 API
  prisma/               schema.prisma, migrations (never edited once committed), seed.ts
  src/core/             auth, /me, /registry, health, seed roles, hook points for apps
  src/db/               the only code that touches the database directly:
                        org-scoping extension, unit of work, activity tracking, auth store
  src/http/             request ids, auth middleware, route table, validation, error handler
  src/jobs/             pg-boss background jobs
  test/                 unit/, integration/, isolation/ (tenant isolation suite)
apps/web/               React 19 + Vite + Mantine
  src/shell/            top bar, app tabs, left menus
  src/auth/             sign-in, session, /me
  src/pages/            Home, account ready, coming soon, not found
  e2e/                  Playwright journeys with axe checks
packages/shared/        rules used by both sides
  src/registry/         registerModule(); knows no app
  src/modules/          the apps' module declarations (the only place listing apps)
  src/permissions/      can, fieldAccess, serialize, checkWrite, reachScope, navigationFor
  src/schemas/          Zod schemas for every request and response
```

## How the pieces fit

- **Permissions** live in `packages/shared/permissions` as pure functions. The server builds a
  `PermissionContext` per request; the web app builds the same one from `GET /me` to draw menus.
  The server is always the authority.
- **Tenancy** is enforced twice: every query goes through `scopeToOrganisation()` (one place in
  `src/db/scoped.ts`), and the database uses composite foreign keys `(organisation_id, id)` so a
  row can never reference another organisation's row.
- **Activity** is recorded automatically for tracked tables; writes to them must run inside
  `withUnitOfWork()`, which stores activity and audit rows in the same transaction.
- **Apps plug in** by registering modules in `packages/shared/src/modules`. Menus, the role editor
  and field permissions build themselves from the registry.

## Security notes

- **Tokens.** The access token is a 12-hour JWT (HS256) sent as a Bearer header and kept only in
  memory in the browser. Each token names its session, and the API checks the session on every
  request, so logout and deactivation take effect immediately. The refresh token is 256 random
  bits in an `httpOnly`, `SameSite=Strict` cookie limited to `/api/auth` (and `Secure` in
  production). Only its SHA-256 is stored. Refresh tokens rotate on every use; presenting a retired
  one (outside a 10-second grace window for two tabs racing) revokes the whole sign-in. Cookie
  endpoints also require an `X-Kidzonia-Client` header, which cross-site pages can't send.
- **One-time codes** are 6 digits, stored only as an HMAC with a server pepper, valid for 5
  minutes, single use, and locked after 5 wrong tries. Unknown numbers get the same response but
  no SMS, so accounts can't be discovered and nobody can run up the SMS bill.
- **Rate limits** are stored in Postgres and set in the environment (see `.env.example`): codes
  per mobile and per IP per 10 minutes **and** per day (against SMS pumping), and password
  attempts per mobile and per IP per 15 minutes. Limited requests get `429` with `Retry-After`.
- **Dev-only code guard.** `DEV_FIXED_OTP=123456` makes every code 123456 for local work and
  tests. The server refuses to start with it set when `NODE_ENV=production`, and also refuses the
  console message provider in production.
- **Rotating the JWT secret.** Deploy with the new value in `JWT_SECRET` and the old one in
  `JWT_SECRET_PREVIOUS`; tokens signed with either are accepted. After one access-token lifetime
  (12 hours) remove `JWT_SECRET_PREVIOUS` and redeploy. Refresh tokens aren't JWTs, so nobody is
  signed out. To force everyone out instead, rotate without setting the previous secret.
- **Role management can't escalate.** Nobody but an Owner can give a role, or edit a role into
  something, more powerful than their own; scopes given must be within the giver's; nobody can
  change someone whose role is more powerful than theirs.
- **Preview as this role** is read-only (every non-GET is refused), audited when it starts, and
  shows only what both the previewer and the previewed person may see.
- **Uploads.** The logo's real type is read from its bytes (PNG, JPEG, WebP; never SVG), the image
  is re-encoded so metadata is dropped, and it's served with a fixed image type, `nosniff` and a
  sandboxing CSP. Task photos and files: type from contents only; photos re-encoded and shrunk
  (EXIF and GPS stripped); PDFs with scripts or embedded files refused, also inside compressed
  streams; only .docx/.xlsx without macros; files served with a sandboxing CSP, Office files and
  PDFs always as downloads, and only to people who can see the task.
- **Logout block and time.** Logout refuses (409) while blocking work is open; releases, defers
  and cancellations are audited. The task schedule only changes copies still untouched, in the
  same statement that checks. Test-only clock routes exist only with `E2E_TEST_HOOKS=1`, which
  the server refuses in production.
- **Parents' numbers are personal data.** They are shown only on the Parent contacts screen, and
  only to roles that can see that field. They are never written to logs (the console provider
  masks them), audit entries, error reports, exports or the parent message log (counts only).
  Deleting a parent removes the number completely. Only parents marked as agreed are messaged; an
  opt-out is audited and only an explicit re-mark undoes it.
- **The audit log is Owner-only.** `GET /audit-log` answers 403 to everyone else (including an
  Owner previewing another role). Entries are shown as sentences with labelled fields, never raw
  JSON, and phone numbers are masked (`+91 ••••• ••108`) wherever they appear, so parent numbers
  never show in the log.
- **Task access is per record.** Approvers, creators, watchers and sub-task people see that one
  task, never the people's other work or records. Named people out of reach are refused.
- **Invites and sign-ups are capped** per person per day and per IP per day (`RL_INVITE_PER_USER_DAY`,
  `RL_REGISTER_PER_IP_DAY`). Registration and organisation-picker tokens work only once.
- **Reports, search and the feed** apply visibility inside the database query, before any limit,
  so pages are never short and never hint at hidden records. Search needs the `pg_trgm`
  extension (created by a migration, so the migrating database user needs rights to create it,
  or a DBA creates it first).
- **CSV downloads** need the Download permission, follow field permissions (hidden fields are
  left out as columns), prefix any cell starting with `=`, `+`, `-`, `@`, tab or carriage return
  with `'` so spreadsheets don't run it as a formula, stream in pages, are audited
  (`report.exported`) and are rate-limited per person (`RL_EXPORTS_PER_USER_HOUR`).
- **Notifications** store only ids; their text is written when read, for the reader, so a
  cancelled or no-longer-visible task reads "This task was removed" and a hidden title reads "a
  task". SMS/WhatsApp go only to active people at their current mobile, never 21:00-07:00
  (organisation time), and at most `SMS_DAILY_CAP_PER_ORG` a day per organisation.
- **Other.** helmet with a strict CSP, a CORS allowlist, JSON bodies capped at 100 kB, secrets
  only from the environment (validated at boot), no stack traces in production responses, and
  records outside someone's reach answer `404`, never `403`.

## Deployment

`docker build -t kidzonia-360 .` builds one image that serves the API under `/api` and the web app
on the same origin. Run `pnpm --filter @kidzonia/api db:deploy` in the image to apply migrations
before starting it. `GET /api/health` checks the database.

- [`docs/operations/runbook.md`](docs/operations/runbook.md): running on any Docker host with a
  managed Postgres (preferably in India), environment variables, first deploy, releases,
  migrations, rollback, backups and restore, the staging migration test, rotating secrets,
  uptime, error tracking, logs and incidents.
- [`docs/operations/go-live-checklist.md`](docs/operations/go-live-checklist.md): everything to
  tick before the first real school.
- Workflows: `release.yml` (on a `v*` tag: checks, image to GHCR, staging migration test, then a
  deploy job behind manual approval that is a placeholder until hosting is chosen) and
  `uptime.yml` (checks `/api/health` every 5 minutes when `HEALTHCHECK_URL` is set).
- Ops scripts: `backup`, `restore` and `staging-migrate-test`, in the image under
  `apps/api/dist/src/ops/`, or `pnpm --filter @kidzonia/api ops:<name>` from a checkout.
