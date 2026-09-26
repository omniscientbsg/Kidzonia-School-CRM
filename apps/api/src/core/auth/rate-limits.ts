import type pg from 'pg';
import { RateLimiterPostgres, RateLimiterRes } from 'rate-limiter-flexible';
import type { Config } from '../../config.js';
import { tooManyRequests } from '../../lib/errors.js';

const TEN_MINUTES = 10 * 60;
const FIFTEEN_MINUTES = 15 * 60;
const DAY = 24 * 60 * 60;

function limiter(pool: pg.Pool, keyPrefix: string, points: number, duration: number) {
  return new RateLimiterPostgres({
    storeClient: pool,
    storeType: 'pool',
    tableName: 'rate_limits',
    // The table is created by a Prisma migration, not by the library.
    tableCreated: true,
    clearExpiredByTimeout: false,
    keyPrefix,
    points,
    duration,
  });
}

/**
 * Sign-in abuse limits, stored in Postgres so they hold across restarts and
 * replicas. Codes have short-window and daily caps per mobile and per IP; the
 * daily caps protect against SMS-pumping costs. All numbers come from config.
 */
export class RateLimits {
  private readonly otp: RateLimiterPostgres[];
  private readonly otpByMobile: RateLimiterPostgres[];
  private readonly login: RateLimiterPostgres[];
  private readonly loginByMobile: RateLimiterPostgres[];

  constructor(pool: pg.Pool, config: Config) {
    this.otpByMobile = [
      limiter(pool, 'otp_m10', config.RL_OTP_PER_MOBILE_10MIN, TEN_MINUTES),
      limiter(pool, 'otp_md', config.RL_OTP_PER_MOBILE_DAY, DAY),
    ];
    this.otp = [
      limiter(pool, 'otp_ip10', config.RL_OTP_PER_IP_10MIN, TEN_MINUTES),
      limiter(pool, 'otp_ipd', config.RL_OTP_PER_IP_DAY, DAY),
    ];
    this.loginByMobile = [
      limiter(pool, 'login_m', config.RL_LOGIN_PER_MOBILE_15MIN, FIFTEEN_MINUTES),
    ];
    this.login = [limiter(pool, 'login_ip', config.RL_LOGIN_PER_IP_15MIN, FIFTEEN_MINUTES)];
  }

  private async consume(
    ipLimiters: RateLimiterPostgres[],
    mobileLimiters: RateLimiterPostgres[],
    ip: string,
    mobile: string,
    message: string,
  ): Promise<void> {
    const attempts = [
      ...ipLimiters.map((l) => l.consume(ip)),
      ...mobileLimiters.map((l) => l.consume(mobile)),
    ];
    const results = await Promise.allSettled(attempts);
    let wait = 0;
    for (const r of results) {
      if (r.status === 'rejected') {
        // The library rejects with RateLimiterRes when over the limit, or an Error if the store fails.
        if (r.reason instanceof RateLimiterRes) wait = Math.max(wait, r.reason.msBeforeNext / 1000);
        else throw r.reason;
      }
    }
    if (wait > 0) throw tooManyRequests(message, wait);
  }

  consumeOtpRequest(ip: string, mobile: string): Promise<void> {
    return this.consume(
      this.otp,
      this.otpByMobile,
      ip,
      mobile,
      'Too many codes requested. Please wait before trying again.',
    );
  }

  consumeLoginAttempt(ip: string, mobile: string): Promise<void> {
    return this.consume(
      this.login,
      this.loginByMobile,
      ip,
      mobile,
      'Too many sign-in attempts. Please wait before trying again.',
    );
  }
}
