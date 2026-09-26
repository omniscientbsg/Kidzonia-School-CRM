-- CreateEnum
CREATE TYPE "SetupType" AS ENUM ('single_school', 'head_office');

-- CreateEnum
CREATE TYPE "SchoolModel" AS ENUM ('coco', 'franchise', 'both');

-- CreateEnum
CREATE TYPE "SchoolType" AS ENUM ('coco', 'franchise');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('invited', 'active', 'inactive');

-- CreateEnum
CREATE TYPE "Reach" AS ENUM ('own', 'team', 'school', 'all');

-- CreateEnum
CREATE TYPE "FieldAccess" AS ENUM ('hidden', 'view', 'edit');

-- CreateEnum
CREATE TYPE "OwnRecordRule" AS ENUM ('same', 'edit');

-- CreateTable
CREATE TABLE "organisations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "logo_key" TEXT,
    "setup_type" "SetupType" NOT NULL,
    "school_model" "SchoolModel" NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "working_days" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6]::INTEGER[],
    "opens_at" TEXT NOT NULL DEFAULT '08:00',
    "closes_at" TEXT NOT NULL DEFAULT '16:00',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "organisations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schools" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT,
    "type" "SchoolType" NOT NULL,
    "franchise_owner_user_id" UUID,
    "working_days" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "opens_at" TEXT,
    "closes_at" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "schools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "email" TEXT,
    "employee_id" TEXT,
    "job_title" TEXT,
    "photo_key" TEXT,
    "home_school_id" UUID,
    "reports_to_user_id" UUID,
    "department" TEXT,
    "start_date" DATE,
    "status" "UserStatus" NOT NULL DEFAULT 'invited',
    "password_hash" TEXT,
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_owner" BOOLEAN NOT NULL DEFAULT false,
    "created_from_role_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "module_key" TEXT NOT NULL,
    "actions" TEXT[],
    "reach" "Reach",
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_field_permissions" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "module_key" TEXT NOT NULL,
    "field_key" TEXT NOT NULL,
    "access" "FieldAccess" NOT NULL,
    "own_record" "OwnRecordRule" NOT NULL DEFAULT 'same',
    "needs_approval" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "role_field_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_assignments" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "scope_all_schools" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_assignment_schools" (
    "organisation_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "role_assignment_schools_pkey" PRIMARY KEY ("assignment_id","school_id")
);

-- CreateTable
CREATE TABLE "automatic_role_settings" (
    "organisation_id" UUID NOT NULL,
    "switch_key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "automatic_role_settings_pkey" PRIMARY KEY ("organisation_id","switch_key")
);

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" UUID NOT NULL,
    "mobile" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "ip" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "family_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_reason" TEXT,
    "last_used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_agent" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "subject_user_ids" UUID[],
    "school_id" UUID,
    "org_wide" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limits" (
    "key" VARCHAR(255) NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "expire" BIGINT,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "schools_organisation_id_franchise_owner_user_id_idx" ON "schools"("organisation_id", "franchise_owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "schools_organisation_id_id_key" ON "schools"("organisation_id", "id");

-- CreateIndex
CREATE INDEX "users_mobile_idx" ON "users"("mobile");

-- CreateIndex
CREATE INDEX "users_organisation_id_home_school_id_idx" ON "users"("organisation_id", "home_school_id");

-- CreateIndex
CREATE INDEX "users_organisation_id_reports_to_user_id_idx" ON "users"("organisation_id", "reports_to_user_id");

-- CreateIndex
CREATE INDEX "users_organisation_id_status_idx" ON "users"("organisation_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "users_organisation_id_id_key" ON "users"("organisation_id", "id");

-- CreateIndex
CREATE INDEX "roles_organisation_id_created_from_role_id_idx" ON "roles"("organisation_id", "created_from_role_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_organisation_id_id_key" ON "roles"("organisation_id", "id");

-- CreateIndex
CREATE INDEX "role_permissions_organisation_id_role_id_idx" ON "role_permissions"("organisation_id", "role_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_organisation_id_id_key" ON "role_permissions"("organisation_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_role_id_module_key_key" ON "role_permissions"("role_id", "module_key");

-- CreateIndex
CREATE INDEX "role_field_permissions_organisation_id_role_id_idx" ON "role_field_permissions"("organisation_id", "role_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_field_permissions_organisation_id_id_key" ON "role_field_permissions"("organisation_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "role_field_permissions_role_id_module_key_field_key_key" ON "role_field_permissions"("role_id", "module_key", "field_key");

-- CreateIndex
CREATE UNIQUE INDEX "role_assignments_user_id_key" ON "role_assignments"("user_id");

-- CreateIndex
CREATE INDEX "role_assignments_organisation_id_role_id_idx" ON "role_assignments"("organisation_id", "role_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_assignments_organisation_id_id_key" ON "role_assignments"("organisation_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "role_assignments_organisation_id_user_id_key" ON "role_assignments"("organisation_id", "user_id");

-- CreateIndex
CREATE INDEX "role_assignment_schools_organisation_id_assignment_id_idx" ON "role_assignment_schools"("organisation_id", "assignment_id");

-- CreateIndex
CREATE INDEX "role_assignment_schools_organisation_id_school_id_idx" ON "role_assignment_schools"("organisation_id", "school_id");

-- CreateIndex
CREATE INDEX "otp_challenges_mobile_created_at_idx" ON "otp_challenges"("mobile", "created_at");

-- CreateIndex
CREATE INDEX "otp_challenges_expires_at_idx" ON "otp_challenges"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_refresh_token_hash_key" ON "auth_sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "auth_sessions_organisation_id_user_id_idx" ON "auth_sessions"("organisation_id", "user_id");

-- CreateIndex
CREATE INDEX "auth_sessions_family_id_idx" ON "auth_sessions"("family_id");

-- CreateIndex
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_organisation_id_id_key" ON "auth_sessions"("organisation_id", "id");

-- CreateIndex
CREATE INDEX "activity_organisation_id_created_at_idx" ON "activity"("organisation_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "activity_organisation_id_actor_user_id_idx" ON "activity"("organisation_id", "actor_user_id");

-- CreateIndex
CREATE INDEX "activity_subject_user_ids_idx" ON "activity" USING GIN ("subject_user_ids");

-- CreateIndex
CREATE UNIQUE INDEX "activity_organisation_id_id_key" ON "activity"("organisation_id", "id");

-- CreateIndex
CREATE INDEX "audit_log_organisation_id_created_at_idx" ON "audit_log"("organisation_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_organisation_id_entity_type_entity_id_idx" ON "audit_log"("organisation_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_organisation_id_actor_user_id_idx" ON "audit_log"("organisation_id", "actor_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_log_organisation_id_id_key" ON "audit_log"("organisation_id", "id");

-- CreateIndex
CREATE INDEX "rate_limits_expire_idx" ON "rate_limits"("expire");

-- AddForeignKey
ALTER TABLE "schools" ADD CONSTRAINT "schools_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schools" ADD CONSTRAINT "schools_organisation_id_franchise_owner_user_id_fkey" FOREIGN KEY ("organisation_id", "franchise_owner_user_id") REFERENCES "users"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organisation_id_home_school_id_fkey" FOREIGN KEY ("organisation_id", "home_school_id") REFERENCES "schools"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organisation_id_reports_to_user_id_fkey" FOREIGN KEY ("organisation_id", "reports_to_user_id") REFERENCES "users"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_organisation_id_created_from_role_id_fkey" FOREIGN KEY ("organisation_id", "created_from_role_id") REFERENCES "roles"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_organisation_id_role_id_fkey" FOREIGN KEY ("organisation_id", "role_id") REFERENCES "roles"("organisation_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_field_permissions" ADD CONSTRAINT "role_field_permissions_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_field_permissions" ADD CONSTRAINT "role_field_permissions_organisation_id_role_id_fkey" FOREIGN KEY ("organisation_id", "role_id") REFERENCES "roles"("organisation_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_organisation_id_user_id_fkey" FOREIGN KEY ("organisation_id", "user_id") REFERENCES "users"("organisation_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_organisation_id_role_id_fkey" FOREIGN KEY ("organisation_id", "role_id") REFERENCES "roles"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignment_schools" ADD CONSTRAINT "role_assignment_schools_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignment_schools" ADD CONSTRAINT "role_assignment_schools_organisation_id_assignment_id_fkey" FOREIGN KEY ("organisation_id", "assignment_id") REFERENCES "role_assignments"("organisation_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignment_schools" ADD CONSTRAINT "role_assignment_schools_organisation_id_school_id_fkey" FOREIGN KEY ("organisation_id", "school_id") REFERENCES "schools"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automatic_role_settings" ADD CONSTRAINT "automatic_role_settings_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_organisation_id_user_id_fkey" FOREIGN KEY ("organisation_id", "user_id") REFERENCES "users"("organisation_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity" ADD CONSTRAINT "activity_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity" ADD CONSTRAINT "activity_organisation_id_actor_user_id_fkey" FOREIGN KEY ("organisation_id", "actor_user_id") REFERENCES "users"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organisation_id_actor_user_id_fkey" FOREIGN KEY ("organisation_id", "actor_user_id") REFERENCES "users"("organisation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written below: constraints Prisma's schema language can't express.
-- ---------------------------------------------------------------------------

-- Uniqueness among live (not soft-deleted) rows only.
CREATE UNIQUE INDEX "users_org_mobile_live_key" ON "users" ("organisation_id", "mobile") WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "users_org_employee_id_live_key" ON "users" ("organisation_id", lower("employee_id")) WHERE "deleted_at" IS NULL AND "employee_id" IS NOT NULL;
CREATE UNIQUE INDEX "roles_org_name_live_key" ON "roles" ("organisation_id", lower("name")) WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "schools_org_name_live_key" ON "schools" ("organisation_id", lower("name")) WHERE "deleted_at" IS NULL;
-- Exactly one Owner role per organisation (brief 5.6: locked, seeded once).
CREATE UNIQUE INDEX "roles_one_owner_per_org_key" ON "roles" ("organisation_id") WHERE "is_owner" AND "deleted_at" IS NULL;

-- Format and range checks.
ALTER TABLE "organisations"
  ADD CONSTRAINT "organisations_opens_at_format" CHECK ("opens_at" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD CONSTRAINT "organisations_closes_at_format" CHECK ("closes_at" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  -- Night shifts crossing midnight aren't supported in v1 (brief 9.5).
  ADD CONSTRAINT "organisations_opens_before_closes" CHECK ("opens_at" < "closes_at"),
  ADD CONSTRAINT "organisations_working_days_valid" CHECK (cardinality("working_days") >= 1 AND "working_days" <@ ARRAY[0,1,2,3,4,5,6]);

ALTER TABLE "schools"
  ADD CONSTRAINT "schools_opens_at_format" CHECK ("opens_at" IS NULL OR "opens_at" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD CONSTRAINT "schools_closes_at_format" CHECK ("closes_at" IS NULL OR "closes_at" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD CONSTRAINT "schools_opens_before_closes" CHECK ("opens_at" IS NULL OR "closes_at" IS NULL OR "opens_at" < "closes_at"),
  ADD CONSTRAINT "schools_working_days_valid" CHECK ("working_days" <@ ARRAY[0,1,2,3,4,5,6]);

ALTER TABLE "users"
  ADD CONSTRAINT "users_mobile_e164" CHECK ("mobile" ~ '^\+[1-9][0-9]{7,14}$'),
  ADD CONSTRAINT "users_not_own_manager" CHECK ("reports_to_user_id" IS NULL OR "reports_to_user_id" <> "id");

ALTER TABLE "role_permissions"
  ADD CONSTRAINT "role_permissions_known_actions" CHECK ("actions" <@ ARRAY['view','create','edit','delete','assign','approve','export']::text[]);

ALTER TABLE "otp_challenges"
  ADD CONSTRAINT "otp_challenges_attempts_non_negative" CHECK ("attempts" >= 0);

-- reports_to must never form a loop: the team tree (reach "team", reporting
-- managers) is computed by walking it. The advisory lock serialises changes
-- within one organisation so two concurrent edits (A->B, B->A) can't both pass.
CREATE FUNCTION "users_prevent_reports_to_cycle"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  found boolean;
BEGIN
  IF NEW."reports_to_user_id" IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('reports_to:' || NEW."organisation_id"::text));
  WITH RECURSIVE chain(id, depth) AS (
    SELECT u."reports_to_user_id", 1
      FROM "users" u
     WHERE u."organisation_id" = NEW."organisation_id" AND u."id" = NEW."reports_to_user_id"
    UNION ALL
    SELECT u."reports_to_user_id", c.depth + 1
      FROM "users" u JOIN chain c ON u."id" = c.id
     WHERE u."organisation_id" = NEW."organisation_id" AND c.depth < 1000
  )
  SELECT EXISTS (SELECT 1 FROM chain WHERE id = NEW."id") INTO found;
  IF found OR NEW."reports_to_user_id" = NEW."id" THEN
    RAISE EXCEPTION 'reports_to_cycle' USING ERRCODE = 'P0001',
      HINT = 'This change would make someone report to themselves through their team.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "users_prevent_reports_to_cycle"
  BEFORE INSERT OR UPDATE OF "reports_to_user_id" ON "users"
  FOR EACH ROW EXECUTE FUNCTION "users_prevent_reports_to_cycle"();

-- A row never moves between organisations.
CREATE FUNCTION "prevent_organisation_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."organisation_id" IS DISTINCT FROM OLD."organisation_id" THEN
    RAISE EXCEPTION 'organisation_id_immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'schools','users','roles','role_permissions','role_field_permissions',
    'role_assignments','role_assignment_schools','automatic_role_settings',
    'auth_sessions','activity','audit_log'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OF organisation_id ON %I FOR EACH ROW EXECUTE FUNCTION prevent_organisation_change()',
      t || '_org_immutable', t);
  END LOOP;
END;
$$;
