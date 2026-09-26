import type { Access } from '@kidzonia/shared';
import type { PreviewTarget } from '../core/access.js';
import type { LoadedPermissions } from '../core/permission-context.js';
import type { Actor, ScopedDb } from '../db/index.js';

/** The signed-in person behind a request. Only set by requireAuth. */
export interface AuthInfo {
  organisationId: string;
  userId: string;
  sessionId: string;
  /** The only database handle route code gets: scoped to this organisation. */
  db: ScopedDb;
  actor: Actor;
  /** The signed-in person's own permissions. Loaded on first use, then cached. */
  permissions(): Promise<LoadedPermissions>;
  /** Set during "Preview as this role"; everything is then read-only. */
  preview: PreviewTarget | null;
  /**
   * What this request may see and do. Route code uses this, never
   * permissions() directly, so previews are limited to what both people may see.
   */
  access(): Promise<Access>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express's own extension point
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AuthInfo;
    }
  }
}
