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

/**
 * "Preview as this role": while set, every request carries the previewed
 * person's id. The server then answers as them, limited to what the signed-in
 * person may also see, and refuses every change.
 */
export interface PreviewState {
  userId: string;
  name: string;
}
const PREVIEW_KEY = 'kz.preview';
let preview: PreviewState | null = (() => {
  try {
    const raw = window.sessionStorage.getItem(PREVIEW_KEY);
    return raw ? (JSON.parse(raw) as PreviewState) : null;
  } catch {
    return null;
  }
})();

export function currentPreview(): PreviewState | null {
  return preview;
}

export function setPreview(next: PreviewState | null): void {
  preview = next;
  try {
    if (next) window.sessionStorage.setItem(PREVIEW_KEY, JSON.stringify(next));
    else window.sessionStorage.removeItem(PREVIEW_KEY);
  } catch {
    // Per-tab convenience only.
  }
}

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
  /** Send as the signed-in person even during a preview (starting one, logging out). */
  noPreview?: boolean;
}

/** Uploads a file as the raw request body (the server sniffs its real type). */
export async function upload<S extends z.ZodType>(
  path: string,
  file: Blob,
  schema: S,
  method: 'POST' | 'PUT' = 'POST',
): Promise<z.output<S>> {
  const run = () =>
    fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        ...CLIENT_HEADER,
        'Content-Type': file.type || 'application/octet-stream',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: file,
    });
  let res = await run();
  if (res.status === 401 && (await refreshSession())) res = await run();
  if (!res.ok) throw await toApiError(res);
  return schema.parse(await res.json());
}

function xhrUpload(
  path: string,
  file: Blob,
  onProgress: (fraction: number) => void,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api${path}`);
    xhr.withCredentials = true;
    for (const [k, v] of Object.entries(CLIENT_HEADER)) xhr.setRequestHeader(k, v);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    if (accessToken) xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // Not JSON (e.g. a proxy error page).
      }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => {
      reject(new Error('network'));
    };
    xhr.send(file);
  });
}

/**
 * Uploads a file with progress (weak phone networks: people see it moving and
 * can retry). Uses XMLHttpRequest because fetch can't report upload progress.
 */
export async function uploadWithProgress<S extends z.ZodType>(
  path: string,
  file: Blob,
  schema: S,
  onProgress: (fraction: number) => void,
): Promise<z.output<S>> {
  let res = await xhrUpload(path, file, onProgress);
  if (res.status === 401 && (await refreshSession())) res = await xhrUpload(path, file, onProgress);
  if (res.status < 200 || res.status >= 300) {
    const parsed = apiErrorSchema.safeParse(res.body);
    if (!parsed.success) {
      throw new ApiError(res.status, 'internal', 'The upload didn’t finish. Try again.');
    }
    const e = parsed.data.error;
    throw new ApiError(res.status, e.code, e.message, e.fields, e.details, e.requestId);
  }
  return schema.parse(res.body);
}

/** Fetches a protected file as an object URL (attachments open in a new tab or download). */
export async function fetchBlobUrl(path: string): Promise<string | null> {
  return fetchImage(path);
}

/** Fetches a protected image (e.g. the logo) as an object URL for <img>. */
export async function fetchImage(path: string): Promise<string | null> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
  if (!res.ok) return null;
  return URL.createObjectURL(await res.blob());
}

async function send(path: string, opts: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { ...CLIENT_HEADER };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (preview && !opts.noPreview) headers['X-Kidzonia-Preview'] = preview.userId;
  const init: RequestInit = {
    method: opts.method ?? 'GET',
    headers,
    credentials: 'same-origin',
  };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  return fetch(`/api${path}`, init);
}

/**
 * Downloads a file the API streams (e.g. a CSV report) with the person's
 * session, and hands it to the browser as `filename`.
 */
export async function downloadFile(path: string, filename: string): Promise<void> {
  let res = await send(path, {});
  if (res.status === 401 && (await refreshSession())) res = await send(path, {});
  if (!res.ok) throw await toApiError(res);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
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
