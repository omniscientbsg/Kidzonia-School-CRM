import type { CookieOptions, Request, RequestHandler, Response } from 'express';
import {
  passwordLoginSchema,
  requestCodeSchema,
  selectOrganisationSchema,
  verifyCodeSchema,
} from '@kidzonia/shared';
import type { AppDeps } from '../../deps.js';
import { AppError, notLoggedIn } from '../../lib/errors.js';
import type { RouteDef } from '../../http/routes.js';
import { parse } from '../../http/validate.js';
import { AuthService } from './service.js';
import type { ClientInfo, SignedIn } from './service.js';

export const REFRESH_COOKIE = 'kz_refresh';
const REFRESH_PATH = '/api/auth';

/**
 * Cookie-authenticated endpoints must carry this header. Browsers can't add a
 * custom header cross-site without a CORS preflight, which our CORS policy
 * refuses, so this blocks cross-site request forgery on top of SameSite=Strict.
 */
export const CSRF_HEADER = 'x-kidzonia-client';

const requireClientHeader: RequestHandler = (req, _res, next) => {
  if (req.get(CSRF_HEADER) !== 'web') {
    throw new AppError('not_allowed', 'This request must come from the Kidzonia app.');
  }
  next();
};

const client = (req: Request): ClientInfo => ({
  ip: req.ip ?? 'unknown',
  userAgent: req.get('user-agent') ?? null,
});

export function authRoutes(deps: AppDeps): RouteDef[] {
  const service = new AuthService(deps);
  const cookieBase: CookieOptions = {
    httpOnly: true,
    secure: deps.config.NODE_ENV === 'production',
    sameSite: 'strict',
    path: REFRESH_PATH,
  };

  const sendSignedIn = (res: Response, signed: SignedIn) => {
    if (signed.refreshToken && signed.refreshExpiresAt) {
      res.cookie(REFRESH_COOKIE, signed.refreshToken, {
        ...cookieBase,
        expires: signed.refreshExpiresAt,
      });
    }
    res.json(signed.result);
  };

  return [
    {
      method: 'post',
      path: '/auth/request-code',
      access: 'public',
      handler: async (req, res) => {
        const { mobile } = parse(requestCodeSchema, req.body);
        res.status(201).json(await service.requestCode(mobile, client(req)));
      },
    },
    {
      method: 'post',
      path: '/auth/verify-code',
      access: 'public',
      handler: async (req, res) => {
        const input = parse(verifyCodeSchema, req.body);
        sendSignedIn(res, await service.verifyCode(input.challengeId, input.code, client(req)));
      },
    },
    {
      method: 'post',
      path: '/auth/login',
      access: 'public',
      handler: async (req, res) => {
        const input = parse(passwordLoginSchema, req.body);
        sendSignedIn(res, await service.passwordLogin(input.mobile, input.password, client(req)));
      },
    },
    {
      method: 'post',
      path: '/auth/select-organisation',
      access: 'public',
      handler: async (req, res) => {
        const input = parse(selectOrganisationSchema, req.body);
        sendSignedIn(
          res,
          await service.selectOrganisation(input.selectionToken, input.organisationId, client(req)),
        );
      },
    },
    {
      method: 'post',
      path: '/auth/refresh',
      access: 'public',
      before: [requireClientHeader],
      handler: async (req, res) => {
        const token = (req.cookies as Record<string, string | undefined>)[REFRESH_COOKIE];
        if (!token) throw notLoggedIn();
        try {
          const next = await service.refresh(token, client(req));
          res.cookie(REFRESH_COOKIE, next.refreshToken, {
            ...cookieBase,
            expires: next.refreshExpiresAt,
          });
          res.json(next.result);
        } catch (err) {
          if (err instanceof AppError && err.code === 'not_logged_in') {
            res.clearCookie(REFRESH_COOKIE, cookieBase);
          }
          throw err;
        }
      },
    },
    {
      method: 'post',
      path: '/auth/logout',
      access: 'authenticated',
      // Logging out must work even while writes are blocked; it has its own guard.
      guardWrites: false,
      allowInPreview: true,
      before: [requireClientHeader],
      handler: async (req, res) => {
        const auth = req.auth;
        if (!auth) throw notLoggedIn();
        await service.logout(auth);
        res.clearCookie(REFRESH_COOKIE, cookieBase);
        res.status(204).end();
      },
    },
  ];
}
