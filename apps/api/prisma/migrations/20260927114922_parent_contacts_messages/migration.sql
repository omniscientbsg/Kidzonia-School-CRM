-- CreateEnum
CREATE TYPE "ParentConsent" AS ENUM ('agreed', 'not_agreed', 'opted_out');

-- CreateEnum
CREATE TYPE "ParentMessageStatus" AS ENUM ('queued', 'sending', 'sent', 'partly_sent', 'failed', 'skipped');

-- CreateTable
CREATE TABLE "school_classes" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "school_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardians" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "consent" "ParentConsent" NOT NULL DEFAULT 'not_agreed',
    "consent_changed_at" TIMESTAMPTZ(3),
    "consent_changed_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "guardians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_guardians" (
    "organisation_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "guardian_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_guardians_pkey" PRIMARY KEY ("student_id","guardian_id")
);

-- CreateTable
CREATE TABLE "parent_messages" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "template_id" UUID,
    "school_id" UUID,
    "class_name" TEXT NOT NULL,
    "event_name" TEXT NOT NULL,
    "activity" TEXT NOT NULL,
    "channel" "DeliveryChannel" NOT NULL DEFAULT 'sms',
    "status" "ParentMessageStatus" NOT NULL DEFAULT 'queued',
    "skip_reason" TEXT,
    "recipients_count" INTEGER NOT NULL DEFAULT 0,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "parent_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parent_message_recipients" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "parent_message_id" UUID NOT NULL,
    "guardian_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3),
    "sent_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parent_message_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "school_classes_organisation_id_school_id_idx" ON "school_classes"("organisation_id", "school_id");

-- CreateIndex
CREATE UNIQUE INDEX "school_classes_organisation_id_id_key" ON "school_classes"("organisation_id", "id");

-- CreateIndex
CREATE INDEX "students_organisation_id_class_id_idx" ON "students"("organisation_id", "class_id");

-- CreateIndex
CREATE INDEX "students_organisation_id_school_id_idx" ON "students"("organisation_id", "school_id");

-- CreateIndex
CREATE UNIQUE INDEX "students_organisation_id_id_key" ON "students"("organisation_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "guardians_organisation_id_id_key" ON "guardians"("organisation_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "guardians_organisation_id_mobile_key" ON "guardians"("organisation_id", "mobile");

-- CreateIndex
CREATE INDEX "student_guardians_organisation_id_guardian_id_idx" ON "student_guardians"("organisation_id", "guardian_id");

-- CreateIndex
CREATE INDEX "parent_messages_organisation_id_status_idx" ON "parent_messages"("organisation_id", "status");

-- CreateIndex
CREATE INDEX "parent_messages_organisation_id_created_at_idx" ON "parent_messages"("organisation_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "parent_messages_organisation_id_task_id_idx" ON "parent_messages"("organisation_id", "task_id");

-- CreateIndex
CREATE UNIQUE INDEX "parent_messages_organisation_id_id_key" ON "parent_messages"("organisation_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "parent_messages_organisation_id_assignment_id_key" ON "parent_messages"("organisation_id", "assignment_id");

-- CreateIndex
CREATE INDEX "parent_message_recipients_organisation_id_guardian_id_sent__idx" ON "parent_message_recipients"("organisation_id", "guardian_id", "sent_at");

-- CreateIndex
CREATE INDEX "parent_message_recipients_organisation_id_status_next_attem_idx" ON "parent_message_recipients"("organisation_id", "status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "parent_message_recipients_organisation_id_id_key" ON "parent_message_recipients"("organisation_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "parent_message_recipients_parent_message_id_guardian_id_stu_key" ON "parent_message_recipients"("parent_message_id", "guardian_id", "student_id");

-- AddForeignKey
ALTER TABLE "school_classes" ADD CONSTRAINT "school_classes_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_classes" ADD CONSTRAINT "school_classes_organisation_id_school_id_fkey" FOREIGN KEY ("organisation_id", "school_id") REFERENCES "schools"("organisation_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_organisation_id_school_id_fkey" FOREIGN KEY ("organisation_id", "school_id") REFERENCES "schools"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_organisation_id_class_id_fkey" FOREIGN KEY ("organisation_id", "class_id") REFERENCES "school_classes"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_organisation_id_student_id_fkey" FOREIGN KEY ("organisation_id", "student_id") REFERENCES "students"("organisation_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_organisation_id_guardian_id_fkey" FOREIGN KEY ("organisation_id", "guardian_id") REFERENCES "guardians"("organisation_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_messages" ADD CONSTRAINT "parent_messages_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_messages" ADD CONSTRAINT "parent_messages_organisation_id_task_id_fkey" FOREIGN KEY ("organisation_id", "task_id") REFERENCES "tasks"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_messages" ADD CONSTRAINT "parent_messages_organisation_id_assignment_id_fkey" FOREIGN KEY ("organisation_id", "assignment_id") REFERENCES "task_assignments"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_messages" ADD CONSTRAINT "parent_messages_organisation_id_school_id_fkey" FOREIGN KEY ("organisation_id", "school_id") REFERENCES "schools"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_message_recipients" ADD CONSTRAINT "parent_message_recipients_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_message_recipients" ADD CONSTRAINT "parent_message_recipients_organisation_id_parent_message_i_fkey" FOREIGN KEY ("organisation_id", "parent_message_id") REFERENCES "parent_messages"("organisation_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_message_recipients" ADD CONSTRAINT "parent_message_recipients_organisation_id_guardian_id_fkey" FOREIGN KEY ("organisation_id", "guardian_id") REFERENCES "guardians"("organisation_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_message_recipients" ADD CONSTRAINT "parent_message_recipients_organisation_id_student_id_fkey" FOREIGN KEY ("organisation_id", "student_id") REFERENCES "students"("organisation_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written below. (Prisma's generated part here wanted to drop the search
-- trigram indexes from the previous migration, which it can't see; those drops
-- were removed on purpose. Future migrations must do the same.)
-- ---------------------------------------------------------------------------

-- Names are unique ignoring case: one "Nursery A" per school, one child of a name per class.
CREATE UNIQUE INDEX "school_classes_school_name_key"
  ON "school_classes" ("organisation_id", "school_id", lower("name"));
CREATE UNIQUE INDEX "students_class_name_key"
  ON "students" ("organisation_id", "class_id", lower("full_name"));

ALTER TABLE "school_classes"
  ADD CONSTRAINT "school_classes_name_not_blank" CHECK (length(btrim("name")) > 0);
ALTER TABLE "students"
  ADD CONSTRAINT "students_name_not_blank" CHECK (length(btrim("full_name")) > 0);
ALTER TABLE "guardians"
  ADD CONSTRAINT "guardians_name_not_blank" CHECK (length(btrim("full_name")) > 0),
  ADD CONSTRAINT "guardians_mobile_e164" CHECK ("mobile" ~ '^\+[1-9][0-9]{7,14}$');
ALTER TABLE "parent_messages"
  ADD CONSTRAINT "parent_messages_counts_valid" CHECK (
    "recipients_count" >= 0 AND "sent_count" >= 0 AND "failed_count" >= 0 AND "skipped_count" >= 0
  );
ALTER TABLE "parent_message_recipients"
  ADD CONSTRAINT "parent_message_recipients_attempts_valid" CHECK ("attempts" >= 0);

-- A student's class must be at the student's school.
CREATE FUNCTION student_class_same_school() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "school_classes" c
                 WHERE c."id" = NEW."class_id" AND c."school_id" = NEW."school_id") THEN
    RAISE EXCEPTION 'student class must belong to the student''s school'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "students_class_same_school" BEFORE INSERT OR UPDATE OF "class_id", "school_id"
  ON "students" FOR EACH ROW EXECUTE FUNCTION student_class_same_school();

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'school_classes', 'students', 'guardians', 'student_guardians',
    'parent_messages', 'parent_message_recipients'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OF organisation_id ON %I FOR EACH ROW EXECUTE FUNCTION prevent_organisation_change()',
      t || '_org_immutable', t);
  END LOOP;
END;
$$;
