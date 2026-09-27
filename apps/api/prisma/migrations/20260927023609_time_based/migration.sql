-- CreateEnum
CREATE TYPE "JobRunStatus" AS ENUM ('running', 'succeeded', 'failed', 'skipped');

-- AlterTable
ALTER TABLE "organisations" ADD COLUMN     "logout_block_lead_minutes" INTEGER NOT NULL DEFAULT 120;

-- CreateTable
CREATE TABLE "job_runs" (
    "id" UUID NOT NULL,
    "job" TEXT NOT NULL,
    "status" "JobRunStatus" NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_at" TIMESTAMPTZ(3),
    "counts" JSONB,
    "error" TEXT,
    "gap_from" TIMESTAMPTZ(3),
    "server" TEXT,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "day_end_forms" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "blocks_logout" BOOLEAN NOT NULL DEFAULT true,
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "day_end_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "day_end_form_versions" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "questions" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "day_end_form_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "day_end_form_roles" (
    "organisation_id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "day_end_form_roles_pkey" PRIMARY KEY ("form_id","role_id")
);

-- CreateTable
CREATE TABLE "logout_releases" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "service_date" DATE NOT NULL,
    "released_by" UUID NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logout_releases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "release_requests" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "release_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_outbox" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "recipient_user_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "dedupe_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMPTZ(3),

    CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_runs_job_status_started_at_idx" ON "job_runs"("job", "status", "started_at" DESC);

-- CreateIndex
CREATE INDEX "day_end_forms_organisation_id_archived_at_idx" ON "day_end_forms"("organisation_id", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "day_end_forms_organisation_id_id_key" ON "day_end_forms"("organisation_id", "id");

-- CreateIndex
CREATE INDEX "day_end_form_versions_organisation_id_form_id_idx" ON "day_end_form_versions"("organisation_id", "form_id");

-- CreateIndex
CREATE UNIQUE INDEX "day_end_form_versions_organisation_id_id_key" ON "day_end_form_versions"("organisation_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "day_end_form_versions_form_id_version_key" ON "day_end_form_versions"("form_id", "version");

-- CreateIndex
CREATE INDEX "day_end_form_roles_organisation_id_form_id_idx" ON "day_end_form_roles"("organisation_id", "form_id");

-- CreateIndex
CREATE INDEX "day_end_form_roles_organisation_id_role_id_idx" ON "day_end_form_roles"("organisation_id", "role_id");

-- CreateIndex
CREATE INDEX "logout_releases_organisation_id_user_id_service_date_idx" ON "logout_releases"("organisation_id", "user_id", "service_date");

-- CreateIndex
CREATE INDEX "logout_releases_organisation_id_released_by_idx" ON "logout_releases"("organisation_id", "released_by");

-- CreateIndex
CREATE UNIQUE INDEX "logout_releases_organisation_id_id_key" ON "logout_releases"("organisation_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "logout_releases_user_id_service_date_key" ON "logout_releases"("user_id", "service_date");

-- CreateIndex
CREATE INDEX "release_requests_organisation_id_user_id_created_at_idx" ON "release_requests"("organisation_id", "user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "release_requests_organisation_id_id_key" ON "release_requests"("organisation_id", "id");

-- CreateIndex
CREATE INDEX "notification_outbox_organisation_id_recipient_user_id_creat_idx" ON "notification_outbox"("organisation_id", "recipient_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notification_outbox_delivered_at_idx" ON "notification_outbox"("delivered_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_outbox_organisation_id_id_key" ON "notification_outbox"("organisation_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_outbox_organisation_id_dedupe_key_key" ON "notification_outbox"("organisation_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "tasks_organisation_id_day_end_form_id_idx" ON "tasks"("organisation_id", "day_end_form_id");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organisation_id_day_end_form_id_fkey" FOREIGN KEY ("organisation_id", "day_end_form_id") REFERENCES "day_end_forms"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_end_forms" ADD CONSTRAINT "day_end_forms_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_end_form_versions" ADD CONSTRAINT "day_end_form_versions_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_end_form_versions" ADD CONSTRAINT "day_end_form_versions_organisation_id_form_id_fkey" FOREIGN KEY ("organisation_id", "form_id") REFERENCES "day_end_forms"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_end_form_roles" ADD CONSTRAINT "day_end_form_roles_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_end_form_roles" ADD CONSTRAINT "day_end_form_roles_organisation_id_form_id_fkey" FOREIGN KEY ("organisation_id", "form_id") REFERENCES "day_end_forms"("organisation_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_end_form_roles" ADD CONSTRAINT "day_end_form_roles_organisation_id_role_id_fkey" FOREIGN KEY ("organisation_id", "role_id") REFERENCES "roles"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logout_releases" ADD CONSTRAINT "logout_releases_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logout_releases" ADD CONSTRAINT "logout_releases_organisation_id_user_id_fkey" FOREIGN KEY ("organisation_id", "user_id") REFERENCES "users"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logout_releases" ADD CONSTRAINT "logout_releases_organisation_id_released_by_fkey" FOREIGN KEY ("organisation_id", "released_by") REFERENCES "users"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "release_requests" ADD CONSTRAINT "release_requests_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "release_requests" ADD CONSTRAINT "release_requests_organisation_id_user_id_fkey" FOREIGN KEY ("organisation_id", "user_id") REFERENCES "users"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_organisation_id_recipient_user_id_fkey" FOREIGN KEY ("organisation_id", "recipient_user_id") REFERENCES "users"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written below.
-- ---------------------------------------------------------------------------

ALTER TABLE "organisations"
  ADD CONSTRAINT "organisations_logout_block_lead_valid"
  CHECK ("logout_block_lead_minutes" BETWEEN 0 AND 720);

ALTER TABLE "day_end_forms"
  ADD CONSTRAINT "day_end_forms_name_not_blank" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "day_end_forms_version_positive" CHECK ("current_version" >= 1);

ALTER TABLE "day_end_form_versions"
  ADD CONSTRAINT "day_end_form_versions_version_positive" CHECK ("version" >= 1);

CREATE UNIQUE INDEX "day_end_forms_live_name_key"
  ON "day_end_forms" ("organisation_id", lower("name")) WHERE "archived_at" IS NULL;

-- A day-end form's task, found from the form.
CREATE UNIQUE INDEX "tasks_one_live_day_end_task_key"
  ON "tasks" ("organisation_id", "day_end_form_id")
  WHERE "day_end_form_id" IS NOT NULL AND "cancelled_at" IS NULL;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'day_end_forms', 'day_end_form_versions', 'day_end_form_roles', 'logout_releases',
    'release_requests', 'notification_outbox'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OF organisation_id ON %I FOR EACH ROW EXECUTE FUNCTION prevent_organisation_change()',
      t || '_org_immutable', t);
  END LOOP;
END;
$$;
