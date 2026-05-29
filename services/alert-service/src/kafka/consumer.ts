import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { kafkaConfig } from '../config';
import { TOPICS, CONSUMER_GROUPS } from './topics';
import { logger } from '../logger';
import { handleSlaAlert } from '../alert-handler';
import type { SlaAlertEvent } from '@nexusroute/contracts';

const kafka = new Kafka(kafkaConfig);
let consumer: Consumer;

export async function connectConsumer(): Promise<void> {
  consumer = kafka.consumer({ groupId: CONSUMER_GROUPS.ALERT_SERVICE });
  await consumer.connect();
  await consumer.subscribe({ topic: TOPICS.SLA_ALERTS, fromBeginning: false });
  await consumer.run({ eachMessage: handleMessage });
  logger.info('Kafka consumer subscribed to sla-alerts');
}

async function handleMessage({ message, topic, partition }: EachMessagePayload): Promise<void> {
  if (!message.value) return;

  let event: SlaAlertEvent;
  try {
    event = JSON.parse(message.value.toString()) as SlaAlertEvent;
  } catch {
    logger.error({ topic, partition, offset: message.offset }, 'Failed to parse message — skipping');
    return;
  }

  await handleSlaAlert(event);
}

export async function disconnectConsumer(): Promise<void> {
  await consumer?.disconnect();
  logger.info('Kafka consumer disconnected');
}
