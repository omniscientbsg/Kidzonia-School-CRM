import type { Logger } from '../lib/logger.js';

export interface InviteMessage {
  organisationName: string;
  inviterName: string | null;
  /** Where to sign in. */
  appUrl: string;
}

/**
 * Sends SMS / WhatsApp messages. OPEN DECISION 13.2: the provider (and DLT /
 * WhatsApp template registration) isn't chosen yet, so only a development
 * provider exists. Config refuses to start production with it.
 */
export interface MessageProvider {
  readonly name: string;
  sendOtp(mobile: string, code: string): Promise<void>;
  sendInvite(mobile: string, invite: InviteMessage): Promise<void>;
  /** A short notification by SMS / WhatsApp (brief 10.1: assigned, sent back, due soon). */
  sendNotification(mobile: string, text: string): Promise<void>;
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

  sendInvite(mobile: string, invite: InviteMessage): Promise<void> {
    this.logger.info({ to: mobile, invite }, 'Invite (console provider, not sent)');
    return Promise.resolve();
  }

  sendNotification(mobile: string, text: string): Promise<void> {
    this.logger.info({ to: mobile, text }, 'Notification (console provider, not sent)');
    return Promise.resolve();
  }
}

/** Collects messages in memory so tests can read the code that was "sent". */
export class MemoryMessageProvider implements MessageProvider {
  readonly name = 'memory';
  readonly sent: { mobile: string; code: string }[] = [];
  readonly invites: { mobile: string; invite: InviteMessage }[] = [];
  readonly notifications: { mobile: string; text: string }[] = [];
  /** Tests set this to make the next sends fail. */
  failNotifications = 0;

  sendNotification(mobile: string, text: string): Promise<void> {
    if (this.failNotifications > 0) {
      this.failNotifications--;
      return Promise.reject(new Error('provider down'));
    }
    this.notifications.push({ mobile, text });
    return Promise.resolve();
  }

  sendInvite(mobile: string, invite: InviteMessage): Promise<void> {
    this.invites.push({ mobile, invite });
    return Promise.resolve();
  }

  sendOtp(mobile: string, code: string): Promise<void> {
    this.sent.push({ mobile, code });
    return Promise.resolve();
  }

  lastCodeFor(mobile: string): string | undefined {
    return this.sent.findLast((m) => m.mobile === mobile)?.code;
  }
}
