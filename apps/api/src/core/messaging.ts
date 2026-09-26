import type { Logger } from '../lib/logger.js';

/**
 * Sends SMS / WhatsApp messages. OPEN DECISION 13.2: the provider (and DLT /
 * WhatsApp template registration) isn't chosen yet, so only a development
 * provider exists. Config refuses to start production with it.
 */
export interface MessageProvider {
  readonly name: string;
  sendOtp(mobile: string, code: string): Promise<void>;
}

/** Logs messages instead of sending them. Development and tests only. */
export class ConsoleMessageProvider implements MessageProvider {
  readonly name = 'console';
  constructor(private readonly logger: Logger) {}

  sendOtp(mobile: string, code: string): Promise<void> {
    // The code is logged on purpose here: this provider never runs in production.
    this.logger.info({ to: mobile, otp: code }, 'Sign-in code (console provider, not sent)');
    return Promise.resolve();
  }
}

/** Collects messages in memory so tests can read the code that was "sent". */
export class MemoryMessageProvider implements MessageProvider {
  readonly name = 'memory';
  readonly sent: { mobile: string; code: string }[] = [];

  sendOtp(mobile: string, code: string): Promise<void> {
    this.sent.push({ mobile, code });
    return Promise.resolve();
  }

  lastCodeFor(mobile: string): string | undefined {
    return this.sent.findLast((m) => m.mobile === mobile)?.code;
  }
}
