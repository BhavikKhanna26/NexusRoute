import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { kafkaConfig } from '../config';
import { TOPICS, CONSUMER_GROUPS } from './topics';
import { logger } from '../logger';
import { getNexusrouteDb } from '../db/mongo';
import { COLLECTIONS } from '../db/collections';
import type { RoutingDecidedEvent } from '@nexusroute/contracts';

const kafka = new Kafka(kafkaConfig);
let consumer: Consumer;

export async function connectConsumer(): Promise<void> {
  consumer = kafka.consumer({ groupId: CONSUMER_GROUPS.ORDER_SERVICE });
  await consumer.connect();
  await consumer.subscribe({ topic: TOPICS.ROUTING_DECISIONS, fromBeginning: false });
  await consumer.run({ eachMessage: handleRoutingDecided });
  logger.info('Kafka consumer subscribed to routing-decisions');
}

async function handleRoutingDecided({ message, topic, partition }: EachMessagePayload): Promise<void> {
  if (!message.value) return;

  let event: RoutingDecidedEvent;
  try {
    event = JSON.parse(message.value.toString());
  } catch {
    logger.error({ topic, partition, offset: message.offset }, 'Failed to parse message — skipping');
    return;
  }

  const db = getNexusrouteDb();

  // Filter includes `status: 'PENDING'` — makes this handler idempotent.
  // If Kafka delivers the same event twice, the second update finds no PENDING
  // order and is a no-op. No Redis dedup needed for this transition.
  const result = await db.collection(COLLECTIONS.OMS_SHIPMENTS).updateOne(
    { order_id: event.order_id, status: 'PENDING' },
    {
      $set: {
        carrier_code: event.selected_carrier_code,
        status: 'CARRIER_ASSIGNED',
        routing_decision_id: event.decision_id,
        updated_at: new Date(),
      },
    }
  );

  if (result.matchedCount === 0) {
    logger.warn({ order_id: event.order_id }, 'Order not in PENDING state — duplicate event, skipping');
    return;
  }

  logger.info({ order_id: event.order_id, carrier: event.selected_carrier_code }, 'Carrier assigned');
}

export async function disconnectConsumer(): Promise<void> {
  await consumer?.disconnect();
  logger.info('Kafka consumer disconnected');
}
