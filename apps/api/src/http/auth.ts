import type { RequestHandler } from 'express';
import { loadPermissions } from '../core/permission-context.js';
import type { LoadedPermissions } from '../core/permission-context.js';
import type { AppDeps } from '../deps.js';
import { setIdentity } from '../lib/context.js';
import { AppError, notLoggedIn } from '../lib/errors.js';

const BEARER = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/;

/**
 * Checks the access token and that its session is still live. The session
 * check costs one indexed lookup per request and is what makes logout,
 * deactivation and "log out everywhere" take effect immediately.
 */
export function requireAuth(deps: AppDeps): RequestHandler {
  return async (req, _res, next) => {
    const match = BEARER.exec(req.get('authorization') ?? '');
    if (!match?.[1]) throw notLoggedIn('Please sign in.');
    const now = deps.now();
    const claims = await deps.tokens.verifyAccess(match[1], now);
    if (!claims) throw notLoggedIn();
    const session = await deps.data.auth.liveSession(claims.sessionId, now);
    if (
      !session ||
      session.userId !== claims.userId ||
      session.organisationId !== claims.organisationId
    ) {
      throw notLoggedIn();
    }

    const db = deps.data.forOrganisation(session.organisationId);
    let loaded: Promise<LoadedPermissions> | undefined;
    req.auth = {
      organisationId: session.organisationId,
      userId: session.userId,
      sessionId: session.id,
      db,
      actor: {
        organisationId: session.organisationId,
        userId: session.userId,
        requestId: req.requestId,
      },
      permissions: () =>
        (loaded ??= loadPermissions(deps.data, db, {
          id: session.userId,
          organisationId: session.organisationId,
        })),
    };
    setIdentity({
      organisationId: session.organisationId,
      userId: session.userId,
      sessionId: session.id,
    });
    next();
  };
}

/**
 * Runs the write guards apps register (e.g. the Tasks logout block, brief 9.7).
 * Reads always stay open.
 */
export function writeGuard(deps: AppDeps): RequestHandler {
  return async (req, _res, next) => {
    const auth = req.auth;
    if (!auth || deps.hooks.writeGuards.length === 0) {
      next();
      return;
    }
    const subject = { organisationId: auth.organisationId, userId: auth.userId, now: deps.now() };
    for (const guard of deps.hooks.writeGuards) {
      const refusal = await guard(subject);
      if (refusal) throw new AppError('logout_blocked', refusal);
    }
    next();
  };
}
