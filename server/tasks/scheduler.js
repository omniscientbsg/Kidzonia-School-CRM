// Scheduled generator.
//
// Instances are materialized by TWO paths, on purpose:
//
//   1. This interval job — the authority. Runs at boot and every
//      TASK_SYNC_MINUTES (default 15), so occurrences appear, deferred work
//      revives and overdue flips even if nobody signs in all day.
//   2. Lazy catch-up on read (syncTasks() at the top of every task endpoint and
//      on login) — the safety net for a process that was down, restarted, or
//      never ran the job for this calendar day.
//
// Both call the same idempotent generator, keyed on sha1(task|position|date),
// so running them together cannot duplicate anything.
//
// LIMITS — this is an in-process timer, NOT a real cron:
//   * dies with the process; nothing catches up until the next boot or read
//   * multi-instance deploys would each run it (harmless here because
//     generation is idempotent, but it is wasted work and there is no lock)
//   * no persistence of run history, no alerting on failure, no backpressure
// For production, move this to a real scheduler (cron / systemd timer / a
// queue worker) calling the same syncTasks() entry point, and keep the lazy
// path as the fallback.
import { syncTasks } from './generate.js'

const DEFAULT_MINUTES = 15

let timer = null
let running = false
let lastRun = null

export function runScheduledSync({ quiet = false } = {}) {
  if (running) return null                       // never overlap a slow run
  running = true
  const startedAt = new Date()
  try {
    const result = syncTasks()
    lastRun = { at: startedAt.toISOString(), ...result, ms: Date.now() - startedAt.getTime() }
    if (!quiet && (result.created || result.revived || result.overdue)) {
      console.log(`[tasks] generated ${result.created}, revived ${result.revived}, overdue ${result.overdue}`)
    }
    return lastRun
  } catch (err) {
    lastRun = { at: startedAt.toISOString(), error: err.message }
    console.error('[tasks] scheduled sync failed:', err.message)
    return lastRun
  } finally {
    running = false
  }
}

export function startScheduler({ minutes = Number(process.env.TASK_SYNC_MINUTES) || DEFAULT_MINUTES } = {}) {
  if (timer) return timer
  runScheduledSync()                             // catch up whatever was missed while down
  timer = setInterval(() => runScheduledSync(), minutes * 60000)
  timer.unref?.()                                // never hold the process open
  console.log(`[tasks] generator scheduled every ${minutes} min (in-process timer — swap for real cron in production)`)
  return timer
}

export function stopScheduler() {
  if (timer) clearInterval(timer)
  timer = null
}

export const schedulerStatus = () => ({ running: !!timer, lastRun })
