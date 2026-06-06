import { z } from 'zod';

const schema = z.object({
  PORT:             z.coerce.number().default(3000),
  NODE_ENV:         z.enum(['development', 'production', 'test']).default('development'),
  INTERNAL_API_KEY: z.string().min(1),

  // RS256 public key — used to verify JWTs. Gateway never needs the private key.
  JWT_PUBLIC_KEY_PATH: z.string().min(1),

  // Downstream service base URLs — no trailing slash
  ORDER_SERVICE_URL:   z.string().url(),
  ROUTING_SERVICE_URL: z.string().url(),
  ALERT_SERVICE_URL:   z.string().url(),

  // Redis — for token bucket rate limiting (per-seller, across all gateway pods)
  REDIS_URL: z.string().min(1),

  // Rate limit config — externalised so ops can tune without redeploy
  RATE_LIMIT_MAX_TOKENS:    z.coerce.number().default(100),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().default(60),
});

export const appConfig = schema.parse(process.env);
