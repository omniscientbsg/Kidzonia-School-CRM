# Phase 4 plan: Time-based features (approved 2026-09-27)

Done when (brief 12): running the job twice creates no duplicates; a blocking task stops logout
until submitted; a release lets the person log out; no task appears on a holiday.

## Agreed design

1. **One `task-schedule` job**, every 15 minutes and at startup; one run at a time across servers
   (queue policy plus a Postgres advisory lock); every run logged in `job_runs`, last success
   shown to Owners; a warning in the logs after an hour without a success. Copies only from today
   to 6 days ahead; missed past days are never filled in and the gap is logged. Batched per
   organisation.
2. **Changes after copies exist** touch only untouched copies (to-do, no ticks, files or answers,
   future or today before the deadline): holidays, working days and hours, school moves,
   deactivation and role loss (cancelled with a visible reason), new joiners.
3. **Overdue** at the deadline, **closed** at `closes_at`; closed and cancelled copies are left out
   of completion everywhere through one shared function.
4. **Logout block** with 409 on logout, previous-day blocking work refusing other writes, and
   three escape hatches (ask for release, release for a date, cancel or defer), all audited.
5. **Day-end forms** with immutable versions; each copy keeps its questions; role changes switch
   the form from the next untouched copy.
6. **Reminders** as events in `notification_outbox`, from the brief 10.1 list; delivery is Phase 5.
7. **Testing time** with the injectable clock; test-only clock and job routes for Playwright,
   refused in production.

## Answers at approval

1. Holidays remove only repeating-task copies; one-time copies stay. Warn both ways: adding a
   holiday shows "N one-time tasks fall on this date"; creating a one-time task on a holiday warns
   the creator before saving.
2. Defer: working days from tomorrow up to 14 days ahead (config), creator or edit reach over the
   person, never the person.
3. A release covers one date. The release screen lists every date the person still has open
   blocking work, with "Release all"; each date gets its own release row and audit entry.
4. Three release requests a day per person.
5. Day-end tasks show the form's name as "Assigned by".

## Additions at approval

- (a) Logout block window: a blocking copy due today blocks logout from a set time before its
  deadline as well as after it. Organisation setting, default 120 minutes (0 = only after the
  deadline). Edge cases tested.
- (b) Every job update or delete on a copy is conditional (still to-do, no ticks, attachments or
  answers), so a copy started a moment before the job reaches it is left alone. Tested.
- (c) Day-end copies follow each person's school calendar (holidays, working days, closing time).
