-- CreateEnum
CREATE TYPE "DeliveryChannel" AS ENUM ('in_app', 'sms');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('pending', 'held', 'sent', 'skipped', 'failed');

-- AlterTable
ALTER TABLE "activity" ADD COLUMN     "task_id" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "selected_school_id" UUID;

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "outbox_id" UUID NOT NULL,
    "channel" "DeliveryChannel" NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "recipient_user_id" UUID NOT NULL,
    "outbox_id" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "group_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "read_at" TIMESTAMPTZ(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "organisation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "channel" "DeliveryChannel" NOT NULL,
    "muted" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id","event","channel")
);

-- CreateTable
CREATE TABLE "saved_views" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "module" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_deliveries_organisation_id_outbox_id_idx" ON "notification_deliveries"("organisation_id", "outbox_id");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_next_attempt_at_idx" ON "notification_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "notification_deliveries_organisation_id_channel_status_sent_idx" ON "notification_deliveries"("organisation_id", "channel", "status", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_organisation_id_id_key" ON "notification_deliveries"("organisation_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_outbox_id_channel_key" ON "notification_deliveries"("outbox_id", "channel");

-- CreateIndex
CREATE INDEX "notifications_organisation_id_recipient_user_id_created_at_idx" ON "notifications"("organisation_id", "recipient_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_organisation_id_recipient_user_id_read_at_idx" ON "notifications"("organisation_id", "recipient_user_id", "read_at");

-- CreateIndex
CREATE INDEX "notifications_organisation_id_recipient_user_id_group_key_idx" ON "notifications"("organisation_id", "recipient_user_id", "group_key");

-- CreateIndex
CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_organisation_id_id_key" ON "notifications"("organisation_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_organisation_id_outbox_id_key" ON "notifications"("organisation_id", "outbox_id");

-- CreateIndex
CREATE INDEX "notification_preferences_organisation_id_user_id_idx" ON "notification_preferences"("organisation_id", "user_id");

-- CreateIndex
CREATE INDEX "saved_views_organisation_id_user_id_module_idx" ON "saved_views"("organisation_id", "user_id", "module");

-- CreateIndex
CREATE UNIQUE INDEX "saved_views_organisation_id_id_key" ON "saved_views"("organisation_id", "id");

-- CreateIndex
CREATE INDEX "activity_organisation_id_task_id_idx" ON "activity"("organisation_id", "task_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organisation_id_selected_school_id_fkey" FOREIGN KEY ("organisation_id", "selected_school_id") REFERENCES "schools"("organisation_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity" ADD CONSTRAINT "activity_organisation_id_task_id_fkey" FOREIGN KEY ("organisation_id", "task_id") REFERENCES "tasks"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_organisation_id_outbox_id_fkey" FOREIGN KEY ("organisation_id", "outbox_id") REFERENCES "notification_outbox"("organisation_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organisation_id_recipient_user_id_fkey" FOREIGN KEY ("organisation_id", "recipient_user_id") REFERENCES "users"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organisation_id_outbox_id_fkey" FOREIGN KEY ("organisation_id", "outbox_id") REFERENCES "notification_outbox"("organisation_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_organisation_id_user_id_fkey" FOREIGN KEY ("organisation_id", "user_id") REFERENCES "users"("organisation_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_organisation_id_user_id_fkey" FOREIGN KEY ("organisation_id", "user_id") REFERENCES "users"("organisation_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written below.
-- ---------------------------------------------------------------------------

-- Search (brief 7.5): trigram indexes make "contains" searches fast.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "tasks_title_trgm_idx" ON "tasks" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "users_full_name_trgm_idx" ON "users" USING GIN ("full_name" gin_trgm_ops);

-- Task actions recorded before this migration point at their task too.
UPDATE "activity" SET "task_id" = "entity_id"
 WHERE "entity_type" = 'task'
   AND EXISTS (SELECT 1 FROM "tasks" t WHERE t."id" = "activity"."entity_id"
               AND t."organisation_id" = "activity"."organisation_id");

CREATE UNIQUE INDEX "saved_views_person_name_key"
  ON "saved_views" ("organisation_id", "user_id", "module", lower("name"));

ALTER TABLE "saved_views"
  ADD CONSTRAINT "saved_views_name_not_blank" CHECK (length(btrim("name")) > 0);
ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_attempts_valid" CHECK ("attempts" >= 0);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'notifications', 'notification_deliveries', 'notification_preferences', 'saved_views'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OF organisation_id ON %I FOR EACH ROW EXECUTE FUNCTION prevent_organisation_change()',
      t || '_org_immutable', t);
  END LOOP;
END;
$$;
