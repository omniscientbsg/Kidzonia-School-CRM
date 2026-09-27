import type { Config } from './config.js';
import type { RateLimits } from './core/auth/rate-limits.js';
import type { TokenService } from './core/auth/tokens.js';
import type { Hooks, ScheduleRequests } from './core/hooks.js';
import type { MessageProvider } from './core/messaging.js';
import type { FileStorage } from './core/storage.js';
import type { DataAccess } from './db/index.js';
import type { Logger } from './lib/logger.js';

/** Everything the app needs from the outside world, passed in so tests can swap parts. */
export interface AppDeps {
  config: Config;
  logger: Logger;
  data: DataAccess;
  tokens: TokenService;
  rateLimits: RateLimits;
  messages: MessageProvider;
  storage: FileStorage;
  hooks: Hooks;
  /** Early runs of the task schedule for one organisation. */
  schedule: ScheduleRequests;
  now: () => Date;
}
