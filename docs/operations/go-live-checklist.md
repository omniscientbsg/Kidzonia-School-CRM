# Go-live checklist

Tick every box before the first real school uses Kidzonia 360, and write the date and who checked
it next to each. Details are in the [runbook](runbook.md). The server itself refuses to start on
some of these (marked **enforced**), but check them anyway.

## Secrets and settings

- [ ] `JWT_SECRET` and `OTP_PEPPER` are new random values (48 bytes), different from every other
      environment, and stored only in the host's secret store.
- [ ] `JWT_SECRET_PREVIOUS` is empty.
- [ ] `NODE_ENV=production` (the image sets it).
- [ ] `DEV_FIXED_OTP` is not set (**enforced**).
- [ ] `E2E_TEST_HOOKS` is `0` or unset (**enforced**).
- [ ] `DATABASE_URL` uses TLS (`sslmode=require` or `verify-full`), and the database accepts
      connections only from the app's private network.
- [ ] `CORS_ORIGINS` lists exactly the public origin, e.g. `https://app.example.in`, nothing else
      (**enforced**: not empty).
- [ ] `APP_URL` is the public HTTPS URL (it goes into invite messages).
- [ ] `TRUST_PROXY` matches the number of proxies in front of the app (usually `1`); per-IP rate
      limits depend on it.
- [ ] Rate limits (`RL_*`) and caps (`SMS_DAILY_CAP_PER_ORG`, `PARENT_DAILY_CAP_PER_ORG`,
      `PARENT_DAILY_LIMIT_PER_PARENT`) reviewed with the product owner; defaults are in
      `.env.example`.
- [ ] `LOG_LEVEL=info`.
- [ ] The container's time zone is left at UTC (organisation time zones come from the database).
- [ ] No `.env` file is inside the image or the repository.

## Domain and HTTPS

- [ ] The domain points at the load balancer; HTTPS with a valid certificate that renews itself.
- [ ] HTTP redirects to HTTPS. (The app sends HSTS in production.)
- [ ] The refresh cookie arrives with `Secure; HttpOnly; SameSite=Strict` (check in the browser's
      developer tools after signing in). It is only `Secure` in production, so this also proves
      `NODE_ENV`.
- [ ] The load balancer's health check is `GET /api/health`.

## Database and storage

- [ ] Managed Postgres 16 in an Indian region, with automated backups and point-in-time recovery
      on.
- [ ] Migrations applied with `db:deploy`; `pg_trgm` extension present.
- [ ] `STORAGE_DRIVER=s3`; the files bucket is **private** (no public read, no public listing),
      in the same region.
- [ ] The backups bucket is separate, private, versioned (or object-locked), with its own key.

## Backups tested

- [ ] The nightly backup job is scheduled and has run successfully at least once.
- [ ] A heartbeat monitor alerts when a night's backup doesn't report in.
- [ ] A **restore drill** was done: the latest backup restored into a scratch database, counts
      checked, scratch database dropped. Date and time taken written down.
- [ ] The staging migration test has passed once (`staging-migrate-test`), from the release
      workflow or from the host.

## Monitoring on

- [ ] External uptime monitor on `https://<domain>/api/health` with Indian check locations,
      alerting the on-call person by email and SMS/phone; TLS expiry watched.
- [ ] `HEALTHCHECK_URL` set in the repository so the GitHub backstop check runs.
- [ ] Error tracking: `ERROR_TRACKING_DSN` set for the API; image built with
      `VITE_ERROR_TRACKING_DSN` and `WEB_ERROR_TRACKING_DSN` set to the same value; one test error
      seen in the tracker from each; the tracker's own data scrubbing and IP removal turned on;
      alerts go to the team.
- [ ] Logs reach the host's log service and are kept for the agreed time.

## SMS and WhatsApp provider

- [ ] Provider chosen (open decision 13.2) and built in; `MESSAGE_PROVIDER` set to it (the console
      provider is **enforced** off in production).
- [ ] DLT registration done (TRAI): the business entity, the sender ID (header) and **every SMS
      template**, including the one-time code, invites and each notification and parent message.
- [ ] WhatsApp Business account verified, and every WhatsApp template approved by Meta.
- [ ] Parent messages are only sent to parents marked as agreed; opt-out works end to end.
- [ ] Provider account has a spending limit or low-balance alert.
- [ ] A real code was received on a real phone and used to sign in.

## Data

- [ ] Seed data has **never** been run against production (`pnpm seed` refuses when
      `NODE_ENV=production`); the database has no demo organisations or demo people.
- [ ] The first Owner account was created through `/register` by the right person, with their own
      mobile number, and they can sign in.
- [ ] No production personal data exists outside production and staging (no copies on laptops;
      restore drills use scratch databases that are dropped).
- [ ] Parent phone numbers do not appear in logs or the error tracker (search both for a known test
      number after sending a test message).

## People and process

- [ ] At least two people can deploy, roll back and restore, and have read the runbook.
- [ ] The GitHub `production` environment requires a reviewer's approval.
- [ ] Who is on call, and how the product owner is reached in an incident, is written down.
