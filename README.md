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
  sandboxing CSP.
- **Invites and sign-ups are capped** per person per day and per IP per day (`RL_INVITE_PER_USER_DAY`,
  `RL_REGISTER_PER_IP_DAY`). Registration and organisation-picker tokens work only once.
- **Other.** helmet with a strict CSP, a CORS allowlist, JSON bodies capped at 100 kB, secrets
  only from the environment (validated at boot), no stack traces in production responses, and
  records outside someone's reach answer `404`, never `403`.

## Deployment

`docker build -t kidzonia-360 .` builds one image that serves the API under `/api` and the web app
on the same origin. Run `pnpm --filter @kidzonia/api db:deploy` in the image to apply migrations
before starting it. `GET /api/health` checks the database.
