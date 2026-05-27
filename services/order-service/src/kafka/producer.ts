import { Kafka, Producer } from 'kafkajs';
import { kafkaConfig } from '../config';
import { TOPICS } from './topics';
import { logger } from '../logger';
import type { OrderCreatedEvent } from '@nexusroute/contracts';

const kafka = new Kafka(kafkaConfig);
let producer: Producer;

export async function connectProducer(): Promise<void> {
  producer = kafka.producer({ idempotent: true });
  await producer.connect();
  logger.info('Kafka producer connected');
}

export async function publishOrderCreated(event: OrderCreatedEvent): Promise<void> {
  await producer.send({
    topic: TOPICS.ORDER_EVENTS,
    messages: [{
      key: event.seller_id,
      value: JSON.stringify(event),
      headers: { trace_id: event.trace_id },
    }],
  });
}

export async function disconnectProducer(): Promise<void> {
  await producer?.disconnect();
  logger.info('Kafka producer disconnected');
}
