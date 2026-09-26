# Phase 3 plan: Tasks core (approved 2026-09-27)

Done when (brief 12): the teacher, principal and head-office journeys in the demo all work end to
end with real data.

## Agreed design

1. **Tables (migration 3):** task_categories, task_priorities (sort_order), task_lists and
   task_list_values, tasks (all brief 9.2 fields plus repeat_weekdays, repeat_month_day,
   repeat_start_date, repeat_end_date, closes_after_minutes, from_template_id,
   generated_through, cancelled_at), task_subtasks (removed_at, never hard-deleted),
   task_watchers, task_assignments (service_date, due_at, closes_at, snapshot, approver,
   blocks_logout, UNIQUE (task_id, user_id, service_date)), task_assignment_subtasks (a row
   means ticked), task_attachments, task_templates, parent_message_templates. Composite org
   foreign keys and the organisation_id trigger on all of them.
2. **Copies** come from one function, `planCopies`, with insert-if-not-exists. Phase 3 makes the
   first copy (one-time: the due date; repeating: the first working day on or after the start).
   Phase 4 schedules the same function for 7 days ahead.
3. **Visibility:** task facts (creator + assignees + their schools) and copy facts (assignee,
   copy school). Approvers, creators and sub-task assignees get access to that record only, via
   a participant rule in the engine; list scopes never widen from it. Editing the task itself
   needs the creator, an edit-watcher, or `tasks.edit` with reach over the creator.
4. **Snapshot:** title, description and sub-tasks on each copy, plus due_at, closes_at,
   needs_approval, approver and blocks_logout as columns. Category, priority and custom values
   are read live from the task.
5. **Statuses** and their moves (with the actor for each) in `packages/shared`; enforced with
   conditional updates (409 on a race). Tested over the full matrix and per endpoint.
6. **Targeting:** named people out of reach are an error, groups skip them quietly, inactive
   and role-less people are never included. Limit `TASK_MAX_RECIPIENTS`. Batched inserts in one
   transaction; one activity row per task.
7. **Field permissions** on every task field in lists, the drawer, filters, sort and search.
   Custom lists become `tasks` fields per organisation.
8. **Files:** type from contents, size limits, images re-encoded with metadata stripped,
   downloads checked against the copy's visibility.
9. **Templates:** server strips people and fixed dates; using one copies it.
10. **"+ New"** in category, priority and list pickers for `task_setup.create`.

## Answers at approval

1. Edits also update today's untouched `todo` copies whose deadline hasn't passed. The drawer
   says how many copies were updated and how many kept the old version.
2. Messages to parents: build the Task setup tab and the "Message parents when done" switch
   now; store the setting and show the preview, send nothing (sending is Phase 6, behind the
   provider interface).
3. Recipient limit default **1,000**, in config; the performance test runs at the limit.
4. Files: also Word and Excel (.docx, .xlsx), checked from contents. Macro-enabled files
   (.docm, .xlsm) and the old .doc/.xls formats are refused. Office files always download as
   attachments, never preview.
5. Approving your own work routes to your manager. With no manager (an Owner), the copy doesn't
   need approval, and the audit log records that it was completed without an approver.
6. Cancelling one person's copy: the creator or `tasks.edit` reach over that person, with a
   short reason that the assignee sees on their copy.

## Additions at approval

- (a) Sub-task assignees only when the task goes to a single named person. The sub-task assignee
  must be within the creator's assign reach, can see that one copy, can tick only their own
  sub-task, and can't submit. Refused on group tasks; tested.
- (b) Weak networks: photos shrunk on the phone (about 2,000 px) before upload, with the server
  still checking and processing; upload progress and retry without losing ticks or answers;
  a repeated submit answered with 409 "already submitted" shows as submitted, not as an error.
- (c) Phone layout of My tasks and the task drawer is the main design target; Priya's Playwright
  steps also run at phone size.
