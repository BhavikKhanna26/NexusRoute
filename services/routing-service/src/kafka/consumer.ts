import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { kafkaConfig } from '../config';
import { TOPICS, CONSUMER_GROUPS } from './topics';
import { logger } from '../logger';
import { handleOrderCreated } from '../routing-handler';
import type { OrderCreatedEvent } from '@nexusroute/contracts';

const kafka = new Kafka(kafkaConfig);
let consumer: Consumer;

export async function connectConsumer(): Promise<void> {
  consumer = kafka.consumer({ groupId: CONSUMER_GROUPS.ROUTING_SERVICE });
  await consumer.connect();
  await consumer.subscribe({ topic: TOPICS.ORDER_EVENTS, fromBeginning: false });
  await consumer.run({ eachMessage: handleMessage });
  logger.info('Kafka consumer subscribed to order-events');
}

async function handleMessage({ message, topic, partition }: EachMessagePayload): Promise<void> {
  if (!message.value) return;

  let event: OrderCreatedEvent;
  try {
    event = JSON.parse(message.value.toString()) as OrderCreatedEvent;
  } catch {
    logger.error({ topic, partition, offset: message.offset }, 'Failed to parse message — skipping');
    return;
  }

  if (event.event_type !== 'ORDER_CREATED') {
    logger.warn({ event_type: event.event_type, topic, offset: message.offset }, 'Unexpected event type on order-events — skipping');
    return;
  }

  await handleOrderCreated(event);
}

export async function disconnectConsumer(): Promise<void> {
  await consumer?.disconnect();
  logger.info('Kafka consumer disconnected');
}
