export const TOPICS = {
  ORDER_EVENTS:      'order-events',
  TRACKING_UPDATES:  'tracking-updates',
  SLA_ALERTS:        'sla-alerts',
  ROUTING_DECISIONS: 'routing-decisions',
  MODEL_FEEDBACK:    'model-feedback',
} as const;

export const CONSUMER_GROUPS = {
  ALERT_SERVICE: 'alert-service',
} as const;
