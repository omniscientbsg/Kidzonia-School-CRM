import type { RegistryBuilder } from '../registry/index.js';

export function registerSettingsApp(r: RegistryBuilder): void {
  r.registerApp({
    key: 'settings',
    name: 'Settings',
    description: 'Organisation, schools, users and roles',
    icon: 'sliders',
    order: 90,
  });

  r.registerModule({
    key: 'organisation',
    app: 'settings',
    name: 'Organisation & calendar',
    description: 'Organisation details, working days and holidays',
    actions: ['view', 'edit'],
    hasReach: false,
    publicProps: [
      'id',
      'name',
      'logoUrl',
      'setupType',
      'schoolModel',
      'timezone',
      'workingDays',
      'opensAt',
      'closesAt',
      'createdAt',
      'updatedAt',
    ],
    pages: [
      {
        key: 'organisation',
        label: 'Organisation',
        path: '/settings/organisation',
        icon: 'building',
        group: 'Settings',
      },
    ],
  });

  r.registerModule({
    key: 'schools',
    app: 'settings',
    name: 'Schools',
    description: 'Add schools and mark them COCO or franchise',
    actions: ['view', 'create', 'edit', 'delete'],
    hasReach: false,
    fields: [
      { key: 'name', label: 'School name' },
      { key: 'city', label: 'City' },
      { key: 'type', label: 'COCO or franchise' },
      {
        key: 'franchiseOwner',
        label: 'Franchise owner',
        props: ['franchiseOwnerUserId', 'franchiseOwnerName'],
      },
      { key: 'principal', label: 'Principal', props: ['principalUserId', 'principalName'] },
    ],
    publicProps: [
      'id',
      'state',
      'workingDays',
      'opensAt',
      'closesAt',
      'peopleCount',
      'createdAt',
      'updatedAt',
    ],
    pages: [
      {
        key: 'schools',
        label: 'Schools',
        path: '/settings/schools',
        icon: 'school',
        group: 'Settings',
      },
    ],
  });

  r.registerModule({
    key: 'users',
    app: 'settings',
    name: 'Users',
    description: 'Add people and manage their details',
    actions: ['view', 'create', 'edit', 'delete'],
    hasReach: true,
    fields: [
      { key: 'fullName', label: 'Full name' },
      { key: 'mobile', label: 'Mobile number' },
      { key: 'email', label: 'Email' },
      { key: 'employeeId', label: 'Employee ID' },
      { key: 'school', label: 'School', props: ['homeSchoolId', 'homeSchoolName'] },
      { key: 'reportsTo', label: 'Reports to', props: ['reportsToUserId', 'reportsToName'] },
    ],
    publicProps: [
      'id',
      'jobTitle',
      'photoUrl',
      'department',
      'startDate',
      'status',
      'role',
      'directReportsCount',
      'invitedAt',
      'lastLoginAt',
      'createdAt',
      'updatedAt',
    ],
    pages: [
      { key: 'users', label: 'Users', path: '/settings/users', icon: 'users', group: 'Settings' },
    ],
  });

  r.registerModule({
    key: 'roles',
    app: 'settings',
    name: 'Roles & permissions',
    description: 'Create roles and decide what they can do',
    actions: ['view', 'create', 'edit', 'delete'],
    hasReach: false,
    publicProps: [
      'id',
      'name',
      'description',
      'isOwner',
      'createdFromRoleId',
      'peopleCount',
      'createdAt',
      'updatedAt',
    ],
    pages: [
      {
        key: 'roles',
        label: 'Roles & permissions',
        path: '/settings/roles',
        icon: 'shield',
        group: 'Settings',
      },
    ],
  });
}
