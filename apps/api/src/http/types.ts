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
  /** Loaded on first use and cached for the rest of the request. */
  permissions(): Promise<LoadedPermissions>;
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
