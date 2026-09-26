import type { RegistryBuilder } from '../registry/index.js';

/**
 * HRMS isn't built in v1. It is registered anyway, with sample fields, to
 * prove a new app plugs into roles and field permissions without Core changes.
 */
export function registerHrmsApp(r: RegistryBuilder): void {
  r.registerApp({
    key: 'hrms',
    name: 'HRMS',
    description: 'Staff records, leave and attendance',
    icon: 'users',
    order: 20,
    comingSoon: true,
  });

  r.registerModule({
    key: 'hrms_staff',
    app: 'hrms',
    name: 'Staff records',
    description: 'Coming next: staff profiles, leave and attendance',
    actions: ['view', 'create', 'edit', 'delete'],
    hasReach: true,
    comingSoon: true,
    fields: [
      { key: 'dateOfBirth', label: 'Date of birth' },
      { key: 'homeAddress', label: 'Home address' },
      { key: 'aadhaar', label: 'Aadhaar number' },
      { key: 'bankDetails', label: 'Bank details' },
      { key: 'salary', label: 'Salary' },
    ],
    publicProps: ['id', 'userId'],
  });
}
