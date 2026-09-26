import { z } from 'zod';
import { ACTIONS, REACHES } from './types.js';
import type { AppDef, FieldDef, ManagerSwitchDef, ModuleDef } from './types.js';

const keySchema = z.string().regex(/^[a-z][a-z0-9_]*$/, 'Keys are lower_snake_case');

const fieldSchema = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
  label: z.string().min(1),
  props: z.array(z.string().min(1)).min(1).optional(),
});

const moduleSchema = z
  .object({
    key: keySchema,
    app: keySchema,
    name: z.string().min(1),
    description: z.string().min(1),
    actions: z.array(z.enum(ACTIONS)).min(1),
    hasReach: z.boolean(),
    fields: z.array(fieldSchema).optional(),
    publicProps: z.array(z.string().min(1)).optional(),
    supportsWatchers: z.boolean().optional(),
    derivedActions: z.record(keySchema, z.array(z.enum(ACTIONS)).min(1)).optional(),
    managerSwitches: z
      .array(
        z.object({
          key: keySchema,
          label: z.string().min(1),
          description: z.string().min(1),
          defaultOn: z.boolean(),
          grants: z.array(z.string().min(1)).min(1),
        }),
      )
      .optional(),
    pages: z
      .array(
        z.object({
          key: keySchema,
          label: z.string().min(1),
          path: z.string().startsWith('/'),
          icon: z.string().min(1),
          group: z.string().min(1),
          requires: z
            .object({
              action: z.string().optional(),
              minReach: z.enum(REACHES).optional(),
              orManagerSwitch: z.string().optional(),
            })
            .optional(),
        }),
      )
      .optional(),
    comingSoon: z.boolean().optional(),
  })
  .superRefine((m, ctx) => {
    if (!m.actions.includes('view')) {
      ctx.addIssue({ code: 'custom', message: `Module "${m.key}" must include the view action` });
    }
    const checkable = new Set<string>([...m.actions, ...Object.keys(m.derivedActions ?? {})]);
    for (const d of Object.keys(m.derivedActions ?? {})) {
      if ((ACTIONS as readonly string[]).includes(d)) {
        ctx.addIssue({ code: 'custom', message: `Derived action "${d}" shadows a real action` });
      }
    }
    for (const s of m.managerSwitches ?? []) {
      for (const g of s.grants) {
        if (!checkable.has(g)) {
          ctx.addIssue({ code: 'custom', message: `Switch "${s.key}" grants unknown "${g}"` });
        }
      }
    }
    for (const p of m.pages ?? []) {
      if (p.requires?.action && !checkable.has(p.requires.action)) {
        ctx.addIssue({ code: 'custom', message: `Page "${p.key}" requires unknown action` });
      }
    }
    const fieldKeys = (m.fields ?? []).map((f) => f.key);
    if (new Set(fieldKeys).size !== fieldKeys.length) {
      ctx.addIssue({ code: 'custom', message: `Module "${m.key}" has duplicate field keys` });
    }
  });

const appSchema = z.object({
  key: keySchema,
  name: z.string().min(1),
  description: z.string().min(1),
  icon: z.string().min(1),
  order: z.number().int(),
  comingSoon: z.boolean().optional(),
});

export interface Registry {
  readonly apps: readonly AppDef[];
  readonly modules: readonly ModuleDef[];
  app(key: string): AppDef;
  module(key: string): ModuleDef;
  hasModule(key: string): boolean;
  modulesOf(appKey: string): readonly ModuleDef[];
  /** Every manager switch, flattened, with the module it belongs to. */
  managerSwitches(): readonly (ManagerSwitchDef & { moduleKey: string })[];
  /**
   * A copy of this registry with extra fields on one module. Used for
   * per-organisation custom lists, which become fields of `tasks`.
   */
  withExtraFields(moduleKey: string, fields: readonly FieldDef[]): Registry;
}

export interface RegistryBuilder {
  registerApp(def: AppDef): RegistryBuilder;
  registerModule(def: ModuleDef): RegistryBuilder;
  build(): Registry;
}

function freeze(apps: AppDef[], modules: ModuleDef[]): Registry {
  const appMap = new Map(apps.map((a) => [a.key, a]));
  const moduleMap = new Map(modules.map((m) => [m.key, m]));
  const sortedApps = [...apps].sort((a, b) => a.order - b.order);

  const registry: Registry = {
    apps: sortedApps,
    modules,
    app(key) {
      const a = appMap.get(key);
      if (!a) throw new Error(`Unknown app "${key}"`);
      return a;
    },
    module(key) {
      const m = moduleMap.get(key);
      // Unknown modules are programming errors, never a user-facing "no".
      if (!m) throw new Error(`Unknown module "${key}"`);
      return m;
    },
    hasModule: (key) => moduleMap.has(key),
    modulesOf: (appKey) => modules.filter((m) => m.app === appKey),
    managerSwitches: () =>
      modules.flatMap((m) => (m.managerSwitches ?? []).map((s) => ({ ...s, moduleKey: m.key }))),
    withExtraFields(moduleKey, fields) {
      const target = registry.module(moduleKey);
      const merged: ModuleDef = { ...target, fields: [...(target.fields ?? []), ...fields] };
      moduleSchema.parse(merged);
      return freeze(
        apps,
        modules.map((m) => (m.key === moduleKey ? merged : m)),
      );
    },
  };
  return registry;
}

export function createRegistry(): RegistryBuilder {
  const apps: AppDef[] = [];
  const modules: ModuleDef[] = [];

  const builder: RegistryBuilder = {
    registerApp(def) {
      appSchema.parse(def);
      if (apps.some((a) => a.key === def.key)) throw new Error(`App "${def.key}" registered twice`);
      apps.push(def);
      return builder;
    },
    registerModule(def) {
      moduleSchema.parse(def);
      if (modules.some((m) => m.key === def.key)) {
        throw new Error(`Module "${def.key}" registered twice`);
      }
      modules.push(def);
      return builder;
    },
    build() {
      for (const m of modules) {
        if (!apps.some((a) => a.key === m.app)) {
          throw new Error(`Module "${m.key}" belongs to unknown app "${m.app}"`);
        }
      }
      const switchKeys = modules.flatMap((m) => (m.managerSwitches ?? []).map((s) => s.key));
      if (new Set(switchKeys).size !== switchKeys.length) {
        throw new Error('Manager switch keys must be unique across modules');
      }
      return freeze([...apps], [...modules]);
    },
  };
  return builder;
}
