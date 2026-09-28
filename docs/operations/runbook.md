# Operations runbook

How Kidzonia 360 runs in production, and what to do on release day and on a bad day. Hosting is
not chosen yet (Phase 6, answer 5), so this is written for **any Docker host with a managed
Postgres, preferably in an Indian region**. Where a step depends on the provider, it says so.

Before the first launch, work through the [go-live checklist](go-live-checklist.md).

## Contents

1. [Architecture](#1-architecture)
2. [Environment variables](#2-environment-variables)
3. [First deploy](#3-first-deploy)
4. [Deploying a release](#4-deploying-a-release)
5. [Migrations](#5-migrations)
6. [Rolling back](#6-rolling-back)
7. [Backups and the restore drill](#7-backups-and-the-restore-drill)
8. [Staging migration test](#8-staging-migration-test)
9. [Rotating secrets](#9-rotating-secrets)
10. [Uptime monitoring](#10-uptime-monitoring)
11. [Error tracking](#11-error-tracking)
12. [Logs](#12-logs)
13. [Incidents](#13-incidents)
14. [How the backup scripts were verified](#14-how-the-backup-scripts-were-verified)

## 1. Architecture

```
            HTTPS (443)
 people ──► load balancer / reverse proxy (TLS, HTTP -> HTTPS)
                 │  HTTP
                 ▼
          ┌──────────────────────┐      ┌──────────────────────────┐
          │ kidzonia-360 image   │ ───► │ managed Postgres 16      │
          │ API under /api       │      │ (India region, private   │
          │ web app on /         │      │  network, TLS, PITR on)  │
          │ background jobs      │      └──────────────────────────┘
          └──────────────────────┘      ┌──────────────────────────┐
                 │  one or more    ───► │ S3-compatible storage     │
                 │  containers          │  files bucket (private)   │
                 │                      │  backups bucket (private) │
                 ▼                      └──────────────────────────┘
          SMS/WhatsApp provider (not chosen yet)
```

- **One image** (`Dockerfile`) serves the API under `/api` and the built web app on the same
  origin, and runs the background jobs (pg-boss, stored in the same database). Running two or more
  containers is safe: each job runs once at a time across all of them.
- **Database:** a managed Postgres **16** (the image's `pg_dump` is 16; build with
  `--build-arg PG_CLIENT_VERSION=17` for a 17 server). Choose an Indian region, for example AWS
  RDS Mumbai (`ap-south-1`) or Hyderabad (`ap-south-2`), Google Cloud SQL Mumbai (`asia-south1`) or
  Delhi (`asia-south2`), Azure Central India, or DigitalOcean Bangalore. Turn on the provider's
  automated backups with point-in-time recovery; our own nightly dump (section 7) is the second,
  provider-independent copy. The migrating user must be able to create the `pg_trgm` extension, or
  a DBA creates it once beforehand.
- **Storage:** two private buckets in the same region: one for uploaded files (`S3_BUCKET`), one
  for database backups (`BACKUP_BUCKET`) with its own access key. Turn on versioning (or object
  lock) on the backups bucket so a leaked key can't erase history.
- **Time:** leave the container's time zone at UTC. Jobs are scheduled in UTC; every organisation
  has its own time zone in the database, and all local times are worked out from it.
- **Connections:** each container opens up to `DATABASE_POOL_SIZE` (10) + 3 (rate limits) + 10
  (jobs) connections. Keep the total under the database plan's limit.

## 2. Environment variables

All settings come from the environment and are checked when the server starts; it refuses to start
on any problem and says which setting is wrong. Keep them in the host's secret store, never in the
image or the repository. `.env.example` has every one with development values.

**Required in production**

| Variable                      | What it is                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------- |
| `NODE_ENV`                    | `production` (the image sets it). Turns on the production guards below.           |
| `DATABASE_URL`                | Postgres URL, with `?sslmode=require` (or `verify-full`) for a managed database.  |
| `JWT_SECRET`                  | 32+ random characters. Signs access tokens.                                       |
| `OTP_PEPPER`                  | 32+ random characters. Hashes one-time codes. Changing it voids codes in flight.  |
| `CORS_ORIGINS`                | The public origin(s), e.g. `https://app.example.in`. Refused empty in production. |
| `APP_URL`                     | The public URL, used in invite messages.                                          |
| `TRUST_PROXY`                 | Number of proxies in front (usually `1`). Wrong values break per-IP rate limits.  |
| `MESSAGE_PROVIDER`            | A real SMS/WhatsApp provider. `console` is refused in production (decision 13.2). |
| `STORAGE_DRIVER`=`s3`, `S3_*` | Files bucket: `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT` (non-AWS), access keys.     |

**Must not be set in production** (the server refuses to start): `DEV_FIXED_OTP`,
`E2E_TEST_HOOKS=1`. The ops scripts refuse `PG_DOCKER_CONTAINER`.

**Optional** (defaults in `.env.example` and `apps/api/src/config.ts`): `PORT`, `LOG_LEVEL`,
`DATABASE_POOL_SIZE`, `JWT_SECRET_PREVIOUS` (only while rotating), token lifetimes, every `RL_*`
rate limit, task and notification limits, parent message caps.

**Error tracking** (off unless set):

| Variable                     | What it is                                                                  |
| ---------------------------- | --------------------------------------------------------------------------- |
| `ERROR_TRACKING_DSN`         | Sentry-compatible DSN for the API.                                          |
| `ERROR_TRACKING_ENVIRONMENT` | Label on reports (`production`, `staging`). Defaults to `NODE_ENV`.         |
| `WEB_ERROR_TRACKING_DSN`     | The web DSN the image was built with; only used to allow it in the CSP.     |
| `APP_VERSION`                | Release name on reports. The release workflow bakes the tag into the image. |

Build arguments (baked into the web app, not secrets): `VITE_ERROR_TRACKING_DSN`,
`VITE_ERROR_TRACKING_ENVIRONMENT`, `APP_VERSION`, `PG_CLIENT_VERSION`.

**Backups and ops scripts** (only for the backup, restore and staging jobs; they don't need the
app's secrets):

| Variable                      | What it is                                                           |
| ----------------------------- | -------------------------------------------------------------------- |
| `BACKUP_BUCKET`               | The backups bucket.                                                  |
| `BACKUP_PREFIX`               | Folder in the bucket. Default `db-backups/`.                         |
| `BACKUP_KEEP_DAYS`            | Days of backups kept. Default 30. The newest is never deleted.       |
| `BACKUP_S3_REGION`            | Falls back to `S3_REGION`.                                           |
| `BACKUP_S3_ENDPOINT`          | Falls back to `S3_ENDPOINT` (needed for non-AWS stores).             |
| `BACKUP_S3_ACCESS_KEY_ID`     | Falls back to `S3_ACCESS_KEY_ID`. Prefer a separate key.             |
| `BACKUP_S3_SECRET_ACCESS_KEY` | Falls back to `S3_SECRET_ACCESS_KEY`.                                |
| `STAGING_DATABASE_URL`        | Staging database, dropped and recreated by the staging test.         |
| `PG_MAINTENANCE_DB`           | Database used to drop and create others. Default `postgres`.         |
| `PG_BIN`                      | Folder with `pg_dump`/`pg_restore` if not on `PATH`.                 |
| `PG_DOCKER_CONTAINER`         | Local testing only: run the tools inside the compose `db` container. |

## 3. First deploy

1. **Database.** Create the managed Postgres 16 in an Indian region, on a private network, with
   TLS, automated backups and point-in-time recovery. Create the app's database and user.
2. **Buckets.** Create the files bucket and the backups bucket (private, versioned), with separate
   access keys.
3. **Secrets.** Generate `JWT_SECRET` and `OTP_PEPPER`:
   `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. Put every
   variable from section 2 in the host's secret store.
4. **Image.** Push a tag (`git tag v1.0.0 && git push --tags`); the release workflow checks, builds
   and pushes `ghcr.io/<owner>/<repo>:v1.0.0`. Or build by hand: `docker build -t kidzonia-360 .`.
5. **Migrate.** Run once, with the production environment:
   `docker run --rm --env-file prod.env IMAGE pnpm --filter @kidzonia/api db:deploy`.
6. **Start** the container (`docker run -p 4000:4000 --env-file prod.env IMAGE`) behind the load
   balancer with HTTPS. Point the load balancer's health check at `/api/health`.
7. **Check:** `curl https://app.example.in/api/health` answers `{"status":"ok","database":"ok"}`.
8. **Schedule backups** (section 7), then run one by hand and a restore drill.
9. **Monitoring:** uptime (section 10) and error tracking (section 11).
10. **First Owner:** open `https://app.example.in/register` and register the organisation. The
    registering person becomes its Owner. Never run `pnpm seed` against production (it refuses
    when `NODE_ENV=production`).

## 4. Deploying a release

A release is a version tag. The release workflow (`.github/workflows/release.yml`):

1. runs the full CI checks (lint, types, unit, integration, Playwright, build);
2. builds the image and pushes it to GHCR, tagged with the version;
3. runs the **staging migration test** (section 8) with the new image; a failure stops the release;
4. waits for a person to approve the `production` environment, then runs the **deploy job**.

The deploy job is a **placeholder** until hosting is chosen: it prints the steps below and
contacts nobody. Until it is wired up, do them by hand on the host:

1. Take a fresh backup: `docker run --rm --env-file backup.env NEW_IMAGE node apps/api/dist/src/ops/backup.js`.
2. Apply migrations with the **new** image (section 5).
3. Start the new container(s). Send traffic only once `/api/health` answers 200 (the image's
   `HEALTHCHECK` and the load balancer's check do this); then stop the old ones.
4. Watch error tracking and the uptime monitor for 30 minutes.

When a provider is chosen, replace the placeholder step with its deploy action, keeping the
approval, the migration step and the health gate.

## 5. Migrations

- Migrations live in `apps/api/prisma/migrations`, and a committed migration is never edited (CI
  refuses it). They run as a **release step before the new version starts**:
  `docker run --rm --env-file prod.env NEW_IMAGE pnpm --filter @kidzonia/api db:deploy`.
- They are tested on a restored copy of real data before every release (section 8).
- **Keep the previous version working on the new schema** (expand, then contract): add columns
  and tables first; remove or rename only in a later release once no running version uses them.
  This is what makes rollback (section 6) a matter of starting the previous image.
- If `db:deploy` fails, Prisma records the migration as failed and refuses further migrations. Do
  not start the new version; the old one keeps running. A failed migration may be **partly**
  applied: compare the database with the migration's SQL and undo (or finish) the part that ran,
  then mark it with
  `pnpm --filter @kidzonia/api exec prisma migrate resolve --rolled-back <migration_name>`
  (or `--applied` if you finished it by hand). Fix the cause in a **new** migration or in the
  data, test it with section 8, and deploy again. When in doubt, restore into a new database
  (section 6) rather than repairing by hand.

## 6. Rolling back

- **Code:** start the previous tag's image and stop the new one. Because migrations keep the
  previous version working (section 5), the database stays as it is.
- **Data** (a bad migration or a destructive bug): prefer the provider's point-in-time recovery to
  just before the problem, into a **new** database; check it; then point `DATABASE_URL` at it and
  restart. Or restore our latest dump into a new database (section 7). Restoring over the live
  database is refused unless you add `--i-know-this-is-production`; don't.

## 7. Backups and the restore drill

**What:** `apps/api/src/ops/backup.ts`, compiled into the image. It runs `pg_dump` (custom format,
compressed), checks the dump is readable with `pg_restore --list`, uploads it to
`BACKUP_BUCKET` as `db-backups/kidzonia-YYYYMMDDTHHMMSSZ.dump` with its SHA-256, and deletes
backups older than `BACKUP_KEEP_DAYS` (30), never the newest. It exits non-zero on any failure.
Dumps hold personal data: the scratch file lives in a private temporary folder that is always
deleted, and the bucket must be private.

**Schedule** it nightly on the host (cron, systemd timer, or the provider's scheduled jobs), for
example 02:30 IST (21:00 UTC):

```sh
0 21 * * * docker run --rm --env-file /etc/kidzonia/backup.env IMAGE \
  node apps/api/dist/src/ops/backup.js && curl -fsS "$BACKUP_HEARTBEAT_URL"
```

`backup.env` holds `DATABASE_URL`, `BACKUP_BUCKET` and the `BACKUP_S3_*` settings only. The
heartbeat URL comes from the uptime service's "cron/heartbeat" monitor, which alerts when a night
goes by without a ping. From a checkout: `pnpm --filter @kidzonia/api ops:backup`
(`--no-prune` keeps old ones).

**Restore:** `node apps/api/dist/src/ops/restore.js --target <url> [--backup latest|<name>] [--recreate]`
(`pnpm --filter @kidzonia/api ops:restore ...` from a checkout; `--list` shows the backups).

- The target must be empty, or give `--recreate` to drop and create it (needs CREATEDB rights).
- A target equal to `DATABASE_URL` is refused unless `--i-know-this-is-production` is added.
- The download is checked against the SHA-256 stored at upload; a corrupt file is refused.
- Owners and grants are not restored (`--no-owner --no-privileges`): the target's user owns
  everything. Extension comments are skipped (only a superuser may set them on managed Postgres).
- It stops at the first error; a partial restore is never reported as success.

**Restore drill (monthly, and before go-live):** restore the latest backup into a scratch database
on the same server, check it, drop it, and write down the date, backup name and time taken.

```sh
node apps/api/dist/src/ops/restore.js --target "$DRILL_URL" --recreate
psql "$DRILL_URL" -c "select count(*) from organisations" -c "select count(*) from users"
```

The staging migration test (section 8) also restores the latest backup before every release, so a
broken backup is noticed then too.

## 8. Staging migration test

Lesson 14: migrations are tested against a copy of real data before each release.
`apps/api/src/ops/staging-migrate-test.ts`:

1. refuses if `STAGING_DATABASE_URL` is the same database as `DATABASE_URL`;
2. drops and recreates the staging database and restores the latest backup (or `--backup <name>`);
3. runs `prisma migrate deploy` with the migrations **in the image being released**;
4. smoke check: connects, counts organisations and users (not fewer than before), finds no failed
   rows in `_prisma_migrations`, and `prisma migrate status` reports nothing pending.

It exits non-zero on any failure. The release workflow runs it with the new image once the
secrets `STAGING_DATABASE_URL`, `BACKUP_BUCKET` and `BACKUP_S3_*` exist (skipped with a warning
until then). GitHub's runners must be able to reach the staging database; if the database only
accepts connections from the private network, run it on the host instead:

```sh
docker run --rm --env-file staging-test.env NEW_IMAGE node apps/api/dist/src/ops/staging-migrate-test.js
```

The staging database holds a full copy of production personal data: keep it on the same private
network, with the same access rules as production, and never point a public staging app at it
without scrubbing.

## 9. Rotating secrets

- **`JWT_SECRET`:** deploy with the new value in `JWT_SECRET` and the old one in
  `JWT_SECRET_PREVIOUS`; tokens signed with either are accepted. After one access-token lifetime
  (`ACCESS_TOKEN_TTL_MINUTES`, 12 hours) remove `JWT_SECRET_PREVIOUS` and redeploy. Nobody is
  signed out (refresh tokens aren't JWTs). To force everyone out instead (a leak), rotate without
  setting the previous secret.
- **`OTP_PEPPER`:** change it and redeploy; codes already sent stop working (they last 5 minutes).
- **Database password:** create the new password (or a second user), update `DATABASE_URL`
  everywhere (app, backup job, staging test), redeploy, then retire the old one.
- **Storage and backup keys:** create a new key, update the environment, redeploy (and the backup
  job), then delete the old key.
- **Error tracking DSN:** create a new client key in the tracker, update `ERROR_TRACKING_DSN` (and
  rebuild the image for the web DSN), then revoke the old key.
- Rotate at least yearly, whenever someone with access leaves, and at once after a suspected leak.

## 10. Uptime monitoring

`GET /api/health` answers `200 {"status":"ok","database":"ok"}` when the app can reach its
database and `503 {"status":"error","database":"unreachable"}` when it can't. It shows no versions,
hosts or error text.

- **Primary: an external monitor** with checks from India, for example Better Stack Uptime or
  UptimeRobot (both have Indian check locations). Check `https://app.example.in/api/health` every
  1 to 3 minutes, expecting status 200 and the text `"status":"ok"`; alert after 2 failed checks
  by email and SMS/phone to the on-call person; also watch the TLS certificate's expiry. Add a
  heartbeat monitor for the nightly backup (section 7).
- **Backstop: GitHub Actions** (`.github/workflows/uptime.yml`) checks every 5 minutes, three
  tries 20 seconds apart, and fails the run when the app is down, which emails whoever watches the
  repository's Actions. Set the repository variable (or secret) `HEALTHCHECK_URL` to the public
  base URL (`https://app.example.in`); without it the check is skipped. GitHub delays scheduled
  runs and pauses them after 60 days without repository activity, so it is not enough alone.

## 11. Error tracking

Unexpected errors are reported through an interface with a no-op default
(`apps/api/src/core/error-reporting.ts`, `apps/web/src/lib/error-reporting.ts`). Any
Sentry-compatible service works (Sentry, or a self-hosted GlitchTip); choose one that stores data
in a region you're comfortable with.

- **API:** set `ERROR_TRACKING_DSN` (and `ERROR_TRACKING_ENVIRONMENT`). Reported: 5xx responses and
  unexpected errors (with the route pattern, request id, organisation and user ids), failed
  background jobs, job queue errors, unhandled promise rejections and uncaught exceptions (the
  process then exits and the container restarts).
- **Web:** build the image with `--build-arg VITE_ERROR_TRACKING_DSN=...` (the release workflow
  reads the repository variable `VITE_ERROR_TRACKING_DSN`) **and** set `WEB_ERROR_TRACKING_DSN` to
  the same value at runtime so the Content-Security-Policy allows the browser to send reports.
  Reported: crashes while rendering a page (the user sees "Something went wrong" with a Reload
  button), uncaught errors and unhandled rejections. API errors are left to the server.
- **Off by default:** nothing is sent unless a DSN is set, in any environment; unit tests always
  use the no-op; the tracker's SDK isn't even loaded without a DSN.
- **Personal data never leaves:** automatic breadcrumbs and integrations are off; request bodies,
  headers, cookies and query strings are never attached; every report is scrubbed of phone
  numbers, email addresses, tokens, `Authorization`/cookie values and values Postgres quotes in
  constraint errors. The same scrubbing applies to errors written to the logs. In the tracker,
  also turn on its server-side data scrubbing and IP-address removal.
- **Alerts:** in the tracker, alert on new issues and on a spike in events, by email to the team.

## 12. Logs

- The API writes one JSON line per event to stdout; let the Docker host ship stdout to its log
  service (CloudWatch, Cloud Logging, Better Stack Logs, Loki...). Keep 30 days unless the product
  owner decides otherwise.
- Every line during a request carries `requestId`, `organisationId` and `userId`. The request id
  is also in every error response, so a person's report can be matched to the logs.
- Request lines hold only the method, path and status. Authorization, cookies, passwords, codes
  and tokens are redacted, and logged errors are scrubbed of phone numbers and email addresses.
  Don't add request bodies or phone numbers to log lines in new code; log ids instead.
- Keep `LOG_LEVEL=info` in production.

## 13. Incidents

1. **Acknowledge** the alert in the uptime or error tracker so others know someone is on it.
2. **Look:** `/api/health` (database reachable?), the containers' state and restarts, the logs
   around the time (search by `requestId`), the tracker's newest issues, the database's CPU,
   connections and storage in the provider's console.
3. **Stabilise:** a bad release -> roll back (section 6). Database unreachable -> the provider's
   status page and support; failover if the plan has a standby. Out of connections -> lower the
   number of containers or `DATABASE_POOL_SIZE`. SMS or WhatsApp misbehaving -> disable the API key in
   the provider's console to stop all sending while you investigate.
4. **Data loss or leak:** stop the cause, keep the logs, restore into a new database (section 6),
   and tell the product owner at once. Personal data breaches may need to be reported under
   India's DPDP Act; the product owner decides.
5. **Afterwards:** write down what happened, when, the impact, the cause and the follow-ups.

## 14. How the backup scripts were verified

Run locally on 2026-09-27 against the docker-compose Postgres 16 and SeaweedFS, on scratch
databases only (`kidzonia_ops_src`, `kidzonia_ops_restore`, `kidzonia_ops_staging`, all dropped
afterwards). The host had no Postgres tools, so `PG_DOCKER_CONTAINER=kidzonia360-db-1` ran
`pg_dump`/`pg_restore` inside the database container.

1. `kidzonia_ops_src`: `prisma migrate deploy`, `pnpm seed` (2 organisations, 20 users, 10 tasks,
   34 copies), then the newest migration was removed again so the backup looked like production
   before a release (7 of 8 migrations).
2. Backup to a scratch bucket: 414 objects, uploaded with its SHA-256, in about 3.5 s.
3. Restore guard: `--target` equal to `DATABASE_URL` (spelled `127.0.0.1` instead of `localhost`)
   was refused, exit 1.
4. `restore --recreate` into `kidzonia_ops_restore`: exit 0 in about 7 s; row counts of all 42
   tables identical to the source. Restoring again without `--recreate` was refused (target not
   empty).
5. `staging-migrate-test`: restored, applied the 1 pending migration, smoke check passed
   (2 organisations, 20 users before and after, 7 -> 8 migrations). With `STAGING_DATABASE_URL`
   equal to `DATABASE_URL` it refused.
6. Failures stop it (exit 1): a backup containing a failed `_prisma_migrations` row; a backup whose
   data makes the pending migration fail (Prisma P3018, "already exists").
7. Pruning: of backups dated 1 Aug, 20 Aug and 1 Sep plus a non-backup file, the two older than 30
   days were deleted; the rest were kept.
8. A backup whose contents didn't match its stored SHA-256 was refused on restore.
9. The image built from the `Dockerfile` has `pg_dump`/`pg_restore` 16.15. Run inside it (native
   tools, reaching the host through `host.docker.internal`), `backup.js` uploaded a backup of a
   freshly seeded scratch database and `staging-migrate-test.js` restored it, ran
   `prisma migrate deploy` and passed (20 users, 8 migrations).

## The public demo on Render

`render.yaml` runs a demo with made-up data: one web service plus a Render Postgres database in
Singapore (Render has no Indian region). It sets `DEMO_MODE=1`, which is the only way a production
build may:

- use the logging message provider (13.2 is still open);
- accept the fixed sign-in code 123456;
- load the demo data on first start (`pnpm start` runs `release`: migrations, then the seed on an
  empty database only).

The web app is built with `VITE_DEMO_MODE=1` and shows a "Demo" banner on every page. Anyone who
knows the code can sign in as anyone, so never put real people's details in the demo, and never set
`DEMO_MODE` on a real deployment.

- **Free plan limits:** the service sleeps when idle (background jobs run only while it's awake),
  uploads are lost on each deploy or restart, and Render's free databases expire after 30 days.
- **To deploy:** Render dashboard → Blueprints → New Blueprint Instance → this repo, branch
  `main`. The service keeps the old CRM service's name. The old CRM's code is on the
  `legacy-main` branch.
