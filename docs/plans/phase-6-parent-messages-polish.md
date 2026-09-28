# Phase 6 plan: Parent messages and polish (approved 2026-09-27)

Brief 9.12, 10.4, 12 (Phase 6), open decisions 13.1 and 13.2, and the items the brief audit
([`docs/brief-audit.md`](../brief-audit.md)) placed here.

**Done when** (proposed; the brief gives no line for Phase 6):

- A task with "Message parents" sends its message when a copy is approved (or marked done without
  approval), through the stub contact source and the logging provider. It is sent once, logged, and
  visible in the task.
- Owners can read the audit log with filters.
- Every screen passes axe in light and dark mode, and the main journeys pass on a phone.
- A release can be deployed from CI, with migrations tested on a restored copy of real data first.

## 1. Parent messages (brief 9.12)

- **Contact source (13.1 is still open).** A `ParentContactSource` interface:
  `recipients(organisationId, schoolId, className) → { studentName, parentMobile }[]`. It comes with
  a **stub** that returns a few made-up parents per class in development and tests. Production
  refuses to start with the stub, like the console message provider. The real source plugs in
  once 13.1 is decided.
- **When it sends.** In the same transaction as the copy moving to _approved_, or to _done_ with no
  approval, a `parent_messages` row is written as _queued_. It is unique per copy, so a copy sent
  back and approved again sends once. The notification worker's pattern then delivers it: claimed,
  sent in chunks, retries with backoff, logged.
- **Idempotency.** Each parent message carries the key `<parentMessageId>:<n>`, the same on every
  attempt (as agreed for notifications).
- **Rendering.** The template's fill-in words are filled per recipient:
  - `{student_name}` from the contact source
  - `{class_name}` from the task
  - `{school_name}` from the person's school
  - `{event_name}` and `{activity}`: see question 2
- **Log (`parent_messages`):**
  - task, copy, template, class, school, channel
  - recipients count, sent / failed counts
  - status: queued, sent, partly sent, failed, or skipped with a reason
  - created and sent times
  - **No phone numbers or student names are stored**; the count and the class are enough to
    audit.
- **Where it shows.**
  - The task drawer's People list gets a line per copy, e.g. "Message sent to 24 parents of
    Nursery A, 3:10 pm".
  - A "Parent messages" page under Task setup lists them all, with filters (school, class,
    status, dates) for people with `task_setup.view`. See question 4.
- **Tests:**
  - sent once on approval, and once on done
  - never on send-back or cancel
  - a re-approval doesn't resend
  - crash and resend use the same key
  - no contacts → skipped with a reason
  - quiet hours and cap, if you choose them
  - isolation cases for new routes
  - e2e: a principal approves and the message shows in the drawer and the log

## 2. Audit log screen (brief 10.4)

- **`GET /audit-log`:** Owner only. Cursor-paged, newest first. Filters: who, area (roles, users,
  schools, organisation, holidays, tasks, releases…), action and date range.
- **The screen:** Settings → Audit log, readable lines ("Ananya Rao changed Principal: Tasks →
  Approve turned on"). Before/after show the changed fields with their registry labels, never raw
  JSON. Hidden fields are masked; an Owner sees all, but the screen still goes through the same
  field labels.
- **Tests:** Owner-only (403 for others, 404 across organisations), filters, paging, readable diffs
  for each area in `api/audit.test.ts`; e2e with axe.

## 3. Mobile polish and accessibility pass (audit D5, D6)

- **Touch targets:** at least 44 px on touch screens (`pointer: coarse`) for buttons, segmented
  controls and icon buttons; desktop keeps its compact sizes.
- **Dark mode:** a Light / Dark / Device choice in the profile menu, remembered per device; axe
  runs every journey in both schemes.
- **Drawers:** full-screen on phones, with the close button reachable and focus returned where it
  came from.
- **Keyboard:** a keyboard-only journey (create a task, submit it, approve it); visible focus
  everywhere; reduced motion respected.
- **Screen readers:** labels reviewed on the pickers, the segmented controls and the tables;
  headings in order.
- **Phones:** phone versions of the main journeys, and no sideways scrolling on any page.

## 4. Playwright main journeys

The ones not yet covered, each with axe:

- Register → setup checklist → first task.
- Teacher's day on a phone: tick, photo, submit, day-end report, log out.
- Principal: approvals, send back, release.
- Head office: report → saved view → download.
- Parent message sent and logged.
- Audit log.

## 5. Deployment setup (audit D12)

- **Hosting target:** see question 5. Whichever it is:
  - The Docker image already builds in CI.
  - A deploy job runs on a version tag after a manual approval.
  - `prisma migrate deploy` runs as a release step before the new version starts.
  - Health checks gate the switch.
- **Backups:** nightly `pg_dump` to the storage bucket with 30-day retention, plus a documented,
  tested restore.
- **Migrations tested on real data (lesson 14):** before each release, a script restores last
  night's backup into a staging database, runs the pending migrations, and runs a smoke check.
  The release is blocked if it fails.
- **Operations:** secrets only from the environment (already validated at start); JSON logs to the
  host's log service; a short runbook in the README (deploy, roll back, restore, rotate secrets).

## 6. Audit follow-ups (depending on your decisions)

- **D1:** a test helper that hides every field of a role and checks every composed endpoint
  (reports, search, Home, feed, notifications, day-end, logout) for leaks.
- **D2:** user photo upload and display, using the logo's image pipeline.
- **D7:** "Copy from…" inside the role editor.
- Plus any seed or rule changes from D3, D4 and D8 to D11.

## Questions for approval

1. **13.1, where parent contacts come from.** Options:
   - a small contact list in Core (class, student name, parent mobile) with a CSV upload per
     class
   - wait for a Students module
   - something else

   Until you decide, I'll build the interface and the stub (recommended either way).

2. **`{event_name}` and `{activity}`.** Fill both from the task's title, or add optional "Event
   name" and "Activity" fields to the parent-message settings on a task? Recommended: optional
   fields, defaulting to the task title.
3. **Quiet hours and cap for parents.** Use the same 21:00–07:00 hold and a separate daily cap per
   organisation (config, default 2,000)? Recommended: yes.
4. **Who sees the parent message log.** People with `task_setup.view`, plus each task's line for
   anyone who can see the task? Or a new `parent_messages` module in the registry with its own
   View? Recommended: a new module (it's a separate responsibility, and "Add a module" is one
   registration).
5. **Hosting target for deployment**, for example a VPS with Docker, Render, Fly.io, or AWS
   (ECS/RDS). It decides the deploy job and the backup tooling.
6. **13.2 SMS/WhatsApp provider.** Is there a choice yet? If so, I'll write its adapter here,
   passing the idempotency key. If not, it stays on the logging provider and production still
   refuses to start.
7. **Audit log retention.** Keep forever (recommended for v1), or prune after a set number of years?
8. **Decisions D1–D12** from the audit, as listed there.

## Answers at approval

Decisions from the audit:

- **D1:** accepted, on condition that the composed screens all use one shared field-check helper
  (not their own checks), plus the automated leak test.
- **D2:** a simple photo upload. A person sets their own; `users.edit` can set others'. Same file
  checks as the logo. Photos appear in avatars.
- **D3, D4, D8, D9, D11:** kept as recommended.
- **D5, D6, D7, D12:** yes, as recommended.
- **D10:** dropped for v1.

Answers:

1. **Parent contacts (13.1):** a small contact list in Core, filled by CSV upload per class
   (class, student name, parent name, parent mobile, agreed to messages).
   - The tables are designed so a future Students module can take them over.
   - Only parents marked as agreed are messaged. An opted-out parent is never messaged again until
     re-marked; opt-outs are audited.
   - The CSV preview shows row-level errors (bad numbers, duplicates, unknown class) before
     anything is saved.
   - Parent numbers are personal data: a contact can be deleted fully, and numbers never appear in
     logs, exports or the message log.
   - All of this sits behind the parent contact source interface, replacing the stand-in.
2. **`{event_name}` and `{activity}`:** optional fields on the task's parent message, both
   defaulting to the task title.
3. **Limits for parents:** the same 21:00–07:00 hold, an organisation daily cap of 2,000 (config),
   and at most 3 messages per parent per day.
4. **The message log** gets a new `parent_messages` permission module.
5. **Hosting:** not decided. Build for any Docker host with managed Postgres, preferably in an
   Indian region, with the runbook, backups and staging migration test. Don't wire the deploy job
   to a provider yet.
6. **SMS/WhatsApp provider (13.2):** not chosen. Keep the stand-in and the production guard.
7. **Audit log:** keep forever for v1.

Additions to deployment:

- Uptime monitoring on `/health`, with alerts.
- Error tracking for the API and the web app, behind an interface and off by default in
  development.
- A go-live checklist: secrets, domain and HTTPS, backups tested, monitoring on, SMS provider set up
  (DLT and WhatsApp templates), seed data never run in production, first Owner account created.

## Changes during the build

- **Recipients are chosen when a message is first sent, then consent is checked again for each
  send.** A parent who opts out before sending is never messaged, whether before or after the
  recipients were chosen.
- **A copy sent back and approved again messages parents once** (one `parent_messages` row per
  copy). Work nobody can approve, completed automatically when its approver leaves (audit fix),
  also messages parents.
- **Two small endpoints were added** for screens used by people without the Schools module:
  `GET /parent-contacts/schools` (schools in scope) and `GET /parent-contacts/class-names` (class
  suggestions for "Message parents" on a task).
- **The leak test also covered person references on copies and task details.** With Users → Full
  name hidden, those now read "Someone" too (`shownPerson`), and the report's person filter is
  left out.
- **Photo uploads allow up to 5 MB** (the logo allows 2 MB), since phone photos are often 3–5 MB.
  The stored file is always a 256px square.
- **Error tracking is on only when a DSN is set, in any environment.** The web DSN is fixed at
  build time, and production also sets `WEB_ERROR_TRACKING_DSN` so the CSP allows reports.
- **Backups aren't gzipped** (the dump format is already compressed). Restore works only into an
  empty target, or with `--recreate`.
- **The schema now declares the search trigram indexes.** Otherwise every `migrate dev` proposed
  dropping them.
- **Playwright:** "register → checklist" stays in the Phase 2 journey. Creating the first task is
  covered by the Tasks journeys rather than one long chain.
