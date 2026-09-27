# Phase 5 plan: Home, notifications, reports (approved 2026-09-27)

Done when (brief 12): each seeded persona's Home matches the demo; report numbers match the rows
behind them.

## Agreed design

1. **Home in one call** (`GET /home`): greeting, attention cards, a snapshot chosen from
   permissions and reach (never role names), Updates, Notifications, Your tasks. Budget: Owner
   under 400 ms (p95) with 1,000+ people; the test asserts under 1,500 ms for CI.
2. **Updates feed** (10.3): task actions carry verbs; visibility is applied in the query.
3. **Notifications:** a delivery worker over the outbox (idempotent, retries, logged); in-app bell
   (count polled every minute, read, read all, 90-day clean-up); grouping ("12 people submitted
   …"); muting per event and channel; SMS/WhatsApp through the logging provider (13.2 open).
4. **Reports:** one filter function for summary and rows (tested to match); options from what the
   person can see; organisation time zone; saved views per person; CSV with field permissions,
   formula-injection protection, streaming, audit, and a per-person rate limit.
5. **Search:** pages, tasks and people, permission-aware, trigram indexes.
6. **School switcher:** stored per person, only schools in scope, applied on the server through the
   list scopes.

## Answers at approval

1. Snapshot rule approved; a docs table lists each rule with an example role, one test per row.
2. Notifications kept 90 days from creation (config).
3. SMS/WhatsApp: assigned and sent back on by default; due soon off except for tasks that block
   logout; "assigned" only when a person first starts receiving a repeating task; quiet hours 21:00
   to 07:00 organisation time (held until morning, dropped if no longer relevant); a daily cap per
   organisation (config) with a log entry when hit; never to deactivated people; always the
   person's current mobile.
4. Grouping: same event, same task, same day, unread.
5. School switcher on the server; the bell, notifications and your own Approvals are never
   narrowed; narrowed screens show "Showing Kondapur only" with "Show all".

## Additions at approval

- (a) Feed, search and reports apply visibility inside the query, before the limit; per-item checks
  in the feed are batched.
- (b) Saved views whose filters point at something no longer visible open with that filter dropped
  and a short notice.
- (c) CSV exports rate-limited per person (config).
- (d) The bell count is announced politely to screen readers when it changes.
- (e) Notifications about a deleted or cancelled task show "This task was removed".

## Changes during the build

- **Delivery worker batched.** The first version made several queries per event and took 33 s for
  a 1,000-person assignment. It now decides a batch in memory from a handful of queries, writes in
  bulk, and keeps taking batches for up to 40 s per run (keyset paging, so held and retrying events
  aren't re-read). SMS/WhatsApp sends are claimed first, sent 25 at a time and marked per chunk: a
  crash re-sends at most one chunk (not "at most one message", which cost about 20 ms per send).
- **SMS text uses the recipient's role only.** Assigned, sent back and due soon are always about
  the recipient's own copy, so the task is visible to them; only their role's field permissions
  (title, names) change the wording. Same text function as the bell.
- **Out-of-reach person in the report drawer answers 404**, not an empty list.
- **Report filters live in the address**, so views, bookmarks and "Full report" links all work the
  same way.
- **Notification settings** are at `/notifications/settings`, linked from the bell and the profile
  menu.
