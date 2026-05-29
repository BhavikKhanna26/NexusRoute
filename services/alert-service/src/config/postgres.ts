import { z } from 'zod';

const schema = z.object({
  POSTGRES_URI: z.string().min(1),
});

const env = schema.parse(process.env);

export const postgresConfig = {
  uri: env.POSTGRES_URI,
};
