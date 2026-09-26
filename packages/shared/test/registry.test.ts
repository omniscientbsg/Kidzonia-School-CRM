import { describe, expect, it } from 'vitest';
import { registry } from '../src/modules/index.js';
import { createRegistry } from '../src/registry/index.js';
import type { ModuleDef } from '../src/registry/index.js';

const app = { key: 'demo', name: 'Demo', description: 'Demo app', icon: 'grid', order: 1 };
const mod = (over: Partial<ModuleDef> = {}): ModuleDef => ({
  key: 'demo_things',
  app: 'demo',
  name: 'Things',
  description: 'Demo things',
  actions: ['view', 'edit'],
  hasReach: false,
  ...over,
});

describe('module registry', () => {
  it('contains the v1 modules with the brief’s keys', () => {
    expect(registry.modules.map((m) => m.key)).toEqual([
      'tasks',
      'dayend',
      'task_reports',
      'task_setup',
      'hrms_staff',
      'organisation',
      'schools',
      'users',
      'roles',
    ]);
  });

  it('matches the brief’s action and reach table', () => {
    const summary = Object.fromEntries(
      registry.modules.map((m) => [m.key, { actions: m.actions.join(','), reach: m.hasReach }]),
    );
    expect(summary).toEqual({
      tasks: { actions: 'view,create,edit,delete,assign,approve', reach: true },
      dayend: { actions: 'view,create,edit,delete', reach: true },
      task_reports: { actions: 'view,export', reach: true },
      task_setup: { actions: 'view,create,edit,delete', reach: false },
      hrms_staff: { actions: 'view,create,edit,delete', reach: true },
      users: { actions: 'view,create,edit,delete', reach: true },
      roles: { actions: 'view,create,edit,delete', reach: false },
      schools: { actions: 'view,create,edit,delete', reach: false },
      organisation: { actions: 'view,edit', reach: false },
    });
  });

  it('accepts a new app without any change to Core', () => {
    const r = createRegistry().registerApp(app).registerModule(mod()).build();
    expect(r.module('demo_things').name).toBe('Things');
    expect(r.modulesOf('demo')).toHaveLength(1);
  });

  it('rejects modules without view, with unknown apps, or registered twice', () => {
    expect(() => createRegistry().registerModule(mod({ actions: ['edit'] }))).toThrow(/view/);
    expect(() => createRegistry().registerModule(mod()).build()).toThrow(/unknown app/);
    expect(() =>
      createRegistry().registerApp(app).registerModule(mod()).registerModule(mod()),
    ).toThrow(/twice/);
  });

  it('rejects switches and pages that refer to unknown actions', () => {
    const bad = mod({
      managerSwitches: [
        { key: 'x', label: 'X', description: 'X', defaultOn: true, grants: ['approve'] },
      ],
    });
    expect(() => createRegistry().registerApp(app).registerModule(bad)).toThrow(/unknown/);
  });

  it('adds per-organisation custom-list fields without mutating the shared registry', () => {
    const withArea = registry.withExtraFields('tasks', [{ key: 'list_area', label: 'Area' }]);
    expect(withArea.module('tasks').fields?.map((f) => f.key)).toContain('list_area');
    expect(registry.module('tasks').fields?.map((f) => f.key)).not.toContain('list_area');
  });
});
