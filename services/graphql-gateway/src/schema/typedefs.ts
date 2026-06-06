export const typeDefs = `#graphql

  # ── Order ─────────────────────────────────────────────────────────────────
  type Order {
    order_id: ID!
    awb_number: String!
    seller_id: String!
    status: String!
    carrier_code: String
    origin_pincode: String!
    destination_pincode: String!
    weight_grams: Int!
    service_type: String!
    payment_method: String!
    promised_sla_days: Int!
    created_at: String!
    updated_at: String!
    routing_decision: RoutingDecision   # resolved via DataLoader
  }

  input CreateOrderInput {
    seller_id: String!
    origin_pincode: String!
    destination_pincode: String!
    weight_grams: Int!
    service_type: String!
    payment_method: String!
    promised_sla_days: Int!
  }

  # ── Routing ───────────────────────────────────────────────────────────────
  type CarrierCandidate {
    carrier_code: String!
    score: Float!
  }

  type RoutingDecision {
    order_id: String!
    selected_carrier_code: String!
    decision_reason: String!
    ml_rank_score: Float
    carrier_candidates: [CarrierCandidate!]!
    decided_at: String!
  }

  # ── Alerts ────────────────────────────────────────────────────────────────
  type Alert {
    id: ID!
    alert_id: String!
    awb_number: String!
    seller_id: String!
    risk_score: Float!
    status: AlertStatus!
    triggered_at: String!
    acknowledged_at: String
    resolved_at: String
  }

  enum AlertStatus {
    NOTIFIED
    ACKNOWLEDGED
    RESOLVED
  }

  type AlertChannel {
    type: String!
    address: String
    url: String
  }

  type AlertRule {
    id: ID!
    seller_id: String!
    rule_name: String!
    risk_threshold: Float!
    alert_channels: [AlertChannel!]!
    is_active: Boolean!
  }

  input AlertChannelInput {
    type: String!
    address: String
    url: String
  }

  input AlertRuleInput {
    seller_id: String!
    rule_name: String!
    risk_threshold: Float!
    alert_channels: [AlertChannelInput!]!
    is_active: Boolean
  }

  # ── Root ──────────────────────────────────────────────────────────────────
  type Query {
    order(orderId: ID!): Order
    alerts(status: AlertStatus): [Alert!]!
    alertRules: [AlertRule!]!
  }

  type Mutation {
    createOrder(input: CreateOrderInput!): Order!
    acknowledgeAlert(alertId: ID!): Alert!
    createAlertRule(input: AlertRuleInput!): AlertRule!
    updateAlertRule(id: ID!, input: AlertRuleInput!): AlertRule!
  }
`;
