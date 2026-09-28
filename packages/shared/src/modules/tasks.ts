import type { RegistryBuilder } from '../registry/index.js';

export const TASK_MODULES = {
  tasks: 'tasks',
  dayend: 'dayend',
  reports: 'task_reports',
  setup: 'task_setup',
  parentMessages: 'parent_messages',
} as const;

export function registerTasksApp(r: RegistryBuilder): void {
  r.registerApp({
    key: 'tasks',
    name: 'Tasks',
    description: 'Assign, track and approve work',
    icon: 'tasks',
    order: 10,
  });

  r.registerModule({
    key: TASK_MODULES.tasks,
    app: 'tasks',
    name: 'Tasks',
    description: 'Create, assign, do and approve tasks',
    actions: ['view', 'create', 'edit', 'delete', 'assign', 'approve'],
    hasReach: true,
    supportsWatchers: true,
    fields: [
      { key: 'title', label: 'Title' },
      { key: 'description', label: 'Description' },
      { key: 'category', label: 'Category', props: ['categoryId', 'category'] },
      { key: 'priority', label: 'Priority', props: ['priorityId', 'priority'] },
      {
        key: 'due',
        label: 'Due date and time',
        props: ['dueType', 'dueTime', 'dueDate', 'dueAt', 'closesAt', 'closesAfterMinutes'],
      },
      { key: 'proof', label: 'Photos and files', props: ['attachments', 'attachmentCount'] },
      { key: 'remarks', label: 'Approver remarks', props: ['remarks'] },
      { key: 'watchers', label: 'Watchers', props: ['watchers'] },
    ],
    // Custom lists join these as `list_<id>` fields per organisation (orgRegistry).
    publicProps: [
      'id',
      'kind',
      'status',
      'repeat',
      'repeatWeekdays',
      'repeatMonthDay',
      'repeatStartDate',
      'repeatEndDate',
      'createdBy',
      'createdAt',
      'updatedAt',
      'taskId',
      'serviceDate',
      'creator',
      'person',
      'subtasks',
      'subtaskCount',
      'subtasksDone',
      'needsApproval',
      'approverMode',
      'approver',
      'blocksLogout',
      'parentMessage',
      'target',
      'targetSummary',
      'submittedAt',
      'decidedAt',
      'cancelReason',
      'cancelledAt',
      'fromTemplateId',
      'progress',
      'people',
      'myCopy',
      'can',
      'questions',
      'answers',
    ],
    // Releasing someone from the logout block is allowed for anyone who can
    // approve their work (brief 9.7); it isn't a separate role checkbox.
    derivedActions: { release: ['approve'] },
    managerSwitches: [
      {
        key: 'manager_sees_team_tasks',
        label: "Sees their team's tasks",
        description: 'Reporting managers see tasks given to people who report to them.',
        defaultOn: true,
        grants: ['view'],
      },
      {
        key: 'manager_approves_team_work',
        label: "Approves their team's work",
        description: 'Reporting managers can approve or send back their team’s work.',
        defaultOn: true,
        grants: ['view', 'approve'],
      },
      {
        key: 'manager_releases_team_logout',
        label: 'Can release their team from the logout block',
        description: 'Reporting managers can let someone in their team log out for today.',
        defaultOn: true,
        grants: ['view', 'release'],
      },
    ],
    pages: [
      { key: 'my', label: 'My tasks', path: '/tasks', icon: 'tasks', group: 'Tasks' },
      {
        key: 'assigned',
        label: 'Assigned by me',
        path: '/tasks/assigned',
        icon: 'flag',
        group: 'Tasks',
        requires: { action: 'create' },
      },
      {
        key: 'team',
        label: 'My team',
        path: '/tasks/team',
        icon: 'users',
        group: 'Tasks',
        requires: { minReach: 'team', orManagerSwitch: 'manager_sees_team_tasks' },
      },
      { key: 'watching', label: 'Watching', path: '/tasks/watching', icon: 'eye', group: 'Tasks' },
      {
        key: 'approvals',
        label: 'Approvals',
        path: '/tasks/approvals',
        icon: 'check',
        group: 'Tasks',
        requires: { action: 'approve', orManagerSwitch: 'manager_approves_team_work' },
      },
    ],
  });

  r.registerModule({
    key: TASK_MODULES.dayend,
    app: 'tasks',
    name: 'Day-end reports',
    description: 'Build day-end forms and see who has submitted',
    actions: ['view', 'create', 'edit', 'delete'],
    hasReach: true,
    publicProps: ['id', 'name', 'roleIds', 'blocksLogout', 'questions', 'createdAt', 'updatedAt'],
    pages: [
      {
        key: 'dayend',
        label: 'Day-end reports',
        path: '/tasks/day-end',
        icon: 'moon',
        group: 'Track',
      },
    ],
  });

  r.registerModule({
    key: TASK_MODULES.reports,
    app: 'tasks',
    name: 'Task reports',
    description: 'Progress of people and schools',
    actions: ['view', 'export'],
    hasReach: true,
    managerSwitches: [
      {
        key: 'manager_sees_team_reports',
        label: 'Sees their team in reports',
        description: 'Reporting managers see their team’s progress in task reports.',
        defaultOn: true,
        grants: ['view'],
      },
    ],
    pages: [
      {
        key: 'reports',
        label: 'Reports',
        path: '/tasks/reports',
        icon: 'chart',
        group: 'Track',
        requires: { orManagerSwitch: 'manager_sees_team_reports' },
      },
    ],
  });

  r.registerModule({
    key: TASK_MODULES.setup,
    app: 'tasks',
    name: 'Task setup',
    description: 'Categories, priorities, lists and parent messages',
    actions: ['view', 'create', 'edit', 'delete'],
    hasReach: false,
    publicProps: ['id', 'name', 'color', 'order', 'values', 'body', 'createdAt', 'updatedAt'],
    pages: [
      { key: 'setup', label: 'Task setup', path: '/tasks/setup', icon: 'sliders', group: 'Setup' },
    ],
  });

  // Phase 6: the log of messages sent to parents (brief 9.12). Counts only;
  // parents' numbers never appear here. Limited to the person's school scope.
  r.registerModule({
    key: TASK_MODULES.parentMessages,
    app: 'tasks',
    name: 'Parent messages',
    description: 'See which parent messages were sent, held or skipped',
    actions: ['view'],
    hasReach: false,
    publicProps: [
      'id',
      'taskId',
      'taskTitle',
      'personName',
      'schoolName',
      'className',
      'templateName',
      'status',
      'skipReason',
      'recipientsCount',
      'sentCount',
      'failedCount',
      'skippedCount',
      'createdAt',
      'finishedAt',
    ],
    pages: [
      {
        key: 'parent_messages',
        label: 'Parent messages',
        path: '/tasks/parent-messages',
        icon: 'msg',
        group: 'Track',
      },
    ],
  });
}
