/**
 * The server's clock, as seen from this device. Deadlines, "Today" and
 * "Coming up" follow the organisation's server time, so a phone whose clock
 * is wrong (or a test run on a pinned date) still groups tasks correctly.
 */
let offsetMs = 0;

export function syncServerClock(serverTime: string): void {
  const t = Date.parse(serverTime);
  if (!Number.isNaN(t)) offsetMs = t - Date.now();
}

export function serverNow(): Date {
  return new Date(Date.now() + offsetMs);
}
