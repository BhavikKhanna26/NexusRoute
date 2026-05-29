import type { OrderCreatedEvent, CarrierCandidate } from '@nexusroute/contracts';

export interface RoutingResult {
  decision_id: string;
  selected_carrier_code: string;
  decision_reason: 'ML_RANKED' | 'RULE_FALLBACK';
  ml_rank_score: number | null;   // null when decision_reason === 'RULE_FALLBACK'
  carrier_candidates: CarrierCandidate[];
}

export interface RoutingStrategy {
  rank(event: OrderCreatedEvent): Promise<RoutingResult>;
}
