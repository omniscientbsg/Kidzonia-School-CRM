import { apiErrorSchema, refreshResultSchema } from '@kidzonia/shared';
import type { ApiErrorBody, ErrorCode } from '@kidzonia/shared';
import type { z } from 'zod';

/** An error from the API, carrying its plain-English message for the screen. */
export class ApiError extends Error {
  override name = 'ApiError';
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly fields: Record<string, string> = {},
    readonly details: Record<string, unknown> = {},
    readonly requestId?: string,
  ) {
    super(message);
  }
}

const CLIENT_HEADER = { 'X-Kidzonia-Client': 'web' };

/**
 * The access token lives only in memory, never in storage a script could
 * read later; the refresh token is an httpOnly cookie the browser handles.
 */
let accessToken: string | null = null;
let onSignedOut: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function hasAccessToken(): boolean {
  return accessToken !== null;
}

/** Called when a refresh fails, so the app can return to the sign-in screen. */
export function onSessionEnded(fn: () => void): void {
  onSignedOut = fn;
}

async function toApiError(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Not JSON (e.g. a proxy error page).
  }
  const parsed = apiErrorSchema.safeParse(body);
  if (!parsed.success) {
    return new ApiError(
      res.status,
      res.status >= 500 ? 'internal' : 'invalid_input',
      res.status >= 500
        ? 'Something went wrong. Please try again.'
        : 'That request could not be completed.',
    );
  }
  const e: ApiErrorBody['error'] = parsed.data.error;
  return new ApiError(res.status, e.code, e.message, e.fields, e.details, e.requestId);
}

let refreshing: Promise<boolean> | null = null;

async function doRefresh(): Promise<boolean> {
  const res = await fetch('/api/auth/refresh', {
    method: 'POST',
    credentials: 'same-origin',
    headers: CLIENT_HEADER,
  });
  if (!res.ok) return false;
  const data = refreshResultSchema.parse(await res.json());
  setAccessToken(data.accessToken);
  return true;
}

/**
 * Swaps the refresh cookie for a new access token. Calls within one tab share
 * a single request; across tabs a Web Lock serialises them, because each
 * refresh token works only once.
 */
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      if ('locks' in navigator) {
        return await navigator.locks.request('kz-refresh', doRefresh);
      }
      return await doRefresh();
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Don't try a token refresh on 401 (sign-in endpoints). */
  noRefresh?: boolean;
}

async function send(path: string, opts: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { ...CLIENT_HEADER };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const init: RequestInit = {
    method: opts.method ?? 'GET',
    headers,
    credentials: 'same-origin',
  };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  return fetch(`/api${path}`, init);
}

/** Calls the API and validates the response with a shared schema. */
export async function api<S extends z.ZodType>(
  path: string,
  schema: S,
  opts: RequestOptions = {},
): Promise<z.output<S>> {
  let res = await send(path, opts);
  if (res.status === 401 && !opts.noRefresh) {
    if (await refreshSession()) {
      res = await send(path, opts);
    } else {
      setAccessToken(null);
      onSignedOut?.();
    }
  }
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return schema.parse(undefined);
  return schema.parse(await res.json());
}
