export const ACTIONS = ['view', 'create', 'edit', 'delete', 'assign', 'approve', 'export'] as const;
export type Action = (typeof ACTIONS)[number];

export const ACTION_TEXT: Record<Action, { label: string; hint: string }> = {
  view: { label: 'View', hint: 'See this section in the menu' },
  create: { label: 'Create', hint: 'Add new items' },
  edit: { label: 'Edit', hint: 'Change existing items' },
  delete: { label: 'Delete', hint: 'Remove items' },
  assign: { label: 'Assign to others', hint: 'Give tasks to other people' },
  approve: { label: 'Approve work', hint: 'Approve or send back submitted work' },
  export: { label: 'Download', hint: 'Download as a spreadsheet' },
};

/** Ordered from narrowest to widest; the order is used by `reachAtLeast`. */
export const REACHES = ['own', 'team', 'school', 'all'] as const;
export type Reach = (typeof REACHES)[number];

export const REACH_TEXT: Record<Reach, string> = {
  own: 'Only their own',
  team: 'Their team',
  school: 'Their school(s)',
  all: 'All schools',
};

export const FIELD_ACCESS = ['hidden', 'view', 'edit'] as const;
export type FieldAccess = (typeof FIELD_ACCESS)[number];

export interface FieldDef {
  key: string;
  label: string;
  /**
   * Record properties this field controls. Defaults to `[key]`. A field such
   * as "Due date and time" can cover several stored properties.
   */
  props?: readonly string[];
}

export interface PageDef {
  key: string;
  label: string;
  /** Absolute client path, e.g. `/tasks/approvals`. */
  path: string;
  icon: string;
  /** Menu heading this page sits under, e.g. "Track". */
  group: string;
  requires?: {
    action?: string;
    minReach?: Reach;
    /** Also shown to reporting managers when this automatic-role switch is on. */
    orManagerSwitch?: string;
    /**
     * Only for people holding the Owner role (brief 10.4: the audit log). A
     * property of the role (`is_owner`), not its name.
     */
    ownerOnly?: boolean;
  };
}

/**
 * A reporting-manager switch (brief 6.3). When on, anyone with people reporting
 * to them gets `grants` on records about their team, whatever their role says.
 */
export interface ManagerSwitchDef {
  key: string;
  label: string;
  description: string;
  defaultOn: boolean;
  grants: readonly string[];
}

export interface ModuleDef {
  key: string;
  app: string;
  name: string;
  description: string;
  /** Actions a role can be given; shown in the role editor. Always includes view. */
  actions: readonly Action[];
  /** Whether roles pick a reach (own / team / school / all) for this module. */
  hasReach: boolean;
  fields?: readonly FieldDef[];
  /**
   * Record properties returned regardless of field permissions (ids, status,
   * timestamps). Together with `fields` this is the output whitelist: anything
   * not listed is dropped by `serialize()`.
   */
  publicProps?: readonly string[];
  /** Records of this module can have watchers (brief 6.3). */
  supportsWatchers?: boolean;
  /**
   * Capabilities that aren't role-editable actions but are checked with
   * `can()`. Each is granted by holding any of the listed actions.
   */
  derivedActions?: Readonly<Record<string, readonly Action[]>>;
  managerSwitches?: readonly ManagerSwitchDef[];
  pages?: readonly PageDef[];
  /** Not built yet: shown in the role editor and launcher, but no pages. */
  comingSoon?: boolean;
}

export interface AppDef {
  key: string;
  name: string;
  description: string;
  icon: string;
  order: number;
  comingSoon?: boolean;
}
