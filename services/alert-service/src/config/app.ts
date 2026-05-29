import { z } from 'zod';

const schema = z.object({
  PORT:             z.coerce.number().default(3003),
  NODE_ENV:         z.enum(['development', 'production', 'test']).default('development'),
  INTERNAL_API_KEY: z.string().min(1),
});

export const appConfig = schema.parse(process.env);
