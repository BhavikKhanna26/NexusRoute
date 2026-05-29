// Kafka topic names and consumer group IDs — hardcoded constants, never from env vars.
// Topic names are inter-service contracts. They must be identical across all environments.

export const TOPICS = {
  ORDER_EVENTS:      'order-events',
  TRACKING_UPDATES:  'tracking-updates',
  SLA_ALERTS:        'sla-alerts',
  ROUTING_DECISIONS: 'routing-decisions',
  MODEL_FEEDBACK:    'model-feedback',
} as const;

export const CONSUMER_GROUPS = {
  ROUTING_SERVICE: 'routing-service',
} as const;
