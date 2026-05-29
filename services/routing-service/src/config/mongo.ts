import { z } from 'zod';

// Routing Service only reads from the logistics cluster (RuleBasedStrategy fallback).
// It does not write to MongoDB — routing decisions go to PostgreSQL.
const schema = z.object({
  LOGISTICS_MONGODB_URI: z.string().min(1),
  LOGISTICS_MONGODB_DB:  z.string().min(1),
});

const env = schema.parse(process.env);

export const mongoConfig = {
  logistics: {
    uri: env.LOGISTICS_MONGODB_URI,
    db:  env.LOGISTICS_MONGODB_DB,
  },
};
