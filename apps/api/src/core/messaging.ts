import type { Logger } from '../lib/logger.js';

export interface InviteMessage {
  organisationName: string;
  inviterName: string | null;
  /** Where to sign in. */
  appUrl: string;
}

/** One SMS / WhatsApp notification. */
export interface NotificationMessage {
  /** The person's current mobile, read at send time. */
  to: string;
  text: string;
  /**
   * The same for every attempt at the same message: the outbox row and the
   * channel (`<outboxId>:sms`). The notification worker marks sends in groups,
   * so a crash between sending and marking means the group is sent again;
   * the provider must pass this key to the vendor (its idempotency or
   * client-reference field) so the vendor drops the repeat instead of
   * texting the person twice. Adapters for vendors without such a field must
   * keep their own record of keys already sent.
   */
  idempotencyKey: string;
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
  sendNotification(message: NotificationMessage): Promise<void>;
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

  sendNotification(message: NotificationMessage): Promise<void> {
    this.logger.info(
      { to: message.to, text: message.text, idempotencyKey: message.idempotencyKey },
      'Notification (console provider, not sent)',
    );
    return Promise.resolve();
  }
}

/**
 * Collects messages in memory so tests can read the code that was "sent".
 * Notifications behave like a vendor that honours idempotency keys: a repeat
 * of a key already delivered is counted but not delivered again.
 */
export class MemoryMessageProvider implements MessageProvider {
  readonly name = 'memory';
  readonly sent: { mobile: string; code: string }[] = [];
  readonly invites: { mobile: string; invite: InviteMessage }[] = [];
  readonly notifications: { mobile: string; text: string; idempotencyKey: string }[] = [];
  /** Every call, including repeats the "vendor" dropped. */
  readonly notificationCalls: NotificationMessage[] = [];
  /** Tests set this to make the next sends fail. */
  failNotifications = 0;

  sendNotification(message: NotificationMessage): Promise<void> {
    if (this.failNotifications > 0) {
      this.failNotifications--;
      return Promise.reject(new Error('provider down'));
    }
    this.notificationCalls.push(message);
    if (!this.notifications.some((n) => n.idempotencyKey === message.idempotencyKey)) {
      this.notifications.push({
        mobile: message.to,
        text: message.text,
        idempotencyKey: message.idempotencyKey,
      });
    }
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
