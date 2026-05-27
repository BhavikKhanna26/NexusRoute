import { z } from 'zod';

const schema = z.object({
  KAFKA_BOOTSTRAP_SERVERS: z.string().min(1),
});

const env = schema.parse(process.env);

export const kafkaConfig = {
  // Split on comma so multiple brokers work: "broker1:9092,broker2:9092"
  brokers: env.KAFKA_BOOTSTRAP_SERVERS.split(','),
  // clientId tags this service in Kafka broker logs — useful when debugging consumer lag
  clientId: 'order-service',
};
