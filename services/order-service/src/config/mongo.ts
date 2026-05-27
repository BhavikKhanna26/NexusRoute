import { z } from 'zod';

const schema = z.object({
  LOGISTICS_MONGODB_URI: z.string().min(1),
  LOGISTICS_MONGODB_DB:  z.string().min(1),
  NEXUSROUTE_MONGODB_URI: z.string().min(1),
  NEXUSROUTE_MONGODB_DB:  z.string().min(1),
});

const env = schema.parse(process.env);

export const mongoConfig = {
  logistics: {
    uri: env.LOGISTICS_MONGODB_URI,
    db:  env.LOGISTICS_MONGODB_DB,
  },
  nexusroute: {
    uri: env.NEXUSROUTE_MONGODB_URI,
    db:  env.NEXUSROUTE_MONGODB_DB,
  },
};
