-- CreateEnum
CREATE TYPE "TaskKind" AS ENUM ('task', 'day_end');

-- CreateEnum
CREATE TYPE "TaskDueType" AS ENUM ('end_of_day', 'at_time', 'on_date');

-- CreateEnum
CREATE TYPE "TaskRepeat" AS ENUM ('none', 'daily', 'weekly', 'monthly');

-- CreateEnum
CREATE TYPE "ApproverMode" AS ENUM ('creator', 'reporting_manager', 'named_user');

-- CreateEnum
CREATE TYPE "WatcherAccess" AS ENUM ('view', 'edit');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('todo', 'in_progress', 'submitted', 'approved', 'done', 'sent_back', 'overdue', 'expired', 'cancelled');

-- CreateTable
CREATE TABLE "task_categories" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "task_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_priorities" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "task_priorities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_lists" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "task_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_list_values" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "list_id" UUID NOT NULL,
    "value" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "task_list_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parent_message_templates" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "parent_message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_templates" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "task_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "kind" "TaskKind" NOT NULL DEFAULT 'task',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category_id" UUID,
    "priority_id" UUID,
    "custom_values" JSONB NOT NULL DEFAULT '{}',
    "due_type" "TaskDueType" NOT NULL,
    "due_time" TEXT,
    "due_date" DATE,
    "repeat" "TaskRepeat" NOT NULL DEFAULT 'none',
    "repeat_weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "repeat_month_day" INTEGER,
    "repeat_start_date" DATE NOT NULL,
    "repeat_end_date" DATE,
    "closes_after_minutes" INTEGER,
    "needs_approval" BOOLEAN NOT NULL DEFAULT false,
    "approver_mode" "ApproverMode" NOT NULL DEFAULT 'creator',
    "approver_user_id" UUID,
    "blocks_logout" BOOLEAN NOT NULL DEFAULT false,
    "parent_message" JSONB,
    "target" JSONB NOT NULL,
    "day_end_form_id" UUID,
    "from_template_id" UUID,
    "generated_through" DATE,
    "cancelled_at" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_subtasks" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "assignee_user_id" UUID,
    "due_time" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMPTZ(3),

    CONSTRAINT "task_subtasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_watchers" (
    "organisation_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "access" "WatcherAccess" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "task_watchers_pkey" PRIMARY KEY ("task_id","user_id")
);

-- CreateTable
CREATE TABLE "task_assignments" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "school_id" UUID,
    "service_date" DATE NOT NULL,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "closes_at" TIMESTAMPTZ(3),
    "status" "AssignmentStatus" NOT NULL DEFAULT 'todo',
    "needs_approval" BOOLEAN NOT NULL,
    "approver_user_id" UUID,
    "blocks_logout" BOOLEAN NOT NULL,
    "snapshot" JSONB NOT NULL,
    "answers" JSONB,
    "remarks" TEXT,
    "cancel_reason" TEXT,
    "submitted_at" TIMESTAMPTZ(3),
    "decided_at" TIMESTAMPTZ(3),
    "decided_by" UUID,
    "cancelled_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "task_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_assignment_subtasks" (
    "organisation_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "subtask_id" UUID NOT NULL,
    "done_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "done_by" UUID NOT NULL,

    CONSTRAINT "task_assignment_subtasks_pkey" PRIMARY KEY ("assignment_id","subtask_id")
);

-- CreateTable
CREATE TABLE "task_attachments" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_categories_organisation_id_archived_at_idx" ON "task_categories"("organisation_id", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "task_categories_organisation_id_id_key" ON "task_categories"("organisation_id", "id");

-- CreateIndex
CREATE INDEX "task_priorities_organisation_id_archived_at_sort_order_idx" ON "task_priorities"("organisation_id", "archived_at", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "task_priorities_organisation_id_id_key" ON "task_priorities"("organisation_id", "id");

-- CreateIndex
CREATE INDEX "task_lists_organisation_id_archived_at_idx" ON "task_lists"("organisation_id", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "task_lists_organisation_id_id_key" ON "task_lists"("organisation_id", "id");

-- CreateIndex
CREATE INDEX "task_list_values_organisation_id_list_id_idx" ON "task_list_values"("organisation_id", "list_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_list_values_organisation_id_id_key" ON "task_list_values"("organisation_id", "id");

-- CreateIndex
CREATE INDEX "parent_message_templates_organisation_id_archived_at_idx" ON "parent_message_templates"("organisation_id", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "parent_message_templates_organisation_id_id_key" ON "parent_message_templates"("organisation_id", "id");

-- CreateIndex
CREATE INDEX "task_templates_organisation_id_name_idx" ON "task_templates"("organisation_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "task_templates_organisation_id_id_key" ON "task_templates"("organisation_id", "id");

-- CreateIndex
CREATE INDEX "tasks_organisation_id_created_by_created_at_idx" ON "tasks"("organisation_id", "created_by", "created_at" DESC);

-- CreateIndex
CREATE INDEX "tasks_organisation_id_category_id_idx" ON "tasks"("organisation_id", "category_id");

-- CreateIndex
CREATE INDEX "tasks_organisation_id_priority_id_idx" ON "tasks"("organisation_id", "priority_id");

-- CreateIndex
CREATE INDEX "tasks_organisation_id_approver_user_id_idx" ON "tasks"("organisation_id", "approver_user_id");

-- CreateIndex
CREATE INDEX "tasks_organisation_id_kind_idx" ON "tasks"("organisation_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_organisation_id_id_key" ON "tasks"("organisation_id", "id");

-- CreateIndex
CREATE INDEX "task_subtasks_organisation_id_task_id_idx" ON "task_subtasks"("organisation_id", "task_id");

-- CreateIndex
CREATE INDEX "task_subtasks_organisation_id_assignee_user_id_idx" ON "task_subtasks"("organisation_id", "assignee_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_subtasks_organisation_id_id_key" ON "task_subtasks"("organisation_id", "id");

-- CreateIndex
CREATE INDEX "task_watchers_organisation_id_user_id_idx" ON "task_watchers"("organisation_id", "user_id");

-- CreateIndex
CREATE INDEX "task_watchers_organisation_id_task_id_idx" ON "task_watchers"("organisation_id", "task_id");

-- CreateIndex
CREATE INDEX "task_assignments_organisation_id_user_id_status_due_at_idx" ON "task_assignments"("organisation_id", "user_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "task_assignments_organisation_id_approver_user_id_status_idx" ON "task_assignments"("organisation_id", "approver_user_id", "status");

-- CreateIndex
CREATE INDEX "task_assignments_organisation_id_task_id_status_idx" ON "task_assignments"("organisation_id", "task_id", "status");

-- CreateIndex
CREATE INDEX "task_assignments_organisation_id_school_id_service_date_idx" ON "task_assignments"("organisation_id", "school_id", "service_date");

-- CreateIndex
CREATE INDEX "task_assignments_organisation_id_decided_by_idx" ON "task_assignments"("organisation_id", "decided_by");

-- CreateIndex
CREATE INDEX "task_assignments_status_due_at_idx" ON "task_assignments"("status", "due_at");

-- CreateIndex
CREATE INDEX "task_assignments_status_closes_at_idx" ON "task_assignments"("status", "closes_at");

-- CreateIndex
CREATE UNIQUE INDEX "task_assignments_organisation_id_id_key" ON "task_assignments"("organisation_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "task_assignments_task_id_user_id_service_date_key" ON "task_assignments"("task_id", "user_id", "service_date");

-- CreateIndex
CREATE INDEX "task_assignment_subtasks_organisation_id_assignment_id_idx" ON "task_assignment_subtasks"("organisation_id", "assignment_id");

-- CreateIndex
CREATE INDEX "task_assignment_subtasks_organisation_id_subtask_id_idx" ON "task_assignment_subtasks"("organisation_id", "subtask_id");

-- CreateIndex
CREATE INDEX "task_assignment_subtasks_organisation_id_done_by_idx" ON "task_assignment_subtasks"("organisation_id", "done_by");

-- CreateIndex
CREATE INDEX "task_attachments_organisation_id_assignment_id_idx" ON "task_attachments"("organisation_id", "assignment_id");

-- CreateIndex
CREATE INDEX "task_attachments_organisation_id_uploaded_by_idx" ON "task_attachments"("organisation_id", "uploaded_by");

-- CreateIndex
CREATE UNIQUE INDEX "task_attachments_organisation_id_id_key" ON "task_attachments"("organisation_id", "id");

-- AddForeignKey
ALTER TABLE "task_categories" ADD CONSTRAINT "task_categories_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_priorities" ADD CONSTRAINT "task_priorities_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_lists" ADD CONSTRAINT "task_lists_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_list_values" ADD CONSTRAINT "task_list_values_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_list_values" ADD CONSTRAINT "task_list_values_organisation_id_list_id_fkey" FOREIGN KEY ("organisation_id", "list_id") REFERENCES "task_lists"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_message_templates" ADD CONSTRAINT "parent_message_templates_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organisation_id_category_id_fkey" FOREIGN KEY ("organisation_id", "category_id") REFERENCES "task_categories"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organisation_id_priority_id_fkey" FOREIGN KEY ("organisation_id", "priority_id") REFERENCES "task_priorities"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organisation_id_created_by_fkey" FOREIGN KEY ("organisation_id", "created_by") REFERENCES "users"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organisation_id_approver_user_id_fkey" FOREIGN KEY ("organisation_id", "approver_user_id") REFERENCES "users"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_subtasks" ADD CONSTRAINT "task_subtasks_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_subtasks" ADD CONSTRAINT "task_subtasks_organisation_id_task_id_fkey" FOREIGN KEY ("organisation_id", "task_id") REFERENCES "tasks"("organisation_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_subtasks" ADD CONSTRAINT "task_subtasks_organisation_id_assignee_user_id_fkey" FOREIGN KEY ("organisation_id", "assignee_user_id") REFERENCES "users"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_watchers" ADD CONSTRAINT "task_watchers_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_watchers" ADD CONSTRAINT "task_watchers_organisation_id_task_id_fkey" FOREIGN KEY ("organisation_id", "task_id") REFERENCES "tasks"("organisation_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_watchers" ADD CONSTRAINT "task_watchers_organisation_id_user_id_fkey" FOREIGN KEY ("organisation_id", "user_id") REFERENCES "users"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_organisation_id_task_id_fkey" FOREIGN KEY ("organisation_id", "task_id") REFERENCES "tasks"("organisation_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_organisation_id_user_id_fkey" FOREIGN KEY ("organisation_id", "user_id") REFERENCES "users"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_organisation_id_school_id_fkey" FOREIGN KEY ("organisation_id", "school_id") REFERENCES "schools"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_organisation_id_approver_user_id_fkey" FOREIGN KEY ("organisation_id", "approver_user_id") REFERENCES "users"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_organisation_id_decided_by_fkey" FOREIGN KEY ("organisation_id", "decided_by") REFERENCES "users"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignment_subtasks" ADD CONSTRAINT "task_assignment_subtasks_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignment_subtasks" ADD CONSTRAINT "task_assignment_subtasks_organisation_id_assignment_id_fkey" FOREIGN KEY ("organisation_id", "assignment_id") REFERENCES "task_assignments"("organisation_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignment_subtasks" ADD CONSTRAINT "task_assignment_subtasks_organisation_id_subtask_id_fkey" FOREIGN KEY ("organisation_id", "subtask_id") REFERENCES "task_subtasks"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignment_subtasks" ADD CONSTRAINT "task_assignment_subtasks_organisation_id_done_by_fkey" FOREIGN KEY ("organisation_id", "done_by") REFERENCES "users"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_organisation_id_assignment_id_fkey" FOREIGN KEY ("organisation_id", "assignment_id") REFERENCES "task_assignments"("organisation_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_organisation_id_uploaded_by_fkey" FOREIGN KEY ("organisation_id", "uploaded_by") REFERENCES "users"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
