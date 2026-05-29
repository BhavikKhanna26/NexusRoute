import { z } from 'zod';

const schema = z.object({
  PORT:            z.coerce.number().default(3002),
  NODE_ENV:        z.enum(['development', 'production', 'test']).default('development'),
  INTERNAL_API_KEY: z.string().min(1),
  ML_SERVING_URL:  z.string().url(),
  // Circuit breaker values are configurable via env but have sensible defaults.
  // Keeping them in app.ts because they configure the ML Serving call — an app-level concern.
  ML_SERVING_TIMEOUT_MS:                  z.coerce.number().default(200),
  ML_CIRCUIT_BREAKER_FAILURE_THRESHOLD:   z.coerce.number().default(5),
  ML_CIRCUIT_BREAKER_RECOVERY_SECONDS:    z.coerce.number().default(30),
});

export const appConfig = schema.parse(process.env);
