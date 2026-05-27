// Kafka event contracts — the single source of truth for all message schemas.
//
// Every service that produces or consumes a topic imports from here.
// If a schema changes, TypeScript surfaces every broken producer/consumer immediately.
// Without this, a field rename in the producer silently breaks the consumer.

export type ServiceType = 'SURFACE' | 'EXPRESS' | 'OVERNIGHT';
export type PaymentMethod = 'COD' | 'PREPAID';

// ─── order-events (topic) ─────────────────────────────────────────────────────
// Producer : Order Service
// Consumer : Routing Service

export interface OrderCreatedEvent {
  event_id: string;          // UUID — used for idempotency dedup by consumer
  event_type: 'ORDER_CREATED';
  awb_number: string;
  order_id: string;
  seller_id: string;
  origin_pincode: string;
  destination_pincode: string;
  weight_grams: number;
  service_type: ServiceType;
  payment_method: PaymentMethod;
  promised_sla_days: number;
  created_at: string;        // ISO 8601
  trace_id: string;
}

// ─── routing-decisions (topic) ────────────────────────────────────────────────
// Producer : Routing Service
// Consumer : Order Service

export interface CarrierCandidate {
  carrier_code: string;
  score: number;
}

export interface RoutingDecidedEvent {
  decision_id: string;
  order_id: string;
  awb_number: string;
  seller_id: string;
  selected_carrier_code: string;
  decision_reason: 'ML_RANKED' | 'RULE_FALLBACK';
  ml_rank_score: number | null;
  carrier_candidates: CarrierCandidate[];
  decided_at: string;
  trace_id: string;
}

// ─── tracking-updates (topic) ─────────────────────────────────────────────────
// Producer : Tracking Ingestion Service (Go)
// Consumer : SLA Monitoring Service (Go)

export interface TrackingUpdateEvent {
  event_id: string;
  awb_number: string;
  carrier_code: string;
  seller_id: string;
  scan_datetime: string;
  status_code: string;
  location: string;
  location_pincode: string;
  raw_status: string;
  trace_id: string;
}

// ─── sla-alerts (topic) ───────────────────────────────────────────────────────
// Producer : SLA Monitoring Service (Go)
// Consumer : Alert Service

export interface SlaAlertEvent {
  alert_id: string;
  awb_number: string;
  carrier_code: string;
  seller_id: string;
  risk_score: number;
  prediction_id: string;
  origin_pincode: string;
  destination_pincode: string;
  promised_delivery_date: string;
  days_to_promised_delivery: number;
  triggered_at: string;
  trace_id: string;
}

// ─── model-feedback (topic) ───────────────────────────────────────────────────
// Producer : Order Service (on delivery scan)
// Consumer : ML batch pipeline

export interface ModelFeedbackEvent {
  feedback_id: string;
  prediction_id: string;
  awb_number: string;
  actual_outcome: 'DELIVERED_ON_TIME' | 'BREACHED';
  actual_delivery_date: string;
  promised_delivery_date: string;
  days_delayed: number;
  feedback_at: string;
}
