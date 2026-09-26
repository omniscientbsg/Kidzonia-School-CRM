import type { RequestHandler } from 'express';
import type { Access } from '@kidzonia/shared';
import { PREVIEW_HEADER, accessFor, resolvePreview } from '../core/access.js';
import { loadPermissions } from '../core/permission-context.js';
import type { LoadedPermissions } from '../core/permission-context.js';
import type { AppDeps } from '../deps.js';
import { idSchema } from '@kidzonia/shared';
import { setIdentity } from '../lib/context.js';
import { AppError, invalidInput, notAllowed, notLoggedIn } from '../lib/errors.js';

const BEARER = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/;

/**
 * Checks the access token and that its session is still live. The session
 * check costs one indexed lookup per request and is what makes logout,
 * deactivation and "log out everywhere" take effect immediately.
 *
 * With the preview header, the request acts as the previewed person but may
 * only see what the signed-in person may also see, and is read-only.
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
    const permissions = () =>
      (loaded ??= loadPermissions(deps.data, db, {
        id: session.userId,
        organisationId: session.organisationId,
      }));

    const previewHeader = req.get(PREVIEW_HEADER);
    let preview = null;
    if (previewHeader) {
      const target = idSchema.safeParse(previewHeader);
      if (!target.success) throw invalidInput('That preview isn’t valid.');
      preview = await resolvePreview(deps.data, db, await permissions(), target.data);
    }

    let access: Promise<Access> | undefined;
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
      permissions,
      preview,
      access: () => (access ??= permissions().then((self) => accessFor(self, preview))),
    };
    setIdentity({
      organisationId: session.organisationId,
      userId: session.userId,
      sessionId: session.id,
    });
    next();
  };
}

/** Previews are read-only: every change is refused before it reaches a handler. */
export const refuseInPreview: RequestHandler = (req, _res, next) => {
  if (req.auth?.preview)
    throw notAllowed('Preview is read-only. Exit the preview to make changes.');
  next();
};

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
