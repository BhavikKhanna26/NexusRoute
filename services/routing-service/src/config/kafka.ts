import { z } from 'zod';

const schema = z.object({
  KAFKA_BOOTSTRAP_SERVERS: z.string().min(1),
});

const env = schema.parse(process.env);

export const kafkaConfig = {
  brokers:  env.KAFKA_BOOTSTRAP_SERVERS.split(','),
  clientId: 'routing-service',
};
