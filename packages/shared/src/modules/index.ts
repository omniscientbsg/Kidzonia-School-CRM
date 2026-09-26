import { createRegistry } from '../registry/index.js';
import type { Registry, RegistryBuilder } from '../registry/index.js';
import { registerHrmsApp } from './hrms.js';
import { registerSettingsApp } from './settings.js';
import { registerTasksApp } from './tasks.js';

export { TASK_MODULES } from './tasks.js';

/** Apps announced in the launcher that have no modules yet. */
function registerUpcomingApps(r: RegistryBuilder): void {
  r.registerApp({
    key: 'admissions',
    name: 'Admissions',
    description: 'From enquiry to admitted student',
    icon: 'school',
    order: 30,
    comingSoon: true,
  });
  r.registerApp({
    key: 'fees',
    name: 'Fees',
    description: 'Fee plans, invoices and receipts',
    icon: 'receipt',
    order: 40,
    comingSoon: true,
  });
  r.registerApp({
    key: 'parent_communication',
    name: 'Parent communication',
    description: 'Announcements, messages and the daily diary',
    icon: 'msg',
    order: 50,
    comingSoon: true,
  });
  r.registerApp({
    key: 'attendance',
    name: 'Attendance',
    description: 'Student and staff attendance',
    icon: 'calendar',
    order: 60,
    comingSoon: true,
  });
}

/**
 * The composition root: the only place that knows which apps exist. Adding an
 * app means adding one `registerXApp` call here and nothing in Core.
 */
export function buildDefaultRegistry(): Registry {
  const r = createRegistry();
  registerTasksApp(r);
  registerHrmsApp(r);
  registerUpcomingApps(r);
  registerSettingsApp(r);
  return r.build();
}

export const registry: Registry = buildDefaultRegistry();
