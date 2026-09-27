import type { PrismaClient } from '../generated/prisma/client.js';
import { Prisma } from '../generated/prisma/client.js';

/** A run that has been "running" longer than this is treated as crashed. */
const STALE_MS = 30 * 60 * 1000;

export interface JobLease {
  id: string;
  /** When the last successful run finished, if there was one. */
  lastSuccessAt: Date | null;
}

/**
 * Job runs (Phase 4 addition a). Starting a run takes a lease: a partial
 * unique index allows one "running" row per job, so a second server trying
 * at the same moment gets nothing and skips. A lease left by a crashed server
 * expires after 30 minutes.
 */
export class JobStore {
  constructor(private readonly prisma: PrismaClient) {}

  async start(job: string, now: Date, server: string): Promise<JobLease | null> {
    await this.prisma.jobRun.updateMany({
      where: { job, status: 'running', startedAt: { lt: new Date(now.getTime() - STALE_MS) } },
      data: { status: 'failed', finishedAt: now, error: 'Did not finish (server stopped?)' },
    });
    const last = await this.lastSuccess(job);
    try {
      const run = await this.prisma.jobRun.create({
        data: { job, status: 'running', startedAt: now, server },
        select: { id: true },
      });
      return { id: run.id, lastSuccessAt: last };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        await this.prisma.jobRun.create({
          data: { job, status: 'skipped', startedAt: now, finishedAt: now, server },
          select: { id: true },
        });
        return null;
      }
      throw err;
    }
  }

  async finish(
    id: string,
    now: Date,
    result: { ok: boolean; counts?: Record<string, number>; error?: string; gapFrom?: Date | null },
  ): Promise<void> {
    await this.prisma.jobRun.update({
      where: { id },
      data: {
        status: result.ok ? 'succeeded' : 'failed',
        finishedAt: now,
        counts: result.counts ?? Prisma.DbNull,
        error: result.error ?? null,
        gapFrom: result.gapFrom ?? null,
      },
      select: { id: true },
    });
  }

  async lastSuccess(job: string): Promise<Date | null> {
    const row = await this.prisma.jobRun.findFirst({
      where: { job, status: 'succeeded' },
      orderBy: { startedAt: 'desc' },
      select: { finishedAt: true },
    });
    return row?.finishedAt ?? null;
  }

  async status(job: string) {
    const [lastSuccess, last] = await Promise.all([
      this.lastSuccess(job),
      this.prisma.jobRun.findFirst({
        where: { job, status: { not: 'skipped' } },
        orderBy: { startedAt: 'desc' },
        select: { startedAt: true, status: true },
      }),
    ]);
    return {
      lastSuccessAt: lastSuccess?.toISOString() ?? null,
      lastRunAt: last?.startedAt.toISOString() ?? null,
      lastStatus: last?.status ?? null,
    };
  }

  /** Every organisation, for jobs that serve them all. */
  async organisationIds(): Promise<string[]> {
    const rows = await this.prisma.organisation.findMany({
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => r.id);
  }
}
