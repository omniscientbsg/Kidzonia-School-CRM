import type { AppDef, PageDef } from '../registry/index.js';
import { can, reachAtLeast, reachOf } from './engine.js';
import type { PermissionContext } from './types.js';

export interface MenuGroup {
  label: string;
  pages: PageDef[];
}

export interface AppNav {
  app: AppDef;
  /** Where the app tab goes: its first visible page, or its coming-soon page. */
  path: string;
  groups: MenuGroup[];
}

export interface Navigation {
  /** False for people with no role or a role that can't view anything. */
  hasAccess: boolean;
  /** App tabs in order. Home is added by the shell when `hasAccess` is true. */
  apps: AppNav[];
}

export const comingSoonPath = (appKey: string) => `/apps/${appKey}`;

function isManagerFor(ctx: PermissionContext, switchKey: string): boolean {
  if (ctx.teamUserIds.size === 0) return false;
  const sw = ctx.registry.managerSwitches().find((s) => s.key === switchKey);
  return sw !== undefined && (ctx.managerSwitches[sw.key] ?? sw.defaultOn);
}

function pageVisible(ctx: PermissionContext, moduleKey: string, page: PageDef): boolean {
  const req = page.requires;
  if (req?.ownerOnly) return ctx.role?.isOwner === true;
  if (req?.orManagerSwitch && isManagerFor(ctx, req.orManagerSwitch)) return true;
  if (!can(ctx, moduleKey, req?.action ?? 'view')) return false;
  if (req?.minReach) {
    const reach = reachOf(ctx, moduleKey);
    return reach !== null && reachAtLeast(reach, req.minReach);
  }
  return true;
}

/**
 * Builds the app tabs and left menus purely from permissions (brief 7.4).
 * Nothing here knows a role by name.
 */
export function navigationFor(ctx: PermissionContext): Navigation {
  const apps: AppNav[] = [];
  for (const app of ctx.registry.apps) {
    const modules = ctx.registry.modulesOf(app.key).filter((m) => can(ctx, m.key, 'view'));
    if (modules.length === 0) continue;

    const groups: MenuGroup[] = [];
    for (const m of modules) {
      for (const page of m.pages ?? []) {
        if (!pageVisible(ctx, m.key, page)) continue;
        let group = groups.find((g) => g.label === page.group);
        if (!group) {
          group = { label: page.group, pages: [] };
          groups.push(group);
        }
        group.pages.push(page);
      }
    }
    const first = groups[0]?.pages[0];
    const path = app.comingSoon || !first ? comingSoonPath(app.key) : first.path;
    apps.push({ app, path, groups: app.comingSoon ? [] : groups });
  }
  return { hasAccess: apps.length > 0, apps };
}
