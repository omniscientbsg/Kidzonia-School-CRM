import type { RequestHandler } from 'express';
import { uuidv7 } from 'uuidv7';
import { runWithContext } from '../lib/context.js';

const VALID_ID = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * Gives every request an id (reusing a caller's X-Request-Id if it looks sane)
 * and runs the rest of the request inside a context the logger reads from.
 */
export const requestContext: RequestHandler = (req, res, next) => {
  const incoming = req.get('x-request-id');
  const requestId = incoming && VALID_ID.test(incoming) ? incoming : uuidv7();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  runWithContext({ requestId }, () => {
    next();
  });
};
