# Phase 2 plan: Registration and Settings (approved 2026-09-26)

Done when (brief 12): an owner can register, add a school, add a user, create a role, give it to
the user with a school scope, hide a field, and see that field disappear from that user's API
responses and screens.

## Agreed design

1. **Migration 2:** holidays + holiday_schools (join table), pending_field_changes,
   one_time_tokens (single-use selection and registration tokens), roles.seed_key,
   schools.principal_user_id, organisations.checklist_dismissed_at, users.invited_at.
2. **Registration** (brief 8.1, four steps as in the demo), verified mobile, one transaction,
   franchise owners invited, rate-limited per IP per day.
3. **Setup checklist** on Home, self-ticking, dismissible.
4. **Settings pages:** Organisation (+ holidays, logo), Schools (+ principal), Users (search,
   filters, drawer, invite, deactivate, last-Owner protection), Your details (+ password),
   Changes to approve, Roles & permissions (roles list, Manage people, Keka-style editor,
   automatic roles, preview). All changes audited.
5. **Power rule:** a role you give must be no more powerful than your own; scope within yours;
   only an Owner gives the Owner role.
6. **Pending field changes** through per-module handlers; approver is the nearest active manager,
   else an Owner.
7. **API** as brief 11, PUT = partial update validated on the merged record, all lists paginated.
8. **Storage** interface (local disk, S3-compatible), used for the organisation logo.
9. **Tests:** integration per endpoint, isolation case per route, unit tests for the power rule
   and pending changes, Playwright + axe for the done-when journey and registration.

Decisions 1–6 taken with the recommendations: read-only preview (banner, audited, no writes),
power rule, school principal field, refuse deleting roles with holders, logo now, holiday join
table.

## Additions requested at approval

- (a) Preview shows only what BOTH the previewer and the previewed person may see; tested with
  the salary case.
- (b) The power rule also applies to editing roles: no one but an Owner can add actions, reach
  or field access beyond their own role.
- (c) Editing users: new school and new manager must be within the editor's reach; nobody may
  edit, deactivate or delete someone whose role is more powerful than theirs; reports-to changes
  still pass the loop check.
- (d) Hidden fields can't be searched, filtered or sorted on; tested.
- (e) Deactivating a manager warns "N people report to [name]" and offers to move them in the
  same step; until then approvals fall back up the chain.
- (f) One pending change per field per record (a new one replaces the old and notifies the
  approver); approval checks the old value still matches, else marks it out of date.
- (g) Logo: real type from file contents, no SVG, metadata stripped, safe content type, nosniff.
- (h) Invite re-sends limited per user per day, in config.
- Section 13 defaults stand (13.4 HO defines roles, 13.5 one role per user); 13.3 needs no code.
