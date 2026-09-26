import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
  organisationId?: string;
  userId?: string;
  sessionId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Adds the signed-in identity to the current request's context (for logs). */
export function setIdentity(
  identity: Pick<RequestContext, 'organisationId' | 'userId' | 'sessionId'>,
) {
  const ctx = storage.getStore();
  if (ctx) Object.assign(ctx, identity);
}
