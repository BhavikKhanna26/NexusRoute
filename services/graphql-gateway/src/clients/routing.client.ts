import { appConfig } from '../config';
import { createServiceClient } from './http';

const client = createServiceClient(appConfig.ROUTING_SERVICE_URL);

export interface RoutingDecision {
  order_id: string;
  selected_carrier_code: string;
  decision_reason: 'ML_RANKED' | 'RULE_FALLBACK';
  ml_rank_score: number | null;
  carrier_candidates: Array<{ carrier_code: string; score: number }>;
  decided_at: string;
}

export const routingClient = {
  async getDecision(orderId: string, correlationId: string): Promise<RoutingDecision | null> {
    try {
      const { data } = await client.get<RoutingDecision>(`/routing/decisions/${orderId}`, {
        headers: { 'X-Correlation-ID': correlationId },
      });
      return data;
    } catch {
      return null;
    }
  },

  async getCircuitBreakerState(correlationId: string) {
    const { data } = await client.get('/routing/circuit-breaker', {
      headers: { 'X-Correlation-ID': correlationId },
    });
    return data;
  },
};
