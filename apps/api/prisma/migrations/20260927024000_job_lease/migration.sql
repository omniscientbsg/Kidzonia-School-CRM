-- One running row per job: the lease that keeps two servers from running
-- the same job at once (Phase 4 addition a).
CREATE UNIQUE INDEX "job_runs_one_running_key" ON "job_runs" ("job") WHERE "status" = 'running';
