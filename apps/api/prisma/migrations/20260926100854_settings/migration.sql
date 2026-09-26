-- CreateEnum
CREATE TYPE "FieldChangeStatus" AS ENUM ('pending', 'approved', 'rejected', 'superseded', 'out_of_date');

-- AlterTable
ALTER TABLE "organisations" ADD COLUMN     "checklist_dismissed_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "roles" ADD COLUMN     "seed_key" TEXT;

-- AlterTable
ALTER TABLE "schools" ADD COLUMN     "principal_user_id" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "invited_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "holidays" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holiday_schools" (
    "organisation_id" UUID NOT NULL,
    "holiday_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "holiday_schools_pkey" PRIMARY KEY ("holiday_id","school_id")
);

-- CreateTable
CREATE TABLE "pending_field_changes" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "module_key" TEXT NOT NULL,
    "record_id" UUID NOT NULL,
    "subject_user_id" UUID NOT NULL,
    "field_key" TEXT NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "status" "FieldChangeStatus" NOT NULL DEFAULT 'pending',
    "requested_by" UUID NOT NULL,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pending_field_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "one_time_tokens" (
    "jti" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "one_time_tokens_pkey" PRIMARY KEY ("jti")
);

-- CreateIndex
CREATE INDEX "holidays_organisation_id_start_date_idx" ON "holidays"("organisation_id", "start_date");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_organisation_id_id_key" ON "holidays"("organisation_id", "id");

-- CreateIndex
CREATE INDEX "holiday_schools_organisation_id_holiday_id_idx" ON "holiday_schools"("organisation_id", "holiday_id");

-- CreateIndex
CREATE INDEX "holiday_schools_organisation_id_school_id_idx" ON "holiday_schools"("organisation_id", "school_id");

-- CreateIndex
CREATE INDEX "pending_field_changes_organisation_id_status_subject_user_i_idx" ON "pending_field_changes"("organisation_id", "status", "subject_user_id");

-- CreateIndex
CREATE INDEX "pending_field_changes_organisation_id_subject_user_id_idx" ON "pending_field_changes"("organisation_id", "subject_user_id");

-- CreateIndex
CREATE INDEX "pending_field_changes_organisation_id_requested_by_idx" ON "pending_field_changes"("organisation_id", "requested_by");

-- CreateIndex
CREATE INDEX "pending_field_changes_organisation_id_decided_by_idx" ON "pending_field_changes"("organisation_id", "decided_by");

-- CreateIndex
CREATE INDEX "pending_field_changes_organisation_id_module_key_record_id__idx" ON "pending_field_changes"("organisation_id", "module_key", "record_id", "field_key");

-- CreateIndex
CREATE UNIQUE INDEX "pending_field_changes_organisation_id_id_key" ON "pending_field_changes"("organisation_id", "id");

-- CreateIndex
CREATE INDEX "one_time_tokens_expires_at_idx" ON "one_time_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "schools_organisation_id_principal_user_id_idx" ON "schools"("organisation_id", "principal_user_id");

-- AddForeignKey
ALTER TABLE "schools" ADD CONSTRAINT "schools_organisation_id_principal_user_id_fkey" FOREIGN KEY ("organisation_id", "principal_user_id") REFERENCES "users"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holiday_schools" ADD CONSTRAINT "holiday_schools_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holiday_schools" ADD CONSTRAINT "holiday_schools_organisation_id_holiday_id_fkey" FOREIGN KEY ("organisation_id", "holiday_id") REFERENCES "holidays"("organisation_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holiday_schools" ADD CONSTRAINT "holiday_schools_organisation_id_school_id_fkey" FOREIGN KEY ("organisation_id", "school_id") REFERENCES "schools"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_field_changes" ADD CONSTRAINT "pending_field_changes_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_field_changes" ADD CONSTRAINT "pending_field_changes_organisation_id_subject_user_id_fkey" FOREIGN KEY ("organisation_id", "subject_user_id") REFERENCES "users"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_field_changes" ADD CONSTRAINT "pending_field_changes_organisation_id_requested_by_fkey" FOREIGN KEY ("organisation_id", "requested_by") REFERENCES "users"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_field_changes" ADD CONSTRAINT "pending_field_changes_organisation_id_decided_by_fkey" FOREIGN KEY ("organisation_id", "decided_by") REFERENCES "users"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written below.
-- ---------------------------------------------------------------------------

ALTER TABLE "holidays"
  ADD CONSTRAINT "holidays_end_not_before_start" CHECK ("end_date" >= "start_date");

-- Only one open request per field per record (a new request supersedes the old).
CREATE UNIQUE INDEX "pending_field_changes_one_open_key"
  ON "pending_field_changes" ("organisation_id", "module_key", "record_id", "field_key")
  WHERE "status" = 'pending';

-- Each seed role exists at most once per organisation.
CREATE UNIQUE INDEX "roles_org_seed_key_live_key"
  ON "roles" ("organisation_id", "seed_key")
  WHERE "seed_key" IS NOT NULL AND "deleted_at" IS NULL;

-- Roles created by the Phase 1 seed predate seed_key; mark them by their seed names.
UPDATE "roles" SET "seed_key" = 'owner' WHERE "is_owner" AND "deleted_at" IS NULL;
UPDATE "roles" SET "seed_key" = CASE "name"
    WHEN 'Department head' THEN 'dept_head'
    WHEN 'Franchise owner' THEN 'franchise_owner'
    WHEN 'Principal' THEN 'principal'
    WHEN 'Teacher' THEN 'teacher'
  END
  WHERE NOT "is_owner" AND "deleted_at" IS NULL
    AND "name" IN ('Department head', 'Franchise owner', 'Principal', 'Teacher');

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['holidays', 'holiday_schools', 'pending_field_changes'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OF organisation_id ON %I FOR EACH ROW EXECUTE FUNCTION prevent_organisation_change()',
      t || '_org_immutable', t);
  END LOOP;
END;
$$;
