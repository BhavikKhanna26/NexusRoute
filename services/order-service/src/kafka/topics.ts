// Kafka topic names and consumer group IDs — hardcoded constants, never from env vars.
//
// Topic names are inter-service contracts. They must be identical across all environments.
// Putting them in .env creates a failure mode: dev uses "order-events-dev",
// prod uses "order-events", a misconfigured deployment silently drops all messages.

export const TOPICS = {
  ORDER_EVENTS:       'order-events',
  TRACKING_UPDATES:   'tracking-updates',
  SLA_ALERTS:         'sla-alerts',
  ROUTING_DECISIONS:  'routing-decisions',
  MODEL_FEEDBACK:     'model-feedback',
} as const;

// Consumer group ID is also a contract — it determines which offset position
// this service resumes from. Changing it means the consumer starts from the
// beginning (or latest, per fromBeginning setting), re-processing all history.
export const CONSUMER_GROUPS = {
  ORDER_SERVICE: 'order-service',
} as const;
