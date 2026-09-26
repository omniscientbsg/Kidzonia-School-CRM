-- Hand-written rules for the Tasks tables that Prisma can't express.

ALTER TABLE "task_categories"
  ADD CONSTRAINT "task_categories_color_format" CHECK ("color" ~ '^#[0-9A-Fa-f]{6}$'),
  ADD CONSTRAINT "task_categories_name_not_blank" CHECK (length(btrim("name")) > 0);

ALTER TABLE "task_priorities"
  ADD CONSTRAINT "task_priorities_color_format" CHECK ("color" ~ '^#[0-9A-Fa-f]{6}$'),
  ADD CONSTRAINT "task_priorities_name_not_blank" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "task_priorities_sort_order_valid" CHECK ("sort_order" >= 0);

ALTER TABLE "task_lists"
  ADD CONSTRAINT "task_lists_name_not_blank" CHECK (length(btrim("name")) > 0);

ALTER TABLE "task_list_values"
  ADD CONSTRAINT "task_list_values_value_not_blank" CHECK (length(btrim("value")) > 0);

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_title_not_blank" CHECK (length(btrim("title")) > 0),
  ADD CONSTRAINT "tasks_due_time_format" CHECK ("due_time" IS NULL OR "due_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  -- The three due types each need their own details.
  ADD CONSTRAINT "tasks_due_details" CHECK (
    ("due_type" = 'end_of_day' AND "due_date" IS NULL)
    OR ("due_type" = 'at_time' AND "due_time" IS NOT NULL AND "due_date" IS NULL)
    OR ("due_type" = 'on_date' AND "due_date" IS NOT NULL AND "repeat" = 'none')
  ),
  ADD CONSTRAINT "tasks_repeat_weekdays_valid" CHECK ("repeat_weekdays" <@ ARRAY[0,1,2,3,4,5,6]),
  ADD CONSTRAINT "tasks_repeat_details" CHECK (
    ("repeat" <> 'weekly' OR cardinality("repeat_weekdays") >= 1)
    AND ("repeat" <> 'monthly' OR "repeat_month_day" IS NOT NULL)
  ),
  ADD CONSTRAINT "tasks_repeat_month_day_valid" CHECK ("repeat_month_day" IS NULL OR "repeat_month_day" BETWEEN 1 AND 31),
  ADD CONSTRAINT "tasks_repeat_end_after_start" CHECK ("repeat_end_date" IS NULL OR "repeat_end_date" >= "repeat_start_date"),
  ADD CONSTRAINT "tasks_closes_after_positive" CHECK ("closes_after_minutes" IS NULL OR "closes_after_minutes" > 0),
  ADD CONSTRAINT "tasks_named_approver" CHECK ("approver_mode" <> 'named_user' OR "approver_user_id" IS NOT NULL);

ALTER TABLE "task_subtasks"
  ADD CONSTRAINT "task_subtasks_title_not_blank" CHECK (length(btrim("title")) > 0),
  ADD CONSTRAINT "task_subtasks_due_time_format" CHECK ("due_time" IS NULL OR "due_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

ALTER TABLE "task_assignments"
  -- Brief 9.5: after the deadline comes closing, never before.
  ADD CONSTRAINT "task_assignments_closes_after_due" CHECK ("closes_at" IS NULL OR "closes_at" >= "due_at"),
  ADD CONSTRAINT "task_assignments_approver_when_needed" CHECK (NOT "needs_approval" OR "approver_user_id" IS NOT NULL),
  ADD CONSTRAINT "task_assignments_cancel_reason" CHECK ("status" <> 'cancelled' OR "cancel_reason" IS NOT NULL);

ALTER TABLE "task_attachments"
  ADD CONSTRAINT "task_attachments_size_positive" CHECK ("size_bytes" > 0);

-- Names are unique per organisation among live rows, ignoring case.
CREATE UNIQUE INDEX "task_categories_live_name_key"
  ON "task_categories" ("organisation_id", lower("name")) WHERE "archived_at" IS NULL;
CREATE UNIQUE INDEX "task_priorities_live_name_key"
  ON "task_priorities" ("organisation_id", lower("name")) WHERE "archived_at" IS NULL;
CREATE UNIQUE INDEX "task_lists_live_name_key"
  ON "task_lists" ("organisation_id", lower("name")) WHERE "archived_at" IS NULL;
CREATE UNIQUE INDEX "task_list_values_live_value_key"
  ON "task_list_values" ("organisation_id", "list_id", lower("value")) WHERE "archived_at" IS NULL;
CREATE UNIQUE INDEX "parent_message_templates_live_name_key"
  ON "parent_message_templates" ("organisation_id", lower("name")) WHERE "archived_at" IS NULL;
CREATE UNIQUE INDEX "task_templates_name_key"
  ON "task_templates" ("organisation_id", lower("name"));

-- The Phase 4 job scans live repeating tasks.
CREATE INDEX "tasks_live_repeating_idx"
  ON "tasks" ("organisation_id", "generated_through")
  WHERE "repeat" <> 'none' AND "cancelled_at" IS NULL;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'task_categories', 'task_priorities', 'task_lists', 'task_list_values',
    'parent_message_templates', 'task_templates', 'tasks', 'task_subtasks', 'task_watchers',
    'task_assignments', 'task_assignment_subtasks', 'task_attachments'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OF organisation_id ON %I FOR EACH ROW EXECUTE FUNCTION prevent_organisation_change()',
      t || '_org_immutable', t);
  END LOOP;
END;
$$;
