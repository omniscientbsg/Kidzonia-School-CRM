# Phase 1 plan: Foundation (approved 2026-09-26)

Scope from brief section 12: repo, database, auth (one-time code with a fake provider, password
optional), multi-tenant scoping, audit and activity logging in the data layer, module registry,
permission engine with full unit tests, app shell (top bar, app tabs, left menus, profile menu,
empty Home), theme.

## Agreed design

1. **Repo:** pnpm workspace `apps/api`, `apps/web`, `packages/shared`; the registry core never
   imports apps (lint-enforced); routes never touch the raw Prisma client (lint-enforced).
2. **Tooling:** strict TypeScript, ESLint strict type-checked with zero warnings, Prettier,
   Node 22.
3. **Database:** organisations, schools, users, roles, role_permissions, role_field_permissions,
   role_assignments, role_assignment_schools, automatic_role_settings, otp_challenges,
   auth_sessions, activity, audit_log, rate_limits. uuid v7 ids, indexes on every foreign key and
   common filter, partial unique indexes and CHECKs in raw SQL within migrations.
4. **Organisation scoping** in one Prisma extension; transactions via a unit-of-work helper.
5. **Auth:** codes via an `OtpSender` / `MessageProvider` interface (console in development), dev
   code 123456 refused in production, argon2id passwords, 12-hour JWT access tokens carrying the
   session id (checked per request), rotating httpOnly refresh cookie with reuse detection,
   Postgres-backed rate limits, logout and write guard hook points.
6. **Registry and permission engine** as pure functions in `packages/shared`, unit-tested per rule.
7. **Endpoints:** health, auth (request-code, verify-code, login, select-organisation, refresh,
   logout), me, registry. Cursor pagination helper for every future list.
8. **Reliability:** pino JSON logs with request ids, central error handler, pg-boss cleanup job,
   graceful shutdown.
9. **Web shell** matching the demo.
10. **Seed** of the demo organisation plus a second organisation.
11. **Tests:** integration on a real database per worker, tenant-isolation suite that fails for
    uncovered routes, Playwright journeys.
12. **Setup:** Docker Compose, `pnpm dev`, CI, Dockerfile, README, PROGRESS.

## Additions requested at approval

- (a) Composite foreign keys `(organisation_id, x_id)` for every org-scoped reference, with
  isolation tests that try cross-organisation links.
- (b) The scoping extension also covers updateMany, deleteMany, count, aggregate and groupBy;
  includes never return other organisations' rows; unit tests for the extension itself.
- (c) Daily OTP caps per mobile and per IP on top of the 10-minute limits; all limits in config.
- (d) reports_to can never form a loop, enforced on write, with tests.
- (e) axe accessibility checks in Playwright, failing on serious issues.
- (f) A "Security notes" section in the README.
- The organisation picker remembers the last choice on the device.
