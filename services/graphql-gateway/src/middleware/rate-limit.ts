import { Request, Response, NextFunction } from 'express';
import { Redis } from 'ioredis';
import { appConfig } from '../config';
import { logger } from '../logger';

// Token bucket rate limiting — stored in Redis so it works correctly
// when multiple Gateway pods are running. In-memory counters would give each
// pod its own limit, effectively multiplying the allowed rate by pod count.
//
// Lua script runs atomically on Redis — no race condition between GET and SET.
const RATE_LIMIT_SCRIPT = `
local key           = KEYS[1]
local max_tokens    = tonumber(ARGV[1])
local window_secs   = tonumber(ARGV[2])
local now           = tonumber(ARGV[3])
local refill_rate   = max_tokens / window_secs   -- tokens per second

local data        = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens      = tonumber(data[1]) or max_tokens
local last_refill = tonumber(data[2]) or now

-- Add tokens based on time elapsed since last request
local elapsed     = math.max(0, now - last_refill)
local new_tokens  = math.min(max_tokens, tokens + elapsed * refill_rate)

if new_tokens < 1 then
  return 0  -- bucket empty → rejected
end

-- Consume one token and persist
redis.call('HMSET', key, 'tokens', new_tokens - 1, 'last_refill', now)
redis.call('EXPIRE', key, window_secs * 2)  -- clean up inactive sellers
return 1  -- allowed
`;

export function createRateLimiter(redis: Redis) {
  return async function rateLimitMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    // sellerId is attached by JWT middleware which runs first
    const sellerId = (req as Request & { seller?: { sellerId: string } }).seller?.sellerId;

    if (!sellerId) {
      // No seller identity yet — JWT middleware will reject unauthenticated requests.
      // Skip rate limiting and let auth handle it.
      next();
      return;
    }

    const key = `rate:seller:${sellerId}`;
    const now = Math.floor(Date.now() / 1000); // seconds

    try {
      const allowed = await redis.eval(
        RATE_LIMIT_SCRIPT,
        1,
        key,
        String(appConfig.RATE_LIMIT_MAX_TOKENS),
        String(appConfig.RATE_LIMIT_WINDOW_SECONDS),
        String(now)
      ) as number;

      if (allowed === 0) {
        logger.warn({ sellerId }, 'Rate limit exceeded');
        res.status(429).json({
          error: 'Too Many Requests',
          message: `Rate limit: ${appConfig.RATE_LIMIT_MAX_TOKENS} requests per ${appConfig.RATE_LIMIT_WINDOW_SECONDS}s`,
        });
        return;
      }

      next();
    } catch (err) {
      // Redis failure → fail open (allow request) rather than blocking all traffic.
      // Log it — this needs alerting in production.
      logger.error({ err }, 'Rate limiter Redis error — failing open');
      next();
    }
  };
}
